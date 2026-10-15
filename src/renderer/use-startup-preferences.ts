import { useEffect, useState } from "react";

import {
  DEFAULT_STARTUP_PREFERENCES_SNAPSHOT,
  type StartupPreferencesSnapshot,
} from "../shared/startup-preferences";

type StartupApi = {
  get(): Promise<StartupPreferencesSnapshot>;
  set(input: {
    openAtLogin: boolean;
    silentLaunch: boolean;
  }): Promise<StartupPreferencesSnapshot>;
};

function startupApi(): StartupApi | undefined {
  return (window as Window & { serpent?: { startup?: StartupApi } }).serpent?.startup;
}

export function useStartupPreferences(): {
  available: boolean;
  snapshot: StartupPreferencesSnapshot;
  setOpenAtLogin: (openAtLogin: boolean) => void;
  setSilentLaunch: (silentLaunch: boolean) => void;
} {
  const available = startupApi() !== undefined;
  const [snapshot, setSnapshot] = useState<StartupPreferencesSnapshot>(
    DEFAULT_STARTUP_PREFERENCES_SNAPSHOT,
  );

  useEffect(() => {
    const api = startupApi();
    if (api === undefined) return undefined;
    let cancelled = false;
    void api.get().then((next) => {
      if (!cancelled) setSnapshot(next);
    }).catch(() => {
      // Keep the default snapshot. The settings page stays usable.
    });
    return () => {
      cancelled = true;
    };
  }, []);

  function persist(next: { openAtLogin: boolean; silentLaunch: boolean }): void {
    const api = startupApi();
    setSnapshot((current) => ({ ...current, ...next }));
    if (api === undefined) return;
    void api.set(next).then(setSnapshot).catch(() => {
      void api.get().then(setSnapshot);
    });
  }

  return {
    available,
    snapshot,
    setOpenAtLogin: (openAtLogin) => {
      persist({ openAtLogin, silentLaunch: snapshot.silentLaunch });
    },
    setSilentLaunch: (silentLaunch) => {
      persist({ openAtLogin: snapshot.openAtLogin, silentLaunch });
    },
  };
}
