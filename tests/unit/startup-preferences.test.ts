import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
  applyStartupLoginItem,
  readStartupPreferences,
  startupPreferencesFilePath,
  writeStartupPreferences,
} from '../../src/main/startup-preferences-store';
import {
  DEFAULT_STARTUP_PREFERENCES,
  SILENT_LAUNCH_ARG,
  loginItemRegistration,
  parseStartupPreferences,
  shouldHandleSecondaryLaunch,
  shouldShowMainWindowOnReady,
  shouldStartHidden,
} from '../../src/shared/startup-preferences';

const tempDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirectories.splice(0).map((directory) => rm(directory, {
    recursive: true,
    force: true,
  })));
});

describe('startup preferences', () => {
  it('falls back when the stored file is missing or invalid', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'serpent-startup-preferences-'));
    tempDirectories.push(root);
    const filePath = startupPreferencesFilePath(root);
    expect(readStartupPreferences(filePath)).toEqual(DEFAULT_STARTUP_PREFERENCES);
    writeStartupPreferences(filePath, { version: 1, openAtLogin: true, silentLaunch: true });
    expect(JSON.parse(await readFile(filePath, 'utf8'))).toEqual({
      version: 1,
      openAtLogin: true,
      silentLaunch: true,
    });
    expect(readStartupPreferences(filePath)).toEqual({
      version: 1,
      openAtLogin: true,
      silentLaunch: true,
    });
    expect(parseStartupPreferences({ version: 2, openAtLogin: true })).toEqual(DEFAULT_STARTUP_PREFERENCES);
  });

  it('registers login items only for packaged macOS and Windows apps', () => {
    const preferences = { version: 1 as const, openAtLogin: true, silentLaunch: true };
    expect(loginItemRegistration({
      platform: 'darwin',
      packaged: true,
      e2e: false,
      preferences,
    })).toEqual({ openAtLogin: true });
    expect(loginItemRegistration({
      platform: 'win32',
      packaged: true,
      e2e: false,
      preferences,
    })).toEqual({
      openAtLogin: true,
      args: [SILENT_LAUNCH_ARG],
      enabled: true,
    });
    expect(loginItemRegistration({
      platform: 'win32',
      packaged: true,
      e2e: false,
      preferences: { ...preferences, silentLaunch: false },
    })?.args).toEqual([]);
    expect(loginItemRegistration({
      platform: 'linux',
      packaged: true,
      e2e: false,
      preferences,
    })).toBeUndefined();
    expect(loginItemRegistration({
      platform: 'darwin',
      packaged: false,
      e2e: false,
      preferences,
    })).toBeUndefined();
    expect(loginItemRegistration({
      platform: 'darwin',
      packaged: true,
      e2e: true,
      preferences,
    })).toBeUndefined();
  });

  it('applies the registration and records macOS approval', () => {
    const calls: unknown[] = [];
    const snapshot = applyStartupLoginItem({
      platform: 'darwin',
      packaged: true,
      e2e: false,
      preferences: { version: 1, openAtLogin: true, silentLaunch: false },
      setLoginItemSettings: (settings) => {
        calls.push(settings);
      },
      getLoginItemStatus: () => 'requires-approval',
    });
    expect(calls).toEqual([{ openAtLogin: true }]);
    expect(snapshot).toEqual({
      openAtLogin: true,
      silentLaunch: false,
      supported: true,
      approvalRequired: true,
    });
  });

  it('hides the first window only for a silent login launch', () => {
    const silent = { version: 1 as const, openAtLogin: true, silentLaunch: true };
    const visible = { ...silent, silentLaunch: false };
    expect(shouldStartHidden({
      preferences: silent,
      argv: [],
      wasOpenedAtLogin: true,
      wasOpenedAsHidden: false,
    })).toBe(true);
    expect(shouldStartHidden({
      preferences: visible,
      argv: [SILENT_LAUNCH_ARG],
      wasOpenedAtLogin: false,
      wasOpenedAsHidden: false,
    })).toBe(true);
    expect(shouldStartHidden({
      preferences: silent,
      argv: [],
      wasOpenedAtLogin: false,
      wasOpenedAsHidden: false,
    })).toBe(false);
    expect(shouldStartHidden({
      preferences: visible,
      argv: [],
      wasOpenedAtLogin: true,
      wasOpenedAsHidden: false,
    })).toBe(false);
  });

  it('does not present a window during silent launch, update handoff, or quit', () => {
    expect(shouldShowMainWindowOnReady({
      startHidden: false,
      updateHandoff: false,
      applicationQuitting: false,
      e2eHideWindow: false,
    })).toBe(true);
    expect(shouldShowMainWindowOnReady({
      startHidden: true,
      updateHandoff: false,
      applicationQuitting: false,
      e2eHideWindow: false,
    })).toBe(false);
    expect(shouldShowMainWindowOnReady({
      startHidden: false,
      updateHandoff: true,
      applicationQuitting: false,
      e2eHideWindow: false,
    })).toBe(false);
    expect(shouldHandleSecondaryLaunch({
      updateHandoff: false,
      applicationQuitting: false,
    })).toBe(true);
    expect(shouldHandleSecondaryLaunch({
      updateHandoff: true,
      applicationQuitting: false,
    })).toBe(false);
    expect(shouldHandleSecondaryLaunch({
      updateHandoff: false,
      applicationQuitting: true,
    })).toBe(false);
  });
});
