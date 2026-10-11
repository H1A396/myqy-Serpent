import { isEmbeddingServiceSelectionId } from "../shared/embedding/http-service";
import { isSemanticSearchModelId, type EmbeddingIndexPhase, type SemanticSearchModelId } from "../shared/embedding/profile";
import type { EmbeddingModality } from "../shared/embedding/modalities";

export type SemanticInstallModel = {
  modelId: SemanticSearchModelId;
  installed: boolean;
};

export type SemanticServiceReady = {
  modalities: readonly EmbeddingModality[];
  textStatus: string;
  dimensions: number | null;
};

/** Toolbar semantic search is available only for a ready library binding that can encode text. */
export function semanticToolbarReady(input: {
  selectionId: string | null;
  runtimeInstalled: boolean;
  models: readonly SemanticInstallModel[];
  service: SemanticServiceReady | null;
}): boolean {
  if (!input.selectionId) return false;
  if (isSemanticSearchModelId(input.selectionId)) {
    return input.runtimeInstalled
      && input.models.some((model) => model.modelId === input.selectionId && model.installed);
  }
  if (!isEmbeddingServiceSelectionId(input.selectionId) || !input.service) return false;
  return input.service.textStatus === "verified"
    && input.service.dimensions != null
    && input.service.modalities.includes("text");
}

/** The jobs affordance stays quiet unless a download or an index is actually running. */
export function semanticBackgroundWorkActive(input: {
  installing: boolean;
  enabled: boolean;
  phase: EmbeddingIndexPhase | null;
}): boolean {
  if (input.installing) return true;
  if (!input.enabled) return false;
  return input.phase === "starting" || input.phase === "indexing";
}
