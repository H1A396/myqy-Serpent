/**
 * Modalities an embedding model claims it can encode.
 * A claim is not proof the current adapter can use that channel.
 */

export const EMBEDDING_MODALITIES = ["image", "video", "audio", "text"] as const;
export type EmbeddingModality = (typeof EMBEDDING_MODALITIES)[number];

/** Local EmbeddingGemma presets encode stills, thumbnail video, audio, and text. */
export const LOCAL_GEMMA_MODALITIES: readonly EmbeddingModality[] = ["image", "video", "audio", "text"];

export function isEmbeddingModality(value: string): value is EmbeddingModality {
  return (EMBEDDING_MODALITIES as readonly string[]).includes(value);
}

/** Older custom services only sent text. Missing flags keep that behavior. */
export function normalizeEmbeddingModalities(value: unknown): EmbeddingModality[] {
  return collectEmbeddingModalities(value) ?? ["text"];
}

/** A saved form must check at least one known modality. An empty list is invalid. */
export function explicitEmbeddingModalities(value: readonly string[]): EmbeddingModality[] | null {
  return collectEmbeddingModalities(value);
}

function collectEmbeddingModalities(value: unknown): EmbeddingModality[] | null {
  if (!Array.isArray(value)) return null;
  const seen = new Set<EmbeddingModality>();
  for (const entry of value) {
    if (typeof entry === "string" && isEmbeddingModality(entry)) seen.add(entry);
  }
  return seen.size > 0 ? EMBEDDING_MODALITIES.filter((modality) => seen.has(modality)) : null;
}

/** Video, audio, and text stay themselves. Other readable assets use a picture. */
export function modalityForMediaType(mediaType: string): EmbeddingModality {
  if (mediaType === "video" || mediaType === "audio" || mediaType === "text") return mediaType;
  return "image";
}

export type SimilarMenuBlock = "service" | "modality";

/**
 * Find-similar needs a declared modality the current adapter actually indexes.
 * Text-only HTTP services cannot encode pictures; multimodal HTTP (image/video
 * declared) ranks from the shared index once the source vector exists.
 */
export function similarMenuBlock(input: {
  mediaType: string;
  implementation: "gemma" | "http";
  declared: readonly EmbeddingModality[];
  /** Reserved: local dual-index fallback is not active while an HTTP service is bound. */
  localSimilarReady?: boolean;
}): SimilarMenuBlock | null {
  const modality = modalityForMediaType(input.mediaType);
  if (!input.declared.includes(modality)) return "modality";
  if (input.implementation === "http") {
    // OpenAI-compatible indexes text only. DashScope may declare image/video.
    const httpCanVisual = input.declared.includes("image") || input.declared.includes("video");
    if (modality !== "text" && !httpCanVisual) return "service";
    return null;
  }
  return null;
}

/** Custom HTTP services that only declare text use text-oriented index copy. */
export function embeddingServiceTextOnly(modalities: readonly EmbeddingModality[] | null | undefined): boolean {
  if (!modalities || modalities.length === 0) return true;
  return !modalities.some((modality) => modality === "image" || modality === "video");
}
