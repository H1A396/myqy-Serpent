import { useEffect, useState, type ReactNode } from "react";

import {
  WEB_SHARE_DEFAULT_PORT,
  WEB_SHARE_DERIVATIVE_TIERS,
  WEB_SHARE_MIN_PASSWORD_LENGTH,
  type SerpentWebShareSettingsApi,
  type WebShareSettingsSnapshot,
  type WebShareThumbnailProgress,
  type WebShareVisitorSummary,
} from "../shared/web-share";
import { useT } from "./i18n";
import { SettingsCard } from "./ui/patterns";
import { Switch } from "./ui/primitives";

const DERIVATIVE_TIERS = WEB_SHARE_DERIVATIVE_TIERS;

function webShareTunnelErrorKey(code: string | undefined): string {
  switch (code) {
    case "WEB_SHARE_TUNNEL_NOT_INSTALLED":
      return "settings.webShareTunnelErrorNotInstalled";
    case "WEB_SHARE_TUNNEL_NO_CONFIG":
      return "settings.webShareTunnelErrorNoConfig";
    case "WEB_SHARE_TUNNEL_NO_HOSTNAME":
      return "settings.webShareTunnelErrorNoHostname";
    case "WEB_SHARE_TUNNEL_SPAWN_FAILED":
      return "settings.webShareTunnelErrorSpawnFailed";
    case "WEB_SHARE_TUNNEL_EXITED":
      return "settings.webShareTunnelErrorExited";
    case "WEB_SHARE_TUNNEL_INSTALL_FAILED":
      return "settings.webShareTunnelErrorInstallFailed";
    case "WEB_SHARE_TUNNEL_INSTALL_UNSUPPORTED":
      return "settings.webShareTunnelErrorInstallUnsupported";
    default:
      return "settings.webShareTunnelErrorGeneric";
  }
}

function webShareThumbnailProgressText(
  t: (key: string) => string,
  progress: WebShareThumbnailProgress | null,
): string {
  if (progress === null) return t("settings.webShareThumbnailRegenerateHint");
  if (progress.active) {
    return `${t("settings.webShareThumbnailProgressRunning")} ${progress.generated}/${progress.total}`;
  }
  const failed =
    progress.failed > 0
      ? ` · ${t("settings.webShareThumbnailProgressFailed")} ${progress.failed}`
      : "";
  return `${t("settings.webShareThumbnailProgressDone")} ${progress.generated}/${progress.total}${failed}`;
}

interface WebShareSettingsPageProps {
  api?: SerpentWebShareSettingsApi;
}

type StatusTone = "running" | "pending" | "stopped" | "error";

export function WebShareSettingsPage({ api }: WebShareSettingsPageProps): ReactNode {
  const t = useT();
  const [snapshot, setSnapshot] = useState<WebShareSettingsSnapshot | null>(null);
  const [portDraft, setPortDraft] = useState(String(WEB_SHARE_DEFAULT_PORT));
  const [maxKbDraft, setMaxKbDraft] = useState("20");
  const [downloadQualityDraft, setDownloadQualityDraft] = useState("91");
  const [passwordDraft, setPasswordDraft] = useState("");
  const [hostnameDraft, setHostnameDraft] = useState("");
  const [tunnelNameDraft, setTunnelNameDraft] = useState("");
  const [cloudflaredPathDraft, setCloudflaredPathDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [visitors, setVisitors] = useState<WebShareVisitorSummary[] | null>(null);

  useEffect(() => {
    if (!api) return;
    let active = true;
    void api
      .request({ type: "get" })
      .then((response) => {
        if (!active) return;
        if ("snapshot" in response && response.snapshot !== undefined) {
          setSnapshot(response.snapshot);
          setPortDraft(String(response.snapshot.preferences.port));
          setMaxKbDraft(String(response.snapshot.preferences.thumbnailMaxKb));
          setDownloadQualityDraft(String(response.snapshot.preferences.downloadQuality));
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
        setMaxKbDraft(String(next.preferences.thumbnailMaxKb));
        setDownloadQualityDraft(String(next.preferences.downloadQuality));
        setHostnameDraft(next.preferences.tunnelHostname ?? "");
        setTunnelNameDraft(next.preferences.tunnelName ?? "");
        setCloudflaredPathDraft(next.preferences.cloudflaredPath ?? "");
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
      if ("snapshot" in response && response.snapshot !== undefined) {
        setSnapshot(response.snapshot);
        setPortDraft(String(response.snapshot.preferences.port));
        setMaxKbDraft(String(response.snapshot.preferences.thumbnailMaxKb));
        setDownloadQualityDraft(String(response.snapshot.preferences.downloadQuality));
        setHostnameDraft(response.snapshot.preferences.tunnelHostname ?? "");
        setTunnelNameDraft(response.snapshot.preferences.tunnelName ?? "");
        setCloudflaredPathDraft(response.snapshot.preferences.cloudflaredPath ?? "");
      }
      if (!response.ok) setError(response.message);
      else if (successNotice !== undefined) setNotice(successNotice);
    } catch {
      setError(t("settings.webShareOperationFailed"));
    } finally {
      setBusy(false);
    }
  }

  async function loadVisitors(): Promise<void> {
    if (!api) return;
    setBusy(true);
    setError(null);
    try {
      const response = await api.request({ type: "list-visitors" });
      if ("visitors" in response) setVisitors(response.visitors);
      else if (!response.ok) setError(response.message);
    } catch {
      setError(t("settings.webShareOperationFailed"));
    } finally {
      setBusy(false);
    }
  }

  async function copyTunnelUrl(): Promise<void> {
    if (snapshot?.tunnel.status !== "running") return;
    try {
      await navigator.clipboard.writeText(snapshot.tunnel.publicUrl);
      setNotice(t("settings.webShareTunnelCopied"));
    } catch {
      setError(t("settings.webShareOperationFailed"));
    }
  }

  function openTunnelUrl(): void {
    if (snapshot?.tunnel.status !== "running") return;
    const shell = (
      window as unknown as {
        serpent?: { shell?: { openExternalUrl?: (url: string) => Promise<unknown> } };
      }
    ).serpent?.shell;
    void shell?.openExternalUrl?.(snapshot.tunnel.publicUrl);
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
  const port = snapshot?.preferences.port ?? WEB_SHARE_DEFAULT_PORT;
  const tunnel = snapshot?.tunnel;
  const tunnelInfo = snapshot?.tunnelInfo;
  const tunnelInstalling = snapshot?.tunnelInstalling ?? false;
  const autoTunnel = snapshot?.preferences.autoTunnel ?? true;
  const tunnelTone: StatusTone =
    tunnel?.status === "running"
      ? "running"
      : tunnel?.status === "error"
        ? "error"
        : tunnel?.status === "starting"
          ? "pending"
          : "stopped";
  const tunnelStatusLabel =
    tunnel?.status === "running"
      ? t("settings.webShareTunnelStatusRunning")
      : tunnel?.status === "starting"
        ? t("settings.webShareTunnelStatusStarting")
        : tunnel?.status === "error"
          ? t("settings.webShareTunnelStatusError")
          : t("settings.webShareTunnelStatusOff");
  const tunnelStatusDetail =
    tunnel?.status === "error"
      ? t(webShareTunnelErrorKey(tunnel.code))
      : tunnel?.status === "running"
        ? t("settings.webShareTunnelStatusRunningDetail")
        : autoTunnel
          ? t("settings.webShareTunnelStatusOffDetail")
          : t("settings.webShareTunnelStatusDisabledDetail");

  const statusTone: StatusTone =
    runtime?.status === "running"
      ? "running"
      : runtime?.status === "error"
        ? "error"
        : runtime?.status === "starting" || runtime?.status === "stopping"
          ? "pending"
          : "stopped";
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
  const statusDetail =
    runtime?.status === "error"
      ? runtime.message
      : running
        ? t("settings.webShareStatusRunningDetail")
        : runtime?.status === "starting" || runtime?.status === "stopping"
          ? statusLabel
          : t("settings.webShareStatusStoppedDetail");
  const addressLine = running
    ? `${runtime.address} · ${t("settings.webShareConnections")}: ${runtime.connectedSessionCount}`
    : `http://127.0.0.1:${port}`;

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
            disabled={busy}
            onCheckedChange={(next) => void request({ type: "enable", enabled: next })}
          />
        </div>
        <div className="app-settings-card-divider" />
        <div className="app-settings-action-row">
          <div className="app-settings-row-copy">
            <strong>{t("settings.webShareStatus")}</strong>
            <span>{statusDetail}</span>
          </div>
          <span className="web-share-status" data-state={statusTone}>
            <span className="web-share-status-dot" aria-hidden="true" />
            {statusLabel}
          </span>
        </div>
        {error ? <p className="settings-error-message">{error}</p> : null}
        {notice ? <p className="settings-success-message">{notice}</p> : null}
      </SettingsCard>

      <SettingsCard>
        <div className="app-settings-toggle-row">
          <span className="app-settings-row-copy">
            <strong>{t("settings.webShareTunnelTitle")}</strong>
            <span>{t("settings.webShareTunnelEnabledHint")}</span>
          </span>
          <Switch
            aria-label={t("settings.webShareTunnelTitle")}
            checked={autoTunnel}
            disabled={busy}
            onCheckedChange={(next) => void request({ type: "set-auto-tunnel", enabled: next })}
          />
        </div>
        <div className="app-settings-card-divider" />
        <div className="app-settings-action-row">
          <div className="app-settings-row-copy">
            <strong>{t("settings.webShareTunnelStatus")}</strong>
            <span>{tunnelStatusDetail}</span>
          </div>
          <span className="web-share-status" data-state={tunnelTone}>
            <span className="web-share-status-dot" aria-hidden="true" />
            {tunnelStatusLabel}
          </span>
        </div>
        {tunnel?.status === "running" ? (
          <div className="app-settings-action-row">
            <div className="app-settings-row-copy">
              <strong>{t("settings.webShareTunnelAddress")}</strong>
              <span>{tunnel.publicUrl}</span>
            </div>
            <button className="secondary-button" disabled={busy} onClick={() => void copyTunnelUrl()} type="button">
              {t("settings.webShareTunnelCopy")}
            </button>
            <button className="secondary-button" disabled={busy} onClick={openTunnelUrl} type="button">
              {t("settings.webShareTunnelOpen")}
            </button>
          </div>
        ) : null}
        <div className="app-settings-card-divider" />
        {tunnelInfo !== undefined && !tunnelInfo.installed ? (
          <div className="app-settings-action-row">
            <div className="app-settings-row-copy">
              <strong>{t("settings.webShareTunnelNotInstalled")}</strong>
              <span>{t("settings.webShareTunnelNotInstalledHint")}</span>
            </div>
            <button
              className="primary-button"
              disabled={busy || tunnelInstalling}
              onClick={() => void request({ type: "install-cloudflared" })}
              type="button"
            >
              {tunnelInstalling ? t("settings.webShareTunnelInstalling") : t("settings.webShareTunnelInstall")}
            </button>
          </div>
        ) : (
          <div className="app-settings-action-row">
            <div className="app-settings-row-copy">
              <strong>{t("settings.webShareTunnelInstalled")}</strong>
              <span>{tunnelInfo?.version ?? t("settings.webShareTunnelInstalledHint")}</span>
            </div>
            <button
              className="secondary-button"
              disabled={busy}
              onClick={() => void request({ type: "detect-cloudflared" })}
              type="button"
            >
              {t("settings.webShareTunnelRedetect")}
            </button>
          </div>
        )}
        <div className="app-settings-card-divider" />
        <label className="app-settings-row app-settings-row-inline" htmlFor="web-share-tunnel-hostname">
          <span className="app-settings-row-copy">
            <strong>{t("settings.webShareTunnelHostname")}</strong>
            <span>{t("settings.webShareTunnelHostnameHint")}</span>
          </span>
          <input
            aria-label={t("settings.webShareTunnelHostname")}
            className="text-field"
            disabled={busy}
            id="web-share-tunnel-hostname"
            onBlur={() => {
              const value = hostnameDraft.trim();
              if (value === (snapshot?.preferences.tunnelHostname ?? "")) return;
              void request({
                type: "set-tunnel-config",
                tunnelHostname: value === "" ? null : value,
              });
            }}
            onChange={(event) => setHostnameDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") event.currentTarget.blur();
            }}
            placeholder={tunnelInfo?.hostname ?? t("settings.webShareTunnelHostnamePlaceholder")}
            value={hostnameDraft}
          />
        </label>
        <div className="app-settings-card-divider" />
        <label className="app-settings-row app-settings-row-inline" htmlFor="web-share-tunnel-name">
          <span className="app-settings-row-copy">
            <strong>{t("settings.webShareTunnelName")}</strong>
            <span>{t("settings.webShareTunnelNameHint")}</span>
          </span>
          <input
            aria-label={t("settings.webShareTunnelName")}
            className="text-field"
            disabled={busy}
            id="web-share-tunnel-name"
            onBlur={() => {
              const value = tunnelNameDraft.trim();
              if (value === (snapshot?.preferences.tunnelName ?? "")) return;
              void request({ type: "set-tunnel-config", tunnelName: value === "" ? null : value });
            }}
            onChange={(event) => setTunnelNameDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") event.currentTarget.blur();
            }}
            placeholder={t("settings.webShareTunnelNamePlaceholder")}
            value={tunnelNameDraft}
          />
        </label>
        <div className="app-settings-card-divider" />
        <label className="app-settings-row app-settings-row-inline" htmlFor="web-share-tunnel-path">
          <span className="app-settings-row-copy">
            <strong>{t("settings.webShareTunnelPath")}</strong>
            <span>{t("settings.webShareTunnelPathHint")}</span>
          </span>
          <input
            aria-label={t("settings.webShareTunnelPath")}
            className="text-field"
            disabled={busy}
            id="web-share-tunnel-path"
            onBlur={() => {
              const value = cloudflaredPathDraft.trim();
              if (value === (snapshot?.preferences.cloudflaredPath ?? "")) return;
              void request({
                type: "set-tunnel-config",
                cloudflaredPath: value === "" ? null : value,
              });
            }}
            onChange={(event) => setCloudflaredPathDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") event.currentTarget.blur();
            }}
            placeholder={tunnelInfo?.cloudflaredPath ?? t("settings.webShareTunnelPathPlaceholder")}
            value={cloudflaredPathDraft}
          />
        </label>
        <div className="app-settings-card-divider" />
        <div className="app-settings-action-row">
          <div className="app-settings-row-copy">
            <strong>{t("settings.webShareTunnelRestartTitle")}</strong>
            <span>{t("settings.webShareTunnelRestartHint")}</span>
          </div>
          <button
            className="secondary-button"
            disabled={busy || !running || !autoTunnel || !(tunnelInfo?.installed ?? false)}
            onClick={() => void request({ type: "restart-tunnel" })}
            type="button"
          >
            {t("settings.webShareTunnelRestart")}
          </button>
        </div>
      </SettingsCard>

      <SettingsCard>
        <div className="app-settings-action-row web-share-password-row">
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
            disabled={busy || passwordDraft.length < WEB_SHARE_MIN_PASSWORD_LENGTH}
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
      </SettingsCard>

      <SettingsCard>
        <label className="app-settings-row app-settings-row-inline" htmlFor="web-share-thumbnail-edge">
          <span className="app-settings-row-copy">
            <strong>{t("settings.webShareThumbnailResolution")}</strong>
            <span>{t("settings.webShareThumbnailResolutionHint")}</span>
          </span>
          <select
            aria-label={t("settings.webShareThumbnailResolution")}
            className="settings-select"
            disabled={busy}
            id="web-share-thumbnail-edge"
            onChange={(event) =>
              void request({
                type: "set-thumbnail-edge",
                edge: Number(event.target.value) === 256 ? 256 : 128,
              })
            }
            value={String(snapshot?.preferences.thumbnailEdge ?? 128)}
          >
            <option value="128">128 px</option>
            <option value="256">256 px</option>
          </select>
        </label>
        <div className="app-settings-card-divider" />
        <label className="app-settings-row app-settings-row-inline" htmlFor="web-share-thumbnail-maxkb">
          <span className="app-settings-row-copy">
            <strong>{t("settings.webShareThumbnailMaxKb")}</strong>
            <span>{t("settings.webShareThumbnailMaxKbHint")}</span>
          </span>
          <input
            aria-label={t("settings.webShareThumbnailMaxKb")}
            className="settings-number-input"
            disabled={busy}
            id="web-share-thumbnail-maxkb"
            max={2048}
            min={4}
            onBlur={() => {
              const next = Number(maxKbDraft);
              if (Number.isInteger(next) && next >= 4 && next <= 2048) {
                void request({ type: "set-thumbnail-max-kb", maxKb: next });
              } else if (snapshot) {
                setMaxKbDraft(String(snapshot.preferences.thumbnailMaxKb));
              }
            }}
            onChange={(event) => setMaxKbDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") event.currentTarget.blur();
            }}
            type="number"
            value={maxKbDraft}
          />
        </label>
        <div className="app-settings-card-divider" />
        <div className="app-settings-toggle-row">
          <span className="app-settings-row-copy">
            <strong>{t("settings.webShareThumbnailSharpen")}</strong>
            <span>{t("settings.webShareThumbnailSharpenHint")}</span>
          </span>
          <Switch
            aria-label={t("settings.webShareThumbnailSharpen")}
            checked={snapshot?.preferences.thumbnailSharpen ?? false}
            disabled={busy}
            onCheckedChange={(next) => void request({ type: "set-thumbnail-sharpen", enabled: next })}
          />
        </div>
        <div className="app-settings-card-divider" />
        <div className="app-settings-action-row">
          <div className="app-settings-row-copy">
            <strong>{t("settings.webShareThumbnailRegenerate")}</strong>
            <span>{webShareThumbnailProgressText(t, snapshot?.thumbnailProgress ?? null)}</span>
          </div>
          <button
            className="secondary-button"
            disabled={busy || (snapshot?.thumbnailProgress?.active ?? false)}
            onClick={() => void request({ type: "regenerate-thumbnails" })}
            type="button"
          >
            {t("settings.webShareThumbnailRegenerateAction")}
          </button>
          <button
            className="secondary-button"
            disabled={busy}
            onClick={() => void request({ type: "delete-thumbnails" })}
            type="button"
          >
            {t("settings.webShareThumbnailDeleteAction")}
          </button>
        </div>
      </SettingsCard>

      <SettingsCard>
        <label className="app-settings-row app-settings-row-inline" htmlFor="web-share-download-quality">
          <span className="app-settings-row-copy">
            <strong>{t("settings.webShareDownloadQuality")}</strong>
            <span>{t("settings.webShareDownloadQualityHint")}</span>
          </span>
          <input
            aria-label={t("settings.webShareDownloadQuality")}
            className="settings-number-input"
            disabled={busy}
            id="web-share-download-quality"
            max={100}
            min={1}
            onBlur={() => {
              const next = Number(downloadQualityDraft);
              if (Number.isInteger(next) && next >= 1 && next <= 100) {
                void request({ type: "set-download-quality", quality: next });
              } else if (snapshot) {
                setDownloadQualityDraft(String(snapshot.preferences.downloadQuality));
              }
            }}
            onChange={(event) => setDownloadQualityDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") event.currentTarget.blur();
            }}
            type="number"
            value={downloadQualityDraft}
          />
        </label>
        <div className="app-settings-card-divider" />
        <div className="app-settings-toggle-row">
          <span className="app-settings-row-copy">
            <strong>{t("settings.webShareDownloadProgressive")}</strong>
            <span>{t("settings.webShareDownloadProgressiveHint")}</span>
          </span>
          <Switch
            aria-label={t("settings.webShareDownloadProgressive")}
            checked={snapshot?.preferences.downloadProgressive ?? false}
            disabled={busy}
            onCheckedChange={(next) => void request({ type: "set-download-progressive", enabled: next })}
          />
        </div>
      </SettingsCard>

      <SettingsCard>
        <div className="app-settings-row-copy">
          <strong>{t("settings.webShareDerivativeTitle")}</strong>
          <span>{t("settings.webShareDerivativeHint")}</span>
        </div>
        {DERIVATIVE_TIERS.map((quality) => {
          const stats = snapshot?.derivativeStats.find((tier) => tier.quality === quality);
          const progress = snapshot?.derivativeProgress;
          const active = progress?.active === true && progress.quality === quality;
          const progressText = active
            ? `${t("settings.webShareDerivativeProgressRunning")} ${progress.generated}/${progress.total}`
            : t("settings.webShareDerivativeSizeHint").replace(
                "{mb}",
                ((stats?.totalBytes ?? 0) / (1024 * 1024)).toFixed(1),
              ).replace("{count}", String(stats?.fileCount ?? 0));
          return (
            <div key={quality}>
              <div className="app-settings-card-divider" />
              <div className="app-settings-action-row">
                <div className="app-settings-row-copy">
                  <strong>{t("settings.webShareDerivativeTier").replace("{quality}", String(quality))}</strong>
                  <span>{progressText}</span>
                </div>
                <button
                  className="secondary-button"
                  disabled={busy || (snapshot?.derivativeProgress?.active ?? false)}
                  onClick={() => void request({ type: "generate-derivatives", quality })}
                  type="button"
                >
                  {t("settings.webShareDerivativeGenerate")}
                </button>
                <button
                  className="secondary-button"
                  disabled={busy || (snapshot?.derivativeProgress?.active ?? false)}
                  onClick={() => void request({ type: "delete-derivatives", quality })}
                  type="button"
                >
                  {t("settings.webShareDerivativeDelete")}
                </button>
              </div>
            </div>
          );
        })}
      </SettingsCard>

      <SettingsCard>
        <div className="app-settings-row app-settings-row-inline">
          <span className="app-settings-row-copy">
            <strong>{t("settings.webShareConnectionTitle")}</strong>
            <span>{addressLine}</span>
          </span>
        </div>
        <div className="app-settings-row-copy">
          <span>{t("settings.webShareTunnelHint")}</span>
        </div>
        <div className="app-settings-card-divider" />
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
              const next = Number(portDraft);
              if (Number.isInteger(next) && next >= 1024 && next <= 65535) {
                void request({ type: "set-port", port: next });
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
      </SettingsCard>

      <SettingsCard>
        <div className="app-settings-action-row">
          <div className="app-settings-row-copy">
            <strong>{t("settings.webShareVisitorsTitle")}</strong>
            <span>
              {t("settings.webShareVisitorsHint")} · {snapshot?.visitorCount ?? 0}
            </span>
          </div>
          <button
            className="secondary-button"
            disabled={busy}
            onClick={() => void loadVisitors()}
            type="button"
          >
            {t("settings.webShareVisitorsLoad")}
          </button>
          <button
            className="secondary-button"
            disabled={busy}
            onClick={() => void request({ type: "export-visitors", format: "json" })}
            type="button"
          >
            {t("settings.webShareVisitorsExportJson")}
          </button>
          <button
            className="secondary-button"
            disabled={busy}
            onClick={() => void request({ type: "export-visitors", format: "csv" })}
            type="button"
          >
            {t("settings.webShareVisitorsExportCsv")}
          </button>
        </div>
        {visitors === null ? null : visitors.length === 0 ? (
          <div className="app-settings-row-copy">
            <span>{t("settings.webShareVisitorsEmpty")}</span>
          </div>
        ) : (
          <div className="web-share-visitors">
            {visitors.map((visitor) => (
              <div className="web-share-visitor" key={visitor.visitorId}>
                <div className="web-share-visitor-head">
                  <strong>{visitor.username}</strong>
                  <span>
                    {visitor.lastIp ?? t("settings.webShareVisitorsUnknownIp")} ·{" "}
                    {t("settings.webShareVisitorsAccesses")}: {visitor.accesses} ·{" "}
                    {new Date(visitor.lastSeenAt).toLocaleString()}
                  </span>
                </div>
                {visitor.lastUserAgent !== null ? (
                  <div className="web-share-visitor-agent">{visitor.lastUserAgent}</div>
                ) : null}
                {visitor.marks.length === 0 ? (
                  <div className="web-share-visitor-mark">
                    {t("settings.webShareVisitorsNoMarks")}
                  </div>
                ) : (
                  visitor.marks.map((mark) => (
                    <div
                      className="web-share-visitor-mark"
                      key={`${mark.libraryId}/${mark.assetId}`}
                    >
                      <span className="web-share-visitor-asset">
                        {mark.assetName ?? mark.assetId}
                      </span>
                      <span>
                        {mark.rating > 0
                          ? "★".repeat(mark.rating)
                          : t("settings.webShareVisitorsNoRating")}
                      </span>
                      {mark.favorite ? <span>{t("settings.webShareVisitorsLiked")}</span> : null}
                    </div>
                  ))
                )}
              </div>
            ))}
          </div>
        )}
      </SettingsCard>
    </>
  );
}
