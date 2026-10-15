import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import {
  DEFAULT_STARTUP_PREFERENCES,
  loginItemRegistration,
  parseStartupPreferences,
  startupPlatformSupported,
  type LoginItemRegistration,
  type StartupPreferences,
  type StartupPreferencesSnapshot,
} from '../shared/startup-preferences';

export const STARTUP_PREFERENCES_FILE_NAME = 'startup-preferences.json';

export function startupPreferencesFilePath(userDataPath: string): string {
  return path.join(userDataPath, STARTUP_PREFERENCES_FILE_NAME);
}

export function readStartupPreferences(filePath: string): StartupPreferences {
  try {
    return parseStartupPreferences(JSON.parse(readFileSync(filePath, 'utf8')));
  } catch {
    return DEFAULT_STARTUP_PREFERENCES;
  }
}

export function writeStartupPreferences(filePath: string, preferences: StartupPreferences): void {
  const stored = parseStartupPreferences(preferences);
  writeFileSync(filePath, `${JSON.stringify(stored, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
}

export function applyStartupLoginItem(input: {
  platform: string;
  packaged: boolean;
  e2e: boolean;
  preferences: StartupPreferences;
  setLoginItemSettings: (settings: LoginItemRegistration) => void;
  getLoginItemStatus?: () => string | undefined;
}): StartupPreferencesSnapshot {
  const registration = loginItemRegistration(input);
  let approvalRequired = false;
  if (registration !== undefined) {
    input.setLoginItemSettings(registration);
    approvalRequired = input.getLoginItemStatus?.() === 'requires-approval';
  }
  return {
    openAtLogin: input.preferences.openAtLogin,
    silentLaunch: input.preferences.silentLaunch,
    supported: startupPlatformSupported(input.platform),
    approvalRequired,
  };
}
