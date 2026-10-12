import { useRef, useState, type ReactNode } from 'react';

import { useT } from '../i18n';
import { SettingsDisclosure } from '../ui/patterns';
import { Button, Slider, TextField } from '../ui/primitives';
import { PROFILE_LABELS } from './ThemeAppearanceControls';
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
    customTheme,
    deleteUserTheme,
    renameUserTheme,
    resetCustomTheme,
    resolved,
    setCustomTheme,
    themeProfile,
  } = useTheme();
  const editStartValues = useRef<Partial<Record<EditorToken, string>>>({});
  const [draftName, setDraftName] = useState('');
  const [confirmDelete, setConfirmDelete] = useState(false);
  const baseTokens = THEME_PROFILE_PRESETS[themeProfile.preset].tokens[resolved] as Partial<Record<string, string>>;

  function setCustomColor(token: EditorToken, value: string) {
    if (!HEX6.test(value) || !activeUserTheme) return;
    setCustomTheme({
      ...customTheme,
      [resolved]: {
        ...customTheme[resolved],
        [token]: value,
      },
    });
  }

  function create() {
    createUserTheme(draftName.trim() || t('settings.customThemeUntitled'));
    setDraftName('');
    setConfirmDelete(false);
  }

  return (
    <SettingsDisclosure
      hint={t('settings.customThemesHint')}
      title={t('settings.advancedColors')}
    >
      <div className="app-settings-custom-theme-header">
        {activeUserTheme ? (
          <>
            <TextField
              aria-label={t('settings.customThemeName')}
              label={t('settings.customThemeName')}
              maxLength={USER_THEME_NAME_MAX}
              onChange={(event) => renameUserTheme(activeUserTheme.id, event.target.value)}
              placeholder={t('settings.customThemeUntitled')}
              value={activeUserTheme.name}
              wrapperClassName="app-settings-custom-theme-name"
            />
            <span className="app-settings-custom-theme-meta">
              {t('settings.customThemeBase', { name: t(PROFILE_LABELS[activeUserTheme.base]) })}
              {' · '}
              {t('settings.customThemeEditingMode', {
                mode: t(resolved === 'dark' ? 'settings.customThemeModeDark' : 'settings.customThemeModeLight'),
              })}
            </span>
          </>
        ) : (
          <>
            <TextField
              aria-label={t('settings.customThemeName')}
              label={t('settings.customThemeName')}
              maxLength={USER_THEME_NAME_MAX}
              onChange={(event) => setDraftName(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') create();
              }}
              placeholder={t('settings.customThemeUntitled')}
              value={draftName}
              wrapperClassName="app-settings-custom-theme-name"
            />
            <span className="app-settings-custom-theme-meta">
              {t('settings.customThemeEmpty')}
            </span>
          </>
        )}
      </div>
      {activeUserTheme ? (
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
      ) : null}
      <div className="app-settings-theme-actions">
        {activeUserTheme ? (
          <>
            <Button onClick={create} size="sm">
              {t('settings.customThemeDuplicate')}
            </Button>
            <Button className="app-settings-theme-reset" onClick={resetCustomTheme} size="sm">
              {t('settings.customThemeRevert')}
            </Button>
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
          </>
        ) : (
          <Button onClick={create} size="sm" variant="primary">
            {t('settings.customThemeCreate')}
          </Button>
        )}
      </div>
      <div
        aria-label={t('settings.customThemePreview')}
        className="app-settings-theme-preview"
      >
        <div className="app-settings-theme-preview-heading">
          {t('settings.customThemePreview')}
        </div>
        <div className="theme-preview-inspector-shell">
          <div className="theme-preview-inspector-rail" aria-hidden="true">
            <span className="theme-preview-rail-line is-active" />
            <span className="theme-preview-rail-line" />
          </div>
          <div className="theme-preview-inspector-main">
            <div className="theme-preview-asset-card">
              <div className="theme-preview-asset-placeholder" />
              <div className="theme-preview-asset-caption">
                <strong>{t('settings.themePreviewAssetPlaceholder')}</strong>
                <span>{t('settings.themePreviewAssetMeta')}</span>
              </div>
            </div>
            <div className="theme-preview-inspector-panel">
              <div className="theme-preview-inspector-heading">
                <strong>{t('settings.themePreviewInspector')}</strong>
                <span>{t('settings.themePreviewTextSecondary')}</span>
              </div>
              <div className="theme-preview-inspector-selected">
                {t('settings.themePreviewSelected')}
              </div>
              <div className="theme-preview-inspector-fields">
                <div className="theme-preview-inspector-field">
                  <span className="theme-preview-inspector-field-label">
                    {t('settings.themePreviewDescription')}
                  </span>
                  <span className="theme-preview-inspector-field-value">
                    {t('settings.themePreviewDescriptionValue')}
                  </span>
                </div>
                <div className="theme-preview-inspector-field">
                  <span className="theme-preview-inspector-field-label">
                    {t('settings.themePreviewAuthor')}
                  </span>
                  <span className="theme-preview-inspector-field-value">
                    {t('settings.themePreviewAuthorValue')}
                  </span>
                </div>
                <div className="theme-preview-inspector-field">
                  <span className="theme-preview-inspector-field-label">
                    {t('settings.themePreviewTags')}
                  </span>
                  <span className="theme-preview-inspector-tag">
                    {t('settings.themePreviewTagsValue')}
                  </span>
                </div>
              </div>
              <div className="theme-preview-inspector-actions">
                <Button size="sm" variant="primary">
                  {t('settings.themePreviewPrimary')}
                </Button>
                <Button size="sm" variant="danger">
                  {t('settings.themePreviewDanger')}
                </Button>
              </div>
              <TextField
                aria-label={t('settings.themePreviewInput')}
                label={t('settings.themePreviewInput')}
                onChange={() => undefined}
                readOnly
                value={t('settings.themePreviewInput')}
                wrapperClassName="theme-preview-input"
              />
              <Slider
                aria-label={t('settings.themePreviewSlider')}
                className="theme-preview-slider"
                disabled
                max={100}
                min={0}
                value={60}
              />
            </div>
          </div>
        </div>
      </div>
    </SettingsDisclosure>
  );
}
