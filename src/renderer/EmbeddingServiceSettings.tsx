import { useEffect, useState, type ReactNode } from "react";

import {
  validateEmbeddingServiceDraft,
  type EmbeddingServiceDestination,
  type EmbeddingServiceIssue,
} from "../shared/embedding/http-service";
import type { EmbeddingHttpServiceSummary } from "../shared/library-api";
import { useT } from "./i18n";

export type EmbeddingServiceSettingsApi = {
  embeddingListServices: () => Promise<{ ok: boolean; value?: EmbeddingHttpServiceSummary[] }>;
  embeddingSaveService: (input: {
    id?: string;
    name: string;
    destination: EmbeddingServiceDestination;
    baseUrl: string;
    modelName: string;
    apiKey?: string;
  }) => Promise<{ ok: boolean; value?: { id: string } }>;
  embeddingDeleteService: (input: { id: string }) => Promise<{ ok: boolean }>;
  embeddingProbeService: (input: { id: string }) => Promise<{ ok: boolean; value?: { textStatus: "verified" | "failed" } }>;
  embeddingGrantService: (input: { id: string; libraryId: string }) => Promise<{ ok: boolean }>;
};

const DESTINATIONS: readonly EmbeddingServiceDestination[] = ["loopback", "lan", "internet"];

export function EmbeddingServiceSettings({
  api,
  libraryId,
  selectedId,
  onSelect,
}: {
  api: EmbeddingServiceSettingsApi;
  libraryId?: string;
  selectedId: string;
  onSelect: (id: string) => void;
}): ReactNode {
  const t = useT();
  const [services, setServices] = useState<EmbeddingHttpServiceSummary[]>([]);
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [destination, setDestination] = useState<EmbeddingServiceDestination>("loopback");
  const [baseUrl, setBaseUrl] = useState("http://127.0.0.1:8080");
  const [modelName, setModelName] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [issue, setIssue] = useState<EmbeddingServiceIssue | null>(null);
  const [busy, setBusy] = useState(false);

  async function refresh(): Promise<EmbeddingHttpServiceSummary[]> {
    const listed = await api.embeddingListServices();
    const next = listed.ok && listed.value ? listed.value : [];
    setServices(next);
    return next;
  }

  useEffect(() => {
    void refresh();
  }, [api]);

  async function save(): Promise<void> {
    const nextIssue = validateEmbeddingServiceDraft({ name, modelName, destination, baseUrl });
    setIssue(nextIssue);
    if (nextIssue) return;
    setBusy(true);
    const saved = await api.embeddingSaveService({
      name,
      destination,
      baseUrl,
      modelName,
      ...(apiKey.trim() ? { apiKey: apiKey.trim() } : {}),
    });
    setBusy(false);
    if (!saved.ok || !saved.value) return;
    setApiKey("");
    setOpen(false);
    await refresh();
    onSelect(saved.value.id);
  }

  return (
    <>
      <div className="app-settings-card-divider" />
      <div className="app-settings-row app-settings-row-stack">
        <div className="app-settings-row-copy">
          <strong>{t("settings.semanticSearch.servicesTitle")}</strong>
          <span>{t("settings.semanticSearch.servicesHint")}</span>
        </div>
        <div className="app-settings-option-group" role="radiogroup" aria-label={t("settings.semanticSearch.servicesTitle")}>
          {services.map((service) => (
            <button
              aria-checked={selectedId === service.id}
              className="app-settings-option"
              key={service.id}
              onClick={() => onSelect(service.id)}
              role="radio"
              type="button"
            >
              {service.name}
            </button>
          ))}
          <button className="app-settings-option" onClick={() => setOpen((value) => !value)} type="button">
            {t("settings.semanticSearch.addService")}
          </button>
        </div>
        {services.filter((service) => service.id === selectedId).map((service) => (
          <ServiceStatus
            api={api}
            key={service.id}
            libraryId={libraryId}
            onChanged={refresh}
            onDelete={() => {
              void api.embeddingDeleteService({ id: service.id }).then(async () => {
                await refresh();
                onSelect("embeddinggemma-2-balanced");
              });
            }}
            service={service}
          />
        ))}
        {open ? (
          <div className="editor-field ai-config-field">
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
            <label className="micro-label" htmlFor="embedding-service-key">{t("settings.semanticSearch.serviceKey")}</label>
            <input className="text-field ai-config-input" id="embedding-service-key" maxLength={2048} onChange={(event) => setApiKey(event.target.value)} spellCheck={false} type="password" value={apiKey} />
            <p className="ai-config-hint">{issue ? t(`settings.semanticSearch.serviceIssue.${issue}`) : t("settings.semanticSearch.serviceFormHint")}</p>
            <button className="app-settings-option" disabled={busy} onClick={() => { void save(); }} type="button">
              {t("settings.semanticSearch.serviceSave")}
            </button>
          </div>
        ) : null}
      </div>
    </>
  );
}

function ServiceStatus({
  api,
  libraryId,
  service,
  onChanged,
  onDelete,
}: {
  api: EmbeddingServiceSettingsApi;
  libraryId?: string;
  service: EmbeddingHttpServiceSummary;
  onChanged: () => Promise<unknown>;
  onDelete: () => void;
}): ReactNode {
  const t = useT();
  const granted = service.destination === "loopback" || (libraryId ? service.grantedLibraryIds.includes(libraryId) : false);
  const statusKey = service.textStatus === "verified"
    ? "settings.semanticSearch.serviceVerified"
    : service.textStatus === "failed"
      ? "settings.semanticSearch.serviceFailed"
      : "settings.semanticSearch.serviceUnverified";
  return (
    <div className="app-settings-row-copy">
      <span>{service.modelName}</span>
      <span>{t(statusKey)}</span>
      <span>{service.destination === "loopback" ? t("settings.semanticSearch.serviceLocalNote") : t("settings.semanticSearch.serviceRemoteNote")}</span>
      {service.destination === "lan" ? <span>{t("settings.semanticSearch.serviceLanNote")}</span> : null}
      <span className="app-settings-option-group">
        <button className="app-settings-option" onClick={() => { void api.embeddingProbeService({ id: service.id }).then(onChanged); }} type="button">
          {t("settings.semanticSearch.serviceTest")}
        </button>
        {!granted && libraryId ? (
          <button className="app-settings-option" onClick={() => { void api.embeddingGrantService({ id: service.id, libraryId }).then(onChanged); }} type="button">
            {t("settings.semanticSearch.serviceGrant")}
          </button>
        ) : null}
        <button className="app-settings-option" onClick={onDelete} type="button">
          {t("settings.semanticSearch.serviceDelete")}
        </button>
      </span>
    </div>
  );
}
