import { randomUUID } from "node:crypto";
import path from "node:path";

import {
  deleteEmbeddingModel,
  EmbeddingModelCatalogError,
  parseEmbeddingModelCatalog,
  setDefaultEmbeddingModel,
  summarizeEmbeddingModels,
  upsertEmbeddingModel,
  type EmbeddingModelCatalog,
} from "../embedding-model-catalog";
import {
  downloadMissingTierFiles,
  embeddingSearchRoots,
  inspectEmbeddingTree,
  installedSemanticModels,
} from "../embedding-install";
import {
  deleteEmbeddingService,
  EmbeddingServiceRegistryError,
  grantEmbeddingService,
  markEmbeddingServiceProbe,
  parseEmbeddingServiceCatalog,
  saveEmbeddingService,
  summarizeEmbeddingServices,
  type EmbeddingServiceCatalog,
  type EmbeddingServiceCredentialStore,
} from "../embedding-service-registry";
import { probeEmbeddingHttp } from "../embedding-http";
import { EmbeddingHttpIndex } from "../embedding-http-index";
import { isEmbeddingServiceSelectionId } from "../../shared/embedding/http-service";
import { isSemanticSearchModelId, SEMANTIC_SEARCH_MODEL_IDS, type SemanticSearchModelId } from "../../shared/embedding/profile";
import type { EmbeddingTestIndex } from "../embedding-test-index";
import { createPublicError } from "../../shared/protocol/errors";
import type { RendererRequest } from "../../shared/protocol/requests";
import type { RendererResult } from "../../shared/protocol/responses";

export type EmbeddingModelRuntime = {
  readCatalog: () => unknown;
  writeCatalog: (catalog: EmbeddingModelCatalog) => void;
  readServices?: () => unknown;
  writeServices?: (catalog: EmbeddingServiceCatalog) => void;
  serviceCredentials?: EmbeddingServiceCredentialStore;
  userDataPath: () => string;
  homePath: () => string;
  embeddingIndex?: EmbeddingTestIndex;
  embeddingHttpIndex?: EmbeddingHttpIndex;
  stopGemmaIndex?: () => void;
  stopHttpIndex?: () => void;
};

export async function tryHandleEmbeddingModelRequest(
  request: RendererRequest,
  runtime: EmbeddingModelRuntime,
): Promise<RendererResult | undefined> {
  switch (request.type) {
    case "embedding.models.list.request":
      return {
        ok: true,
        type: "embedding.models.listed",
        models: summarizeEmbeddingModels(parseEmbeddingModelCatalog(runtime.readCatalog())),
      };
    case "embedding.models.upsert.request":
      return saveModel(request, runtime);
    case "embedding.models.delete.request":
      return removeModel(request.id, runtime);
    case "embedding.models.set-default.request":
      return chooseDefault(request.id, runtime);
    case "embedding.services.list.request":
      return listServices(runtime);
    case "embedding.services.save.request":
      return saveService(request, runtime);
    case "embedding.services.delete.request":
      return removeService(request.id, runtime);
    case "embedding.services.probe.request":
      return probeService(request.id, runtime);
    case "embedding.services.grant.request":
      return grantService(request.id, request.libraryId, runtime);
    case "embedding.install.status.request":
      return installStatus(runtime);
    case "embedding.install.start.request":
      return installModel(request.modelId, runtime);
    case "embedding.index.status.request":
      if (isEmbeddingServiceSelectionId(request.modelId)) {
        runtime.stopGemmaIndex?.();
        return runtime.embeddingHttpIndex?.handleStatus(request) ?? unavailableIndex();
      }
      runtime.stopHttpIndex?.();
      if (!isSemanticSearchModelId(request.modelId)) return unavailableIndex();
      return runtime.embeddingIndex?.handleStatus({ ...request, modelId: request.modelId }) ?? unavailableIndex();
    case "embedding.search.request":
      if (isEmbeddingServiceSelectionId(request.modelId)) {
        runtime.stopGemmaIndex?.();
        return runtime.embeddingHttpIndex?.handleSearch(request) ?? emptySearch();
      }
      runtime.stopHttpIndex?.();
      if (!isSemanticSearchModelId(request.modelId)) return emptySearch();
      return runtime.embeddingIndex?.handleSearch({ ...request, modelId: request.modelId }) ?? emptySearch();
    case "embedding.similar.request":
      if (isEmbeddingServiceSelectionId(request.modelId)) {
        runtime.stopGemmaIndex?.();
        return runtime.embeddingHttpIndex?.handleSimilar(request) ?? {
          ok: true,
          type: "embedding.similar",
          phase: "unavailable",
          done: 0,
          total: 0,
          failedCount: 0,
          status: "unsupported",
          sourceAssetId: request.assetId,
          assetIds: [],
        };
      }
      runtime.stopHttpIndex?.();
      if (!isSemanticSearchModelId(request.modelId)) {
        return {
          ok: true,
          type: "embedding.similar",
          phase: "unavailable",
          done: 0,
          total: 0,
          failedCount: 0,
          status: "unsupported",
          sourceAssetId: request.assetId,
          assetIds: [],
        };
      }
      return runtime.embeddingIndex?.handleSimilar({ ...request, modelId: request.modelId }) ?? {
        ok: true,
        type: "embedding.similar",
        phase: "unavailable",
        done: 0,
        total: 0,
        failedCount: 0,
        status: "unavailable",
        sourceAssetId: request.assetId,
        assetIds: [],
      };
    default:
      return undefined;
  }
}

function installStatus(runtime: EmbeddingModelRuntime): RendererResult {
  const inspection = inspectEmbeddingTree(embeddingSearchRoots({
    userData: runtime.userDataPath(),
    home: runtime.homePath(),
  }));
  const installed = new Set(installedSemanticModels(new Set(inspection.files.keys())));
  return {
    ok: true,
    type: "embedding.install.status",
    runtimeInstalled: inspection.runtimeFound,
    models: SEMANTIC_SEARCH_MODEL_IDS.map((modelId) => ({
      modelId,
      installed: installed.has(modelId),
    })),
  };
}

async function installModel(modelId: SemanticSearchModelId, runtime: EmbeddingModelRuntime): Promise<RendererResult> {
  const current = installStatus(runtime);
  if (!current.ok || current.type !== "embedding.install.status") return current;
  if (current.models.some((model) => model.modelId === modelId && model.installed)) return current;
  try {
    await downloadMissingTierFiles(
      modelId,
      path.join(runtime.userDataPath(), "embedding-models"),
      new Set(inspectEmbeddingTree(embeddingSearchRoots({
        userData: runtime.userDataPath(),
        home: runtime.homePath(),
      })).files.keys()),
    );
  } catch {
    return { ok: false, error: createPublicError("EMBEDDING_INSTALL_FAILED") };
  }
  return installStatus(runtime);
}

function saveModel(
  request: Extract<RendererRequest, { type: "embedding.models.upsert.request" }>,
  runtime: EmbeddingModelRuntime,
): RendererResult {
  const catalog = parseEmbeddingModelCatalog(runtime.readCatalog());
  try {
    const id = request.id ?? randomUUID();
    const next = upsertEmbeddingModel(catalog, {
      id,
      name: request.name,
      tier: request.tier,
      modelDirectory: request.modelDirectory,
      runtimePath: request.runtimePath,
    });
    runtime.writeCatalog(next);
    return { ok: true, type: "embedding.model.saved", id };
  } catch (error) {
    if (error instanceof EmbeddingModelCatalogError) {
      return { ok: false, error: createPublicError("EMBEDDING_MODEL_INVALID") };
    }
    throw error;
  }
}

function removeModel(id: string, runtime: EmbeddingModelRuntime): RendererResult {
  const catalog = parseEmbeddingModelCatalog(runtime.readCatalog());
  runtime.writeCatalog(deleteEmbeddingModel(catalog, id));
  return { ok: true, type: "embedding.model.deleted", id };
}

function chooseDefault(id: string, runtime: EmbeddingModelRuntime): RendererResult {
  const catalog = parseEmbeddingModelCatalog(runtime.readCatalog());
  try {
    runtime.writeCatalog(setDefaultEmbeddingModel(catalog, id));
    return { ok: true, type: "embedding.model.default-set", id };
  } catch (error) {
    if (error instanceof EmbeddingModelCatalogError) {
      return { ok: false, error: createPublicError("EMBEDDING_MODEL_INVALID") };
    }
    throw error;
  }
}

function unavailableIndex(): RendererResult {
  return {
    ok: true,
    type: "embedding.index.status",
    phase: "unavailable",
    done: 0,
    total: 0,
    failedCount: 0,
  };
}

function emptySearch(): RendererResult {
  return {
    ok: true,
    type: "embedding.search",
    phase: "unavailable",
    done: 0,
    total: 0,
    failedCount: 0,
    assetIds: [],
    scores: [],
  };
}

function listServices(runtime: EmbeddingModelRuntime): RendererResult {
  if (!runtime.readServices || !runtime.serviceCredentials) {
    return { ok: true, type: "embedding.services.listed", services: [] };
  }
  return {
    ok: true,
    type: "embedding.services.listed",
    services: summarizeEmbeddingServices(
      parseEmbeddingServiceCatalog(runtime.readServices()),
      runtime.serviceCredentials,
    ),
  };
}

function saveService(
  request: Extract<RendererRequest, { type: "embedding.services.save.request" }>,
  runtime: EmbeddingModelRuntime,
): RendererResult {
  if (!runtime.readServices || !runtime.writeServices || !runtime.serviceCredentials) {
    return { ok: false, error: createPublicError("EMBEDDING_SERVICE_INVALID") };
  }
  try {
    const next = saveEmbeddingService(
      parseEmbeddingServiceCatalog(runtime.readServices()),
      runtime.serviceCredentials,
      request,
    );
    runtime.writeServices(next);
    const id = request.id ?? next.services.at(-1)?.id;
    if (!id) return { ok: false, error: createPublicError("EMBEDDING_SERVICE_INVALID") };
    return { ok: true, type: "embedding.service.saved", id };
  } catch (error) {
    if (error instanceof EmbeddingServiceRegistryError) {
      return { ok: false, error: createPublicError("EMBEDDING_SERVICE_INVALID") };
    }
    throw error;
  }
}

function removeService(id: string, runtime: EmbeddingModelRuntime): RendererResult {
  if (!runtime.readServices || !runtime.writeServices || !runtime.serviceCredentials) {
    return { ok: false, error: createPublicError("EMBEDDING_SERVICE_INVALID") };
  }
  runtime.writeServices(deleteEmbeddingService(
    parseEmbeddingServiceCatalog(runtime.readServices()),
    runtime.serviceCredentials,
    id,
  ));
  return { ok: true, type: "embedding.service.deleted", id };
}

async function probeService(id: string, runtime: EmbeddingModelRuntime): Promise<RendererResult> {
  if (!runtime.readServices || !runtime.writeServices || !runtime.serviceCredentials) {
    return { ok: false, error: createPublicError("EMBEDDING_SERVICE_INVALID") };
  }
  const catalog = parseEmbeddingServiceCatalog(runtime.readServices());
  const service = catalog.services.find((entry) => entry.id === id);
  if (!service) return { ok: false, error: createPublicError("EMBEDDING_SERVICE_INVALID") };
  try {
    const probed = await probeEmbeddingHttp({
      baseUrl: service.baseUrl,
      modelName: service.modelName,
      apiKey: runtime.serviceCredentials.read(id),
    });
    runtime.writeServices(markEmbeddingServiceProbe(catalog, id, { ok: true, dimensions: probed.dimensions }));
    return { ok: true, type: "embedding.service.probed", id, textStatus: "verified", dimensions: probed.dimensions };
  } catch {
    runtime.writeServices(markEmbeddingServiceProbe(catalog, id, { ok: false }));
    return { ok: true, type: "embedding.service.probed", id, textStatus: "failed", dimensions: null };
  }
}

function grantService(id: string, libraryId: string, runtime: EmbeddingModelRuntime): RendererResult {
  if (!runtime.readServices || !runtime.writeServices) {
    return { ok: false, error: createPublicError("EMBEDDING_SERVICE_INVALID") };
  }
  try {
    runtime.writeServices(grantEmbeddingService(
      parseEmbeddingServiceCatalog(runtime.readServices()),
      id,
      libraryId,
    ));
    return { ok: true, type: "embedding.service.granted", id };
  } catch (error) {
    if (error instanceof EmbeddingServiceRegistryError) {
      return { ok: false, error: createPublicError("EMBEDDING_SERVICE_INVALID") };
    }
    throw error;
  }
}
