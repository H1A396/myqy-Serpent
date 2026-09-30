import { createServer, type IncomingMessage, type Server as HttpServer, type ServerResponse } from 'node:http';
import { createReadStream } from 'node:fs';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';

import {
  filterClauseSchema,
  sortDefinitionSchema,
  type FilterClause,
  type SearchScope,
  type SortDefinition,
} from '../../shared/asset-types';
import { parseSearchExpression } from '../../shared/search-expression';
import {
  WEB_SHARE_DERIVATIVE_MAX_EDGE,
  WEB_SHARE_DERIVATIVE_QUALITY,
  WEB_SHARE_SESSION_COOKIE,
  WEB_SHARE_SESSION_TTL_MS,
  WEB_SHARE_THUMBNAIL_FORMAT,
  webShareSettingsSnapshotSchema,
  webShareUsernameSchema,
  type WebShareLibrarySummary,
  type WebShareRuntimeState,
  type WebShareServerPreferences,
  type WebShareSettingsSnapshot,
  type WebShareThumbnailEdge,
  type WebShareThumbnailProgress,
  type WebShareVisitorSummary,
} from '../../shared/web-share';
import {
  createWebSharePasswordRecord,
  verifyWebSharePassword,
  WebShareLoginThrottle,
  WebShareSessionSigner,
} from './web-share-auth';
import { WebShareVisitorStore } from './web-share-visitor-store';
import { WebShareDataError, type WebShareDataProvider } from './web-share-data';
import type { ResolvedDerivative, ResolvedMedia, WebShareMediaResolver } from './web-share-media';
import { WebShareSettingsStore } from './web-share-settings-store';
import { parseByteRange } from '../../main/artifact-response';

/**
 * The viewer WebP is split into this many contiguous byte-range chunks. The
 * client requests them in parallel (each a separate tunnel connection, which is
 * ~5× faster than one stream) and concatenates them back into the image.
 */
const WEB_SHARE_VIEWER_CHUNK_COUNT = 4;

export interface WebShareLogger {
  info(scope: string, message: string, context?: Record<string, unknown>): void;
  error(scope: string, error: unknown, context?: Record<string, unknown>): void;
}

export interface WebShareServerOptions {
  data: WebShareDataProvider;
  userDataPath: string;
  logger: WebShareLogger;
  /** Resolves thumbnail/source/artifact bytes; absent disables media routes. */
  media?: WebShareMediaResolver;
  /** Main-owned fence: returns false while a library must not be read. */
  mediaGuard?: (libraryId: string) => boolean;
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
const MAX_MARK_BODY_BYTES = 2 * 1024;
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
  readonly #media: WebShareMediaResolver | undefined;
  readonly #mediaGuard: ((libraryId: string) => boolean) | undefined;
  readonly #logger: WebShareLogger;
  readonly #store: WebShareSettingsStore;
  readonly #throttle = new WebShareLoginThrottle();
  readonly #now: () => number;
  readonly #staticRootDir: string | null;
  readonly #onSnapshotChanged: WebShareServerOptions['onSnapshotChanged'];
  readonly #snapshotListeners = new Set<(snapshot: WebShareSettingsSnapshot) => void>();
  readonly #sessions = new Map<string, number>();
  readonly #visitors: WebShareVisitorStore;
  #thumbnailProgress: WebShareThumbnailProgress | null = null;
  #signer: WebShareSessionSigner;
  #libraries: WebShareLibrarySummary[] = [];
  #runtime: WebShareRuntimeState = { status: 'stopped' };
  #httpServer: HttpServer | undefined;
  #startPromise: Promise<WebShareSettingsSnapshot> | undefined;

  constructor(options: WebShareServerOptions) {
    this.#data = options.data;
    this.#media = options.media;
    this.#mediaGuard = options.mediaGuard;
    this.#logger = options.logger;
    this.#store = new WebShareSettingsStore(options.userDataPath);
    this.#visitors = new WebShareVisitorStore(options.userDataPath);
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
      visitorCount: this.#visitors.count,
      thumbnailProgress: this.#thumbnailProgress,
      libraries: this.#libraries,
    });
  }

  /** Visitor records for the operator's panel and export. */
  listVisitors(): WebShareVisitorSummary[] {
    return this.#visitors.listSummaries();
  }

  /** The library visitors currently see (`null` when none is open). */
  resolvedSharedLibraryId(): string | null {
    return this.#resolveSharedLibraryId();
  }

  setThumbnailEdge(edge: WebShareThumbnailEdge): WebShareSettingsSnapshot {
    this.#store.setPreferences({ thumbnailEdge: edge });
    return this.#publish();
  }

  setThumbnailSharpen(enabled: boolean): WebShareSettingsSnapshot {
    this.#store.setPreferences({ thumbnailSharpen: enabled });
    return this.#publish();
  }

  setThumbnailMaxKb(maxKb: number): WebShareSettingsSnapshot {
    this.#store.setPreferences({ thumbnailMaxKb: maxKb });
    return this.#publish();
  }

  setDownloadQuality(quality: number): WebShareSettingsSnapshot {
    this.#store.setPreferences({ downloadQuality: quality });
    return this.#publish();
  }

  setDownloadProgressive(enabled: boolean): WebShareSettingsSnapshot {
    this.#store.setPreferences({ downloadProgressive: enabled });
    return this.#publish();
  }

  /** Main relays worker sweep progress here so the panel can show it. */
  setThumbnailProgress(progress: WebShareThumbnailProgress | null): WebShareSettingsSnapshot {
    this.#thumbnailProgress = progress;
    return this.#publish();
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
    // Keep-alive is deliberate. A share runs over a tunnel with a long RTT, and
    // the grid requests dozens of thumbnails; closing the socket per request
    // paid a fresh handshake for every one of them. Node's default HTTP
    // timeouts bound idle sockets.
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

    // Unauthenticated: the login screen needs to know whether a password is
    // configured before it can render the right fields.
    if (request.method === 'GET' && pathname === '/api/config') {
      writeJson(response, 200, {
        app: 'Serpent',
        requiresPassword: this.#store.password !== null,
        // Only a direct loopback browser may reveal the client's test affordance;
        // a tunnel/proxy request (which carries a real client IP header) never
        // gets it, so visitors cannot enable `?debug=1`.
        debug: isDirectLocalRequest(request),
      });
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

    if (pathname.startsWith('/api/') || pathname.startsWith('/media/')) {
      const visitorId = this.#authorize(request, response);
      if (visitorId === null) {
        request.resume();
        return;
      }
      if (pathname.startsWith('/media/')) {
        await this.#handleMedia(request, response, url, pathname);
        return;
      }
      await this.#handleApi(request, response, url, pathname, visitorId);
      return;
    }

    await this.#serveStatic(request, response, pathname);
  }

  /** Returns the signed-in visitor id, or `null` after writing a 401. */
  #authorize(request: IncomingMessage, response: ServerResponse): string | null {
    const cookie = parseCookies(request.headers.cookie)[WEB_SHARE_SESSION_COOKIE];
    const visitorId = cookie === undefined ? null : this.#signer.verify(cookie, this.#now());
    if (visitorId === null || !this.#visitors.has(visitorId)) {
      writeJson(response, 401, { error: 'Authentication required.', code: 'WEB_SHARE_UNAUTHORIZED' });
      return null;
    }
    this.#sessions.set(cookie!, this.#now());
    return visitorId;
  }

  async #handleLogin(request: IncomingMessage, response: ServerResponse): Promise<void> {
    const body = await readJsonBody(request, MAX_LOGIN_BODY_BYTES).catch(() => undefined);
    const username = webShareUsernameSchema.safeParse(
      isRecord(body) && typeof body.username === 'string' ? body.username : undefined,
    );
    if (!username.success) {
      writeJson(response, 400, {
        error: 'A username is required.',
        code: 'WEB_SHARE_USERNAME_REQUIRED',
      });
      return;
    }

    const passwordRecord = this.#store.password;
    const remoteKey = clientIp(request) ?? request.socket.remoteAddress ?? 'unknown';
    if (passwordRecord !== null) {
      if (this.#throttle.isBlocked(remoteKey)) {
        const retryAfterMs = this.#throttle.blockedForMs(remoteKey);
        response.setHeader('Retry-After', String(Math.ceil(retryAfterMs / 1000)));
        writeJson(response, 429, { error: 'Too many attempts.', code: 'WEB_SHARE_TOO_MANY_ATTEMPTS' });
        return;
      }
      const password = isRecord(body) && typeof body.password === 'string' ? body.password : undefined;
      if (password === undefined || !verifyWebSharePassword(password, passwordRecord)) {
        this.#throttle.recordFailure(remoteKey);
        writeJson(response, 401, { error: 'Incorrect password.', code: 'WEB_SHARE_INVALID_PASSWORD' });
        return;
      }
      this.#throttle.reset(remoteKey);
    }

    const visitorId = this.#visitors.authenticate({
      username: username.data,
      ip: clientIp(request),
      userAgent: userAgentOf(request),
      now: new Date(this.#now()).toISOString(),
    });
    const token = this.#signer.issue(visitorId, this.#now());
    this.#sessions.set(token, this.#now());
    response.setHeader('Set-Cookie', sessionCookie(token));
    writeJson(response, 200, { ok: true, username: username.data });
  }

  async #handleApi(
    request: IncomingMessage,
    response: ServerResponse,
    url: URL,
    pathname: string,
    visitorId: string,
  ): Promise<void> {
    const segments = pathname.split('/').filter((segment) => segment.length > 0);
    // segments[0] === 'api'
    const rest = segments.slice(1);

    if (request.method === 'GET' && rest.length === 1 && rest[0] === 'state') {
      writeJson(response, 200, this.#buildState(visitorId));
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

    // The visitor's own marks are the only writable resource. Everything else
    // the web client can reach stays read-only.
    if (
      request.method === 'PUT'
      && rest.length === 5
      && rest[2] === 'assets'
      && rest[4] === 'marks'
    ) {
      await this.#handleSetMarks(
        request,
        response,
        libraryId,
        decodeURIComponent(rest[3]!),
        visitorId,
      );
      return;
    }

    if (request.method !== 'GET') {
      writeJson(response, 405, { error: 'Method not allowed.', code: 'WEB_SHARE_METHOD_NOT_ALLOWED' });
      return;
    }

    try {
      const payload = await this.#resolveLibraryRoute(rest, url, visitorId);
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

  /** Upsert this visitor's favorite/rating for one asset. */
  async #handleSetMarks(
    request: IncomingMessage,
    response: ServerResponse,
    libraryId: string,
    assetId: string,
    visitorId: string,
  ): Promise<void> {
    const body = await readJsonBody(request, MAX_MARK_BODY_BYTES).catch(() => undefined);
    if (!isRecord(body)) {
      writeJson(response, 400, { error: 'Invalid mark.', code: 'WEB_SHARE_INVALID_MARK' });
      return;
    }
    const patch: { favorite?: boolean; rating?: number } = {};
    if (typeof body.favorite === 'boolean') patch.favorite = body.favorite;
    if (
      typeof body.rating === 'number'
      && Number.isInteger(body.rating)
      && body.rating >= 0
      && body.rating <= 5
    ) {
      patch.rating = body.rating;
    }
    if (patch.favorite === undefined && patch.rating === undefined) {
      writeJson(response, 400, { error: 'Nothing to update.', code: 'WEB_SHARE_INVALID_MARK' });
      return;
    }
    let assetName: string;
    try {
      // Only assets that really exist in the shared library can be marked, so a
      // visitor cannot inflate the store with invented ids.
      const detail = await this.#data.getAssetDetail({ libraryId, assetId });
      assetName = detail.asset.displayName;
    } catch (error) {
      if (error instanceof WebShareDataError) {
        writeJson(response, 404, { error: 'Asset not found.', code: 'WEB_SHARE_ASSET_NOT_FOUND' });
        return;
      }
      throw error;
    }
    const marks = this.#visitors.setMark({
      visitorId,
      libraryId,
      assetId,
      assetName,
      ...patch,
      ip: clientIp(request),
      userAgent: userAgentOf(request),
      now: new Date(this.#now()).toISOString(),
    });
    this.#publish();
    writeJson(response, 200, { ok: true, marks });
  }

  async #resolveLibraryRoute(rest: string[], url: URL, visitorId: string): Promise<unknown> {
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

    if (resource === 'assets' && rest.length === 5 && rest[4] === 'marks') {
      const assetId = decodeURIComponent(rest[3]!);
      return { marks: this.#visitors.getMarks(visitorId, libraryId, assetId) };
    }

    if (resource === 'assets' && rest.length === 4) {
      const assetId = decodeURIComponent(rest[3]!);
      const detail = await this.#data.getAssetDetail({ libraryId, assetId });
      // The detail carries the visitor's own favorite/rating so the inspector
      // can render them without a second request.
      return { ...detail, marks: this.#visitors.getMarks(visitorId, libraryId, assetId) };
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

  #buildState(visitorId: string): unknown {
    const sharedLibraryId = this.#resolveSharedLibraryId();
    return {
      app: 'Serpent',
      sharedLibraryId,
      library: this.#libraries.find((library) => library.libraryId === sharedLibraryId) ?? null,
      allowDownload: this.#store.preferences.allowDownload,
      requiresPassword: this.#store.password !== null,
      username: this.#visitors.usernameOf(visitorId),
    };
  }

  async #handleMedia(
    request: IncomingMessage,
    response: ServerResponse,
    url: URL,
    pathname: string,
  ): Promise<void> {
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      writeJson(response, 405, { error: 'Method not allowed.', code: 'WEB_SHARE_METHOD_NOT_ALLOWED' });
      return;
    }
    const media = this.#media;
    if (media === undefined) {
      writeJson(response, 503, { error: 'Media is unavailable.', code: 'WEB_SHARE_MEDIA_UNAVAILABLE' });
      return;
    }
    const segments = pathname.split('/').filter((segment) => segment.length > 0);
    // segments[0] === 'media'
    if (segments.length !== 4) {
      writeJson(response, 404, { error: 'Not found.', code: 'WEB_SHARE_NOT_FOUND' });
      return;
    }
    const kind = segments[1]!;
    const libraryId = decodeURIComponent(segments[2]!);
    const identifier = decodeURIComponent(segments[3]!);
    if (!this.#isSharedLibrary(libraryId)) {
      writeJson(response, 404, { error: 'Library not shared.', code: 'WEB_SHARE_LIBRARY_NOT_SHARED' });
      return;
    }
    if (this.#mediaGuard !== undefined && !this.#mediaGuard(libraryId)) {
      writeJson(response, 410, { error: 'Library unavailable.', code: 'WEB_SHARE_LIBRARY_UNAVAILABLE' });
      return;
    }

    let resolved: ResolvedMedia | null;
    if (kind === 'thumbnail') {
      // Grid tiles are downscaled from the cached card artifact so a page of
      // dozens of tiles stays small on a slow tunnel. Fall back to the raw card
      // artifact when the bounded re-encode is not available yet.
      const derivative = await media.resolveThumbnailDerivative({
        libraryId,
        assetId: identifier,
        format: WEB_SHARE_THUMBNAIL_FORMAT,
        maxEdge: this.#store.preferences.thumbnailEdge,
        sharpen: this.#store.preferences.thumbnailSharpen,
        maxBytes: this.#store.preferences.thumbnailMaxKb * 1024,
      });
      if (derivative !== null) {
        await this.#streamDerivative(request, response, derivative, {
          download: false,
          assetId: identifier,
          cacheable: true,
        });
        return;
      }
      resolved = await media.resolveThumbnail({ libraryId, assetId: identifier });
    } else if (kind === 'source') {
      const revisionId = url.searchParams.get('revision');
      if (revisionId === null || revisionId === '') {
        writeJson(response, 400, { error: 'A revision is required.', code: 'WEB_SHARE_REVISION_REQUIRED' });
        return;
      }
      resolved = await media.resolveSource({ libraryId, assetId: identifier, revisionId });
    } else if (kind === 'preview' || kind === 'proxy') {
      resolved = await media.resolveArtifact({ libraryId, artifactId: identifier, kind });
    } else if (kind === 'view') {
      // The viewer shows a bounded WebP (a ComfyUI 12 MB PNG is a minute over a
      // small tunnel); the Download button re-encodes the *original* at full
      // resolution to JPEG so the saved file matches a Photoshop quality-10 save.
      const revisionId = url.searchParams.get('revision');
      if (revisionId === null || revisionId === '') {
        writeJson(response, 400, { error: 'A revision is required.', code: 'WEB_SHARE_REVISION_REQUIRED' });
        return;
      }
      const download = url.searchParams.get('download') === '1';
      if (download && !this.#store.preferences.allowDownload) {
        writeJson(response, 403, { error: 'Downloading is disabled.', code: 'WEB_SHARE_DOWNLOAD_DISABLED' });
        return;
      }
      const derivative = await media.resolveDerivative({
        libraryId,
        assetId: identifier,
        revisionId,
        format: download ? 'jpeg' : 'webp',
        maxEdge: WEB_SHARE_DERIVATIVE_MAX_EDGE,
        quality: download
          ? this.#store.preferences.downloadQuality
          : WEB_SHARE_DERIVATIVE_QUALITY,
        fullSize: download,
        progressive: download && this.#store.preferences.downloadProgressive,
      });
      if (derivative === null) {
        writeJson(response, 404, { error: 'Media not found.', code: 'WEB_SHARE_MEDIA_NOT_FOUND' });
        return;
      }
      // The on-screen image is a deterministic function of the asset+revision
      // and (for the bounded WebP) persisted, so split it into fixed byte-range
      // chunks the client can pull in parallel. Downloads keep the single file.
      const chunkParam = url.searchParams.get('chunk');
      if (!download && derivative.cached && chunkParam !== null) {
        await this.#streamViewerChunk(request, response, derivative, chunkParam);
        return;
      }
      await this.#streamDerivative(request, response, derivative, {
        download,
        assetId: identifier,
        // The on-screen image is a deterministic function of the asset+revision,
        // so let the visitor's own browser reuse it across reopens. Downloads
        // stay uncached so the browser always saves a fresh copy.
        cacheControl: download ? 'private, no-store' : 'private, max-age=3600',
      });
      return;
    } else {
      writeJson(response, 404, { error: 'Not found.', code: 'WEB_SHARE_NOT_FOUND' });
      return;
    }

    if (resolved === null) {
      writeJson(response, 404, { error: 'Media not found.', code: 'WEB_SHARE_MEDIA_NOT_FOUND' });
      return;
    }
    const download = kind === 'source' && url.searchParams.get('download') === '1';
    if (download && !this.#store.preferences.allowDownload) {
      writeJson(response, 403, { error: 'Downloading is disabled.', code: 'WEB_SHARE_DOWNLOAD_DISABLED' });
      return;
    }
    await this.#streamResolved(request, response, resolved, {
      download,
      cacheable: kind === 'thumbnail',
    });
  }

  async #streamResolved(
    request: IncomingMessage,
    response: ServerResponse,
    resolved: ResolvedMedia,
    options: { download: boolean; cacheable: boolean },
  ): Promise<void> {
    let size: number;
    try {
      const info = await stat(resolved.absolutePath);
      if (!info.isFile()) throw new Error('not a file');
      size = info.size;
    } catch {
      writeJson(response, 404, { error: 'Media not found.', code: 'WEB_SHARE_MEDIA_NOT_FOUND' });
      return;
    }

    response.setHeader('Content-Type', resolved.mimeType);
    response.setHeader('Accept-Ranges', 'bytes');
    response.setHeader(
      'Cache-Control',
      options.cacheable ? 'public, max-age=3600' : 'private, max-age=0, must-revalidate',
    );
    if (options.download) {
      response.setHeader('Content-Disposition', contentDisposition(path.basename(resolved.absolutePath)));
    }

    const rangeHeader = request.headers.range;
    const range = rangeHeader === undefined ? null : parseByteRange(rangeHeader, size);
    if (rangeHeader !== undefined && range === null) {
      response.statusCode = 416;
      response.setHeader('Content-Range', `bytes */${size}`);
      response.end();
      return;
    }

    const start = range?.start ?? 0;
    const end = range?.end ?? size - 1;
    response.statusCode = range === null ? 200 : 206;
    if (range !== null) response.setHeader('Content-Range', `bytes ${start}-${end}/${size}`);
    response.setHeader('Content-Length', String(end - start + 1));

    if (request.method === 'HEAD') {
      response.end();
      return;
    }

    const stream = createReadStream(resolved.absolutePath, { start, end });
    stream.on('error', (error) => {
      this.#logger.error('web-share.media-stream', error);
      if (!response.headersSent) {
        writeJson(response, 404, { error: 'Media not found.', code: 'WEB_SHARE_MEDIA_NOT_FOUND' });
      } else {
        response.destroy();
      }
    });
    response.on('close', () => {
      if (!response.writableFinished) stream.destroy();
    });
    stream.pipe(response);
  }

  /**
   * Serve one fixed byte-range chunk of the persisted viewer WebP.
   *
   * The client asks for `chunk=0..3`; each maps to an exact, contiguous,
   * non-overlapping slice of the same file, so the four responses concatenate
   * back into the original image with no gaps. `416` reports an out-of-range
   * index; a `HEAD` returns the slice headers without a body. The cached file is
   * never deleted (its `cleanup` is a no-op).
   */
  async #streamViewerChunk(
    request: IncomingMessage,
    response: ServerResponse,
    derivative: ResolvedDerivative,
    chunkParam: string,
  ): Promise<void> {
    let size: number;
    try {
      const info = await stat(derivative.absolutePath);
      if (!info.isFile()) throw new Error('not a file');
      size = info.size;
    } catch {
      derivative.cleanup();
      writeJson(response, 404, { error: 'Media not found.', code: 'WEB_SHARE_MEDIA_NOT_FOUND' });
      return;
    }

    const index = Number.parseInt(chunkParam, 10);
    if (
      !Number.isInteger(index)
      || index < 0
      || index >= WEB_SHARE_VIEWER_CHUNK_COUNT
      || size <= 0
    ) {
      response.statusCode = 416;
      response.setHeader('Content-Range', `bytes */${size}`);
      response.end();
      return;
    }

    const start = Math.floor((index * size) / WEB_SHARE_VIEWER_CHUNK_COUNT);
    const endExclusive = Math.floor(((index + 1) * size) / WEB_SHARE_VIEWER_CHUNK_COUNT);
    const end = Math.max(start, endExclusive - 1);

    response.setHeader('Content-Type', derivative.mimeType);
    response.setHeader('Accept-Ranges', 'bytes');
    response.setHeader('Cache-Control', 'private, max-age=3600');
    response.statusCode = 206;
    response.setHeader('Content-Range', `bytes ${start}-${end}/${size}`);
    response.setHeader('Content-Length', String(end - start + 1));

    if (request.method === 'HEAD') {
      response.end();
      return;
    }

    const stream = createReadStream(derivative.absolutePath, { start, end });
    stream.on('error', (error) => {
      this.#logger.error('web-share.viewer-chunk-stream', error);
      if (!response.headersSent) {
        writeJson(response, 404, { error: 'Media not found.', code: 'WEB_SHARE_MEDIA_NOT_FOUND' });
      } else {
        response.destroy();
      }
    });
    response.on('close', () => {
      if (!response.writableFinished) stream.destroy();
    });
    stream.pipe(response);
  }

  /**
   * Stream a freshly encoded derivative and delete it once the transfer ends.
   *
   * `cleanup` is bound to the response rather than awaited, so a visitor who
   * aborts mid-download still leaves nothing behind. No byte range is accepted:
   * the client receives a whole, disposable file, and a partial save would be
   * useless anyway.
   */
  async #streamDerivative(
    request: IncomingMessage,
    response: ServerResponse,
    derivative: ResolvedDerivative,
    options: {
      download: boolean;
      assetId: string;
      cacheable?: boolean;
      cacheControl?: string;
      nameSuffix?: string;
    },
  ): Promise<void> {
    let size: number;
    try {
      const info = await stat(derivative.absolutePath);
      if (!info.isFile()) throw new Error('not a file');
      size = info.size;
    } catch {
      derivative.cleanup();
      writeJson(response, 404, { error: 'Media not found.', code: 'WEB_SHARE_MEDIA_NOT_FOUND' });
      return;
    }

    response.setHeader('Content-Type', derivative.mimeType);
    // The temporary file is gone by the next request, but the bytes are a
    // deterministic function of the source. `cacheControl` is set explicitly by
    // the caller: grid thumbnails may be cached publicly, the on-screen viewer
    // image privately in the visitor's browser, and downloads never.
    response.setHeader(
      'Cache-Control',
      options.cacheControl
        ?? (options.cacheable === true ? 'public, max-age=3600' : 'private, no-store'),
    );
    response.setHeader('Content-Length', String(size));
    if (options.download) {
      response.setHeader(
        'Content-Disposition',
        contentDisposition(
          `share-${options.assetId}${options.nameSuffix ?? ''}${path.extname(derivative.absolutePath)}`,
        ),
      );
    }

    if (request.method === 'HEAD') {
      response.end();
      derivative.cleanup();
      return;
    }

    let cleaned = false;
    const cleanup = (): void => {
      if (cleaned) return;
      cleaned = true;
      derivative.cleanup();
    };
    const stream = createReadStream(derivative.absolutePath);
    stream.on('error', (error) => {
      this.#logger.error('web-share.derivative-stream', error);
      cleanup();
      if (!response.headersSent) {
        writeJson(response, 404, { error: 'Media not found.', code: 'WEB_SHARE_MEDIA_NOT_FOUND' });
      } else {
        response.destroy();
      }
    });
    // 'close' fires for both a completed response and an aborted socket, so it
    // is the one event that always runs.
    response.on('close', () => {
      stream.destroy();
      cleanup();
    });
    stream.pipe(response);
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
    // A path that names a directory must end in `/`, otherwise the client's
    // relative `./assets/…` URLs resolve against the parent, silently serving
    // the other build's bundle. Redirect rather than fall back to index.html.
    if (candidate !== root && (await isDirectory(candidate)) && !pathname.endsWith('/')) {
      response.statusCode = 301;
      response.setHeader('Location', `${pathname}/`);
      response.setHeader('Content-Length', '0');
      if (request.method === 'HEAD') response.end();
      else response.end();
      return;
    }
    // Resolve the file to serve. A directory serves its own index.html — not
    // the root one — so a nested build (e.g. `/web-preview/`) gets its own
    // entry document instead of silently falling back to the root build.
    // Unknown paths fall back to the SPA entry of the nearest enclosing
    // directory that actually has one, so deep links inside a nested build
    // stay inside that build.
    const filePath = await resolveStaticFile(root, candidate, isInside);
    if (filePath === null) {
      writeJson(response, 404, { error: 'Not found.', code: 'WEB_SHARE_NOT_FOUND' });
      return;
    }
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

async function isDirectory(candidate: string): Promise<boolean> {
  try {
    return (await stat(candidate)).isDirectory();
  } catch {
    return false;
  }
}

/**
 * Pick the file to serve for one static request.
 *
 * A real file wins. A directory serves its own `index.html` (so a nested build
 * is self-contained); an unknown path falls back to the SPA entry of the
 * nearest enclosing directory that has one, and finally to the root entry.
 * Returns `null` only when no entry can be found at all.
 */
async function resolveStaticFile(
  root: string,
  candidate: string,
  inside: (root: string, candidate: string) => boolean,
): Promise<string | null> {
  if (await isFile(candidate)) return candidate;
  if (await isDirectory(candidate)) {
    const entry = path.join(candidate, 'index.html');
    return (await isFile(entry)) ? entry : null;
  }
  // Deep link inside a nested build: stay inside that build.
  for (
    let enclosing = path.dirname(candidate);
    inside(root, enclosing) && enclosing !== root;
    enclosing = path.dirname(enclosing)
  ) {
    const nestedEntry = path.join(enclosing, 'index.html');
    if (await isFile(nestedEntry)) return nestedEntry;
  }
  const rootEntry = path.join(root, 'index.html');
  return (await isFile(rootEntry)) ? rootEntry : null;
}

/**
 * Best-effort client IP. A tunnel (Cloudflare, frp) terminates the connection,
 * so the loopback socket address is useless; the proxy headers carry the real
 * address. Headers are spoofable, so this is only recorded for the operator's
 * records, never used for access control.
 */
function clientIp(request: IncomingMessage): string | null {
  const cf = request.headers['cf-connecting-ip'];
  const direct = Array.isArray(cf) ? cf[0] : cf;
  if (typeof direct === 'string' && direct.trim() !== '') return direct.trim();
  const forwarded = request.headers['x-forwarded-for'];
  const first = Array.isArray(forwarded) ? forwarded[0] : forwarded;
  if (typeof first === 'string' && first.trim() !== '') {
    return first.split(',')[0]!.trim();
  }
  return request.socket.remoteAddress ?? null;
}

/**
 * True only for a browser talking to the loopback server directly, not through
 * a tunnel. A tunnel (Cloudflare, frp) forwards the visitor's real address in
 * `cf-connecting-ip` / `x-forwarded-for`, so its presence means "not local".
 */
function isDirectLocalRequest(request: IncomingMessage): boolean {
  const cf = request.headers['cf-connecting-ip'];
  const forwarded = request.headers['x-forwarded-for'];
  if (typeof cf === 'string' && cf.trim() !== '') return false;
  if (typeof forwarded === 'string' && forwarded.trim() !== '') return false;
  const address = request.socket.remoteAddress ?? '';
  return address === '127.0.0.1' || address === '::1' || address === '::ffff:127.0.0.1';
}

function userAgentOf(request: IncomingMessage): string | null {
  const value = request.headers['user-agent'];
  return typeof value === 'string' && value !== '' ? value.slice(0, 1024) : null;
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

function contentDisposition(filename: string): string {
  const fallback = filename.replace(/[^\x20-\x7e]/gu, '_').replace(/["\\]/gu, '_') || 'download';
  return `attachment; filename="${fallback}"; filename*=UTF-8''${encodeURIComponent(filename)}`;
}

function writeJson(response: ServerResponse, status: number, body: unknown): void {
  if (response.headersSent || response.destroyed) return;
  const serialized = JSON.stringify(body);
  response.statusCode = status;
  response.setHeader('Content-Type', 'application/json; charset=utf-8');
  response.setHeader('Content-Length', Buffer.byteLength(serialized, 'utf8'));
  response.end(serialized);
}

/**
 * Only formats the desktop can produce from the original are accepted. An
 * unknown value is a client bug, not a reason to silently fall back to WebP.
 */
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
