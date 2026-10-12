import { useRef, useState, type ReactNode } from 'react';

import { useT } from '../i18n';
import { SettingsDisclosure } from '../ui/patterns';
import { Button, TextField } from '../ui/primitives';
import { useTheme } from './ThemeProvider';
import { THEME_PROFILE_PRESETS } from './theme-profiles';
import { USER_THEME_NAME_MAX } from './user-themes';

const CUSTOM_THEME_EDITOR_FIELDS = [
  { token: '--ui-surface-canvas', labelKey: 'settings.customThemeCanvas', light: '#ebeceb', dark: '#252729' },
  { token: '--ui-surface-pane', labelKey: 'settings.customThemePane', light: '#f4f5f3', dark: '#2c2e31' },
  { token: '--ui-surface-raised', labelKey: 'settings.customThemeRaised', light: '#f2f4f0', dark: '#35383b' },
  { token: '--ui-border-subtle', labelKey: 'settings.customThemeBorder', light: '#d5d7d4', dark: '#45484c' },
  { token: '--ui-content-primary', labelKey: 'settings.customThemePrimary', light: '#1c1e1c', dark: '#f1f2ef' },
  { token: '--ui-content-secondary', labelKey: 'settings.customThemeSecondary', light: '#5a5f5a', dark: '#a9ada9' },
  { token: '--ui-action-accent', labelKey: 'settings.customThemeAccent', light: '#3b82f6', dark: '#3b82f6' },
  { token: '--ui-status-danger', labelKey: 'settings.customThemeDanger', light: '#dc2626', dark: '#e76b7a' },
] as const;

type EditorToken = (typeof CUSTOM_THEME_EDITOR_FIELDS)[number]['token'];
const HEX6 = /^#[0-9a-f]{6}$/iu;

/**
 * Custom themes editor. A custom theme starts as a copy of whatever is
 * showing (built-in profile + any overrides), is named, and then edited per
 * light/dark variant. Selecting, renaming and deleting live here and in the
 * theme grid; everything persists through ThemeProvider (user-themes.ts).
 */
export function ThemeColorSettings(): ReactNode {
  const t = useT();
  const {
    activeUserTheme,
    createUserTheme,
    customOverlay,
    customTheme,
    deleteUserTheme,
    renameUserTheme,
    resetCustomTheme,
    resolved,
    saveOverlayToActiveUserTheme,
    setCustomTheme,
    themeProfile,
  } = useTheme();
  const editStartValues = useRef<Partial<Record<EditorToken, string>>>({});
  const [draftName, setDraftName] = useState('');
  const [confirmDelete, setConfirmDelete] = useState(false);
  const baseTokens = THEME_PROFILE_PRESETS[themeProfile.preset].tokens[resolved] as Partial<Record<string, string>>;
  const hasOverlay = Object.values(customOverlay.light).some(Boolean)
    || Object.values(customOverlay.dark).some(Boolean);

  // Edits are anonymous and live: they go to the unsaved overlay on top of
  // whatever theme is selected (built-in or named).
  function setCustomColor(token: EditorToken, value: string) {
    if (!HEX6.test(value)) return;
    setCustomTheme({
      ...customOverlay,
      [resolved]: { ...customOverlay[resolved], [token]: value },
    });
  }

  function saveAsTheme() {
    createUserTheme(draftName.trim() || t('settings.customThemeUntitled'));
    setDraftName('');
    setConfirmDelete(false);
  }

  return (
    <SettingsDisclosure
      hint={t('settings.customThemesHint')}
      title={t('settings.advancedColors')}
    >
      {activeUserTheme ? (
        <div className="app-settings-custom-theme-active">
          <TextField
            aria-label={t('settings.customThemeName')}
            label={t('settings.customThemeActive')}
            maxLength={USER_THEME_NAME_MAX}
            onChange={(event) => renameUserTheme(activeUserTheme.id, event.target.value)}
            placeholder={t('settings.customThemeUntitled')}
            value={activeUserTheme.name}
            wrapperClassName="app-settings-custom-theme-name"
          />
          <Button
            onBlur={() => setConfirmDelete(false)}
            onClick={() => {
              if (!confirmDelete) {
                setConfirmDelete(true);
                return;
              }
              setConfirmDelete(false);
              deleteUserTheme(activeUserTheme.id);
            }}
            size="sm"
            variant="danger"
          >
            {confirmDelete ? t('settings.customThemeDeleteConfirm') : t('settings.customThemeDelete')}
          </Button>
        </div>
      ) : null}
      <span className="app-settings-custom-theme-meta">
        {t('settings.customThemeEditingMode', {
          mode: t(resolved === 'dark' ? 'settings.customThemeModeDark' : 'settings.customThemeModeLight'),
        })}
      </span>
      <div className="app-settings-custom-theme-grid">
        {CUSTOM_THEME_EDITOR_FIELDS.map((field) => {
          const baseValue = baseTokens[field.token];
          const current = customTheme[resolved][field.token]
            ?? (baseValue && HEX6.test(baseValue) ? baseValue : field[resolved]);
          return (
            <label className="app-settings-custom-theme-row" key={field.token}>
              <span className="app-settings-custom-theme-label">
                {t(field.labelKey)}
              </span>
              <input
                aria-label={t(field.labelKey)}
                className="app-settings-custom-theme-swatch"
                onChange={(event) => setCustomColor(field.token, event.target.value)}
                onFocus={() => {
                  editStartValues.current[field.token] = current;
                }}
                onKeyDown={(event) => {
                  if (event.key !== 'Escape') return;
                  const original = editStartValues.current[field.token];
                  if (original !== undefined) setCustomColor(field.token, original);
                  event.currentTarget.blur();
                }}
                onBlur={() => {
                  delete editStartValues.current[field.token];
                }}
                type="color"
                value={current}
              />
            </label>
          );
        })}
      </div>
      <div
        aria-label={t('settings.customThemePreview')}
        className="app-settings-theme-preview"
      >
        <div className="app-settings-theme-preview-heading">
          {t('settings.customThemePreview')}
        </div>
        {/* Live miniature of the islands app, painted from the real theme
            tokens so every edit above shows up immediately. */}
        <div className="tp-window" aria-hidden="true">
          <div className="tp-island tp-nav">
            <span className="tp-nav-row is-active"><i /><b /></span>
            <span className="tp-nav-row"><i /><b /></span>
            <span className="tp-nav-row"><i /><b className="is-short" /></span>
            <span className="tp-nav-label" />
            <span className="tp-nav-row"><i /><b className="is-short" /></span>
          </div>
          <div className="tp-island tp-main">
            <div className="tp-toolstrip">
              <span className="tp-pill is-accent" />
              <span className="tp-pill" />
              <span className="tp-toolstrip-spacer" />
              <span className="tp-dot" />
              <span className="tp-dot" />
            </div>
            <div className="tp-cards">
              <div className="tp-card is-selected">
                <div className="tp-card-media" />
                <div className="tp-card-caption">
                  <strong>{t('settings.themePreviewAssetPlaceholder')}</strong>
                  <span>{t('settings.themePreviewAssetMeta')}</span>
                </div>
              </div>
              <div className="tp-card">
                <div className="tp-card-media is-alt" />
                <div className="tp-card-caption">
                  <b />
                  <i />
                </div>
              </div>
            </div>
          </div>
          <div className="tp-island tp-inspector">
            <div className="tp-inspector-heading">
              <strong>{t('settings.themePreviewInspector')}</strong>
              <span>{t('settings.themePreviewTextSecondary')}</span>
            </div>
            <div className="tp-selected">{t('settings.themePreviewSelected')}</div>
            <dl className="tp-fields">
              <dt>{t('settings.themePreviewDescription')}</dt>
              <dd>{t('settings.themePreviewDescriptionValue')}</dd>
              <dt>{t('settings.themePreviewAuthor')}</dt>
              <dd>{t('settings.themePreviewAuthorValue')}</dd>
              <dt>{t('settings.themePreviewTags')}</dt>
              <dd>
                <span className="tp-tag">
                  <span className="tp-tag-dot" />
                  {t('settings.themePreviewTagsValue')}
                </span>
              </dd>
            </dl>
            <div className="tp-actions">
              <span className="ui-button ui-button--primary ui-button--sm tp-button"><span className="ui-button__label">{t('settings.themePreviewPrimary')}</span></span>
              <span className="ui-button ui-button--danger ui-button--sm tp-button"><span className="ui-button__label">{t('settings.themePreviewDanger')}</span></span>
            </div>
            <span className="tp-input">{t('settings.themePreviewInput')}</span>
            <span className="tp-slider"><span className="tp-slider-fill" /><span className="tp-slider-thumb" /></span>
          </div>
        </div>
      </div>
      <div className="app-settings-custom-theme-save">
        <label className="app-settings-custom-theme-save-label" htmlFor="custom-theme-save-name">
          {t('settings.customThemeName')}
        </label>
        <TextField
          aria-label={t('settings.customThemeName')}
          id="custom-theme-save-name"
          maxLength={USER_THEME_NAME_MAX}
          onChange={(event) => setDraftName(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') saveAsTheme();
          }}
          placeholder={t('settings.customThemeUntitled')}
          value={draftName}
          wrapperClassName="app-settings-custom-theme-save-input"
        />
        <Button onClick={saveAsTheme} size="sm" variant="primary">
          {t('settings.customThemeCreate')}
        </Button>
        {activeUserTheme && hasOverlay ? (
          <Button onClick={saveOverlayToActiveUserTheme} size="sm">
            {t('settings.customThemeUpdate', { name: activeUserTheme.name || t('settings.customThemeUntitled') })}
          </Button>
        ) : null}
        <Button
          className="app-settings-theme-reset"
          disabled={!hasOverlay}
          onClick={resetCustomTheme}
          size="sm"
        >
          {t('settings.customThemeReset')}
        </Button>
      </div>
    </SettingsDisclosure>
  );
}
