import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
  webShareTunnelInfoSchema,
  type WebShareTunnelErrorCode,
  type WebShareTunnelInfo,
  type WebShareTunnelState,
} from '../../shared/web-share';

export interface CloudflareTunnelLogger {
  info(scope: string, message: string, context?: Record<string, unknown>): void;
  error(scope: string, error: unknown, context?: Record<string, unknown>): void;
}

/** Operator overrides; `null` on any field means "discover automatically". */
export interface CloudflareTunnelConfig {
  cloudflaredPath: string | null;
  tunnelName: string | null;
  tunnelHostname: string | null;
}

/** Minimal process surface so unit tests can drive the lifecycle without spawning. */
export interface TunnelProcess {
  pid?: number;
  stdout: NodeJS.ReadableStream | null;
  stderr: NodeJS.ReadableStream | null;
  on(event: 'error', listener: (error: Error) => void): void;
  on(event: 'exit', listener: (code: number | null, signal: NodeJS.Signals | null) => void): void;
  kill(signal?: NodeJS.Signals): boolean;
}

export type TunnelSpawner = (
  command: string,
  args: readonly string[],
  options: { windowsHide: boolean },
) => TunnelProcess;

export interface CloudflareTunnelDeps {
  userDataPath: string;
  logger: CloudflareTunnelLogger;
  platform?: NodeJS.Platform;
  homeDir?: string;
  env?: NodeJS.ProcessEnv;
  fileExists?: (candidate: string) => boolean;
  readTextFile?: (file: string) => string | undefined;
  writeTextFile?: (file: string, contents: string) => void;
  ensureDir?: (dir: string) => void;
  spawnProcess?: TunnelSpawner;
  killProcessTree?: (child: TunnelProcess) => void;
  /** How long to wait for cloudflared to register a connection. */
  readyTimeoutMs?: number;
  /** How long a `--version` / install probe may take. */
  probeTimeoutMs?: number;
}

export interface ParsedCloudflareConfig {
  found: boolean;
  tunnel: string | null;
  credentialsFile: string | null;
  hostname: string | null;
}

/**
 * The surface `WebShareServer` needs from the tunnel owner. Keeping this an
 * interface (rather than the concrete manager) lets server tests drive the
 * lifecycle without spawning a real process.
 */
export interface WebShareTunnel {
  state(): WebShareTunnelState;
  info(): WebShareTunnelInfo;
  isInstalling(): boolean;
  onChange(listener: () => void): () => void;
  setConfig(config: Partial<CloudflareTunnelConfig>): void;
  refreshInfo(): Promise<WebShareTunnelInfo>;
  start(port: number): Promise<void>;
  stop(): Promise<void>;
  install(): Promise<void>;
}

const READY_TIMEOUT_MS = 30_000;
const PROBE_TIMEOUT_MS = 10_000;
const INSTALL_TIMEOUT_MS = 300_000;
const LOG_TAIL_LINES = 40;
const DEFAULT_CLOUDFLARED_DIRNAME = '.cloudflared';
const READY_LOG = /Registered tunnel connection/iu;

function stripQuotes(value: string): string {
  const trimmed = value.trim();
  if (trimmed.length >= 2) {
    const first = trimmed[0];
    const last = trimmed[trimmed.length - 1];
    if ((first === '"' && last === '"') || (first === "'" && last === "'")) {
      return trimmed.slice(1, -1).trim();
    }
  }
  return trimmed;
}

/**
 * Tiny reader for the handful of top-level keys Serpent needs from a
 * cloudflared `config.yml`. It intentionally does not implement YAML: it reads
 * `tunnel:`, `credentials-file:` and the first `ingress` `hostname:`.
 */
export function parseCloudflaredConfig(text: string): Omit<ParsedCloudflareConfig, 'found'> {
  let tunnel: string | null = null;
  let credentialsFile: string | null = null;
  let hostname: string | null = null;
  let inIngress = false;
  for (const rawLine of text.split(/\r?\n/u)) {
    const line = rawLine.replace(/\s+#.*$/u, '');
    if (line.trim() === '' || line.trimStart().startsWith('#')) continue;
    const indent = line.length - line.trimStart().length;
    const trimmed = line.trim();
    if (indent === 0) {
      inIngress = trimmed.startsWith('ingress:');
      const match = /^([A-Za-z0-9_-]+):\s*(.*)$/u.exec(trimmed);
      if (!match) continue;
      const key = match[1];
      const value = stripQuotes(match[2] ?? '');
      if (value === '') continue;
      if (key === 'tunnel') tunnel = value;
      else if (key === 'credentials-file') credentialsFile = value;
      continue;
    }
    if (inIngress && hostname === null) {
      const match = /^-\s*hostname:\s*(.+)$/u.exec(trimmed);
      if (match) hostname = stripQuotes(match[1] ?? '');
    }
  }
  return { tunnel, credentialsFile, hostname };
}

/** Public domains only: strip a scheme/path and lowercase. */
export function normalizeTunnelHostname(value: string | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  let host = value.trim().toLowerCase();
  if (host === '') return null;
  host = host.replace(/^[a-z][a-z0-9+.-]*:\/\//u, '');
  host = host.replace(/[/?#].*$/u, '');
  return host === '' ? null : host;
}

export function buildManagedTunnelConfig(input: {
  tunnel: string;
  credentialsFile: string;
  hostname: string;
  port: number;
}): string {
  return [
    `tunnel: ${input.tunnel}`,
    `credentials-file: ${input.credentialsFile}`,
    '',
    'ingress:',
    `  - hostname: ${input.hostname}`,
    `    service: http://127.0.0.1:${input.port}`,
    '  - service: http_status:404',
    '',
  ].join('\n');
}

function dedupe(values: readonly string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    const key = process.platform === 'win32' ? value.toLowerCase() : value;
    if (value === '' || seen.has(key)) continue;
    seen.add(key);
    result.push(value);
  }
  return result;
}

function defaultCloudflaredCandidates(
  platform: NodeJS.Platform,
  env: NodeJS.ProcessEnv,
): string[] {
  const candidates: string[] = [];
  const name = platform === 'win32' ? 'cloudflared.exe' : 'cloudflared';
  const pathVar = env.PATH ?? env.Path ?? '';
  const extensions = platform === 'win32' ? ['.exe', '.cmd', '.bat', ''] : [''];
  for (const dir of pathVar.split(path.delimiter)) {
    if (dir.trim() === '') continue;
    for (const extension of extensions) {
      candidates.push(path.join(dir, `cloudflared${extension}`));
    }
  }
  if (platform === 'win32') {
    for (const base of [env.ProgramFiles, env['ProgramFiles(x86)'], env.LOCALAPPDATA]) {
      if (!base) continue;
      candidates.push(path.join(base, 'cloudflared', name));
    }
    if (env.LOCALAPPDATA) {
      candidates.push(path.join(env.LOCALAPPDATA, 'Microsoft', 'WinGet', 'Links', name));
    }
  } else if (platform === 'darwin') {
    candidates.push(
      '/opt/homebrew/bin/cloudflared',
      '/usr/local/bin/cloudflared',
      '/usr/bin/cloudflared',
    );
  } else {
    candidates.push('/usr/local/bin/cloudflared', '/usr/bin/cloudflared', '/snap/bin/cloudflared');
  }
  return candidates;
}

const defaultSpawner: TunnelSpawner = (command, args, options) =>
  spawn(command, args as string[], options) as unknown as TunnelProcess;

function defaultKillProcessTree(platform: NodeJS.Platform, child: TunnelProcess): void {
  if (child.pid === undefined) {
    try {
      child.kill();
    } catch {
      // already gone
    }
    return;
  }
  if (platform === 'win32') {
    try {
      spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true }).unref();
    } catch {
      try {
        child.kill();
      } catch {
        // already gone
      }
    }
    return;
  }
  try {
    child.kill('SIGTERM');
  } catch {
    // already gone
  }
}

async function runCapture(
  spawnProcess: TunnelSpawner,
  command: string,
  args: readonly string[],
  timeoutMs: number,
): Promise<{ code: number | null; output: string }> {
  return new Promise((resolve) => {
    let output = '';
    let settled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const finish = (code: number | null): void => {
      if (settled) return;
      settled = true;
      if (timer !== undefined) {
        clearTimeout(timer);
        timer = undefined;
      }
      resolve({ code, output });
    };
    let child: TunnelProcess;
    try {
      child = spawnProcess(command, args, { windowsHide: true });
    } catch (error) {
      output = String(error);
      finish(null);
      return;
    }
    child.stdout?.on('data', (chunk: unknown) => {
      output += String(chunk);
    });
    child.stderr?.on('data', (chunk: unknown) => {
      output += String(chunk);
    });
    child.on('error', () => finish(null));
    child.on('exit', (code) => finish(code));
    timer = setTimeout(() => {
      try {
        child.kill();
      } catch {
        // already gone
      }
      finish(null);
    }, timeoutMs);
  });
}

/**
 * Owns the operator's named Cloudflare tunnel: locates `cloudflared`, derives
 * the tunnel/hostname from their config (or explicit overrides), writes a
 * Serpent-managed ingress config so the port always matches, and runs it for
 * the lifetime of the share. Every failure is reported as a state, never thrown
 * into the share lifecycle.
 */
export class CloudflareTunnelManager implements WebShareTunnel {
  readonly #logger: CloudflareTunnelLogger;
  readonly #platform: NodeJS.Platform;
  readonly #homeDir: string;
  readonly #env: NodeJS.ProcessEnv;
  readonly #fileExists: (candidate: string) => boolean;
  readonly #readTextFile: (file: string) => string | undefined;
  readonly #writeTextFile: (file: string, contents: string) => void;
  readonly #ensureDir: (dir: string) => void;
  readonly #spawnProcess: TunnelSpawner;
  readonly #killProcessTree: (child: TunnelProcess) => void;
  readonly #readyTimeoutMs: number;
  readonly #probeTimeoutMs: number;
  readonly #configDir: string;
  readonly #managedConfigPath: string;
  readonly #listeners = new Set<() => void>();

  #config: CloudflareTunnelConfig = {
    cloudflaredPath: null,
    tunnelName: null,
    tunnelHostname: null,
  };
  #state: WebShareTunnelState = { status: 'off' };
  #info: WebShareTunnelInfo;
  #installing = false;
  #process: TunnelProcess | undefined;
  #lineBuffer = '';
  #logTail: string[] = [];
  #activeHostname: string | null = null;
  #activePort: number | null = null;
  #readyTimer: ReturnType<typeof setTimeout> | undefined;
  #stopping = false;
  #generation = 0;

  constructor(deps: CloudflareTunnelDeps) {
    this.#logger = deps.logger;
    this.#platform = deps.platform ?? process.platform;
    this.#homeDir = deps.homeDir ?? os.homedir();
    this.#env = deps.env ?? process.env;
    this.#fileExists = deps.fileExists ?? ((candidate) => existsSync(candidate));
    this.#readTextFile =
      deps.readTextFile ??
      ((file) => {
        try {
          return readFileSync(file, 'utf8');
        } catch {
          return undefined;
        }
      });
    this.#writeTextFile =
      deps.writeTextFile ??
      ((file, contents) => {
        writeFileSync(file, contents, 'utf8');
      });
    this.#ensureDir = deps.ensureDir ?? ((dir) => mkdirSync(dir, { recursive: true }));
    this.#spawnProcess = deps.spawnProcess ?? defaultSpawner;
    this.#killProcessTree =
      deps.killProcessTree ?? ((child) => defaultKillProcessTree(this.#platform, child));
    this.#readyTimeoutMs = deps.readyTimeoutMs ?? READY_TIMEOUT_MS;
    this.#probeTimeoutMs = deps.probeTimeoutMs ?? PROBE_TIMEOUT_MS;
    this.#configDir = path.join(deps.userDataPath, 'cloudflared');
    this.#managedConfigPath = path.join(this.#configDir, 'serpent-tunnel.yml');
    this.#info = webShareTunnelInfoSchema.parse({
      installed: false,
      cloudflaredPath: null,
      version: null,
      hostname: null,
      configFound: false,
      managedConfigPath: this.#managedConfigPath,
    });
  }

  state(): WebShareTunnelState {
    return this.#state;
  }

  info(): WebShareTunnelInfo {
    return this.#info;
  }

  isInstalling(): boolean {
    return this.#installing;
  }

  onChange(listener: () => void): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  setConfig(config: Partial<CloudflareTunnelConfig>): void {
    this.#config = { ...this.#config, ...config };
  }

  /** Locate cloudflared, probe its version and resolve the effective hostname. */
  async refreshInfo(): Promise<WebShareTunnelInfo> {
    const executable = this.#resolveExecutable();
    let version: string | null = null;
    if (executable !== null) {
      const result = await runCapture(
        this.#spawnProcess,
        executable,
        ['--version'],
        this.#probeTimeoutMs,
      );
      version = result.output.trim().split(/\r?\n/u)[0]?.trim() ?? null;
      if (version === '') version = null;
    }
    const parsed = this.#readParsedConfig();
    const hostname =
      normalizeTunnelHostname(this.#config.tunnelHostname) ?? normalizeTunnelHostname(parsed.hostname);
    this.#info = webShareTunnelInfoSchema.parse({
      installed: executable !== null,
      cloudflaredPath: executable,
      version,
      hostname,
      configFound: parsed.found,
      managedConfigPath: this.#managedConfigPath,
    });
    this.#emit();
    return this.#info;
  }

  async start(port: number): Promise<void> {
    if (this.#process !== undefined) {
      // Already running: only restart when the target port changed.
      if (this.#state.status === 'running' && this.#activePort === port) return;
      await this.stop();
    }
    const parsed = this.#readParsedConfig();
    const executable = this.#resolveExecutable();
    if (executable === null) {
      this.#setError(
        'WEB_SHARE_TUNNEL_NOT_INSTALLED',
        'cloudflared was not found. Install it or set its path in Web Share settings.',
      );
      return;
    }
    const tunnel = this.#config.tunnelName?.trim() || parsed.tunnel;
    if (tunnel === null || tunnel === '' || parsed.credentialsFile === null) {
      this.#setError(
        'WEB_SHARE_TUNNEL_NO_CONFIG',
        'No tunnel credentials were found. Fill in the tunnel name and hostname in Web Share settings.',
      );
      return;
    }
    const hostname =
      normalizeTunnelHostname(this.#config.tunnelHostname) ?? normalizeTunnelHostname(parsed.hostname);
    if (hostname === null) {
      this.#setError(
        'WEB_SHARE_TUNNEL_NO_HOSTNAME',
        'No public hostname was found. Enter the domain you routed to this tunnel in Web Share settings.',
      );
      return;
    }
    let managed: string;
    try {
      this.#ensureDir(this.#configDir);
      managed = buildManagedTunnelConfig({
        tunnel,
        credentialsFile: parsed.credentialsFile,
        hostname,
        port,
      });
      this.#writeTextFile(this.#managedConfigPath, managed);
    } catch (error) {
      this.#logger.error('web-share.tunnel.config', error);
      this.#setError('WEB_SHARE_TUNNEL_SPAWN_FAILED', 'The managed tunnel config could not be written.');
      return;
    }

    this.#activeHostname = hostname;
    this.#activePort = port;
    this.#logTail = [];
    this.#lineBuffer = '';
    const generation = ++this.#generation;
    this.#stopping = false;
    this.#setState({ status: 'starting' });

    const args = [
      'tunnel',
      '--config',
      this.#managedConfigPath,
      '--no-autoupdate',
      'run',
      tunnel,
    ];
    let child: TunnelProcess;
    try {
      child = this.#spawnProcess(executable, args, { windowsHide: true });
    } catch (error) {
      this.#logger.error('web-share.tunnel.spawn', error);
      this.#setError('WEB_SHARE_TUNNEL_SPAWN_FAILED', 'cloudflared could not be started.');
      return;
    }
    this.#process = child;
    child.stdout?.on('data', (chunk: unknown) => this.#consume(String(chunk), generation));
    child.stderr?.on('data', (chunk: unknown) => this.#consume(String(chunk), generation));
    child.on('error', (error) => {
      if (generation !== this.#generation) return;
      this.#logger.error('web-share.tunnel.process', error);
      this.#setError('WEB_SHARE_TUNNEL_SPAWN_FAILED', 'cloudflared could not be started.');
    });
    child.on('exit', (code) => {
      if (generation !== this.#generation) return;
      this.#process = undefined;
      this.#clearReadyTimer();
      if (this.#stopping) return;
      this.#setError(
        'WEB_SHARE_TUNNEL_EXITED',
        `cloudflared exited${code === null ? '' : ` (code ${code})`}.${this.#logHint()}`,
      );
    });
    this.#readyTimer = setTimeout(() => {
      if (generation !== this.#generation) return;
      if (this.#state.status !== 'starting') return;
      this.#setError(
        'WEB_SHARE_TUNNEL_EXITED',
        `The tunnel did not connect in time.${this.#logHint()}`,
      );
    }, this.#readyTimeoutMs);
  }

  async stop(): Promise<void> {
    this.#generation += 1;
    this.#stopping = true;
    this.#clearReadyTimer();
    const child = this.#process;
    this.#process = undefined;
    if (child !== undefined) {
      try {
        this.#killProcessTree(child);
      } catch {
        // already gone
      }
    }
    this.#activeHostname = null;
    this.#activePort = null;
    this.#setState({ status: 'off' });
  }

  /** Run the platform package manager to install cloudflared. */
  async install(): Promise<void> {
    if (this.#installing) return;
    const spec = this.#installCommand();
    if (spec === null) {
      this.#setError(
        'WEB_SHARE_TUNNEL_INSTALL_UNSUPPORTED',
        'Automatic install is only available on Windows and macOS. Install cloudflared manually.',
      );
      return;
    }
    this.#installing = true;
    this.#emit();
    try {
      const result = await runCapture(
        this.#spawnProcess,
        spec.command,
        spec.args,
        INSTALL_TIMEOUT_MS,
      );
      if (result.code !== 0) {
        this.#logger.error('web-share.tunnel.install', new Error('install failed'), {
          code: result.code,
        });
        this.#setError(
          'WEB_SHARE_TUNNEL_INSTALL_FAILED',
          `cloudflared could not be installed automatically.${this.#outputHint(result.output)}`,
        );
        return;
      }
      await this.refreshInfo();
      if (!this.#info.installed) {
        this.#setError(
          'WEB_SHARE_TUNNEL_INSTALL_FAILED',
          'cloudflared was installed but could not be found yet. Restart Serpent, then try again.',
        );
      }
    } finally {
      this.#installing = false;
      this.#emit();
    }
  }

  #installCommand(): { command: string; args: string[] } | null {
    if (this.#platform === 'win32') {
      return {
        command: this.#env.ComSpec ?? 'cmd.exe',
        args: [
          '/d',
          '/s',
          '/c',
          'winget install --id Cloudflare.cloudflared -e --accept-source-agreements --accept-package-agreements',
        ],
      };
    }
    if (this.#platform === 'darwin') {
      return { command: 'brew', args: ['install', 'cloudflared'] };
    }
    return null;
  }

  #resolveExecutable(): string | null {
    const explicit = this.#config.cloudflaredPath?.trim();
    if (explicit !== undefined && explicit !== '' && this.#fileExists(explicit)) {
      return explicit;
    }
    for (const candidate of dedupe(defaultCloudflaredCandidates(this.#platform, this.#env))) {
      if (this.#fileExists(candidate)) return candidate;
    }
    return null;
  }

  #readParsedConfig(): ParsedCloudflareConfig {
    const names = ['config.yml', 'config.yaml'];
    for (const name of names) {
      const file = path.join(this.#homeDir, DEFAULT_CLOUDFLARED_DIRNAME, name);
      const text = this.#readTextFile(file);
      if (text === undefined) continue;
      return { found: true, ...parseCloudflaredConfig(text) };
    }
    return { found: false, tunnel: null, credentialsFile: null, hostname: null };
  }

  #consume(text: string, generation: number): void {
    if (generation !== this.#generation) return;
    this.#lineBuffer += text;
    const lines = this.#lineBuffer.split(/\r?\n/u);
    this.#lineBuffer = lines.pop() ?? '';
    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed === '') continue;
      this.#logTail.push(trimmed);
      if (this.#logTail.length > LOG_TAIL_LINES) this.#logTail.shift();
      if (READY_LOG.test(trimmed) && this.#state.status === 'starting') {
        this.#setRunning();
      }
    }
  }

  #setRunning(): void {
    this.#clearReadyTimer();
    const hostname = this.#activeHostname;
    if (hostname === null) return;
    this.#setState({ status: 'running', publicUrl: `https://${hostname}` });
  }

  #clearReadyTimer(): void {
    if (this.#readyTimer !== undefined) {
      clearTimeout(this.#readyTimer);
      this.#readyTimer = undefined;
    }
  }

  #logHint(): string {
    const tail = this.#logTail.slice(-3).join(' | ');
    return tail === '' ? '' : ` ${tail}`;
  }

  #outputHint(output: string): string {
    const tail = output.trim().split(/\r?\n/u).filter((line) => line.trim() !== '').slice(-2).join(' | ');
    return tail === '' ? '' : ` ${tail}`;
  }

  #setState(state: WebShareTunnelState): void {
    this.#state = state;
    this.#emit();
  }

  #setError(code: WebShareTunnelErrorCode, message: string): void {
    this.#logger.error('web-share.tunnel', new Error(message), { code });
    this.#setState({ status: 'error', code, message });
  }

  #emit(): void {
    for (const listener of this.#listeners) listener();
  }
}
