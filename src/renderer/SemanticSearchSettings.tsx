import { useState, type ReactNode } from "react";

import { SEMANTIC_SEARCH_MODELS, type EmbeddingIndexSnapshot } from "../shared/embedding/profile";
import { EmbeddingServiceSettings, type EmbeddingServiceSettingsApi } from "./EmbeddingServiceSettings";
import { useT } from "./i18n";
import { embeddingIndexCopyKey } from "./semantic-index-copy";
import {
  loadSemanticSearchPreferences,
  SEMANTIC_SEARCH_PAGE_SIZES,
  saveSemanticSearchPreferences,
  type SemanticSearchPageSize,
} from "./semantic-search-preferences";
import { SettingsCard } from "./ui/patterns";
import { Switch } from "./ui/primitives";

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

export function SemanticSearchSettings({
  libraryOpen,
  libraryId,
  index,
  servicesApi,
}: {
  libraryOpen: boolean;
  libraryId?: string;
  index: EmbeddingIndexSnapshot;
  servicesApi?: EmbeddingServiceSettingsApi;
}): ReactNode {
  const t = useT();
  const [prefs, setPrefs] = useState(() => loadSemanticSearchPreferences());

  function update(next: {
    enabled?: boolean;
    modelId?: string;
    pageSize?: SemanticSearchPageSize;
  }): void {
    const enabled = next.enabled ?? prefs.enabled;
    const saved = {
      version: 1 as const,
      enabled,
      modelId: next.modelId ?? prefs.modelId,
      searchMode: enabled ? prefs.searchMode : "keyword" as const,
      pageSize: next.pageSize ?? prefs.pageSize,
    };
    saveSemanticSearchPreferences(saved);
    setPrefs(saved);
  }

  return (
    <SettingsCard>
      <label className="app-settings-toggle-row">
        <span className="app-settings-row-copy">
          <strong>{t("settings.semanticSearch.enabled")}</strong>
          <span>{t("settings.semanticSearch.enabledHint")}</span>
        </span>
        <Switch
          aria-label={t("settings.semanticSearch.enabled")}
          checked={prefs.enabled}
          onCheckedChange={(checked) => update({ enabled: checked })}
        />
      </label>
      <div className="app-settings-card-divider" />
      <div className="app-settings-row app-settings-row-stack">
        <div className="app-settings-row-copy">
          <strong>{t("settings.semanticSearch.modelTitle")}</strong>
          <span>{t(MODEL_HINT_KEYS[prefs.modelId as keyof typeof MODEL_HINT_KEYS] ?? "settings.semanticSearch.servicesHint")}</span>
        </div>
        <div
          aria-label={t("settings.semanticSearch.modelTitle")}
          className="app-settings-option-group"
          role="radiogroup"
        >
          {SEMANTIC_SEARCH_MODELS.map((model) => (
            <button
              aria-checked={prefs.modelId === model.id}
              className="app-settings-option"
              key={model.id}
              onClick={() => update({ modelId: model.id })}
              role="radio"
              type="button"
            >
              {t(MODEL_LABEL_KEYS[model.id])}
            </button>
          ))}
        </div>
      </div>
      {servicesApi ? (
        <EmbeddingServiceSettings
          api={servicesApi}
          libraryId={libraryId}
          onSelect={(modelId) => update({ modelId })}
          selectedId={prefs.modelId}
        />
      ) : null}
      <div className="app-settings-card-divider" />
      <div className="app-settings-row app-settings-row-stack">
        <div className="app-settings-row-copy">
          <strong>{t("settings.semanticSearch.pageSizeTitle")}</strong>
          <span>{t("settings.semanticSearch.pageSizeHint")}</span>
        </div>
        <div
          aria-label={t("settings.semanticSearch.pageSizeTitle")}
          className="app-settings-option-group"
          role="radiogroup"
        >
          {SEMANTIC_SEARCH_PAGE_SIZES.map((pageSize) => (
            <button
              aria-checked={prefs.pageSize === pageSize}
              className="app-settings-option"
              key={pageSize}
              onClick={() => update({ pageSize })}
              role="radio"
              type="button"
            >
              {pageSize}
            </button>
          ))}
        </div>
      </div>
      <div className="app-settings-card-divider" />
      <div className="app-settings-row app-settings-row-stack">
        <div className="app-settings-row-copy">
          <strong>{t("settings.semanticSearch.indexTitle")}</strong>
          <span>
            {!prefs.enabled
              ? t("settings.semanticSearch.indexIdle")
              : !libraryOpen
                ? t("settings.semanticSearch.indexNeedsLibrary")
                : t(embeddingIndexCopyKey(index), {
                    done: index.done,
                    total: index.total,
                    failed: index.failedCount,
                  })}
          </span>
        </div>
      </div>
    </SettingsCard>
  );
}
