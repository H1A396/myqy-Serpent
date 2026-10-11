import { randomUUID } from "node:crypto";

import {
  embeddingHttpProfileKey,
  normalizeEmbeddingServiceUrl,
  validateEmbeddingServiceDraft,
  type EmbeddingServiceDestination,
  type EmbeddingTextStatus,
} from "../shared/embedding/http-service";

export type EmbeddingServiceRecord = {
  id: string;
  name: string;
  destination: EmbeddingServiceDestination;
  baseUrl: string;
  modelName: string;
  textStatus: EmbeddingTextStatus;
  dimensions: number | null;
  grantedLibraryIds: string[];
};

export type EmbeddingServiceCatalog = {
  version: 1;
  services: EmbeddingServiceRecord[];
};

export type EmbeddingServiceSummary = EmbeddingServiceRecord & {
  hasCredential: boolean;
  profileKey: string | null;
};

export type EmbeddingServiceCredentialStore = {
  has(id: string): boolean;
  read(id: string): string | null;
  write(id: string, apiKey: string): void;
  delete(id: string): void;
};

const SERVICE_ID = /^svc_[a-z0-9]{8,40}$/;
const LIBRARY_LIMIT = 100;

export function emptyEmbeddingServiceCatalog(): EmbeddingServiceCatalog {
  return { version: 1, services: [] };
}

export function createEmbeddingServiceId(): string {
  return `svc_${randomUUID().replaceAll("-", "").slice(0, 20)}`;
}

export function parseEmbeddingServiceCatalog(input: unknown): EmbeddingServiceCatalog {
  if (!input || typeof input !== "object") return emptyEmbeddingServiceCatalog();
  const services = (input as { services?: unknown }).services;
  if (!Array.isArray(services)) return emptyEmbeddingServiceCatalog();
  return {
    version: 1,
    services: services.filter(isServiceRecord),
  };
}

export function summarizeEmbeddingServices(
  catalog: EmbeddingServiceCatalog,
  credentials: Pick<EmbeddingServiceCredentialStore, "has">,
): EmbeddingServiceSummary[] {
  return catalog.services.map((service) => ({
    ...service,
    grantedLibraryIds: [...service.grantedLibraryIds],
    hasCredential: credentials.has(service.id),
    profileKey: service.textStatus === "verified" && service.dimensions
      ? embeddingHttpProfileKey({
        baseUrl: service.baseUrl,
        modelName: service.modelName,
        dimensions: service.dimensions,
      })
      : null,
  }));
}

export function saveEmbeddingService(
  catalog: EmbeddingServiceCatalog,
  credentials: EmbeddingServiceCredentialStore,
  input: {
    id?: string;
    name: string;
    destination: EmbeddingServiceDestination;
    baseUrl: string;
    modelName: string;
    apiKey?: string;
  },
): EmbeddingServiceCatalog {
  const issue = validateEmbeddingServiceDraft(input);
  const url = normalizeEmbeddingServiceUrl(input.baseUrl);
  if (issue || !url) throw new EmbeddingServiceRegistryError("invalid");
  const id = input.id ?? createEmbeddingServiceId();
  if (!SERVICE_ID.test(id)) throw new EmbeddingServiceRegistryError("invalid");
  const existing = catalog.services.find((service) => service.id === id);
  const sameTarget = existing
    && existing.baseUrl === url.baseUrl
    && existing.modelName === input.modelName.trim()
    && existing.destination === input.destination;
  const next: EmbeddingServiceRecord = {
    id,
    name: input.name.trim(),
    destination: input.destination,
    baseUrl: url.baseUrl,
    modelName: input.modelName.trim(),
    textStatus: sameTarget ? existing.textStatus : "declared",
    dimensions: sameTarget ? existing.dimensions : null,
    grantedLibraryIds: sameTarget ? [...existing.grantedLibraryIds] : [],
  };
  if (input.apiKey !== undefined) {
    const key = input.apiKey.trim();
    if (key) credentials.write(id, key);
    else credentials.delete(id);
  }
  const services = existing
    ? catalog.services.map((service) => (service.id === id ? next : service))
    : [...catalog.services, next];
  return { version: 1, services };
}

export function deleteEmbeddingService(
  catalog: EmbeddingServiceCatalog,
  credentials: EmbeddingServiceCredentialStore,
  id: string,
): EmbeddingServiceCatalog {
  credentials.delete(id);
  return { version: 1, services: catalog.services.filter((service) => service.id !== id) };
}

export function grantEmbeddingService(
  catalog: EmbeddingServiceCatalog,
  id: string,
  libraryId: string,
): EmbeddingServiceCatalog {
  if (!libraryId || libraryId.length > 255) throw new EmbeddingServiceRegistryError("invalid");
  const existing = catalog.services.find((service) => service.id === id);
  if (!existing) throw new EmbeddingServiceRegistryError("missing");
  if (existing.grantedLibraryIds.includes(libraryId)) return catalog;
  if (existing.grantedLibraryIds.length >= LIBRARY_LIMIT) throw new EmbeddingServiceRegistryError("invalid");
  return {
    version: 1,
    services: catalog.services.map((service) => (
      service.id === id
        ? { ...service, grantedLibraryIds: [...service.grantedLibraryIds, libraryId] }
        : service
    )),
  };
}

export function markEmbeddingServiceProbe(
  catalog: EmbeddingServiceCatalog,
  id: string,
  result: { ok: true; dimensions: number } | { ok: false },
): EmbeddingServiceCatalog {
  return {
    version: 1,
    services: catalog.services.map((service) => {
      if (service.id !== id) return service;
      if (!result.ok) return { ...service, textStatus: "failed", dimensions: null };
      return { ...service, textStatus: "verified", dimensions: result.dimensions };
    }),
  };
}

export class EmbeddingServiceRegistryError extends Error {
  readonly code: "invalid" | "missing";

  constructor(code: EmbeddingServiceRegistryError["code"]) {
    super(code);
    this.name = "EmbeddingServiceRegistryError";
    this.code = code;
  }
}

function isServiceRecord(value: unknown): value is EmbeddingServiceRecord {
  if (!value || typeof value !== "object") return false;
  const record = value as Partial<EmbeddingServiceRecord>;
  return typeof record.id === "string"
    && SERVICE_ID.test(record.id)
    && typeof record.name === "string"
    && (record.destination === "loopback" || record.destination === "lan" || record.destination === "internet")
    && typeof record.baseUrl === "string"
    && typeof record.modelName === "string"
    && (record.textStatus === "unsupported" || record.textStatus === "declared" || record.textStatus === "verified" || record.textStatus === "failed")
    && (record.dimensions === null || (typeof record.dimensions === "number" && Number.isInteger(record.dimensions) && record.dimensions > 0))
    && Array.isArray(record.grantedLibraryIds)
    && record.grantedLibraryIds.every((id) => typeof id === "string");
}
