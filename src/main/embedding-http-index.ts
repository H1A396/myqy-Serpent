import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";

import { readEmbeddingDocument } from "./embedding-text";
import { postEmbeddingHttp } from "./embedding-http";
import {
  embeddingSkipKey,
  embeddingTargetsToEncode,
  resolveContainedPath,
  scoreEmbeddings,
} from "./embedding-test-index";
import {
  embeddingHttpProfileKey,
  type EmbeddingServiceDestination,
  type EmbeddingTextStatus,
} from "../shared/embedding/http-service";
import {
  embeddingSourcePlan,
  embeddingTextRevision,
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

export type EmbeddingHttpServiceView = {
  id: string;
  destination: EmbeddingServiceDestination;
  baseUrl: string;
  modelName: string;
  textStatus: EmbeddingTextStatus;
  dimensions: number | null;
  grantedLibraryIds: readonly string[];
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
    if (!service || service.textStatus !== "verified" || !service.dimensions) {
      this.#write(generation, { phase: "unavailable" });
      return { ok: true, type: "embedding.search", ...this.#snapshot(), assetIds: [], scores: [] };
    }
    if (!this.#allowed(service, request.libraryId)) {
      this.#write(generation, { phase: "unavailable", hold: "grant" });
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
        inputs: [request.query],
        apiKey: this.options.readKey(service.id),
      });
      if (!vector || this.#state?.generation !== generation) {
        return { ok: true, type: "embedding.search", ...this.#snapshot(), assetIds: [], scores: [] };
      }
      const scores = scoreEmbeddings(normalizeEmbedding(vector, service.dimensions), [...state.entries.values()]);
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
    return {
      ok: true,
      type: "embedding.similar",
      ...this.#snapshot(),
      status: "unsupported",
      sourceAssetId: request.assetId,
      assetIds: [],
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
    if (!service || service.textStatus !== "verified" || !service.dimensions) {
      this.#write(generation, { phase: "unavailable", hold: undefined });
      return;
    }
    if (!this.#allowed(service, libraryId)) {
      this.#write(generation, { phase: "unavailable", hold: "grant" });
      return;
    }
    this.#running = true;
    try {
      const targets = await this.#listText(libraryId);
      if (this.#state?.generation !== generation) return;
      const profileKey = embeddingHttpProfileKey({
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
          const document = await readEmbeddingDocument(target.filePath, path.basename(target.filePath));
          const [vector] = await postEmbeddingHttp({
            baseUrl: service.baseUrl,
            modelName: service.modelName,
            inputs: [document],
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

  #allowed(service: EmbeddingHttpServiceView, libraryId: string): boolean {
    return service.destination === "loopback" || service.grantedLibraryIds.includes(libraryId);
  }

  async #listText(libraryId: string): Promise<Array<{ assetId: string; revisionId: string; filePath: string }>> {
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
    const targets: Array<{ assetId: string; revisionId: string; filePath: string }> = [];
    for (const asset of assets.assets) {
      if (embeddingSourcePlan(asset) !== "text") continue;
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
      });
    }
    return targets;
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
