import { createServer, type IncomingMessage, type Server as HttpServer, type ServerResponse } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';

import {
  filterClauseSchema,
  sortDefinitionSchema,
  type FilterClause,
  type SearchScope,
  type SortDefinition,
} from '../shared/asset-types';
import { parseSearchExpression } from '../shared/search-expression';
import {
  WEB_SHARE_SESSION_COOKIE,
  WEB_SHARE_SESSION_TTL_MS,
  webShareSettingsSnapshotSchema,
  type WebShareLibrarySummary,
  type WebShareRuntimeState,
  type WebShareServerPreferences,
  type WebShareSettingsSnapshot,
} from '../shared/web-share';
import {
  createWebSharePasswordRecord,
  verifyWebSharePassword,
  WebShareLoginThrottle,
  WebShareSessionSigner,
} from './web-share-auth';
import { WebShareDataError, type WebShareDataProvider } from './web-share-data';
import { WebShareSettingsStore } from './web-share-settings-store';

export interface WebShareLogger {
  info(scope: string, message: string, context?: Record<string, unknown>): void;
  error(scope: string, error: unknown, context?: Record<string, unknown>): void;
}

export interface WebShareServerOptions {
  data: WebShareDataProvider;
  userDataPath: string;
  logger: WebShareLogger;
  /** Built web client directory. When absent only the API is served. */
  staticRootDir?: string | null;
  now?: () => number;
  onSnapshotChanged?: (snapshot: WebShareSettingsSnapshot) => void;
}

export class WebShareServerError extends Error {
  readonly code:
    | 'WEB_SHARE_SERVER_NOT_ENABLED'
    | 'WEB_SHARE_PASSWORD_REQUIRED'
    | 'WEB_SHARE_PORT_UNAVAILABLE'
    | 'WEB_SHARE_START_FAILED'
    | 'WEB_SHARE_STOP_FAILED';

  constructor(code: WebShareServerError['code'], message: string) {
    super(message);
    this.name = 'WebShareServerError';
    this.code = code;
  }
}

const MAX_LOGIN_BODY_BYTES = 4 * 1024;
const LOOPBACK_ADDRESS = '127.0.0.1';
const CONTENT_TYPES: Readonly<Record<string, string>> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.map': 'application/json; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
};

const SECURITY_HEADERS: Readonly<Record<string, string>> = {
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  'X-Frame-Options': 'DENY',
  'Cross-Origin-Resource-Policy': 'same-origin',
};

/**
 * Loopback-only read-only sharing server. Main owns the listener; the desktop
 * operator points a tunnel client (e.g. an FRP client) at
 * `http://127.0.0.1:<port>`. It never exposes a write command and never returns
 * an absolute filesystem path.
 */
export class WebShareServer {
  readonly #data: WebShareDataProvider;
  readonly #logger: WebShareLogger;
  readonly #store: WebShareSettingsStore;
  readonly #throttle = new WebShareLoginThrottle();
  readonly #now: () => number;
  readonly #staticRootDir: string | null;
  readonly #onSnapshotChanged: WebShareServerOptions['onSnapshotChanged'];
  readonly #snapshotListeners = new Set<(snapshot: WebShareSettingsSnapshot) => void>();
  readonly #sessions = new Map<string, number>();
  #signer: WebShareSessionSigner;
  #libraries: WebShareLibrarySummary[] = [];
  #runtime: WebShareRuntimeState = { status: 'stopped' };
  #httpServer: HttpServer | undefined;
  #startPromise: Promise<WebShareSettingsSnapshot> | undefined;

  constructor(options: WebShareServerOptions) {
    this.#data = options.data;
    this.#logger = options.logger;
    this.#store = new WebShareSettingsStore(options.userDataPath);
    this.#now = options.now ?? Date.now;
    this.#staticRootDir = options.staticRootDir ?? null;
    this.#onSnapshotChanged = options.onSnapshotChanged;
    this.#signer = new WebShareSessionSigner(
      this.#store.sessionSecret,
      WEB_SHARE_SESSION_TTL_MS,
    );
  }

  get preferences(): WebShareServerPreferences {
    return this.#store.preferences;
  }

  snapshot(): WebShareSettingsSnapshot {
    this.#pruneSessions();
    const runtime: WebShareRuntimeState = this.#runtime.status === 'running'
      ? { ...this.#runtime, connectedSessionCount: this.#sessions.size }
      : this.#runtime;
    return webShareSettingsSnapshotSchema.parse({
      preferences: this.#store.preferences,
      runtime,
      hasPassword: this.#store.password !== null,
      libraries: this.#libraries,
    });
  }

  onSnapshot(listener: (snapshot: WebShareSettingsSnapshot) => void): () => void {
    this.#snapshotListeners.add(listener);
    return () => this.#snapshotListeners.delete(listener);
  }

  async initialize(): Promise<void> {
    await this.refreshLibraries().catch(() => undefined);
    if (this.#store.preferences.enabled) {
      try {
        await this.start();
      } catch (error) {
        this.#logger.error('web-share.initialize', error);
      }
    }
  }

  /** Refresh the open-library projection shown to the desktop and visitors. */
  async refreshLibraries(): Promise<WebShareSettingsSnapshot> {
    try {
      this.#libraries = await this.#data.listLibraries();
    } catch (error) {
      this.#logger.error('web-share.libraries', error);
      this.#libraries = [];
    }
    return this.#publish();
  }

  async setEnabled(enabled: boolean): Promise<WebShareSettingsSnapshot> {
    this.#store.setPreferences({ enabled });
    if (!enabled && this.#runtime.status !== 'stopped') await this.stop();
    if (enabled && this.#runtime.status === 'stopped') await this.start();
    return this.#publish();
  }

  async setPort(port: number): Promise<WebShareSettingsSnapshot> {
    const wasRunning = this.#runtime.status === 'running';
    if (wasRunning) await this.stop();
    this.#store.setPreferences({ port });
    if (wasRunning) await this.start();
    return this.#publish();
  }

  setAllowDownload(enabled: boolean): WebShareSettingsSnapshot {
    this.#store.setPreferences({ allowDownload: enabled });
    return this.#publish();
  }

  setLibrary(libraryId: string | null): WebShareSettingsSnapshot {
    this.#store.setPreferences({ sharedLibraryId: libraryId });
    return this.#publish();
  }

  setPassword(password: string): WebShareSettingsSnapshot {
    this.#store.setPassword(createWebSharePasswordRecord(password));
    this.#invalidateSessions();
    return this.#publish();
  }

  clearPassword(): WebShareSettingsSnapshot {
    this.#store.clearPassword();
    this.#invalidateSessions();
    return this.#publish();
  }

  #invalidateSessions(): void {
    this.#sessions.clear();
    this.#signer = new WebShareSessionSigner(
      this.#store.rotateSessionSecret(),
      WEB_SHARE_SESSION_TTL_MS,
    );
  }

  async start(): Promise<WebShareSettingsSnapshot> {
    if (!this.#store.preferences.enabled) {
      throw new WebShareServerError(
        'WEB_SHARE_SERVER_NOT_ENABLED',
        'Enable web sharing before starting it.',
      );
    }
    if (this.#runtime.status === 'running') return this.snapshot();
    if (this.#startPromise !== undefined) return this.#startPromise;
    this.#startPromise = this.#startInternal().finally(() => {
      this.#startPromise = undefined;
    });
    return this.#startPromise;
  }

  async stop(): Promise<WebShareSettingsSnapshot> {
    const pending = this.#startPromise;
    if (pending !== undefined) {
      try {
        await pending;
      } catch {
        // A failed start still leaves the lifecycle normalizable below.
      }
    }
    if (this.#runtime.status === 'stopped') return this.snapshot();
    this.#runtime = { status: 'stopping' };
    this.#publish();
    const server = this.#httpServer;
    this.#httpServer = undefined;
    this.#sessions.clear();
    try {
      if (server !== undefined) await closeHttpServer(server);
      this.#runtime = { status: 'stopped' };
      return this.#publish();
    } catch (error) {
      this.#runtime = {
        status: 'error',
        code: 'WEB_SHARE_STOP_FAILED',
        message: 'The web share server could not stop cleanly.',
      };
      this.#logger.error('web-share.stop', error);
      this.#publish();
      throw new WebShareServerError(
        'WEB_SHARE_STOP_FAILED',
        'The web share server could not stop cleanly.',
      );
    }
  }

  async close(): Promise<void> {
    if (this.#runtime.status !== 'stopped') {
      await this.stop().catch((error: unknown) => {
        this.#logger.error('web-share.close', error);
      });
    }
  }

  async #startInternal(): Promise<WebShareSettingsSnapshot> {
    await this.refreshLibraries().catch(() => undefined);
    const port = this.#store.preferences.port;
    this.#runtime = { status: 'starting' };
    this.#publish();
    const server = createServer((request, response) => {
      void this.#handleRequest(request, response).catch((error: unknown) => {
        this.#logger.error('web-share.request', error, {
          method: request.method,
          url: request.url,
        });
        if (!response.headersSent) {
          writeJson(response, 500, { error: 'The request failed.', code: 'WEB_SHARE_INTERNAL' });
        } else {
          response.end();
        }
      });
    });
    try {
      await new Promise<void>((resolve, reject) => {
        const onError = (error: Error): void => {
          server.removeListener('listening', onListening);
          reject(error);
        };
        const onListening = (): void => {
          server.removeListener('error', onError);
          resolve();
        };
        server.once('error', onError);
        server.once('listening', onListening);
        server.listen(port, LOOPBACK_ADDRESS);
      });
    } catch (error) {
      const unavailable = isPortUnavailable(error);
      this.#runtime = {
        status: 'error',
        code: unavailable ? 'WEB_SHARE_PORT_UNAVAILABLE' : 'WEB_SHARE_START_FAILED',
        message: unavailable
          ? `Port ${port} is unavailable.`
          : 'The web share server could not start.',
      };
      this.#logger.error('web-share.start', error, { port });
      this.#publish();
      throw new WebShareServerError(this.#runtime.code, this.#runtime.message);
    }
    this.#httpServer = server;
    server.on('error', (error) => {
      if (this.#httpServer !== server) return;
      this.#logger.error('web-share.runtime', error, { port });
      this.#httpServer = undefined;
      this.#runtime = {
        status: 'error',
        code: 'WEB_SHARE_START_FAILED',
        message: 'The web share server encountered a listener error.',
      };
      void closeHttpServer(server).catch(() => undefined);
      this.#publish();
    });
    this.#runtime = {
      status: 'running',
      address: `http://${LOOPBACK_ADDRESS}:${port}`,
      port,
      connectedSessionCount: 0,
      startedAt: new Date(this.#now()).toISOString(),
    };
    this.#logger.info('web-share.started', 'Web share server started.', {
      port,
      address: LOOPBACK_ADDRESS,
    });
    return this.#publish();
  }

  async #handleRequest(request: IncomingMessage, response: ServerResponse): Promise<void> {
    for (const [name, value] of Object.entries(SECURITY_HEADERS)) {
      response.setHeader(name, value);
    }
    response.setHeader('Connection', 'close');
    request.on('error', () => {
      // The socket is destroyed by Node; nothing to do.
    });

    // Host is intentionally not allowlisted: a tunnel (FRP) forwards the
    // visitor's public Host header. Access control is the share password plus
    // the loopback-only bind, not the Host header.
    const url = new URL(request.url ?? '/', `http://${LOOPBACK_ADDRESS}`);
    const pathname = url.pathname;

    if (request.method === 'GET' && pathname === '/api/health') {
      writeJson(response, 200, { app: 'Serpent' });
      return;
    }

    if (request.method === 'POST' && pathname === '/api/session') {
      await this.#handleLogin(request, response);
      return;
    }

    if (request.method === 'DELETE' && pathname === '/api/session') {
      response.setHeader('Set-Cookie', clearSessionCookie());
      writeJson(response, 200, { ok: true });
      return;
    }

    if (pathname.startsWith('/api/')) {
      if (!this.#authorize(request, response)) {
        request.resume();
        return;
      }
      await this.#handleApi(request, response, url, pathname);
      return;
    }

    await this.#serveStatic(request, response, pathname);
  }

  #authorize(request: IncomingMessage, response: ServerResponse): boolean {
    if (this.#store.password === null) {
      writeJson(response, 409, {
        error: 'Web sharing has no password yet.',
        code: 'WEB_SHARE_PASSWORD_REQUIRED',
      });
      return false;
    }
    const cookie = parseCookies(request.headers.cookie)[WEB_SHARE_SESSION_COOKIE];
    if (cookie === undefined || !this.#signer.verify(cookie, this.#now())) {
      writeJson(response, 401, { error: 'Authentication required.', code: 'WEB_SHARE_UNAUTHORIZED' });
      return false;
    }
    this.#sessions.set(cookie, this.#now());
    return true;
  }

  async #handleLogin(request: IncomingMessage, response: ServerResponse): Promise<void> {
    if (this.#store.password === null) {
      writeJson(response, 409, {
        error: 'Web sharing has no password yet.',
        code: 'WEB_SHARE_PASSWORD_REQUIRED',
      });
      request.resume();
      return;
    }
    const remoteKey = request.socket.remoteAddress ?? 'unknown';
    if (this.#throttle.isBlocked(remoteKey)) {
      const retryAfterMs = this.#throttle.blockedForMs(remoteKey);
      response.setHeader('Retry-After', String(Math.ceil(retryAfterMs / 1000)));
      writeJson(response, 429, { error: 'Too many attempts.', code: 'WEB_SHARE_TOO_MANY_ATTEMPTS' });
      request.resume();
      return;
    }

    const body = await readJsonBody(request, MAX_LOGIN_BODY_BYTES).catch(() => undefined);
    const password = isRecord(body) && typeof body.password === 'string' ? body.password : undefined;
    const record = this.#store.password;
    if (password === undefined || record === null || !verifyWebSharePassword(password, record)) {
      this.#throttle.recordFailure(remoteKey);
      writeJson(response, 401, { error: 'Incorrect password.', code: 'WEB_SHARE_INVALID_PASSWORD' });
      return;
    }
    this.#throttle.reset(remoteKey);
    const token = this.#signer.issue(this.#now());
    this.#sessions.set(token, this.#now());
    response.setHeader('Set-Cookie', sessionCookie(token));
    writeJson(response, 200, { ok: true });
  }

  async #handleApi(
    request: IncomingMessage,
    response: ServerResponse,
    url: URL,
    pathname: string,
  ): Promise<void> {
    if (request.method !== 'GET') {
      writeJson(response, 405, { error: 'Method not allowed.', code: 'WEB_SHARE_METHOD_NOT_ALLOWED' });
      return;
    }
    const segments = pathname.split('/').filter((segment) => segment.length > 0);
    // segments[0] === 'api'
    const rest = segments.slice(1);

    if (rest.length === 1 && rest[0] === 'state') {
      writeJson(response, 200, this.#buildState());
      return;
    }

    if (rest[0] !== 'libraries' || rest.length < 2) {
      writeJson(response, 404, { error: 'Not found.', code: 'WEB_SHARE_NOT_FOUND' });
      return;
    }

    const libraryId = decodeURIComponent(rest[1]!);
    if (!this.#isSharedLibrary(libraryId)) {
      writeJson(response, 404, { error: 'Library not shared.', code: 'WEB_SHARE_LIBRARY_NOT_SHARED' });
      return;
    }

    try {
      const payload = await this.#resolveLibraryRoute(rest, url);
      if (payload === NOT_FOUND) {
        writeJson(response, 404, { error: 'Not found.', code: 'WEB_SHARE_NOT_FOUND' });
        return;
      }
      writeJson(response, 200, payload);
    } catch (error) {
      if (error instanceof WebShareDataError) {
        const status = error.code === 'WEB_SHARE_ASSET_NOT_FOUND' ? 404 : 502;
        writeJson(response, status, { error: 'The library request failed.', code: error.code });
        return;
      }
      throw error;
    }
  }

  async #resolveLibraryRoute(rest: string[], url: URL): Promise<unknown> {
    const libraryId = decodeURIComponent(rest[1]!);
    const resource = rest[2];
    if (resource === undefined) return NOT_FOUND;

    if (resource === 'folders' && rest.length === 3) {
      return { folders: await this.#data.listFolders(libraryId) };
    }

    if (resource === 'browse' && rest.length === 3) {
      const parentParam = url.searchParams.get('parent');
      const parentFolderId =
        parentParam === null || parentParam === '' || parentParam === 'root'
          ? null
          : parentParam;
      return {
        folders: await this.#data.browseEntries(libraryId, parentFolderId),
        linked: await this.#data.listLinkedFolders(libraryId),
      };
    }

    if (resource === 'assets' && rest.length === 3) {
      const folderParam = url.searchParams.get('folderId');
      const folderId =
        folderParam === null || folderParam === '' || folderParam === 'root'
          ? null
          : folderParam;
      return this.#data.listAssets({
        libraryId,
        folderId,
        recursive: url.searchParams.get('recursive') === '1',
        limit: numberParam(url, 'limit'),
        offset: numberParam(url, 'offset'),
      });
    }

    if (resource === 'assets' && rest.length === 4) {
      const assetId = decodeURIComponent(rest[3]!);
      return this.#data.getAssetDetail({ libraryId, assetId });
    }

    if (resource === 'search' && rest.length === 3) {
      const scope = this.#parseScope(libraryId, url);
      const sort = this.#parseSort(url);
      return this.#data.searchAssets({
        libraryId,
        query: parseSearchExpression(url.searchParams.get('q') ?? ''),
        filters: this.#parseFilters(url),
        ...(scope === undefined ? {} : { scope }),
        ...(sort === undefined ? {} : { sort }),
        limit: numberParam(url, 'limit'),
        offset: numberParam(url, 'offset'),
      });
    }

    if (resource === 'tags' && rest.length === 3) {
      return { tags: await this.#data.listTags(libraryId) };
    }

    if (resource === 'collections' && rest.length === 3) {
      return { collections: await this.#data.listCollections(libraryId) };
    }

    if (resource === 'collections' && rest.length === 5 && rest[4] === 'assets') {
      return this.#data.listCollectionAssets({
        libraryId,
        collectionId: decodeURIComponent(rest[3]!),
        recursive: url.searchParams.get('recursive') === '1',
        limit: numberParam(url, 'limit'),
        offset: numberParam(url, 'offset'),
      });
    }

    return NOT_FOUND;
  }

  #parseScope(libraryId: string, url: URL): SearchScope | undefined {
    const kind = url.searchParams.get('scope');
    if (kind === 'collection') {
      const collectionId = url.searchParams.get('collectionId');
      if (collectionId === null || collectionId === '') return undefined;
      return { kind: 'collection', collectionId, recursive: url.searchParams.get('recursive') === '1' };
    }
    if (kind === 'folder') {
      const folderParam = url.searchParams.get('folderId');
      const folderId =
        folderParam === null || folderParam === '' || folderParam === 'root' ? null : folderParam;
      return { kind: 'folder', folderId, recursive: url.searchParams.get('recursive') === '1' };
    }
    // An unscoped search still stays inside the library, never the whole device.
    return { kind: 'folder', folderId: null, recursive: true };
  }

  #parseFilters(url: URL): FilterClause[] {
    const clauses: FilterClause[] = [];
    const push = (clause: unknown) => {
      const parsed = filterClauseSchema.safeParse(clause);
      if (parsed.success) clauses.push(parsed.data);
    };
    const split = (value: string | null): string[] =>
      value === null ? [] : value.split(',').map((entry) => entry.trim()).filter(Boolean);

    const formats = split(url.searchParams.get('format'));
    if (formats.length > 0) push({ field: 'format', values: formats, exclude: false });
    const tags = split(url.searchParams.get('tag'));
    if (tags.length > 0) push({ field: 'tag', values: tags, exclude: false, includeAi: true });
    const ratings = split(url.searchParams.get('rating'));
    if (ratings.length > 0) push({ field: 'rating', values: ratings, exclude: false, includeAi: true });
    const favorite = url.searchParams.get('favorite');
    if (favorite === 'yes') push({ field: 'favorite', values: [], exclude: false });
    if (favorite === 'no') push({ field: 'favorite', values: [], exclude: true });
    const availability = url.searchParams.get('availability');
    if (availability === 'available' || availability === 'missing') {
      push({ field: 'availability', values: [availability], exclude: false });
    }
    return clauses.slice(0, 16);
  }

  #parseSort(url: URL): SortDefinition | undefined {
    const field = url.searchParams.get('sort');
    if (field === null || field === '') return undefined;
    const order = url.searchParams.get('order') === 'desc' ? 'desc' : 'asc';
    const parsed = sortDefinitionSchema.safeParse({ field, order });
    return parsed.success ? parsed.data : undefined;
  }

  #isSharedLibrary(libraryId: string): boolean {
    const shared = this.#resolveSharedLibraryId();
    return shared !== null && shared === libraryId;
  }

  #resolveSharedLibraryId(): string | null {
    const preferred = this.#store.preferences.sharedLibraryId;
    if (preferred !== null && this.#libraries.some((library) => library.libraryId === preferred)) {
      return preferred;
    }
    return this.#libraries[0]?.libraryId ?? null;
  }

  #buildState(): unknown {
    const sharedLibraryId = this.#resolveSharedLibraryId();
    return {
      app: 'Serpent',
      sharedLibraryId,
      library: this.#libraries.find((library) => library.libraryId === sharedLibraryId) ?? null,
      allowDownload: this.#store.preferences.allowDownload,
    };
  }

  async #serveStatic(
    request: IncomingMessage,
    response: ServerResponse,
    pathname: string,
  ): Promise<void> {
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      writeJson(response, 405, { error: 'Method not allowed.', code: 'WEB_SHARE_METHOD_NOT_ALLOWED' });
      return;
    }
    const root = this.#staticRootDir;
    if (root === null) {
      writeJson(response, 503, {
        error: 'The web client is not built.',
        code: 'WEB_SHARE_CLIENT_UNAVAILABLE',
      });
      return;
    }
    const relative = decodeURIComponent(pathname).replace(/^\/+/u, '');
    const candidate = path.resolve(root, relative);
    if (!isInside(root, candidate)) {
      writeJson(response, 400, { error: 'Invalid path.', code: 'WEB_SHARE_INVALID_PATH' });
      return;
    }
    const filePath = (await isFile(candidate)) ? candidate : path.join(root, 'index.html');
    try {
      const body = await readFile(filePath);
      response.statusCode = 200;
      response.setHeader('Content-Type', CONTENT_TYPES[path.extname(filePath).toLowerCase()] ?? 'application/octet-stream');
      response.setHeader('Cache-Control', path.basename(filePath) === 'index.html' ? 'no-cache' : 'public, max-age=3600');
      if (path.extname(filePath).toLowerCase() === '.html') {
        response.setHeader('Content-Security-Policy', WEB_SHARE_CSP);
      }
      response.setHeader('Content-Length', String(body.byteLength));
      if (request.method === 'HEAD') response.end();
      else response.end(body);
    } catch (error) {
      this.#logger.error('web-share.static', error, { pathname });
      writeJson(response, 404, { error: 'Not found.', code: 'WEB_SHARE_NOT_FOUND' });
    }
  }

  #pruneSessions(): void {
    if (this.#sessions.size === 0) return;
    const cutoff = this.#now() - WEB_SHARE_SESSION_TTL_MS;
    for (const [token, lastSeen] of this.#sessions) {
      if (lastSeen < cutoff) this.#sessions.delete(token);
    }
  }

  #publish(): WebShareSettingsSnapshot {
    const snapshot = this.snapshot();
    this.#onSnapshotChanged?.(snapshot);
    for (const listener of this.#snapshotListeners) listener(snapshot);
    return snapshot;
  }
}

const NOT_FOUND = Symbol('web-share-not-found');
const WEB_SHARE_CSP = [
  "default-src 'self'",
  "img-src 'self' data: blob:",
  "media-src 'self' blob:",
  "style-src 'self' 'unsafe-inline'",
  "script-src 'self'",
  "connect-src 'self'",
  "font-src 'self' data:",
  "frame-ancestors 'none'",
  "base-uri 'none'",
  "form-action 'none'",
].join('; ');

function isPortUnavailable(error: unknown): boolean {
  if (typeof error !== 'object' || error === null || !('code' in error)) return false;
  const code = (error as { code?: unknown }).code;
  return code === 'EADDRINUSE' || code === 'EACCES' || code === 'EPERM';
}

function closeHttpServer(server: HttpServer): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      server.closeAllConnections();
      resolve();
    }, 5_000);
    timer.unref();
    server.closeIdleConnections();
    server.close((error) => {
      clearTimeout(timer);
      if (error === undefined) resolve();
      else reject(error);
    });
  });
}

function isInside(root: string, candidate: string): boolean {
  const normalizedRoot = path.resolve(root);
  const relative = path.relative(normalizedRoot, candidate);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

async function isFile(candidate: string): Promise<boolean> {
  try {
    return (await stat(candidate)).isFile();
  } catch {
    return false;
  }
}

function parseCookies(header: string | undefined): Record<string, string> {
  const result: Record<string, string> = {};
  if (header === undefined) return result;
  for (const part of header.split(';')) {
    const separator = part.indexOf('=');
    if (separator <= 0) continue;
    const name = part.slice(0, separator).trim();
    const value = part.slice(separator + 1).trim();
    if (name.length > 0) result[name] = value;
  }
  return result;
}

function sessionCookie(token: string): string {
  const maxAgeSeconds = Math.floor(WEB_SHARE_SESSION_TTL_MS / 1000);
  return `${WEB_SHARE_SESSION_COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAgeSeconds}`;
}

function clearSessionCookie(): string {
  return `${WEB_SHARE_SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`;
}

function writeJson(response: ServerResponse, status: number, body: unknown): void {
  if (response.headersSent || response.destroyed) return;
  const serialized = JSON.stringify(body);
  response.statusCode = status;
  response.setHeader('Content-Type', 'application/json; charset=utf-8');
  response.setHeader('Content-Length', Buffer.byteLength(serialized, 'utf8'));
  response.end(serialized);
}

function readJsonBody(request: IncomingMessage, maxBytes: number): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    let settled = false;
    request.on('data', (chunk: Buffer | string) => {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      size += buffer.byteLength;
      if (size > maxBytes) {
        if (!settled) {
          settled = true;
          request.resume();
          reject(new Error('payload too large'));
        }
        return;
      }
      chunks.push(buffer);
    });
    request.on('error', (error) => {
      if (settled) return;
      settled = true;
      reject(error);
    });
    request.on('end', () => {
      if (settled) return;
      settled = true;
      if (chunks.length === 0) {
        resolve(undefined);
        return;
      }
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
      } catch (error) {
        reject(error);
      }
    });
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function numberParam(url: URL, name: string): number | undefined {
  const raw = url.searchParams.get(name);
  if (raw === null || raw === '') return undefined;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : undefined;
}
