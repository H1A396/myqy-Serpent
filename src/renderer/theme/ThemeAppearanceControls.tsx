import { useRef, useState, type CSSProperties, type ReactNode } from 'react';

import { useT } from '../i18n';
import { Select, Slider, Switch } from '../ui/primitives';
import { BackgroundImagePanel } from './BackgroundImageControls';
import {
  BACKGROUND_DISPLAY_MODES,
  isSafeBackgroundImageDataUrl,
  MIN_PANEL_OPACITY,
  type BackgroundDisplayMode,
} from './background-preferences';
import { compressBackgroundImage, formatBackgroundBytes } from './background-image-compression';
import { useTheme } from './ThemeProvider';
import {
  THEME_PROFILE_IDS,
  THEME_PROFILE_PRESETS,
  type ThemeProfileId,
} from './theme-profiles';
import {
  THEME_ACCENT_PRESETS,
  themeAccentPresetByHex,
} from './theme-accent-preferences';
import type { UserTheme } from './user-themes';

export const PROFILE_LABELS = {
  serpent: 'settings.themeProfileSerpent',
  vscode: 'settings.themeProfileVscode',
  soft: 'settings.themeProfileSoft',
  midnight: 'settings.themeProfileMidnight',
  mist: 'settings.themeProfileMist',
  sand: 'settings.themeProfileSand',
  forest: 'settings.themeProfileForest',
  indigo: 'settings.themeProfileIndigo',
  rose: 'settings.themeProfileRose',
  ocean: 'settings.themeProfileOcean',
  copper: 'settings.themeProfileCopper',
  ink: 'settings.themeProfileInk',
  lilac: 'settings.themeProfileLilac',
  citrus: 'settings.themeProfileCitrus',
  paper: 'settings.themeProfilePaper',
  slate: 'settings.themeProfileSlate',
  film: 'settings.themeProfileFilm',
  mono: 'settings.themeProfileMono',
  blush: 'settings.themeProfileBlush',
  olive: 'settings.themeProfileOlive',
  charcoal: 'settings.themeProfileCharcoal',
  silver: 'settings.themeProfileSilver',
  graphite: 'settings.themeProfileGraphite',
  smoke: 'settings.themeProfileSmoke',
  ash: 'settings.themeProfileAsh',
  notion: 'settings.themeProfileNotion',
  onedark: 'settings.themeProfileOnedark',
  code: 'settings.themeProfileCode',
  azure: 'settings.themeProfileAzure',
  teal: 'settings.themeProfileTeal',
  jade: 'settings.themeProfileJade',
  amber: 'settings.themeProfileAmber',
  orchid: 'settings.themeProfileOrchid',
  coral: 'settings.themeProfileCoral',
} as const;

const BACKGROUND_MODE_LABELS = {
  cover: 'settings.backgroundModeCover',
  fill: 'settings.backgroundModeFill',
  tile: 'settings.backgroundModeTile',
} as const;

function asPreviewStyle(
  profile: ThemeProfileId,
  resolved: 'light' | 'dark',
  overrides: Partial<Record<string, string | undefined>> = {},
): CSSProperties {
  const tokens = THEME_PROFILE_PRESETS[profile].tokens[resolved];
  const pick = (token: keyof typeof tokens) => overrides[token] ?? tokens[token];
  return {
    '--theme-preview-canvas': pick('--ui-surface-canvas'),
    '--theme-preview-pane': pick('--ui-surface-pane'),
    '--theme-preview-raised': pick('--ui-surface-raised'),
    '--theme-preview-accent': pick('--ui-action-accent'),
    '--theme-preview-text': pick('--ui-content-primary'),
  } as CSSProperties;
}

/**
 * Miniature of the islands layout: window backdrop, a tab strip, and three
 * floating rounded panels (sidebar, asset grid, inspector) with a hint of
 * the accent. Colours come from the --theme-preview-* custom properties.
 */
function ThemePreviewMiniature(): ReactNode {
  return (
    <span aria-hidden="true" className="theme-mini">
      <span className="theme-mini-tabs">
        <span className="theme-mini-tab is-active" />
        <span className="theme-mini-tab" />
      </span>
      <span className="theme-mini-islands">
        <span className="theme-mini-island is-side">
          <span className="theme-mini-row is-active" />
          <span className="theme-mini-row" />
          <span className="theme-mini-row is-short" />
        </span>
        <span className="theme-mini-island is-main">
          <span className="theme-mini-card is-accent" />
          <span className="theme-mini-card" />
          <span className="theme-mini-card" />
          <span className="theme-mini-card" />
        </span>
        <span className="theme-mini-island is-side">
          <span className="theme-mini-row is-short" />
          <span className="theme-mini-row" />
        </span>
      </span>
    </span>
  );
}

type PickerEntry =
  | { readonly kind: 'user'; readonly key: string; readonly theme: UserTheme }
  | { readonly kind: 'preset'; readonly key: string; readonly preset: ThemeProfileId };

export function ThemeProfilePicker(): ReactNode {
  const t = useT();
  const {
    themeProfile,
    setThemeProfile,
    resolved,
    userThemes,
    activeUserTheme,
    selectUserTheme,
  } = useTheme();
  const buttonRefs = useRef<Array<HTMLButtonElement | null>>([]);
  // Custom themes lead the grid so they are visible without scrolling.
  const entries: PickerEntry[] = [
    ...userThemes.themes.map((theme) => ({ kind: 'user' as const, key: theme.id, theme })),
    ...THEME_PROFILE_IDS.map((preset) => ({ kind: 'preset' as const, key: preset, preset })),
  ];
  const isSelected = (entry: PickerEntry) =>
    entry.kind === 'user'
      ? activeUserTheme?.id === entry.theme.id
      : !activeUserTheme && themeProfile.preset === entry.preset;
  const selectedIndex = Math.max(0, entries.findIndex(isSelected));

  function select(entry: PickerEntry) {
    if (entry.kind === 'user') selectUserTheme(entry.theme.id);
    else setThemeProfile(entry.preset);
  }

  function moveSelection(index: number) {
    const nextIndex = (index + entries.length) % entries.length;
    select(entries[nextIndex]!);
    requestAnimationFrame(() => buttonRefs.current[nextIndex]?.focus());
  }

  return (
    <div
      aria-label={t('shell.theme')}
      className="app-settings-theme-profiles"
      role="radiogroup"
    >
      {entries.map((entry, index) => {
        const selected = isSelected(entry);
        const label = entry.kind === 'user'
          ? entry.theme.name || t('settings.customThemeUntitled')
          : t(PROFILE_LABELS[entry.preset]);
        const style = entry.kind === 'user'
          ? asPreviewStyle(entry.theme.base, resolved, entry.theme[resolved])
          : asPreviewStyle(entry.preset, resolved);
        return (
          <button
            aria-checked={selected}
            className={`app-settings-theme-profile${selected ? ' is-active' : ''}${entry.kind === 'user' ? ' is-custom' : ''}`}
            data-theme-entry={entry.key}
            key={entry.key}
            onClick={() => select(entry)}
            onKeyDown={(event) => {
              if (event.key === 'ArrowRight' || event.key === 'ArrowDown') {
                event.preventDefault();
                moveSelection(index + 1);
              } else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') {
                event.preventDefault();
                moveSelection(index - 1);
              } else if (event.key === 'Home') {
                event.preventDefault();
                moveSelection(0);
              } else if (event.key === 'End') {
                event.preventDefault();
                moveSelection(entries.length - 1);
              }
            }}
            role="radio"
            style={style}
            tabIndex={index === selectedIndex ? 0 : -1}
            title={label}
            type="button"
            ref={(element) => {
              buttonRefs.current[index] = element;
            }}
          >
            <ThemePreviewMiniature />
            <span className="app-settings-theme-profile-label">
              <span className="app-settings-theme-profile-name">{label}</span>
              {entry.kind === 'user' ? (
                <span className="app-settings-theme-profile-badge">
                  {t('settings.customThemeBadge')}
                </span>
              ) : null}
            </span>
          </button>
        );
      })}
    </div>
  );
}

/**
 * Quick accent choices. This is deliberately separate from the advanced
 * semantic color editor below: it changes only the action accent and can be
 * paired with any of the three theme profiles.
 */
export function ThemeAccentPicker(): ReactNode {
  const t = useT();
  const { setThemeAccent, themeAccentHex, customTheme, resolved } = useTheme();
  const advancedAccent = customTheme[resolved]['--ui-action-accent'];
  const selectedPreset = themeAccentPresetByHex(
    advancedAccent ?? themeAccentHex,
  );

  return (
    <div className="app-settings-theme-accent">
      <div className="app-settings-row-copy">
        <strong>{t('settings.themeAccent')}</strong>
        <span>{t('settings.themeAccentHint')}</span>
      </div>
      <div
        aria-label={t('settings.themeAccent')}
        className="app-settings-theme-accent-swatches"
        role="radiogroup"
      >
        {THEME_ACCENT_PRESETS.map((preset) => {
          const selected = selectedPreset === preset.id;
          const label = t(preset.labelKey);
          return (
            <button
              aria-checked={selected}
              aria-label={label}
              className={`dimension-color-swatch app-settings-theme-accent-swatch${selected ? ' is-active' : ''}`}
              data-theme-accent={preset.id}
              key={preset.id}
              onClick={() => setThemeAccent(preset.hex)}
              role="radio"
              style={{ background: preset.hex }}
              title={label}
              type="button"
            />
          );
        })}
      </div>
    </div>
  );
}

/**
 * Light/dark/follow-system mode picker rendered as three round swatches.
 * The actual disc lives inside a larger hit target so the selected ring is
 * never clipped by the button box. Hovering shows the mode name.
 */
export function ThemeModePicker(): ReactNode {
  const t = useT();
  const { preference, setTheme } = useTheme();
  const MODES = [
    { value: 'light', label: t('shell.themeLight'), disc: 'light' },
    { value: 'dark', label: t('shell.themeDark'), disc: 'dark' },
    { value: 'system', label: t('shell.themeSystem'), disc: 'system' },
  ] as const;

  return (
    <div
      aria-label={t('settings.themeMode')}
      className="app-settings-theme-mode"
      role="radiogroup"
    >
      {MODES.map((mode) => (
        <button
          aria-checked={preference === mode.value}
          aria-label={mode.label}
          className={`app-settings-theme-mode-disc is-${mode.disc}${preference === mode.value ? ' is-active' : ''}`}
          key={mode.value}
          onClick={() => setTheme(mode.value)}
          role="radio"
          title={mode.label}
          type="button"
        >
          <span aria-hidden="true" className="app-settings-theme-mode-disc-surface" />
        </button>
      ))}
    </div>
  );
}

export function BackgroundSettings(): ReactNode {
  const t = useT();
  const { backgroundPreferences, setBackgroundPreferences } = useTheme();
  const [error, setError] = useState<string | null>(null);
  const [notices, setNotices] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);

  function update(next: Partial<typeof backgroundPreferences>) {
    setError(null);
    const saved = setBackgroundPreferences({ ...backgroundPreferences, ...next });
    if (!saved) setError(t('settings.backgroundSaveError'));
  }

  /**
   * Any raster file is accepted; oversized payloads are re-encoded in the
   * browser (downscale + WebP/JPEG ladder) instead of rejecting the file.
   */
  async function handleSelectFile(file: File) {
    setError(null);
    setNotices([]);
    if (!file.type.startsWith('image/')) {
      setError(t('settings.backgroundImageUnsupported'));
      return;
    }
    setBusy(true);
    try {
      const result = await compressBackgroundImage(file);
      if (!isSafeBackgroundImageDataUrl(result.dataUrl)) {
        setError(t('settings.backgroundImageUnsupported'));
        return;
      }
      const saved = setBackgroundPreferences({
        ...backgroundPreferences,
        imageDataUrl: result.dataUrl,
        imageSource: {
          fileName: file.name,
          width: result.width,
          height: result.height,
          originalBytes: result.originalBytes,
          encodedBytes: result.encodedBytes,
        },
      });
      if (!saved) {
        setError(t('settings.backgroundSaveError'));
        return;
      }
      if (result.compressed) {
        const notes = [
          t('settings.backgroundCompressedNote', {
            size: formatBackgroundBytes(result.encodedBytes),
            original: formatBackgroundBytes(result.originalBytes),
          }),
        ];
        if (result.animationLost) notes.push(t('settings.backgroundAnimatedNote'));
        setNotices(notes);
      }
    } catch {
      setError(t('settings.backgroundImageUnsupported'));
    } finally {
      setBusy(false);
    }
  }

  // Reference the real backdrop token set so the stage previews exactly what
  // the app shell renders (single source of truth in tokens.css).
  const previewStyle = {
    backgroundImage: 'var(--ui-backdrop-image, none)',
    backgroundPosition: 'var(--ui-backdrop-position, center)',
    backgroundRepeat: 'var(--ui-backdrop-repeat, no-repeat)',
    backgroundSize: 'var(--ui-backdrop-size, cover)',
  } satisfies CSSProperties;

  return (
    <div className="app-settings-background-settings">
      <BackgroundImagePanel
        busy={busy}
        error={error}
        imageDataUrl={backgroundPreferences.imageDataUrl}
        imageSource={backgroundPreferences.imageSource}
        notices={notices}
        onRemove={() => update({ imageDataUrl: null, imageSource: null })}
        onSelectFile={(file) => void handleSelectFile(file)}
        previewStyle={previewStyle}
      />
      <div className="app-settings-background-row">
        <Select
          aria-label={t('settings.backgroundMode')}
          label={t('settings.backgroundMode')}
          onValueChange={(value) => update({ mode: value as BackgroundDisplayMode })}
          options={BACKGROUND_DISPLAY_MODES.map((mode) => ({
            value: mode,
            label: t(BACKGROUND_MODE_LABELS[mode]),
          }))}
          value={backgroundPreferences.mode}
        />
      </div>
      <div className="app-settings-row app-settings-background-main-panel">
        <div className="app-settings-row-copy">
          <strong>{t('settings.backgroundMainPanel')}</strong>
          <span>{t('settings.backgroundMainPanelHint')}</span>
        </div>
        <Switch
          aria-label={t('settings.backgroundMainPanel')}
          checked={backgroundPreferences.showInMainPanel}
          disabled={backgroundPreferences.imageDataUrl === null}
          onCheckedChange={(checked) => update({ showInMainPanel: checked })}
        />
      </div>
      <div className="app-settings-background-opacity">
        <Slider
          aria-label={t('settings.backgroundOpacity')}
          label={t('settings.backgroundOpacity')}
          max={1}
          min={0}
          onValueChange={(value) => update({ imageOpacity: value })}
          showValue
          step={0.05}
          value={backgroundPreferences.imageOpacity}
          valueText={`${Math.round(backgroundPreferences.imageOpacity * 100)}%`}
        />
      </div>
      {backgroundPreferences.showInMainPanel && backgroundPreferences.imageDataUrl !== null ? (
        <div className="app-settings-background-opacity app-settings-background-panel-opacity">
          <Slider
            aria-label={t('settings.backgroundPanelOpacity')}
            label={t('settings.backgroundPanelOpacity')}
            max={1}
            min={MIN_PANEL_OPACITY}
            onValueChange={(value) => update({ panelOpacity: value })}
            showValue
            step={0.02}
            value={backgroundPreferences.panelOpacity}
            valueText={`${Math.round(backgroundPreferences.panelOpacity * 100)}%`}
          />
        </div>
      ) : null}
    </div>
  );
}
