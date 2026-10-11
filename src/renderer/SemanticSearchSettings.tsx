import { useEffect, useState, type ReactNode } from "react";

import type { PublicError } from "../shared/protocol/errors";
import { SEMANTIC_SEARCH_MODELS, type SemanticSearchModelId } from "../shared/embedding/profile";
import { EmbeddingServiceSettings, type EmbeddingServiceSettingsApi } from "./EmbeddingServiceSettings";
import { notifyEmbeddingCatalogChanged, setEmbeddingInstallActive } from "./embedding-catalog-events";
import { messageForPublicError } from "./error-utils";
import { useLocale, useT } from "./i18n";
import {
  SEMANTIC_SEARCH_PAGE_SIZES,
  loadSemanticSearchPreferences,
  saveSemanticSearchPreferences,
  type SemanticSearchPageSize,
} from "./semantic-search-preferences";
import { SettingsCard } from "./ui/patterns";

const MODEL_LABEL_KEYS = {
  "embeddinggemma-2-compact": "settings.semanticSearch.modelCompact",
  "embeddinggemma-2-balanced": "settings.semanticSearch.modelBalanced",
  "embeddinggemma-2-quality": "settings.semanticSearch.modelQuality",
} as const;

const MODEL_HINT_KEYS = {
  "embeddinggemma-2-compact": "settings.semanticSearch.modelCompactHint",
  "embeddinggemma-2-balanced": "settings.semanticSearch.modelBalancedHint",
  "embeddinggemma-2-quality": "settings.semanticSearch.modelQualityHint",
} as const;

type InstallSnapshot = {
  runtimeInstalled: boolean;
  runtimeDownloadable: boolean;
  models: Array<{ modelId: SemanticSearchModelId; installed: boolean }>;
};

type ModelInstallState = "ready" | "missing" | "missing-runtime" | "runtime-unavailable" | "unknown";

export type EmbeddingCatalogApi = EmbeddingServiceSettingsApi & {
  embeddingInstallStatus: () => Promise<{ ok: boolean; value?: InstallSnapshot; error?: PublicError }>;
  embeddingInstall: (input: { modelId: SemanticSearchModelId }) => Promise<{ ok: boolean; value?: InstallSnapshot; error?: PublicError }>;
};

function resolveModelState(
  installed: boolean,
  install: InstallSnapshot | null,
): ModelInstallState {
  if (!install) return "unknown";
  if (!installed) return "missing";
  if (install.runtimeInstalled) return "ready";
  if (!install.runtimeDownloadable) return "runtime-unavailable";
  return "missing-runtime";
}

export function SemanticSearchSettings({
  libraryId,
  servicesApi,
}: {
  libraryId?: string;
  servicesApi?: EmbeddingCatalogApi;
}): ReactNode {
  const t = useT();
  const { locale } = useLocale();
  const [prefs, setPrefs] = useState(() => loadSemanticSearchPreferences());
  const [mode, setMode] = useState<"local" | "custom">("local");
  const [install, setInstall] = useState<InstallSnapshot | null>(null);
  const [installingId, setInstallingId] = useState<SemanticSearchModelId | null>(null);
  const [installError, setInstallError] = useState<string | null>(null);

  useEffect(() => {
    if (!servicesApi) return;
    let cancelled = false;
    void servicesApi.embeddingInstallStatus().then((result) => {
      if (!cancelled && result.ok && result.value) setInstall(result.value);
    });
    return () => {
      cancelled = true;
    };
  }, [servicesApi]);

  function updatePageSize(pageSize: SemanticSearchPageSize): void {
    const saved = { ...loadSemanticSearchPreferences(), pageSize };
    saveSemanticSearchPreferences(saved);
    setPrefs(saved);
  }

  async function installModel(modelId: SemanticSearchModelId): Promise<void> {
    if (!servicesApi || installingId) return;
    setInstallingId(modelId);
    setInstallError(null);
    setEmbeddingInstallActive(true);
    try {
      const result = await servicesApi.embeddingInstall({ modelId });
      if (!result.ok || !result.value) {
        setInstallError(result.error
          ? messageForPublicError(result.error, locale, t("error.code.EMBEDDING_INSTALL_FAILED"))
          : t("error.code.EMBEDDING_INSTALL_FAILED"));
        return;
      }
      if (result.value) setInstall(result.value);
      notifyEmbeddingCatalogChanged();
    } finally {
      setInstallingId(null);
      setEmbeddingInstallActive(false);
    }
  }

  return (
    <SettingsCard className="semantic-search-card">
      <div className="app-settings-action-row semantic-settings-toolbar">
        <div className="app-settings-row-copy">
          <strong>{t("settings.semanticSearch.modelTitle")}</strong>
          <span>{t("settings.semanticSearch.libraryChooses")}</span>
        </div>
        <div
          className="app-settings-option-group semantic-settings-segment"
          role="radiogroup"
          aria-label={t("settings.semanticSearch.modelTitle")}
        >
          <button
            aria-checked={mode === "local"}
            className="app-settings-option"
            onClick={() => setMode("local")}
            role="radio"
            type="button"
          >
            {t("settings.semanticSearch.modeLocal")}
          </button>
          <button
            aria-checked={mode === "custom"}
            className="app-settings-option"
            onClick={() => setMode("custom")}
            role="radio"
            type="button"
          >
            {t("settings.semanticSearch.modeCustom")}
          </button>
        </div>
      </div>

      {mode === "local" ? (
        <>
          <div className="semantic-model-list" role="list">
            {SEMANTIC_SEARCH_MODELS.map((model) => {
              const installed = install?.models.some((entry) => entry.modelId === model.id && entry.installed) ?? false;
              const working = installingId === model.id;
              const state = resolveModelState(installed, install);
              const statusLabel = state === "ready"
                ? t("settings.semanticSearch.installReady")
                : state === "missing-runtime"
                  ? t("settings.semanticSearch.installNeedsRuntime")
                  : state === "runtime-unavailable"
                    ? t("settings.semanticSearch.installUnavailable")
                    : state === "missing"
                      ? t("settings.semanticSearch.installNotInstalled")
                      : null;
              const statusDetail = state === "missing-runtime"
                ? t("settings.semanticSearch.installMissingRuntime")
                : state === "runtime-unavailable"
                  ? t("settings.semanticSearch.installRuntimeUnavailable")
                  : null;
              const statusTone = state === "ready"
                ? "connected"
                : state === "missing-runtime"
                  ? "checking"
                  : state === "runtime-unavailable"
                    ? "failed"
                    : "idle";
              const actionLabel = working
                ? t("settings.semanticSearch.installWorking")
                : state === "ready"
                  ? t("settings.semanticSearch.installReinstall")
                  : t("settings.semanticSearch.installAction");
              return (
                <div className="semantic-model-card" key={model.id} role="listitem">
                  <div className="semantic-model-card-copy">
                    <div className="semantic-model-card-title-row">
                      <strong>{t(MODEL_LABEL_KEYS[model.id])}</strong>
                      {statusLabel ? (
                        <span className="sync-status-indicator" data-state={statusTone}>
                          <span className="sync-status-dot" data-state={statusTone} />
                          <span>{statusLabel}</span>
                        </span>
                      ) : null}
                    </div>
                    <span>{t(MODEL_HINT_KEYS[model.id])}</span>
                    {statusDetail ? <span>{statusDetail}</span> : null}
                  </div>
                  <div className="semantic-model-card-action">
                    <button
                      className={state === "ready" ? "secondary-button" : "primary-button"}
                      disabled={installingId !== null || state === "runtime-unavailable"}
                      onClick={() => { void installModel(model.id); }}
                      type="button"
                    >
                      {actionLabel}
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
          {installError ? <p className="settings-error-message">{installError}</p> : null}
        </>
      ) : servicesApi ? (
        <EmbeddingServiceSettings api={servicesApi} libraryId={libraryId} />
      ) : null}

      <div className="app-settings-card-divider" />
      <div className="app-settings-action-row semantic-settings-toolbar">
        <div className="app-settings-row-copy">
          <strong>{t("settings.semanticSearch.pageSizeTitle")}</strong>
          <span>{t("settings.semanticSearch.pageSizeHint")}</span>
        </div>
        <div
          aria-label={t("settings.semanticSearch.pageSizeTitle")}
          className="app-settings-option-group semantic-settings-segment"
          role="radiogroup"
        >
          {SEMANTIC_SEARCH_PAGE_SIZES.map((pageSize) => (
            <button
              aria-checked={prefs.pageSize === pageSize}
              className="app-settings-option"
              key={pageSize}
              onClick={() => updatePageSize(pageSize)}
              role="radio"
              type="button"
            >
              {pageSize}
            </button>
          ))}
        </div>
      </div>
    </SettingsCard>
  );
}
