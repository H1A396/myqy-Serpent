import { useEffect, useState, type ReactNode } from "react";

import type { EmbeddingIndexSnapshot, SemanticSearchModelId } from "../shared/embedding/profile";
import { SETTINGS_LOCAL_SEMANTIC_MODELS } from "../shared/embedding/profile";
import { embeddingBindingIssue } from "../shared/embedding/library-binding";
import { isEmbeddingServiceSelectionId } from "../shared/embedding/http-service";
import type { EmbeddingHttpServiceSummary } from "../shared/library-api";
import { notifyEmbeddingCatalogChanged } from "./embedding-catalog-events";
import { useT } from "./i18n";
import { loadSemanticSearchPreferences } from "./semantic-search-preferences";
import { embeddingIndexCopyKey } from "./semantic-index-copy";

const MODEL_LABEL_KEYS = {
  "embeddinggemma-2-compact": "settings.semanticSearch.modelCompact",
  "embeddinggemma-2-balanced": "settings.semanticSearch.modelBalanced",
  "embeddinggemma-2-quality": "settings.semanticSearch.modelQuality",
} as const;

const INHERIT_VALUE = "";
const OFF_VALUE = "__off__";

type InstallSnapshot = {
  runtimeInstalled: boolean;
  models: Array<{ modelId: SemanticSearchModelId; installed: boolean }>;
};

export type LibraryEmbeddingCallbacks = {
  listServices: () => Promise<{ ok: true; value: EmbeddingHttpServiceSummary[] } | { ok: false }>;
  installStatus: () => Promise<{ ok: true; value: InstallSnapshot } | { ok: false }>;
  getBinding: (input: { libraryId: string }) => Promise<{ ok: true; value: { selectionId: string | null; enabled: boolean; inherit: boolean } } | { ok: false }>;
  saveBinding: (input: { libraryId: string; selectionId: string | null; inherit?: boolean }) => Promise<{ ok: true } | { ok: false }>;
};

function toSelectValue(binding: { selectionId: string | null; enabled: boolean; inherit: boolean }): string {
  if (binding.inherit) return INHERIT_VALUE;
  if (!binding.enabled || !binding.selectionId) return OFF_VALUE;
  return binding.selectionId;
}

export function LibraryEmbeddingSettings({
  libraryId,
  callbacks,
  index,
}: {
  libraryId: string;
  callbacks: LibraryEmbeddingCallbacks;
  index: EmbeddingIndexSnapshot | null;
}): ReactNode {
  const t = useT();
  const [services, setServices] = useState<EmbeddingHttpServiceSummary[]>([]);
  const [install, setInstall] = useState<InstallSnapshot | null>(null);
  const [selectionValue, setSelectionValue] = useState(INHERIT_VALUE);
  const [savedValue, setSavedValue] = useState(INHERIT_VALUE);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const globalPrefs = loadSemanticSearchPreferences();

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const [listed, status, binding] = await Promise.all([
        callbacks.listServices(),
        callbacks.installStatus(),
        callbacks.getBinding({ libraryId }),
      ]);
      if (cancelled) return;
      if (listed.ok) setServices(listed.value);
      if (status.ok) setInstall(status.value);
      if (binding.ok) {
        const next = toSelectValue(binding.value);
        setSelectionValue(next);
        setSavedValue(next);
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [libraryId]);

  const installed = new Set(
    (install?.models ?? []).filter((model) => model.installed).map((model) => model.modelId),
  );
  const nothingReady = installed.size === 0 && services.length === 0;
  const savedBinding = savedValue === INHERIT_VALUE
    ? null
    : savedValue === OFF_VALUE
      ? { selectionId: null, enabled: false }
      : { selectionId: savedValue, enabled: true };
  const issue = embeddingBindingIssue({
    binding: savedBinding,
    services: new Map(services.map((service) => [service.id, service])),
    runtimeInstalled: install?.runtimeInstalled ?? false,
    installedModelIds: installed,
  });
  const defaultLabel = (() => {
    const id = globalPrefs.modelId;
    if (id in MODEL_LABEL_KEYS) return t(MODEL_LABEL_KEYS[id as keyof typeof MODEL_LABEL_KEYS]);
    const service = services.find((item) => item.id === id);
    return service?.name ?? id;
  })();

  async function save(): Promise<void> {
    setBusy(true);
    setNotice(null);
    try {
      const inherit = selectionValue === INHERIT_VALUE;
      const result = await callbacks.saveBinding({
        libraryId,
        selectionId: inherit || selectionValue === OFF_VALUE ? null : selectionValue,
        ...(inherit ? { inherit: true } : {}),
      });
      if (!result.ok) return;
      setSavedValue(selectionValue);
      setNotice(t("settings.librarySemantic.saved"));
      notifyEmbeddingCatalogChanged();
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <div className="app-settings-page-heading">
        <h3>{t("settings.librarySemantic.title")}</h3>
        <p>{t("settings.librarySemantic.hint")}</p>
      </div>
      <section className="app-settings-card">
        <div className="app-settings-row app-settings-row-stack">
          <div className="app-settings-row-copy">
            <strong>{t("settings.librarySemantic.model")}</strong>
            <span>{t("settings.librarySemantic.inheritHint", { model: defaultLabel })}</span>
          </div>
          {!globalPrefs.enabled ? (
            <p className="app-settings-help-note">{t("settings.librarySemantic.globalOff")}</p>
          ) : null}
          {nothingReady ? <p className="app-settings-help-note">{t("settings.librarySemantic.empty")}</p> : null}
          <select
            aria-label={t("settings.librarySemantic.model")}
            className="text-field"
            onChange={(event) => setSelectionValue(event.target.value)}
            value={selectionValue}
          >
            <option value={INHERIT_VALUE}>
              {t("settings.librarySemantic.inherit", { model: defaultLabel })}
            </option>
            <option value={OFF_VALUE}>{t("settings.librarySemantic.off")}</option>
            {SETTINGS_LOCAL_SEMANTIC_MODELS.map((modelId) => (
              <option key={modelId} value={modelId}>
                {t(MODEL_LABEL_KEYS[modelId])}
                {installed.has(modelId) ? "" : ` (${t("settings.librarySemantic.notInstalled")})`}
              </option>
            ))}
            {services.map((service) => (
              <option key={service.id} value={service.id}>{service.name}</option>
            ))}
          </select>
          {savedValue !== INHERIT_VALUE && issue === "missing" ? <p className="app-settings-help-note">{t("settings.librarySemantic.missing")}</p> : null}
          {savedValue !== INHERIT_VALUE && issue === "install" ? <p className="app-settings-help-note">{t("settings.librarySemantic.install")}</p> : null}
          {savedValue !== INHERIT_VALUE && issue === "configure" ? <p className="app-settings-help-note">{t("settings.librarySemantic.configure")}</p> : null}
          {issue === "ready" && index && savedValue !== INHERIT_VALUE && savedValue !== OFF_VALUE ? (
            <span>
              {t(embeddingIndexCopyKey(index, {
                textOnly: isEmbeddingServiceSelectionId(savedValue),
              }), {
                done: index.done,
                total: index.total,
                failed: index.failedCount,
              })}
            </span>
          ) : null}
        </div>
        <div className="library-settings-gitignore-actions">
          <button className="primary-button" disabled={busy} onClick={() => { void save(); }} type="button">
            {t("settings.librarySemantic.save")}
          </button>
        </div>
        {notice ? <p className="library-settings-gitignore-help">{notice}</p> : null}
      </section>
    </>
  );
}
