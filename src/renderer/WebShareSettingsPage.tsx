import { useEffect, useState, type ReactNode } from "react";

import {
  WEB_SHARE_DEFAULT_PORT,
  type SerpentWebShareSettingsApi,
  type WebShareSettingsSnapshot,
} from "../shared/web-share";
import { useT } from "./i18n";
import { SettingsCard, SettingsDisclosure } from "./ui/patterns";
import { Switch } from "./ui/primitives";

interface WebShareSettingsPageProps {
  api?: SerpentWebShareSettingsApi;
}

export function WebShareSettingsPage({ api }: WebShareSettingsPageProps): ReactNode {
  const t = useT();
  const [snapshot, setSnapshot] = useState<WebShareSettingsSnapshot | null>(null);
  const [portDraft, setPortDraft] = useState(String(WEB_SHARE_DEFAULT_PORT));
  const [passwordDraft, setPasswordDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    if (!api) return;
    let active = true;
    void api
      .request({ type: "get" })
      .then((response) => {
        if (!active) return;
        if (response.snapshot) {
          setSnapshot(response.snapshot);
          setPortDraft(String(response.snapshot.preferences.port));
        }
        if (!response.ok) setError(response.message);
      })
      .catch(() => {
        if (active) setError(t("settings.webShareUnavailable"));
      });
    return () => {
      active = false;
    };
  }, [api, t]);

  useEffect(
    () =>
      api?.onChanged((next) => {
        setSnapshot(next);
        setPortDraft(String(next.preferences.port));
      }) ?? undefined,
    [api],
  );

  async function request(
    input: Parameters<SerpentWebShareSettingsApi["request"]>[0],
    successNotice?: string,
  ): Promise<void> {
    if (!api) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const response = await api.request(input);
      if (response.snapshot) {
        setSnapshot(response.snapshot);
        setPortDraft(String(response.snapshot.preferences.port));
      }
      if (!response.ok) setError(response.message);
      else if (successNotice !== undefined) setNotice(successNotice);
    } catch {
      setError(t("settings.webShareOperationFailed"));
    } finally {
      setBusy(false);
    }
  }

  if (!api) {
    return (
      <SettingsCard>
        <p>{t("settings.webShareUnavailable")}</p>
      </SettingsCard>
    );
  }

  const runtime = snapshot?.runtime;
  const running = runtime?.status === "running";
  const enabled = snapshot?.preferences.enabled ?? false;
  const hasPassword = snapshot?.hasPassword ?? false;
  const libraries = snapshot?.libraries ?? [];
  const sharedLibraryId = snapshot?.preferences.sharedLibraryId ?? null;
  const statusLabel =
    runtime?.status === "running"
      ? t("settings.webShareStatusRunning")
      : runtime?.status === "starting"
        ? t("settings.webShareStatusStarting")
        : runtime?.status === "stopping"
          ? t("settings.webShareStatusStopping")
          : runtime?.status === "error"
            ? t("settings.webShareStatusError")
            : t("settings.webShareStatusStopped");

  return (
    <>
      <SettingsCard>
        <div className="app-settings-toggle-row">
          <span className="app-settings-row-copy">
            <strong>{t("settings.webShareEnabled")}</strong>
            <span>{t("settings.webShareEnabledHint")}</span>
          </span>
          <Switch
            aria-label={t("settings.webShareEnabled")}
            checked={enabled}
            disabled={busy || !hasPassword}
            onCheckedChange={(next) => void request({ type: "enable", enabled: next })}
          />
        </div>
        <div className="app-settings-card-divider" />
        <div className="app-settings-action-row">
          <div className="app-settings-row-copy">
            <strong>{t("settings.webShareStatus")}</strong>
            <span>
              {running && runtime
                ? `${runtime.address} · ${t("settings.webShareConnections")}: ${runtime.connectedSessionCount}`
                : statusLabel}
            </span>
          </div>
          {running ? (
            <button
              className="primary-button"
              disabled={busy}
              onClick={() => void request({ type: "stop" })}
              type="button"
            >
              {t("settings.webShareStop")}
            </button>
          ) : (
            <button
              className="primary-button"
              disabled={busy || !enabled || !hasPassword}
              onClick={() => void request({ type: "start" })}
              type="button"
            >
              {t("settings.webShareStart")}
            </button>
          )}
        </div>
        {runtime?.status === "running" ? (
          <div className="app-settings-row-copy">
            <span>{t("settings.webShareTunnelHint")}</span>
          </div>
        ) : null}
        {!hasPassword ? (
          <div className="app-settings-row-copy">
            <span>{t("settings.webSharePasswordRequired")}</span>
          </div>
        ) : null}
        {error ? <p className="settings-error-message">{error}</p> : null}
        {notice ? <p className="settings-success-message">{notice}</p> : null}
      </SettingsCard>

      <SettingsCard>
        <div className="app-settings-action-row">
          <div className="app-settings-row-copy">
            <strong>{t("settings.webSharePasswordTitle")}</strong>
            <span>{t("settings.webSharePasswordHint")}</span>
          </div>
          <input
            aria-label={t("settings.webSharePasswordTitle")}
            autoComplete="new-password"
            className="text-field"
            disabled={busy}
            onChange={(event) => setPasswordDraft(event.target.value)}
            placeholder={t("settings.webSharePasswordPlaceholder")}
            type="password"
            value={passwordDraft}
          />
          <button
            className="primary-button"
            disabled={busy || passwordDraft.length < 8}
            onClick={() => {
              void request({ type: "set-password", password: passwordDraft }, t("settings.webSharePasswordSetNotice"));
              setPasswordDraft("");
            }}
            type="button"
          >
            {t("settings.webSharePasswordSet")}
          </button>
          {hasPassword ? (
            <button
              className="secondary-button"
              disabled={busy}
              onClick={() => void request({ type: "clear-password" })}
              type="button"
            >
              {t("settings.webSharePasswordClear")}
            </button>
          ) : null}
        </div>
      </SettingsCard>

      <SettingsCard>
        <label className="app-settings-row app-settings-row-inline" htmlFor="web-share-library">
          <span className="app-settings-row-copy">
            <strong>{t("settings.webShareLibraryTitle")}</strong>
            <span>{t("settings.webShareLibraryHint")}</span>
          </span>
          <select
            aria-label={t("settings.webShareLibraryTitle")}
            className="settings-select"
            disabled={busy || libraries.length === 0}
            id="web-share-library"
            onChange={(event) =>
              void request({
                type: "set-library",
                libraryId: event.target.value === "" ? null : event.target.value,
              })
            }
            value={sharedLibraryId ?? ""}
          >
            <option value="">{t("settings.webShareLibraryFirst")}</option>
            {libraries.map((library) => (
              <option key={library.libraryId} value={library.libraryId}>
                {library.displayName}
              </option>
            ))}
          </select>
        </label>
        {libraries.length === 0 ? (
          <div className="app-settings-row-copy">
            <span>{t("settings.webShareNoLibrary")}</span>
          </div>
        ) : null}
        <div className="app-settings-card-divider" />
        <div className="app-settings-toggle-row">
          <span className="app-settings-row-copy">
            <strong>{t("settings.webShareAllowDownload")}</strong>
            <span>{t("settings.webShareAllowDownloadHint")}</span>
          </span>
          <Switch
            aria-label={t("settings.webShareAllowDownload")}
            checked={snapshot?.preferences.allowDownload ?? true}
            disabled={busy}
            onCheckedChange={(next) => void request({ type: "set-allow-download", enabled: next })}
          />
        </div>
        <SettingsDisclosure
          defaultOpen={false}
          hint={t("settings.webShareAdvancedHint")}
          title={t("settings.webShareAdvanced")}
        >
          <label className="app-settings-row app-settings-row-inline" htmlFor="web-share-port">
            <span className="app-settings-row-copy">
              <strong>{t("settings.webSharePort")}</strong>
              <span>{t("settings.webSharePortHint")}</span>
            </span>
            <input
              aria-label={t("settings.webSharePort")}
              className="settings-number-input"
              disabled={busy || running}
              id="web-share-port"
              max={65535}
              min={1024}
              onBlur={() => {
                const port = Number(portDraft);
                if (Number.isInteger(port) && port >= 1024 && port <= 65535) {
                  void request({ type: "set-port", port });
                } else if (snapshot) {
                  setPortDraft(String(snapshot.preferences.port));
                }
              }}
              onChange={(event) => setPortDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") event.currentTarget.blur();
              }}
              type="number"
              value={portDraft}
            />
          </label>
        </SettingsDisclosure>
      </SettingsCard>
    </>
  );
}
