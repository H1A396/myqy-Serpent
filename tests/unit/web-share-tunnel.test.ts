import { EventEmitter } from 'node:events';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
  buildManagedTunnelConfig,
  CloudflareTunnelManager,
  normalizeTunnelHostname,
  parseCloudflaredConfig,
  type TunnelProcess,
  type TunnelSpawner,
} from '../../src/myqy-web-share/server/cloudflare-tunnel';
import { WebShareSettingsStore } from '../../src/myqy-web-share/server/web-share-settings-store';

class FakeStream extends EventEmitter {
  push(chunk: string): void {
    this.emit('data', chunk);
  }
}

class FakeProcess extends EventEmitter {
  pid = 4_321;
  stdout = new FakeStream();
  stderr = new FakeStream();
  killed = false;

  kill(): boolean {
    this.killed = true;
    return true;
  }

  log(line: string): void {
    this.stderr.push(`${line}\n`);
  }
}

interface Harness {
  manager: CloudflareTunnelManager;
  processes: FakeProcess[];
  spawns: { command: string; args: string[] }[];
  texts: Map<string, string>;
  existing: Set<string>;
}

const HOME = '/home/example';
const CONFIG_PATH = path.join(HOME, '.cloudflared', 'config.yml');
const EXE = '/opt/homebrew/bin/cloudflared';
const MANAGED_PATH = path.join('/tmp/userdata', 'cloudflared', 'serpent-tunnel.yml');

function fakeConfig(
  overrides: Partial<{ tunnel: string; credentials: string; hostname: string }> = {},
): string {
  const tunnel = overrides.tunnel ?? 'aaaa-bbbb';
  const credentials = overrides.credentials ?? `${HOME}/.cloudflared/aaaa-bbbb.json`;
  const hostname = overrides.hostname ?? 'share.example.test';
  return [
    `tunnel: ${tunnel}`,
    `credentials-file: ${credentials}`,
    '',
    'ingress:',
    `  - hostname: ${hostname}`,
    '    service: http://127.0.0.1:47890',
    '  - service: http_status:404',
    '',
  ].join('\n');
}

function makeHarness(options: {
  config?: string | undefined;
  withExe?: boolean;
  platform?: NodeJS.Platform;
}): Harness {
  const processes: FakeProcess[] = [];
  const spawns: { command: string; args: string[] }[] = [];
  const texts = new Map<string, string>();
  const existing = new Set<string>();
  if (options.config !== undefined) {
    texts.set(CONFIG_PATH, options.config);
    existing.add(CONFIG_PATH);
  }
  if (options.withExe ?? true) existing.add(EXE);

  const spawnProcess: TunnelSpawner = (command, args) => {
    spawns.push({ command, args: [...args] });
    const process = new FakeProcess();
    if (args.includes('--version')) {
      setImmediate(() => {
        process.stdout.push('cloudflared version 2026.9.3\n');
        process.emit('exit', 0, null);
      });
    } else if (command !== EXE) {
      // Install command.
      queueMicrotask(() => process.emit('exit', 0, null));
    } else {
      processes.push(process);
    }
    return process as unknown as TunnelProcess;
  };

  const manager = new CloudflareTunnelManager({
    userDataPath: '/tmp/userdata',
    logger: { info() {}, error() {} },
    platform: options.platform ?? 'darwin',
    homeDir: HOME,
    env: {
      PATH: '',
      ProgramFiles: 'C:\\Program Files',
      ['ProgramFiles(x86)']: 'C:\\Program Files (x86)',
    },
    fileExists: (candidate) => existing.has(candidate),
    readTextFile: (file) => texts.get(file),
    writeTextFile: (file, contents) => {
      texts.set(file, contents);
      existing.add(file);
    },
    ensureDir: () => {},
    spawnProcess,
    killProcessTree: (child) => {
      (child as unknown as FakeProcess).killed = true;
    },
    readyTimeoutMs: 5_000,
    probeTimeoutMs: 1_000,
  });
  return { manager, processes, spawns, texts, existing };
}

describe('parseCloudflaredConfig', () => {
  it('reads the tunnel, credentials and first hostname, ignoring the 404 catch-all', () => {
    const parsed = parseCloudflaredConfig(fakeConfig());
    expect(parsed.tunnel).toBe('aaaa-bbbb');
    expect(parsed.credentialsFile).toBe(`${HOME}/.cloudflared/aaaa-bbbb.json`);
    expect(parsed.hostname).toBe('share.example.test');
  });

  it('tolerates quotes and inline comments', () => {
    const parsed = parseCloudflaredConfig(
      ['tunnel: "t-123" # my tunnel', 'credentials-file: /x/y.json', 'ingress:', '  - hostname: "a.b.test"'].join(
        '\n',
      ),
    );
    expect(parsed.tunnel).toBe('t-123');
    expect(parsed.hostname).toBe('a.b.test');
  });
});

describe('normalizeTunnelHostname', () => {
  it('strips scheme/path and lowercases', () => {
    expect(normalizeTunnelHostname('HTTPS://Share.Example.Test/path?q=1')).toBe('share.example.test');
    expect(normalizeTunnelHostname('  ')).toBeNull();
    expect(normalizeTunnelHostname(undefined)).toBeNull();
  });
});

describe('buildManagedTunnelConfig', () => {
  it('points the ingress at the current share port', () => {
    const yaml = buildManagedTunnelConfig({
      tunnel: 'aaaa-bbbb',
      credentialsFile: `${HOME}/.cloudflared/aaaa-bbbb.json`,
      hostname: 'share.example.test',
      port: 49_001,
    });
    expect(yaml).toContain('  - hostname: share.example.test');
    expect(yaml).toContain('    service: http://127.0.0.1:49001');
    expect(yaml).toContain('  - service: http_status:404');
  });
});

describe('CloudflareTunnelManager', () => {
  it('reports installed, version and hostname from the config', async () => {
    const harness = makeHarness({ config: fakeConfig() });
    const info = await harness.manager.refreshInfo();
    expect(info.installed).toBe(true);
    expect(info.cloudflaredPath).toBe(EXE);
    expect(info.version).toContain('cloudflared');
    expect(info.hostname).toBe('share.example.test');
    expect(info.configFound).toBe(true);
  });

  it('refuses to start when cloudflared is missing', async () => {
    const harness = makeHarness({ config: fakeConfig(), withExe: false });
    await harness.manager.refreshInfo();
    await harness.manager.start(47_890);
    expect(harness.manager.state()).toMatchObject({
      status: 'error',
      code: 'WEB_SHARE_TUNNEL_NOT_INSTALLED',
    });
  });

  it('refuses to start when no public hostname can be resolved', async () => {
    const harness = makeHarness({
      config: ['tunnel: aaaa-bbbb', `credentials-file: ${HOME}/.cloudflared/aaaa-bbbb.json`, ''].join('\n'),
    });
    await harness.manager.start(47_890);
    expect(harness.manager.state()).toMatchObject({
      status: 'error',
      code: 'WEB_SHARE_TUNNEL_NO_HOSTNAME',
    });
  });

  it('writes a managed config and reports running once the tunnel registers', async () => {
    const harness = makeHarness({ config: fakeConfig() });
    await harness.manager.start(47_890);
    expect(harness.manager.state()).toEqual({ status: 'starting' });
    const managed = harness.texts.get(MANAGED_PATH);
    expect(managed).toContain('service: http://127.0.0.1:47890');

    harness.processes[0]!.log('INF Registered tunnel connection connIndex=0');
    expect(harness.manager.state()).toEqual({
      status: 'running',
      publicUrl: 'https://share.example.test',
    });
  });

  it('uses explicit overrides for the tunnel name and hostname', async () => {
    const harness = makeHarness({ config: fakeConfig() });
    harness.manager.setConfig({
      cloudflaredPath: null,
      tunnelName: 'override-name',
      tunnelHostname: 'HTTPS://Routed.Example.Test/',
    });
    await harness.manager.start(47_890);
    const managed = harness.texts.get(MANAGED_PATH);
    expect(managed).toContain('tunnel: override-name');
    expect(managed).toContain('  - hostname: routed.example.test');
    harness.processes[0]!.log('INF Registered tunnel connection connIndex=0');
    expect(harness.manager.state()).toEqual({
      status: 'running',
      publicUrl: 'https://routed.example.test',
    });
  });

  it('stops the process and returns to off', async () => {
    const harness = makeHarness({ config: fakeConfig() });
    await harness.manager.start(47_890);
    harness.processes[0]!.log('INF Registered tunnel connection connIndex=0');
    await harness.manager.stop();
    expect(harness.processes[0]!.killed).toBe(true);
    expect(harness.manager.state()).toEqual({ status: 'off' });
  });

  it('reports an installation failure when no package manager is available', async () => {
    const harness = makeHarness({ config: fakeConfig(), withExe: false, platform: 'linux' });
    await harness.manager.install();
    expect(harness.manager.state()).toMatchObject({
      status: 'error',
      code: 'WEB_SHARE_TUNNEL_INSTALL_UNSUPPORTED',
    });
  });

  it('installs via the package manager and re-detects the binary', async () => {
    const harness = makeHarness({ config: fakeConfig(), withExe: false, platform: 'win32' });
    // The fake install command "installs" the binary.
    harness.existing.add(
      path.join('C:\\Program Files (x86)', 'cloudflared', 'cloudflared.exe'),
    );
    await harness.manager.install();
    expect(harness.spawns.some((entry) => entry.args.some((arg) => arg.includes('winget')))).toBe(true);
    expect(harness.manager.info().installed).toBe(true);
  });
});

describe('WebShareSettingsStore tunnel preferences', () => {
  const tempDirs: string[] = [];

  afterEach(async () => {
    await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
  });

  async function makeDir(): Promise<string> {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'serpent-ws-store-'));
    tempDirs.push(dir);
    return dir;
  }

  it('defaults to automatic forwarding with no overrides', async () => {
    const store = new WebShareSettingsStore(await makeDir());
    expect(store.preferences.autoTunnel).toBe(true);
    expect(store.preferences.cloudflaredPath).toBeNull();
    expect(store.preferences.tunnelName).toBeNull();
    expect(store.preferences.tunnelHostname).toBeNull();
  });

  it('persists tunnel overrides across instances', async () => {
    const dir = await makeDir();
    const store = new WebShareSettingsStore(dir);
    store.setPreferences({
      autoTunnel: false,
      cloudflaredPath: '/usr/local/bin/cloudflared',
      tunnelName: 'my-tunnel',
      tunnelHostname: 'share.example.test',
    });
    const reloaded = new WebShareSettingsStore(dir);
    expect(reloaded.preferences).toMatchObject({
      autoTunnel: false,
      cloudflaredPath: '/usr/local/bin/cloudflared',
      tunnelName: 'my-tunnel',
      tunnelHostname: 'share.example.test',
    });
  });

  it('loads a legacy settings file that predates the tunnel fields', async () => {
    const dir = await makeDir();
    await writeFile(
      path.join(dir, 'web-share-settings.json'),
      JSON.stringify({
        version: 1,
        preferences: { enabled: true, port: 47_890, allowDownload: true },
      }),
      'utf8',
    );
    const store = new WebShareSettingsStore(dir);
    expect(store.preferences.enabled).toBe(true);
    expect(store.preferences.autoTunnel).toBe(true);
    expect(store.preferences.tunnelHostname).toBeNull();
    // A subsequent write persists the new keys without dropping the old ones.
    store.setPreferences({ tunnelName: 'kept' });
    const written = JSON.parse(await readFile(path.join(dir, 'web-share-settings.json'), 'utf8')) as {
      preferences: { enabled: boolean; tunnelName: string };
    };
    expect(written.preferences.enabled).toBe(true);
    expect(written.preferences.tunnelName).toBe('kept');
  });
});
