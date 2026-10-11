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

export type EmbeddingCatalogApi = EmbeddingServiceSettingsApi & {
  embeddingInstallStatus: () => Promise<{ ok: boolean; value?: InstallSnapshot; error?: PublicError }>;
  embeddingInstall: (input: { modelId: SemanticSearchModelId }) => Promise<{ ok: boolean; value?: InstallSnapshot; error?: PublicError }>;
};

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

  const runtimeReady = install?.runtimeInstalled === true;

  return (
    <SettingsCard>
      <div className="app-settings-row app-settings-row-stack">
        <div className="app-settings-row-copy">
          <strong>{t("settings.semanticSearch.modelTitle")}</strong>
          <span>{t("settings.semanticSearch.libraryChooses")}</span>
        </div>
        <div className="app-settings-option-group" role="radiogroup" aria-label={t("settings.semanticSearch.modelTitle")}>
          <button aria-checked={mode === "local"} className="app-settings-option" onClick={() => setMode("local")} role="radio" type="button">
            {t("settings.semanticSearch.modeLocal")}
          </button>
          <button aria-checked={mode === "custom"} className="app-settings-option" onClick={() => setMode("custom")} role="radio" type="button">
            {t("settings.semanticSearch.modeCustom")}
          </button>
        </div>
      </div>
      {mode === "local" ? (
        <>
          <div className="app-settings-card-divider" />
          {SEMANTIC_SEARCH_MODELS.map((model) => {
            const installed = install?.models.some((entry) => entry.modelId === model.id && entry.installed) ?? false;
            const working = installingId === model.id;
            return (
              <div className="app-settings-row app-settings-row-stack" key={model.id}>
                <div className="app-settings-row-copy">
                  <strong>{t(MODEL_LABEL_KEYS[model.id])}</strong>
                  <span>{t(MODEL_HINT_KEYS[model.id])}</span>
                  <span>
                    {installed && runtimeReady
                      ? t("settings.semanticSearch.installReady")
                      : installed && install && !install.runtimeDownloadable && !runtimeReady
                        ? t("settings.semanticSearch.installRuntimeUnavailable")
                        : installed
                          ? t("settings.semanticSearch.installMissingRuntime")
                          : null}
                  </span>
                </div>
                <button
                  className="app-settings-option"
                  disabled={installingId !== null || (installed && runtimeReady)}
                  onClick={() => { void installModel(model.id); }}
                  type="button"
                >
                  {working
                    ? t("settings.semanticSearch.installWorking")
                    : installed && runtimeReady
                      ? t("settings.semanticSearch.installReady")
                      : t("settings.semanticSearch.installAction")}
                </button>
              </div>
            );
          })}
          {installError ? <p className="settings-error-message">{installError}</p> : null}
        </>
      ) : servicesApi ? (
        <>
          <div className="app-settings-card-divider" />
          <EmbeddingServiceSettings api={servicesApi} libraryId={libraryId} />
        </>
      ) : null}
      <div className="app-settings-card-divider" />
      <div className="app-settings-row app-settings-row-stack">
        <div className="app-settings-row-copy">
          <strong>{t("settings.semanticSearch.pageSizeTitle")}</strong>
          <span>{t("settings.semanticSearch.pageSizeHint")}</span>
        </div>
        <div aria-label={t("settings.semanticSearch.pageSizeTitle")} className="app-settings-option-group" role="radiogroup">
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
