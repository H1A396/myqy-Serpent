import { useEffect, useState, type ReactNode } from "react";

import {
  parseEmbeddingDimensions,
  validateEmbeddingServiceDraft,
  type EmbeddingHttpAdapter,
  type EmbeddingServiceDestination,
  type EmbeddingServiceIssue,
} from "../shared/embedding/http-service";
import { EMBEDDING_MODALITIES, type EmbeddingModality } from "../shared/embedding/modalities";
import type { EmbeddingHttpServiceSummary } from "../shared/library-api";
import { notifyEmbeddingCatalogChanged } from "./embedding-catalog-events";
import { useT } from "./i18n";

export type EmbeddingServiceSettingsApi = {
  embeddingListServices: () => Promise<{ ok: boolean; value?: EmbeddingHttpServiceSummary[] }>;
  embeddingSaveService: (input: {
    id?: string;
    name: string;
    adapter?: EmbeddingHttpAdapter;
    destination: EmbeddingServiceDestination;
    baseUrl: string;
    modelName: string;
    apiKey?: string;
    modalities?: EmbeddingModality[];
    dimensions?: number | null;
  }) => Promise<{ ok: boolean; value?: { id: string } }>;
  embeddingDeleteService: (input: { id: string }) => Promise<{ ok: boolean }>;
  embeddingProbeService: (input: { id: string }) => Promise<{ ok: boolean; value?: { textStatus: "verified" | "failed"; dimensions: number | null } }>;
  embeddingGrantService: (input: { id: string; libraryId: string }) => Promise<{ ok: boolean }>;
};

const DESTINATIONS: readonly EmbeddingServiceDestination[] = ["loopback", "lan", "internet"];
const ADAPTERS: readonly EmbeddingHttpAdapter[] = ["openai-embeddings-v1", "dashscope-multimodal-v1"];
const MODALITY_KEYS = {
  image: "settings.semanticSearch.modalityImage",
  video: "settings.semanticSearch.modalityVideo",
  audio: "settings.semanticSearch.modalityAudio",
  text: "settings.semanticSearch.modalityText",
} as const;

export function EmbeddingServiceSettings({
  api,
  libraryId,
}: {
  api: EmbeddingServiceSettingsApi;
  libraryId?: string;
}): ReactNode {
  const t = useT();
  const [services, setServices] = useState<EmbeddingHttpServiceSummary[]>([]);
  const [open, setOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [destination, setDestination] = useState<EmbeddingServiceDestination>("loopback");
  const [baseUrl, setBaseUrl] = useState("http://127.0.0.1:8080");
  const [modelName, setModelName] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [adapter, setAdapter] = useState<EmbeddingHttpAdapter>("openai-embeddings-v1");
  const [modalities, setModalities] = useState<EmbeddingModality[]>(["text"]);
  const [dimensions, setDimensions] = useState("");
  const [issue, setIssue] = useState<EmbeddingServiceIssue | null>(null);
  const [busy, setBusy] = useState(false);

  async function refresh(): Promise<void> {
    const listed = await api.embeddingListServices();
    setServices(listed.ok && listed.value ? listed.value : []);
  }

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const listed = await api.embeddingListServices();
      if (!cancelled) setServices(listed.ok && listed.value ? listed.value : []);
    })();
    return () => {
      cancelled = true;
    };
  }, [api]);

  function resetForm(): void {
    setEditingId(null);
    setName("");
    setDestination("loopback");
    setBaseUrl("http://127.0.0.1:8080");
    setModelName("");
    setApiKey("");
    setAdapter("openai-embeddings-v1");
    setModalities(["text"]);
    setDimensions("");
    setIssue(null);
  }

  function beginEdit(service: EmbeddingHttpServiceSummary): void {
    setEditingId(service.id);
    setName(service.name);
    setDestination(service.destination);
    setBaseUrl(service.baseUrl);
    setModelName(service.modelName);
    setApiKey("");
    setAdapter(service.adapter);
    setModalities(service.modalities.length > 0 ? [...service.modalities] : ["text"]);
    setDimensions(service.dimensions == null ? "" : String(service.dimensions));
    setIssue(null);
    setOpen(true);
  }

  function toggleModality(modality: EmbeddingModality): void {
    setModalities((current) => (
      current.includes(modality)
        ? current.filter((item) => item !== modality)
        : EMBEDDING_MODALITIES.filter((item) => item === modality || current.includes(item))
    ));
  }

  async function save(): Promise<void> {
    const parsedDimensions = dimensions.trim() === "" ? null : parseEmbeddingDimensions(Number(dimensions.trim()));
    const nextIssue = validateEmbeddingServiceDraft({
      name,
      modelName,
      destination,
      baseUrl,
      modalities,
      dimensions: dimensions.trim() === "" ? null : parsedDimensions,
    });
    setIssue(nextIssue ?? (dimensions.trim() !== "" && parsedDimensions === null ? "dimensions" : null));
    if (nextIssue || (dimensions.trim() !== "" && parsedDimensions === null)) return;
    setBusy(true);
    const saved = await api.embeddingSaveService({
      ...(editingId ? { id: editingId } : {}),
      name,
      adapter,
      destination,
      baseUrl,
      modelName,
      modalities,
      dimensions: parsedDimensions,
      ...(apiKey.trim() ? { apiKey: apiKey.trim() } : {}),
    });
    setBusy(false);
    if (!saved.ok || !saved.value) return;
    resetForm();
    setOpen(false);
    await refresh();
    notifyEmbeddingCatalogChanged();
  }

  return (
    <div className="semantic-custom-panel">
      <div className="app-settings-action-row semantic-settings-toolbar">
        <div className="app-settings-row-copy">
          <strong>{t("settings.semanticSearch.servicesTitle")}</strong>
          <span>{t("settings.semanticSearch.servicesHint")}</span>
        </div>
        <button
          className="primary-button"
          onClick={() => {
            if (open && !editingId) {
              setOpen(false);
              return;
            }
            resetForm();
            setOpen(true);
          }}
          type="button"
        >
          {t("settings.semanticSearch.addService")}
        </button>
      </div>
      <p className="app-settings-help-note">{t("settings.semanticSearch.serviceSimilarLimit")}</p>
      {services.length > 0 ? (
        <div className="semantic-model-list" role="list">
          {services.map((service) => (
            <ServiceStatus
              api={api}
              key={service.id}
              libraryId={libraryId}
              onChanged={async () => {
                await refresh();
                notifyEmbeddingCatalogChanged();
              }}
              onDelete={() => {
                void api.embeddingDeleteService({ id: service.id }).then(async () => {
                  await refresh();
                  notifyEmbeddingCatalogChanged();
                });
              }}
              onEdit={() => beginEdit(service)}
              service={service}
            />
          ))}
        </div>
      ) : null}
      {open ? (
        <div className="semantic-service-form editor-field ai-config-field">
          <span className="micro-label">{t("settings.semanticSearch.adapterTitle")}</span>
          <div className="app-settings-option-group" role="radiogroup" aria-label={t("settings.semanticSearch.adapterTitle")}>
            {ADAPTERS.map((item) => (
              <button
                aria-checked={adapter === item}
                className="app-settings-option"
                key={item}
                onClick={() => setAdapter(item)}
                role="radio"
                type="button"
              >
                {t(item === "openai-embeddings-v1" ? "settings.semanticSearch.adapterOpenAi" : "settings.semanticSearch.adapterDashScope")}
              </button>
            ))}
          </div>
          {adapter === "dashscope-multimodal-v1" ? <p className="ai-config-hint">{t("settings.semanticSearch.adapterDashScopeHint")}</p> : null}
          <label className="micro-label" htmlFor="embedding-service-name">{t("settings.semanticSearch.serviceName")}</label>
          <input className="text-field ai-config-input" id="embedding-service-name" maxLength={80} onChange={(event) => setName(event.target.value)} value={name} />
          <span className="micro-label">{t("settings.semanticSearch.serviceWhere")}</span>
          <div className="app-settings-option-group" role="radiogroup">
            {DESTINATIONS.map((item) => (
              <button
                aria-checked={destination === item}
                className="app-settings-option"
                key={item}
                onClick={() => setDestination(item)}
                role="radio"
                type="button"
              >
                {t(`settings.semanticSearch.destination.${item}`)}
              </button>
            ))}
          </div>
          <label className="micro-label" htmlFor="embedding-service-url">{t("settings.semanticSearch.serviceAddress")}</label>
          <input className="text-field ai-config-input" id="embedding-service-url" maxLength={300} onChange={(event) => setBaseUrl(event.target.value)} spellCheck={false} value={baseUrl} />
          <label className="micro-label" htmlFor="embedding-service-model">{t("settings.semanticSearch.serviceModel")}</label>
          <input className="text-field ai-config-input" id="embedding-service-model" maxLength={120} onChange={(event) => setModelName(event.target.value)} spellCheck={false} value={modelName} />
          <span className="micro-label">{t("settings.semanticSearch.modalitiesTitle")}</span>
          <div className="app-settings-option-group" role="group" aria-label={t("settings.semanticSearch.modalitiesTitle")}>
            {EMBEDDING_MODALITIES.map((modality) => (
              <button
                aria-pressed={modalities.includes(modality)}
                className="app-settings-option"
                key={modality}
                onClick={() => toggleModality(modality)}
                type="button"
              >
                {t(MODALITY_KEYS[modality])}
              </button>
            ))}
          </div>
          <label className="micro-label" htmlFor="embedding-service-dimensions">{t("settings.semanticSearch.dimensions")}</label>
          <input
            className="text-field ai-config-input"
            id="embedding-service-dimensions"
            inputMode="numeric"
            onChange={(event) => setDimensions(event.target.value)}
            spellCheck={false}
            value={dimensions}
          />
          <p className="ai-config-hint">{t("settings.semanticSearch.dimensionsHint")}</p>
          <label className="micro-label" htmlFor="embedding-service-key">{t("settings.semanticSearch.serviceKey")}</label>
          <input className="text-field ai-config-input" id="embedding-service-key" maxLength={2048} onChange={(event) => setApiKey(event.target.value)} spellCheck={false} type="password" value={apiKey} />
          <p className="ai-config-hint">{issue ? t(`settings.semanticSearch.serviceIssue.${issue}`) : t("settings.semanticSearch.serviceFormHint")}</p>
          <button className="primary-button" disabled={busy} onClick={() => { void save(); }} type="button">
            {t("settings.semanticSearch.serviceSave")}
          </button>
        </div>
      ) : null}
    </div>
  );
}

function ServiceStatus({
  api,
  libraryId,
  service,
  onChanged,
  onDelete,
  onEdit,
}: {
  api: EmbeddingServiceSettingsApi;
  libraryId?: string;
  service: EmbeddingHttpServiceSummary;
  onChanged: () => Promise<unknown>;
  onDelete: () => void;
  onEdit: () => void;
}): ReactNode {
  const t = useT();
  const granted = service.destination === "loopback" || (libraryId ? service.grantedLibraryIds.includes(libraryId) : false);
  const statusKey = service.textStatus === "verified"
    ? "settings.semanticSearch.serviceVerified"
    : service.textStatus === "failed"
      ? "settings.semanticSearch.serviceFailed"
      : "settings.semanticSearch.serviceUnverified";
  const statusTone = service.textStatus === "verified"
    ? "connected"
    : service.textStatus === "failed"
      ? "failed"
      : "idle";
  return (
    <div className="semantic-model-card" role="listitem">
      <div className="semantic-model-card-copy">
        <div className="semantic-model-card-title-row">
          <strong>{service.name}</strong>
          <span className="sync-status-indicator" data-state={statusTone}>
            <span className="sync-status-dot" data-state={statusTone} />
            <span>{t(statusKey)}{service.dimensions ? ` · ${service.dimensions}` : ""}</span>
          </span>
        </div>
        <span>{service.modelName}</span>
        <span>{service.destination === "loopback" ? t("settings.semanticSearch.serviceLocalNote") : t("settings.semanticSearch.serviceRemoteNote")}</span>
        {service.destination === "lan" ? <span>{t("settings.semanticSearch.serviceLanNote")}</span> : null}
      </div>
      <div className="semantic-model-card-action app-settings-option-group">
        <button className="secondary-button" onClick={onEdit} type="button">
          {t("settings.semanticSearch.serviceEdit")}
        </button>
        <button className="secondary-button" onClick={() => { void api.embeddingProbeService({ id: service.id }).then(onChanged); }} type="button">
          {t("settings.semanticSearch.serviceTest")}
        </button>
        {!granted && libraryId ? (
          <button className="secondary-button" onClick={() => { void api.embeddingGrantService({ id: service.id, libraryId }).then(onChanged); }} type="button">
            {t("settings.semanticSearch.serviceGrant")}
          </button>
        ) : null}
        <button className="secondary-button" onClick={onDelete} type="button">
          {t("settings.semanticSearch.serviceDelete")}
        </button>
      </div>
    </div>
  );
}
