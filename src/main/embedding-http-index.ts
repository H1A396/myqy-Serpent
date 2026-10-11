import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";

import { readEmbeddingDocument } from "./embedding-text";
import { EMBEDDING_HTTP_IMAGE_MAX_BYTES, postEmbeddingHttp } from "./embedding-http";
import { DASHSCOPE_VISUAL_SEARCH_INSTRUCT } from "../shared/embedding/http-service";
import {
  embeddingSkipKey,
  embeddingTargetsToEncode,
  resolveContainedPath,
  rankSimilarAssetIds,
  scoreEmbeddings,
} from "./embedding-test-index";
import {
  embeddingHttpProfileKey,
  type EmbeddingHttpAdapter,
  type EmbeddingHttpContent,
  type EmbeddingServiceDestination,
  type EmbeddingTextStatus,
} from "../shared/embedding/http-service";
import {
  modalityForMediaType,
  type EmbeddingModality,
} from "../shared/embedding/modalities";
import {
  embeddingSourcePlan,
  embeddingTextRevision,
  embeddingThumbnailRevision,
  normalizeEmbedding,
  type EmbeddingIndexSnapshot,
} from "../shared/embedding/profile";
import type { WorkerCommand } from "../shared/protocol/requests";
import type { RendererResult, WorkerResult } from "../shared/protocol/responses";

type StoredEntry = { assetId: string; revisionId: string; vector: number[] };
type JobState = EmbeddingIndexSnapshot & {
  generation: number;
  libraryId: string;
  serviceId: string;
  entries: Map<string, StoredEntry>;
};

type HttpEmbeddingTarget = {
  assetId: string;
  revisionId: string;
  filePath: string;
  kind: "text" | "image";
};

const THUMBNAIL_EXTENSIONS = new Set([".jpg", ".jpeg", ".png", ".webp"]);
const IMAGE_MIME_TYPES = new Map([
  [".jpg", "image/jpeg"],
  [".jpeg", "image/jpeg"],
  [".png", "image/png"],
  [".webp", "image/webp"],
  [".bmp", "image/bmp"],
]);

export type EmbeddingHttpServiceView = {
  id: string;
  adapter: EmbeddingHttpAdapter;
  destination: EmbeddingServiceDestination;
  baseUrl: string;
  modelName: string;
  textStatus: EmbeddingTextStatus;
  dimensions: number | null;
  grantedLibraryIds: readonly string[];
  modalities: readonly EmbeddingModality[];
};

export class EmbeddingHttpIndex {
  #generation = 0;
  #state: JobState | null = null;
  #skipped = new Set<string>();
  #running = false;

  constructor(private readonly options: {
    cacheDirectory: string;
    requestWorker: (command: WorkerCommand) => Promise<WorkerResult>;
    loadService: (id: string) => EmbeddingHttpServiceView | null;
    readKey: (id: string) => string | null;
  }) {}

  close(): void {
    this.#generation += 1;
    this.#state = null;
    this.#skipped.clear();
  }

  catchUp(libraryId: string): void {
    const state = this.#state;
    if (!state || state.libraryId !== libraryId || state.phase !== "ready") return;
    void this.#encode(state.generation, state.libraryId, state.serviceId);
  }

  handleStatus(request: {
    libraryId: string;
    modelId: string;
    run: boolean;
  }): RendererResult {
    if (request.run) {
      const current = this.#state;
      const active = current
        && current.libraryId === request.libraryId
        && current.serviceId === request.modelId
        && (current.phase === "starting" || current.phase === "indexing" || current.phase === "ready");
      if (!active) void this.#encode(this.#begin(request.libraryId, request.modelId), request.libraryId, request.modelId);
    }
    return { ok: true, type: "embedding.index.status", ...this.#snapshot() };
  }

  async handleSearch(request: {
    libraryId: string;
    modelId: string;
    query: string;
  }): Promise<RendererResult> {
    const generation = this.#begin(request.libraryId, request.modelId);
    void this.#encode(generation, request.libraryId, request.modelId);
    const snapshot = this.#snapshot();
    const service = this.options.loadService(request.modelId);
    if (!httpServiceReady(service)) {
      this.#write(generation, { phase: "unavailable" });
      return { ok: true, type: "embedding.search", ...this.#snapshot(), assetIds: [], scores: [] };
    }
    const state = this.#state;
    if (!state || state.entries.size === 0) {
      return { ok: true, type: "embedding.search", ...snapshot, assetIds: [], scores: [] };
    }
    try {
      const [vector] = await postEmbeddingHttp({
        baseUrl: service.baseUrl,
        modelName: service.modelName,
        adapter: service.adapter,
        dimensions: service.dimensions,
        inputs: [request.query],
        apiKey: this.options.readKey(service.id),
        instruct: service.adapter === "dashscope-multimodal-v1"
          ? DASHSCOPE_VISUAL_SEARCH_INSTRUCT
          : null,
      });
      if (!vector || this.#state?.generation !== generation) {
        return { ok: true, type: "embedding.search", ...this.#snapshot(), assetIds: [], scores: [] };
      }
      const scores = scoreEmbeddings(
        normalizeEmbedding(vector, service.dimensions),
        [...state.entries.values()],
      );
      return {
        ok: true,
        type: "embedding.search",
        ...this.#snapshot(),
        assetIds: scores.map(({ assetId }) => assetId),
        scores,
      };
    } catch {
      return { ok: true, type: "embedding.search", ...snapshot, assetIds: [], scores: [] };
    }
  }

  handleSimilar(request: { libraryId: string; modelId: string; assetId: string }): RendererResult {
    const state = this.#state;
    const snapshot = this.#snapshot();
    if (
      !state
      || state.libraryId !== request.libraryId
      || state.serviceId !== request.modelId
      || state.phase === "unavailable"
      || state.phase === "failed"
    ) {
      return {
        ok: true,
        type: "embedding.similar",
        ...snapshot,
        status: "unavailable",
        sourceAssetId: request.assetId,
        assetIds: [],
      };
    }
    const skipped = [...this.#skipped].some((key) => key.startsWith(`${request.assetId}\0`));
    if (!state.entries.has(request.assetId)) {
      if (state.phase === "ready" || skipped) {
        return {
          ok: true,
          type: "embedding.similar",
          ...snapshot,
          status: "unsupported",
          sourceAssetId: request.assetId,
          assetIds: [],
        };
      }
      void this.#encode(state.generation, state.libraryId, state.serviceId);
      return {
        ok: true,
        type: "embedding.similar",
        ...snapshot,
        status: "preparing",
        sourceAssetId: request.assetId,
        assetIds: [],
      };
    }
    return {
      ok: true,
      type: "embedding.similar",
      ...snapshot,
      status: "ready",
      sourceAssetId: request.assetId,
      assetIds: rankSimilarAssetIds(request.assetId, [...state.entries.values()]),
    };
  }

  #begin(libraryId: string, serviceId: string): number {
    const current = this.#state;
    if (current && current.libraryId === libraryId && current.serviceId === serviceId) return current.generation;
    this.#generation += 1;
    this.#skipped.clear();
    this.#state = {
      phase: "starting",
      done: 0,
      total: 0,
      failedCount: 0,
      generation: this.#generation,
      libraryId,
      serviceId,
      entries: new Map(),
    };
    return this.#generation;
  }

  async #encode(generation: number, libraryId: string, serviceId: string): Promise<void> {
    if (this.#running) return;
    const service = this.options.loadService(serviceId);
    if (!httpServiceReady(service)) {
      this.#write(generation, { phase: "unavailable", hold: undefined });
      return;
    }
    this.#running = true;
    try {
      const targets = await this.#listTargets(libraryId, service);
      if (this.#state?.generation !== generation) return;
      const profileKey = embeddingHttpProfileKey({
        adapter: service.adapter,
        baseUrl: service.baseUrl,
        modelName: service.modelName,
        dimensions: service.dimensions,
      });
      const cached = this.#readCache(libraryId, serviceId, profileKey);
      const entries = new Map<string, StoredEntry>();
      for (const target of targets) {
        const stored = cached.get(target.assetId);
        if (stored?.revisionId === target.revisionId) entries.set(target.assetId, stored);
      }
      const pending = embeddingTargetsToEncode(targets, entries, this.#skipped);
      this.#write(generation, {
        entries,
        done: entries.size,
        total: targets.length,
        phase: pending.length > 0 ? "indexing" : "ready",
        hold: undefined,
      });
      for (const target of pending) {
        if (this.#state?.generation !== generation) return;
        try {
          const inputs = await this.#buildInputs(target);
          const [vector] = await postEmbeddingHttp({
            baseUrl: service.baseUrl,
            modelName: service.modelName,
            adapter: service.adapter,
            dimensions: service.dimensions,
            inputs,
            apiKey: this.options.readKey(service.id),
          });
          if (!vector || this.#state?.generation !== generation) return;
          entries.set(target.assetId, {
            assetId: target.assetId,
            revisionId: target.revisionId,
            vector: normalizeEmbedding(vector, service.dimensions),
          });
          this.#write(generation, { entries, done: entries.size });
          this.#writeCache(libraryId, serviceId, profileKey, entries);
        } catch {
          if (this.#state?.generation !== generation) return;
          this.#skipped.add(embeddingSkipKey(target.assetId, target.revisionId));
          this.#write(generation, { failedCount: (this.#state?.failedCount ?? 0) + 1 });
        }
      }
      if (this.#state?.generation === generation) this.#write(generation, { phase: "ready" });
    } finally {
      this.#running = false;
    }
  }

  async #buildInputs(target: HttpEmbeddingTarget): Promise<EmbeddingHttpContent[] | string[]> {
    if (target.kind === "text") {
      const document = await readEmbeddingDocument(target.filePath, path.basename(target.filePath));
      return [document];
    }
    return [{ image: readImageDataUri(target.filePath) }];
  }

  /**
   * List assets the service can encode. OpenAI-compatible stays text-only.
   * DashScope multimodal indexes text plus image/video when those modalities
   * are declared; local video uses a ready thumbnail (API needs a public URL).
   */
  async #listTargets(
    libraryId: string,
    service: EmbeddingHttpServiceView & { dimensions: number },
  ): Promise<HttpEmbeddingTarget[]> {
    const listed = await this.options.requestWorker({ type: "library.list" });
    if (!listed.ok || listed.type !== "library.list") return [];
    const library = listed.libraries.find((entry) => entry.libraryId === libraryId);
    if (!library) return [];
    const assets = await this.options.requestWorker({ type: "asset.list", libraryId, recursive: true });
    if (!assets.ok || assets.type !== "asset.list") return [];
    const linked = await this.options.requestWorker({ type: "linked-folder.list", libraryId });
    const roots = new Map<string, string>();
    if (linked.ok && linked.type === "linked-folder.list") {
      for (const folder of linked.folders) {
        const id = folder.linkedFolderId ?? folder.folderId;
        if (folder.relativePath === "" || !roots.has(id)) roots.set(id, folder.absoluteRootPath);
      }
    }

    const encodeModalities = encodeModalitiesForAdapter(service.adapter, service.modalities);
    const targets: HttpEmbeddingTarget[] = [];
    const thumbnailIds: string[] = [];
    const thumbnailTargets: Array<{ assetId: string; revisionId: string; artifactId: string }> = [];

    for (const asset of assets.assets) {
      const modality = modalityForMediaType(asset.mediaType);
      if (!encodeModalities.has(modality)) continue;
      const plan = embeddingSourcePlan(asset);
      if (plan === "text") {
        const root = asset.locationKind === "managed"
          ? path.join(library.libraryPath, "Assets")
          : asset.linkedFolderId ? roots.get(asset.linkedFolderId) : undefined;
        if (!root) continue;
        const filePath = resolveContainedPath(root, asset.relativeFilePath);
        if (!filePath || !existsSync(filePath)) continue;
        targets.push({
          assetId: asset.assetId,
          revisionId: embeddingTextRevision(asset.currentRevisionId),
          filePath,
          kind: "text",
        });
        continue;
      }
      if (plan === "file") {
        const root = asset.locationKind === "managed"
          ? path.join(library.libraryPath, "Assets")
          : asset.linkedFolderId ? roots.get(asset.linkedFolderId) : undefined;
        if (!root) continue;
        const filePath = resolveContainedPath(root, asset.relativeFilePath);
        if (!filePath || !existsSync(filePath)) continue;
        targets.push({
          assetId: asset.assetId,
          revisionId: asset.currentRevisionId,
          filePath,
          kind: "image",
        });
        continue;
      }
      if (plan === "thumbnail" && asset.thumbnailArtifactId) {
        thumbnailIds.push(asset.thumbnailArtifactId);
        thumbnailTargets.push({
          assetId: asset.assetId,
          revisionId: embeddingThumbnailRevision(asset.currentRevisionId, asset.thumbnailArtifactId),
          artifactId: asset.thumbnailArtifactId,
        });
      }
    }

    const thumbnailPaths = await this.#thumbnailPaths(libraryId, thumbnailIds);
    for (const target of thumbnailTargets) {
      const filePath = thumbnailPaths.get(target.artifactId);
      if (!filePath) continue;
      const extension = path.extname(filePath).toLowerCase();
      if (!THUMBNAIL_EXTENSIONS.has(extension) || !existsSync(filePath)) continue;
      targets.push({
        assetId: target.assetId,
        revisionId: target.revisionId,
        filePath,
        kind: "image",
      });
    }
    return targets;
  }

  async #thumbnailPaths(libraryId: string, artifactIds: readonly string[]): Promise<Map<string, string>> {
    const paths = new Map<string, string>();
    const unique = [...new Set(artifactIds)];
    for (let index = 0; index < unique.length; index += 500) {
      const artifactChunk = unique.slice(index, index + 500);
      if (artifactChunk.length === 0) continue;
      const result = await this.options.requestWorker({
        type: "media.get-artifact-paths",
        libraryId,
        artifactIds: artifactChunk,
        usage: "preview",
      });
      if (!result.ok || result.type !== "media.artifact-paths") continue;
      for (const entry of result.entries) paths.set(entry.artifactId, entry.absolutePath);
    }
    return paths;
  }

  #snapshot(): EmbeddingIndexSnapshot {
    if (!this.#state) return { phase: "unavailable", done: 0, total: 0, failedCount: 0 };
    return {
      phase: this.#state.phase,
      done: this.#state.done,
      total: this.#state.total,
      failedCount: this.#state.failedCount,
      ...(this.#state.hold ? { hold: this.#state.hold } : {}),
    };
  }

  #write(generation: number, patch: Partial<JobState>): void {
    if (!this.#state || this.#state.generation !== generation) return;
    this.#state = { ...this.#state, ...patch };
  }

  #cachePath(libraryId: string, serviceId: string): string {
    if (!/^[A-Za-z0-9_-]+$/.test(libraryId) || !/^svc_[a-z0-9]{8,40}$/.test(serviceId)) {
      throw new Error("Unsafe embedding cache name.");
    }
    return path.join(this.options.cacheDirectory, libraryId, `${serviceId}.json`);
  }

  #readCache(libraryId: string, serviceId: string, profileKey: string): Map<string, StoredEntry> {
    const entries = new Map<string, StoredEntry>();
    try {
      const parsed = JSON.parse(readFileSync(this.#cachePath(libraryId, serviceId), "utf8")) as {
        profileKey?: unknown;
        entries?: unknown;
      };
      if (parsed.profileKey !== profileKey || !Array.isArray(parsed.entries)) return entries;
      for (const entry of parsed.entries) {
        if (!entry || typeof entry !== "object") continue;
        const row = entry as Partial<StoredEntry>;
        if (typeof row.assetId !== "string" || typeof row.revisionId !== "string" || !Array.isArray(row.vector)) continue;
        if (row.vector.some((value) => typeof value !== "number" || !Number.isFinite(value))) continue;
        entries.set(row.assetId, { assetId: row.assetId, revisionId: row.revisionId, vector: row.vector });
      }
    } catch {
      return entries;
    }
    return entries;
  }

  #writeCache(
    libraryId: string,
    serviceId: string,
    profileKey: string,
    entries: ReadonlyMap<string, StoredEntry>,
  ): void {
    const filePath = this.#cachePath(libraryId, serviceId);
    mkdirSync(path.dirname(filePath), { recursive: true });
    const temporary = `${filePath}.partial`;
    writeFileSync(temporary, JSON.stringify({ version: 1, profileKey, entries: [...entries.values()] }));
    try {
      rmSync(filePath, { force: true });
      renameSync(temporary, filePath);
    } catch {
      rmSync(temporary, { force: true });
    }
  }
}

function httpServiceReady(
  service: EmbeddingHttpServiceView | null,
): service is EmbeddingHttpServiceView & { dimensions: number } {
  return Boolean(
    service
    && service.textStatus === "verified"
    && service.dimensions
    && service.modalities.includes("text"),
  );
}

/** Multimodal adapters can encode images and the existing video thumbnails. */
export function encodeModalitiesForAdapter(
  adapter: EmbeddingHttpAdapter,
  modalities: readonly EmbeddingModality[],
): Set<EmbeddingModality> {
  const allowed = new Set<EmbeddingModality>();
  for (const modality of modalities) {
    if (modality === "text") allowed.add("text");
    if (adapter !== "openai-embeddings-v1" && (modality === "image" || modality === "video")) {
      allowed.add(modality);
    }
  }
  return allowed;
}

function readImageDataUri(filePath: string): string {
  const extension = path.extname(filePath).toLowerCase();
  const mimeType = IMAGE_MIME_TYPES.get(extension);
  if (!mimeType) throw new Error("Image format is not supported.");
  const bytes = readFileSync(filePath);
  if (bytes.byteLength <= 0 || bytes.byteLength > EMBEDDING_HTTP_IMAGE_MAX_BYTES) {
    throw new Error("Image is too large to embed.");
  }
  return `data:${mimeType};base64,${bytes.toString("base64")}`;
}
