import { useEffect, useState, type ReactNode } from "react";

import type { EmbeddingIndexSnapshot, SemanticSearchModelId } from "../shared/embedding/profile";
import { SEMANTIC_SEARCH_MODELS } from "../shared/embedding/profile";
import { embeddingBindingIssue } from "../shared/embedding/library-binding";
import { isEmbeddingServiceSelectionId } from "../shared/embedding/http-service";
import type { EmbeddingHttpServiceSummary } from "../shared/library-api";
import { notifyEmbeddingCatalogChanged } from "./embedding-catalog-events";
import { useT } from "./i18n";
import { embeddingIndexCopyKey } from "./semantic-index-copy";

const MODEL_LABEL_KEYS = {
  "embeddinggemma-2-compact": "settings.semanticSearch.modelCompact",
  "embeddinggemma-2-balanced": "settings.semanticSearch.modelBalanced",
  "embeddinggemma-2-quality": "settings.semanticSearch.modelQuality",
} as const;

type InstallSnapshot = {
  runtimeInstalled: boolean;
  models: Array<{ modelId: SemanticSearchModelId; installed: boolean }>;
};

export type LibraryEmbeddingCallbacks = {
  listServices: () => Promise<{ ok: true; value: EmbeddingHttpServiceSummary[] } | { ok: false }>;
  installStatus: () => Promise<{ ok: true; value: InstallSnapshot } | { ok: false }>;
  getBinding: (input: { libraryId: string }) => Promise<{ ok: true; value: { selectionId: string | null; enabled: boolean } } | { ok: false }>;
  saveBinding: (input: { libraryId: string; selectionId: string | null }) => Promise<{ ok: true } | { ok: false }>;
};

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
  const [selectionId, setSelectionId] = useState("");
  const [savedId, setSavedId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

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
        const next = binding.value.enabled && binding.value.selectionId ? binding.value.selectionId : "";
        setSelectionId(next);
        setSavedId(next || null);
      }
    })();
    return () => {
      cancelled = true;
    };
    // Callbacks are recreated with the dialog. Reload when the library changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [libraryId]);

  const installed = new Set(
    (install?.models ?? []).filter((model) => model.installed).map((model) => model.modelId),
  );
  const nothingReady = installed.size === 0 && services.length === 0;
  const issue = embeddingBindingIssue({
    binding: savedId ? { selectionId: savedId, enabled: true } : { selectionId: null, enabled: false },
    services: new Map(services.map((service) => [service.id, service])),
    runtimeInstalled: install?.runtimeInstalled ?? false,
    installedModelIds: installed,
  });

  async function save(): Promise<void> {
    setBusy(true);
    setNotice(null);
    try {
      const result = await callbacks.saveBinding({
        libraryId,
        selectionId: selectionId || null,
      });
      if (!result.ok) return;
      setSavedId(selectionId || null);
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
          </div>
          {nothingReady ? <p className="app-settings-help-note">{t("settings.librarySemantic.empty")}</p> : null}
          <select
            aria-label={t("settings.librarySemantic.model")}
            className="text-field"
            onChange={(event) => setSelectionId(event.target.value)}
            value={selectionId}
          >
            <option value="">{t("settings.librarySemantic.off")}</option>
            {SEMANTIC_SEARCH_MODELS.map((model) => (
              <option key={model.id} value={model.id}>
                {t(MODEL_LABEL_KEYS[model.id])}
                {installed.has(model.id) ? "" : ` (${t("settings.librarySemantic.notInstalled")})`}
              </option>
            ))}
            {services.map((service) => (
              <option key={service.id} value={service.id}>{service.name}</option>
            ))}
          </select>
          {issue === "missing" ? <p className="app-settings-help-note">{t("settings.librarySemantic.missing")}</p> : null}
          {issue === "install" ? <p className="app-settings-help-note">{t("settings.librarySemantic.install")}</p> : null}
          {issue === "configure" ? <p className="app-settings-help-note">{t("settings.librarySemantic.configure")}</p> : null}
          {issue === "ready" && index ? (
            <span>
              {t(embeddingIndexCopyKey(index, {
                textOnly: isEmbeddingServiceSelectionId(selectionId || savedId || ""),
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
