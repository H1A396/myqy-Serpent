import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';

import {
  applyBackgroundPreferences,
  loadBackgroundPreferences,
  saveBackgroundPreferences,
  type BackgroundPreferences,
} from './background-preferences';
import {
  clearCustomTheme,
  loadCustomTheme,
  saveCustomTheme,
  type CustomTheme,
} from './custom-theme';
import { CUSTOM_THEME_COLOR_TOKENS, DEFAULT_CUSTOM_THEME } from './custom-theme';
import {
  activeUserTheme as findActiveUserTheme,
  addUserTheme,
  loadUserThemes,
  removeUserTheme,
  saveUserThemes,
  updateUserTheme,
  type UserTheme,
  type UserThemesState,
} from './user-themes';
import {
  migrateLegacyAccentIntoCustomTheme,
  resolveEffectiveThemeTokens,
} from './theme-composition';
import {
  loadThemeAccent,
  saveThemeAccent,
} from './theme-accent-preferences';
import {
  loadThemeProfile,
  saveThemeProfile,
  THEME_PROFILE_VERSION,
  type ThemeProfile,
  type ThemeProfileId,
} from './theme-profiles';
import {
  applyResolvedTheme,
  loadThemePreferences,
  readSystemTheme,
  resolveEffectiveTheme,
  setStoredTheme,
  type ResolvedTheme,
  type ThemePreference,
  type ThemePreferencesStorage,
} from './theme-preferences';

type ThemeContextValue = {
  readonly preference: ThemePreference;
  readonly resolved: ResolvedTheme;
  readonly customTheme: CustomTheme;
  readonly themeAccentHex: string | null;
  readonly themeProfile: ThemeProfile;
  readonly backgroundPreferences: BackgroundPreferences;
  readonly themeRevision: number;
  readonly setTheme: (theme: ThemePreference) => void;
  readonly setCustomTheme: (theme: CustomTheme) => void;
  readonly resetCustomTheme: () => void;
  readonly setThemeProfile: (profile: ThemeProfileId) => void;
  readonly setThemeAccent: (accentHex: string) => void;
  readonly setBackgroundPreferences: (preferences: BackgroundPreferences) => boolean;
  /** Saved user themes and which one (if any) is active. */
  readonly userThemes: UserThemesState;
  readonly activeUserTheme: UserTheme | null;
  readonly selectUserTheme: (id: string) => void;
  /** Duplicate the current look (profile + overrides) into a new active user theme. */
  readonly createUserTheme: (name: string) => string;
  readonly renameUserTheme: (id: string, name: string) => void;
  readonly deleteUserTheme: (id: string) => void;
};

const ThemeContext = createContext<ThemeContextValue | null>(null);

export type ThemeProviderProps = {
  readonly children: ReactNode;
  readonly storage?: ThemePreferencesStorage;
  readonly initialPreference?: ThemePreference;
};

export function ThemeProvider({
  children,
  storage,
  initialPreference,
}: ThemeProviderProps) {
  const [preference, setPreferenceState] = useState<ThemePreference>(
    () => initialPreference ?? loadThemePreferences(storage).theme,
  );
  const [initial] = useState(() => {
    // The legacy standalone accent preference migrates into a custom-theme
    // override here, once, before anything else reads the theme. Legacy
    // "advanced colour" overrides then migrate into a user theme.
    const legacy = migrateLegacyAccentIntoCustomTheme(loadCustomTheme(storage), storage);
    const profile = loadThemeProfile(storage);
    const loaded = loadUserThemes({
      storage,
      legacyCustomTheme: legacy,
      currentPreset: profile.preset,
    });
    return {
      customTheme: loaded.migrated ? DEFAULT_CUSTOM_THEME : legacy,
      profile,
      userThemes: loaded.state,
    };
  });
  const [baseCustomTheme, setCustomThemeState] = useState<CustomTheme>(initial.customTheme);
  const [userThemes, setUserThemesState] = useState<UserThemesState>(initial.userThemes);
  const [themeAccentHex, setThemeAccentState] = useState<string | null>(() =>
    loadThemeAccent(storage),
  );
  const [baseThemeProfile, setThemeProfileState] = useState<ThemeProfile>(initial.profile);
  const [backgroundPreferences, setBackgroundPreferencesState] = useState<BackgroundPreferences>(() => loadBackgroundPreferences(storage));
  const [systemTheme, setSystemTheme] = useState<ResolvedTheme>(() =>
    readSystemTheme(),
  );
  const [themeRevision, setThemeRevision] = useState(0);
  const themeSignatureRef = useRef('');

  const activeUserTheme = useMemo(() => findActiveUserTheme(userThemes), [userThemes]);
  // The theme that is actually rendered: a user theme's base profile and
  // overrides replace the built-in selection while it is active.
  const themeProfile = useMemo<ThemeProfile>(
    () => (activeUserTheme ? { ...baseThemeProfile, preset: activeUserTheme.base } : baseThemeProfile),
    [activeUserTheme, baseThemeProfile],
  );
  const customTheme = useMemo<CustomTheme>(
    () => (activeUserTheme
      ? { ...baseCustomTheme, light: activeUserTheme.light, dark: activeUserTheme.dark }
      : baseCustomTheme),
    [activeUserTheme, baseCustomTheme],
  );
  const commitUserThemes = useCallback((next: UserThemesState) => {
    saveUserThemes(next, storage);
    setUserThemesState(next);
  }, [storage]);

  const resolved = useMemo(
    () => resolveEffectiveTheme(preference, systemTheme),
    [preference, systemTheme],
  );

  useEffect(() => {
    applyResolvedTheme(resolved);
  }, [resolved]);

  useEffect(() => {
    if (typeof document === 'undefined') return;
    const root = document.documentElement;
    for (const token of CUSTOM_THEME_COLOR_TOKENS) {
      root.style.removeProperty(token);
    }
    const composition = resolveEffectiveThemeTokens({
      themeProfile,
      customTheme,
      resolved,
      themeAccentHex,
    });
    for (const [token, value] of Object.entries(composition.tokens)) {
      root.style.setProperty(token, value);
    }
    root.style.setProperty('--accent', composition.accentHex);
  }, [customTheme, resolved, themeAccentHex, themeProfile]);

  useEffect(() => {
    applyBackgroundPreferences(backgroundPreferences);
  }, [backgroundPreferences]);

  useEffect(() => {
    const signature = `${resolved}:${JSON.stringify(customTheme)}:${JSON.stringify(themeAccentHex)}:${JSON.stringify(themeProfile)}:${JSON.stringify(backgroundPreferences)}`;
    if (themeSignatureRef.current === signature) return;
    themeSignatureRef.current = signature;
    setThemeRevision((revision) => revision + 1);
  }, [backgroundPreferences, customTheme, resolved, themeAccentHex, themeProfile]);

  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return;
    const mq = window.matchMedia('(prefers-color-scheme: light)');
    const onChange = () => setSystemTheme(readSystemTheme());
    onChange();
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);

  const setTheme = useCallback(
    (next: ThemePreference) => {
      setStoredTheme(next, storage);
      setPreferenceState(next);
    },
    [storage],
  );

  const setCustomTheme = useCallback((next: CustomTheme) => {
    if (activeUserTheme) {
      commitUserThemes(updateUserTheme(userThemes, activeUserTheme.id, {
        light: next.light,
        dark: next.dark,
      }));
      return;
    }
    saveCustomTheme(next, storage);
    setCustomThemeState(next);
  }, [activeUserTheme, commitUserThemes, storage, userThemes]);

  const resetCustomTheme = useCallback(() => {
    if (activeUserTheme) {
      commitUserThemes(updateUserTheme(userThemes, activeUserTheme.id, { light: {}, dark: {} }));
      return;
    }
    clearCustomTheme(storage);
    setCustomThemeState(loadCustomTheme(storage));
  }, [activeUserTheme, commitUserThemes, storage, userThemes]);

  const selectUserTheme = useCallback((id: string) => {
    if (!userThemes.themes.some((theme) => theme.id === id)) return;
    commitUserThemes({ ...userThemes, activeId: id });
  }, [commitUserThemes, userThemes]);

  const createUserTheme = useCallback((name: string) => {
    const { state, theme } = addUserTheme(userThemes, {
      name,
      base: themeProfile.preset,
      light: { ...customTheme.light },
      dark: { ...customTheme.dark },
    });
    commitUserThemes(state);
    return theme.id;
  }, [commitUserThemes, customTheme, themeProfile.preset, userThemes]);

  const renameUserTheme = useCallback((id: string, name: string) => {
    commitUserThemes(updateUserTheme(userThemes, id, { name }));
  }, [commitUserThemes, userThemes]);

  const deleteUserTheme = useCallback((id: string) => {
    const deleted = userThemes.themes.find((theme) => theme.id === id);
    commitUserThemes(removeUserTheme(userThemes, id));
    // Deleting the active theme falls back to the profile it was built on.
    if (deleted && userThemes.activeId === id) {
      const profile: ThemeProfile = { version: THEME_PROFILE_VERSION, preset: deleted.base, overrides: {} };
      saveThemeProfile(profile, storage);
      setThemeProfileState(profile);
    }
  }, [commitUserThemes, storage, userThemes]);

  const setThemeProfile = useCallback((preset: ThemeProfileId) => {
    const next: ThemeProfile = { version: THEME_PROFILE_VERSION, preset, overrides: {} };
    saveThemeProfile(next, storage);
    setThemeProfileState(next);
    if (userThemes.activeId !== null) commitUserThemes({ ...userThemes, activeId: null });
    // Light/dark is orthogonal to the theme: picking a profile must not flip
    // the global light/dark preference.
  }, [commitUserThemes, storage, userThemes]);

  const setThemeAccent = useCallback((accentHex: string) => {
    const nextHex = saveThemeAccent(accentHex, storage);
    setThemeAccentState(nextHex);
    // A quick color is an intentional shortcut for the accent only. Remove
    // the advanced accent override so clicking a swatch always takes effect;
    // every other advanced color remains untouched.
    const nextCustomTheme: CustomTheme = {
      ...customTheme,
      light: { ...customTheme.light },
      dark: { ...customTheme.dark },
    };
    delete nextCustomTheme.light['--ui-action-accent'];
    delete nextCustomTheme.dark['--ui-action-accent'];
    setCustomTheme(nextCustomTheme);
  }, [customTheme, setCustomTheme, storage]);

  const setBackgroundPreferences = useCallback((next: BackgroundPreferences) => {
    const saved = saveBackgroundPreferences(next, storage);
    if (saved) setBackgroundPreferencesState(next);
    return saved;
  }, [storage]);

  const value = useMemo(
    () => ({
      preference,
      resolved,
      customTheme,
      themeAccentHex,
      themeProfile,
      backgroundPreferences,
      themeRevision,
      setTheme,
      setCustomTheme,
      resetCustomTheme,
      setThemeProfile,
      setThemeAccent,
      setBackgroundPreferences,
      userThemes,
      activeUserTheme,
      selectUserTheme,
      createUserTheme,
      renameUserTheme,
      deleteUserTheme,
    }),
    [activeUserTheme, createUserTheme, deleteUserTheme, renameUserTheme, selectUserTheme, userThemes, backgroundPreferences, customTheme, preference, resetCustomTheme, resolved, setBackgroundPreferences, setCustomTheme, setTheme, setThemeAccent, setThemeProfile, themeAccentHex, themeProfile, themeRevision],
  );

  return (
    <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
  );
}

export function useTheme(): ThemeContextValue {
  const value = useContext(ThemeContext);
  if (!value) {
    throw new Error('useTheme must be used within ThemeProvider');
  }
  return value;
}
