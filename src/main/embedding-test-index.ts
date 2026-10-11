import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";

import {
  EMBEDDING_AUDIO_MAX_WINDOWS,
  EMBEDDING_GEMMA2_DIMENSIONS,
  EMBEDDING_GEMMA2_TIER_FILES,
  SEMANTIC_SEARCH_MODELS,
  embeddingAudioRevision,
  embeddingProfileKey,
  embeddingSourcePlan,
  embeddingTextRevision,
  embeddingThumbnailRevision,
  formatEmbeddingSearchQuery,
  meanPoolEmbeddings,
  normalizeEmbedding,
  type EmbeddingIndexSnapshot,
  type SemanticSearchModelId,
} from "../shared/embedding/profile";
import type { WorkerCommand } from "../shared/protocol/requests";
import type { RendererResult, WorkerResult } from "../shared/protocol/responses";
import {
  localEmbeddingFilesReady,
  readLocalEmbeddingTestConfig,
  type LocalEmbeddingTestConfig,
} from "./embedding-local-config";
import {
  discardPreparedEmbeddingAudio,
  renderEmbeddingAudioWindows,
} from "./embedding-audio";
import { readEmbeddingDocument } from "./embedding-text";
import { startLlamaEmbeddingSession, type LlamaEmbeddingSession } from "./embedding-llama-session";

type StoredEntry = {
  assetId: string;
  revisionId: string;
  vector: number[];
};

type JobState = EmbeddingIndexSnapshot & {
  generation: number;
  libraryId: string;
  modelId: SemanticSearchModelId;
  entries: Map<string, StoredEntry>;
};

const THUMBNAIL_EXTENSIONS = new Set([".jpg", ".jpeg", ".png", ".webp"]);

type EmbeddingTarget = {
  assetId: string;
  revisionId: string;
  filePath: string;
  kind: "image" | "audio" | "text";
};
const CATCH_UP_DELAY_MS = 500;

export function embeddingSkipKey(assetId: string, revisionId: string): string {
  return `${assetId}\u0000${revisionId}`;
}

/** Images that still need a vector. Same revision already stored, or already failed, is left alone. */
export function embeddingTargetsToEncode<T extends { assetId: string; revisionId: string }>(
  targets: readonly T[],
  encoded: ReadonlyMap<string, { revisionId: string }>,
  skipped: ReadonlySet<string>,
): T[] {
  return targets.filter((target) => {
    if (encoded.get(target.assetId)?.revisionId === target.revisionId) return false;
    return !skipped.has(embeddingSkipKey(target.assetId, target.revisionId));
  });
}

export type ScoredEmbedding = { assetId: string; score: number };

function compareScoredEmbeddings(left: ScoredEmbedding, right: ScoredEmbedding): number {
  return right.score - left.score || (
    left.assetId < right.assetId ? -1 : left.assetId > right.assetId ? 1 : 0
  );
}

/** Exact cosine ranking for the already L2-normalized query and corpus vectors. */
export function scoreEmbeddings(
  query: readonly number[],
  entries: readonly { assetId: string; vector: readonly number[]; revisionId?: string }[],
): ScoredEmbedding[] {
  const scored = entries.map((entry) => {
    let score = 0;
    const length = Math.min(query.length, entry.vector.length);
    for (let index = 0; index < length; index += 1) {
      score += (query[index] ?? 0) * (entry.vector[index] ?? 0);
    }
    return { assetId: entry.assetId, score };
  });
  scored.sort(compareScoredEmbeddings);
  return scored;
}

export function rankEmbeddings(
  query: readonly number[],
  entries: readonly { assetId: string; vector: readonly number[] }[],
  limit: number,
): string[] {
  return scoreEmbeddings(query, entries)
    .slice(0, Math.max(0, limit))
    .map((entry) => entry.assetId);
}

/** Same-space image similarity. The source asset is not a result. */
export function rankSimilarAssetIds(
  sourceAssetId: string,
  entries: readonly { assetId: string; vector: readonly number[] }[],
): string[] {
  const source = entries.find((entry) => entry.assetId === sourceAssetId);
  if (!source) return [];
  return rankEmbeddings(
    source.vector,
    entries.filter((entry) => entry.assetId !== sourceAssetId),
    entries.length,
  );
}

/** Pull a requested asset ahead of the remaining encode queue. */
export function takeNextEmbeddingTarget<T extends { assetId: string }>(
  pending: readonly T[],
  priorityAssetId: string | null,
): { target: T; rest: readonly T[] } | null {
  if (pending.length === 0) return null;
  const priorityIndex = priorityAssetId === null
    ? -1
    : pending.findIndex((target) => target.assetId === priorityAssetId);
  const index = priorityIndex >= 0 ? priorityIndex : 0;
  const target = pending[index];
  if (!target) return null;
  return {
    target,
    rest: [...pending.slice(0, index), ...pending.slice(index + 1)],
  };
}

export function resolveContainedPath(root: string, relativePath: string): string | null {
  if (!relativePath || relativePath.includes("\\") || relativePath.startsWith("/")) return null;
  const target = path.resolve(root, ...relativePath.split("/").filter(Boolean));
  const relative = path.relative(root, target);
  if (relative === "" || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) return null;
  return target;
}

function emptySnapshot(phase: EmbeddingIndexSnapshot["phase"] = "starting"): EmbeddingIndexSnapshot {
  return { phase, done: 0, total: 0, failedCount: 0 };
}

export class EmbeddingTestIndex {
  #generation = 0;
  #state: JobState | null = null;
  #session: LlamaEmbeddingSession | null = null;
  #sessionGate: Promise<LlamaEmbeddingSession | null> = Promise.resolve(null);
  #queue: Promise<void> = Promise.resolve();
  #skipped = new Set<string>();
  #priorityAssetId: string | null = null;
  #catchUpRequested = false;
  #catchUpRunning = false;
  #catchUpTimer: ReturnType<typeof setTimeout> | undefined;

  constructor(private readonly options: {
    cacheDirectory: string;
    configDirectories: readonly string[];
    requestWorker: (command: WorkerCommand) => Promise<WorkerResult>;
    installedLayout?: (modelId: SemanticSearchModelId) => LocalEmbeddingTestConfig | null;
  }) {}

  async close(): Promise<void> {
    this.#generation += 1;
    this.#state = null;
    this.#priorityAssetId = null;
    this.#catchUpRequested = false;
    if (this.#catchUpTimer) clearTimeout(this.#catchUpTimer);
    this.#catchUpTimer = undefined;
    await this.#closeSession();
  }

  /**
   * Import and other asset changes already notify Main. Encode only the
   * pictures that are not in the current index, the same way a later thumbnail
   * wave only queues files that still need a preview.
   */
  catchUp(libraryId: string): void {
    const state = this.#state;
    if (!state || state.libraryId !== libraryId) return;
    if (state.phase === "unavailable" || state.phase === "failed") return;
    this.#catchUpRequested = true;
    if (state.phase !== "ready" || this.#catchUpRunning || this.#catchUpTimer) return;
    this.#catchUpTimer = setTimeout(() => {
      this.#catchUpTimer = undefined;
      const current = this.#state;
      if (!current || current.libraryId !== libraryId || current.phase !== "ready") return;
      void this.#catchUp(current.generation);
    }, CATCH_UP_DELAY_MS);
  }

  handleStatus(request: {
    libraryId: string;
    modelId: SemanticSearchModelId;
    run: boolean;
    restart: boolean;
  }): RendererResult {
    if (request.run) this.#ensure(request);
    return { ok: true, type: "embedding.index.status", ...this.#snapshot() };
  }

  async handleSearch(request: {
    libraryId: string;
    modelId: SemanticSearchModelId;
    query: string;
  }): Promise<RendererResult> {
    this.#ensure({ ...request, restart: false });
    const snapshot = this.#snapshot();
    const session = await this.#sessionGate;
    const state = this.#state;
    if (
      !session
      || !state
      || state.libraryId !== request.libraryId
      || state.modelId !== request.modelId
      || state.entries.size === 0
    ) {
      return { ok: true, type: "embedding.search", ...this.#snapshot(), assetIds: [], scores: [] };
    }
    try {
      const vector = normalizeEmbedding(await this.#enqueue(() => session.embedText(
        formatEmbeddingSearchQuery(request.query),
      )));
      if (this.#state?.generation !== state.generation) {
        return { ok: true, type: "embedding.search", ...this.#snapshot(), assetIds: [], scores: [] };
      }
      const scores = scoreEmbeddings(vector, [...state.entries.values()]);
      return {
        ok: true,
        type: "embedding.search",
        ...this.#snapshot(),
        // Return the stable, exact ranking as an ID snapshot. Renderer pages
        // summaries from this order as the user scrolls; score thresholds and
        // a single fixed Top-K would either discard candidates or limit recall.
        assetIds: scores.map(({ assetId }) => assetId),
        scores,
      };
    } catch {
      return { ok: true, type: "embedding.search", ...snapshot, assetIds: [], scores: [] };
    }
  }

  handleSimilar(request: {
    libraryId: string;
    modelId: SemanticSearchModelId;
    assetId: string;
  }): RendererResult {
    const state = this.#state;
    const snapshot = this.#snapshot();
    if (
      !state
      || state.libraryId !== request.libraryId
      || state.modelId !== request.modelId
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
      this.#priorityAssetId = request.assetId;
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

  #snapshot(): EmbeddingIndexSnapshot {
    if (!this.#state) return emptySnapshot();
    return {
      phase: this.#state.phase,
      done: this.#state.done,
      total: this.#state.total,
      failedCount: this.#state.failedCount,
    };
  }

  #ensure(request: {
    libraryId: string;
    modelId: SemanticSearchModelId;
    restart: boolean;
  }): void {
    const current = this.#state;
    if (
      current
      && current.libraryId === request.libraryId
      && current.modelId === request.modelId
    ) {
      if (current.phase === "starting" || current.phase === "indexing" || current.phase === "ready") return;
      if (!request.restart) return;
    }
    const config = readLocalEmbeddingTestConfig(this.options.configDirectories)
      ?? this.options.installedLayout?.(request.modelId)
      ?? null;
    if (!config || !localEmbeddingFilesReady(config, request.modelId)) {
      this.#generation += 1;
      void this.#closeSession();
      this.#state = {
        ...emptySnapshot("unavailable"),
        generation: this.#generation,
        libraryId: request.libraryId,
        modelId: request.modelId,
        entries: new Map(),
      };
      this.#sessionGate = Promise.resolve(null);
      return;
    }
    this.#generation += 1;
    this.#priorityAssetId = null;
    this.#skipped.clear();
    this.#catchUpRequested = false;
    const generation = this.#generation;
    this.#state = {
      ...emptySnapshot("starting"),
      generation,
      libraryId: request.libraryId,
      modelId: request.modelId,
      entries: new Map(),
    };
    let resolveGate: (session: LlamaEmbeddingSession | null) => void = () => undefined;
    this.#sessionGate = new Promise((resolve) => {
      resolveGate = resolve;
    });
    void this.#run(generation, request.libraryId, request.modelId, config, resolveGate);
  }

  async #run(
    generation: number,
    libraryId: string,
    modelId: SemanticSearchModelId,
    config: LocalEmbeddingTestConfig,
    resolveGate: (session: LlamaEmbeddingSession | null) => void,
  ): Promise<void> {
    try {
      await this.#closeSession();
      if (this.#state?.generation !== generation) {
        resolveGate(null);
        return;
      }
      const targets = await this.#listTargets(libraryId);
      if (this.#state?.generation !== generation) {
        resolveGate(null);
        return;
      }
      const cached = this.#readCache(libraryId, modelId);
      const entries = new Map<string, StoredEntry>();
      let done = 0;
      for (const target of targets) {
        const stored = cached.get(target.assetId);
        if (!stored || stored.revisionId !== target.revisionId) continue;
        entries.set(target.assetId, stored);
        done += 1;
      }
      this.#write(generation, { entries, done, total: targets.length, phase: "starting" });
      const pending = embeddingTargetsToEncode(targets, entries, this.#skipped);
      const session = await this.#openSession(config, modelId);
      if (this.#state?.generation !== generation) {
        await session.close();
        resolveGate(null);
        return;
      }
      this.#session = session;
      resolveGate(session);
      if (pending.length > 0) {
        this.#write(generation, { phase: "indexing" });
        const finished = await this.#encodeTargets(
          generation,
          libraryId,
          modelId,
          session,
          entries,
          pending,
        );
        if (!finished) return;
      }
      if (this.#catchUpRequested) {
        await this.#catchUp(generation);
        return;
      }
      this.#write(generation, { phase: "ready" });
    } catch {
      if (this.#state?.generation !== generation) {
        resolveGate(null);
        return;
      }
      this.#write(generation, { phase: "failed" });
      resolveGate(null);
    }
  }

  async #catchUp(generation: number): Promise<void> {
    if (this.#catchUpRunning) return;
    this.#catchUpRunning = true;
    try {
      while (this.#state?.generation === generation && this.#catchUpRequested) {
        this.#catchUpRequested = false;
        const state = this.#state;
        const session = this.#session;
        if (!state || !session) return;
        const targets = await this.#listTargets(state.libraryId);
        if (this.#state?.generation !== generation) return;
        const live = new Set(targets.map((target) => target.assetId));
        const before = state.entries.size;
        for (const assetId of [...state.entries.keys()]) {
          if (!live.has(assetId)) state.entries.delete(assetId);
        }
        if (state.entries.size !== before) {
          this.#writeCache(state.libraryId, state.modelId, state.entries);
        }
        const pending = embeddingTargetsToEncode(targets, state.entries, this.#skipped);
        const done = targets.length - pending.length;
        this.#write(generation, {
          entries: state.entries,
          total: targets.length,
          done,
          phase: pending.length > 0 ? "indexing" : "ready",
        });
        if (pending.length === 0) continue;
        const finished = await this.#encodeTargets(
          generation,
          state.libraryId,
          state.modelId,
          session,
          state.entries,
          pending,
        );
        if (!finished) return;
      }
      if (this.#state?.generation === generation) this.#write(generation, { phase: "ready" });
    } finally {
      this.#catchUpRunning = false;
    }
  }

  async #encodeTargets(
    generation: number,
    libraryId: string,
    modelId: SemanticSearchModelId,
    session: LlamaEmbeddingSession,
    entries: Map<string, StoredEntry>,
    pending: readonly EmbeddingTarget[],
  ): Promise<boolean> {
    let remaining = pending;
    while (remaining.length > 0) {
      if (this.#state?.generation !== generation) return false;
      const next = takeNextEmbeddingTarget(remaining, this.#priorityAssetId);
      if (!next) return false;
      remaining = next.rest;
      const target = next.target;
      try {
        const vector = await this.#embedTarget(generation, session, target);
        if (!vector || this.#state?.generation !== generation) return false;
        entries.set(target.assetId, {
          assetId: target.assetId,
          revisionId: target.revisionId,
          vector,
        });
        const done = (this.#state?.done ?? 0) + 1;
        this.#write(generation, { entries, done });
        this.#writeCache(libraryId, modelId, entries);
      } catch {
        if (this.#state?.generation !== generation) return false;
        this.#skipped.add(embeddingSkipKey(target.assetId, target.revisionId));
        this.#write(generation, { failedCount: (this.#state?.failedCount ?? 0) + 1 });
      }
    }
    return this.#state?.generation === generation;
  }

  async #openSession(
    config: LocalEmbeddingTestConfig,
    modelId: SemanticSearchModelId,
  ): Promise<LlamaEmbeddingSession> {
    const model = SEMANTIC_SEARCH_MODELS.find((entry) => entry.id === modelId);
    if (!model) throw new Error("Unknown semantic model.");
    const files = EMBEDDING_GEMMA2_TIER_FILES[model.tier];
    const sessionFiles = {
      corePath: path.join(config.modelDirectory, files.coreFile),
      projectorPath: path.join(config.modelDirectory, files.projectorFile),
    };
    try {
      return await startLlamaEmbeddingSession({
        executable: config.runtimePath,
        files: sessionFiles,
        gpuLayers: 99,
      });
    } catch {
      return startLlamaEmbeddingSession({
        executable: config.runtimePath,
        files: sessionFiles,
        gpuLayers: 0,
      });
    }
  }

  async #embedTarget(
    generation: number,
    session: LlamaEmbeddingSession,
    target: EmbeddingTarget,
  ): Promise<number[] | null> {
    if (target.kind === "audio") {
      const { resolveHostMediaBinaries } = await import("./media-binary-env");
      const binaries = resolveHostMediaBinaries();
      if (!binaries) throw new Error("Audio conversion is unavailable.");
      const prepared = await renderEmbeddingAudioWindows({
        ffmpegPath: binaries.ffmpegPath,
        sourcePath: target.filePath,
        maxWindows: EMBEDDING_AUDIO_MAX_WINDOWS,
      });
      try {
        const vectors: number[][] = [];
        for (const wavPath of prepared.wavPaths) {
          if (this.#state?.generation !== generation) return null;
          vectors.push(await this.#enqueue(() => session.embedAudio(wavPath)));
        }
        if (this.#state?.generation !== generation) return null;
        return meanPoolEmbeddings(vectors);
      } finally {
        await discardPreparedEmbeddingAudio(prepared);
      }
    }
    if (target.kind === "text") {
      const document = await readEmbeddingDocument(target.filePath, path.basename(target.filePath));
      if (this.#state?.generation !== generation) return null;
      return normalizeEmbedding(await this.#enqueue(() => session.embedText(document)));
    }
    return normalizeEmbedding(await this.#enqueue(() => session.embedImage(target.filePath)));
  }

  async #listTargets(libraryId: string): Promise<EmbeddingTarget[]> {
    const listed = await this.options.requestWorker({ type: "library.list" });
    if (!listed.ok || listed.type !== "library.list") return [];
    const library = listed.libraries.find((entry) => entry.libraryId === libraryId);
    if (!library) return [];
    const assets = await this.options.requestWorker({
      type: "asset.list",
      libraryId,
      recursive: true,
    });
    if (!assets.ok || assets.type !== "asset.list") return [];
    const linked = await this.options.requestWorker({ type: "linked-folder.list", libraryId });
    const roots = new Map<string, string>();
    if (linked.ok && linked.type === "linked-folder.list") {
      for (const folder of linked.folders) {
        const id = folder.linkedFolderId ?? folder.folderId;
        if (folder.relativePath === "" || !roots.has(id)) roots.set(id, folder.absoluteRootPath);
      }
    }
    const thumbnailIds: string[] = [];
    const targets: EmbeddingTarget[] = [];
    const thumbnailTargets: Array<{ assetId: string; revisionId: string; artifactId: string }> = [];
    for (const asset of assets.assets) {
      const plan = embeddingSourcePlan(asset);
      if (plan === "file" || plan === "audio" || plan === "text") {
        const root = asset.locationKind === "managed"
          ? path.join(library.libraryPath, "Assets")
          : asset.linkedFolderId ? roots.get(asset.linkedFolderId) : undefined;
        if (!root) continue;
        const filePath = resolveContainedPath(root, asset.relativeFilePath);
        if (!filePath || !existsSync(filePath)) continue;
        targets.push({
          assetId: asset.assetId,
          revisionId: plan === "audio"
            ? embeddingAudioRevision(asset.currentRevisionId)
            : plan === "text"
              ? embeddingTextRevision(asset.currentRevisionId)
              : asset.currentRevisionId,
          filePath,
          kind: plan === "file" ? "image" : plan,
        });
      } else if (plan === "thumbnail" && asset.thumbnailArtifactId) {
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

  #cachePath(libraryId: string, modelId: SemanticSearchModelId): string {
    if (!/^[A-Za-z0-9_-]+$/.test(libraryId) || !/^[A-Za-z0-9_-]+$/.test(modelId)) {
      throw new Error("Unsafe embedding cache name.");
    }
    return path.join(this.options.cacheDirectory, libraryId, `${modelId}.json`);
  }

  #readCache(libraryId: string, modelId: SemanticSearchModelId): Map<string, StoredEntry> {
    const entries = new Map<string, StoredEntry>();
    let parsed: unknown;
    try {
      parsed = JSON.parse(readFileSync(this.#cachePath(libraryId, modelId), "utf8")) as unknown;
    } catch {
      return entries;
    }
    if (!parsed || typeof parsed !== "object") return entries;
    const record = parsed as { profileKey?: unknown; entries?: unknown };
    const model = SEMANTIC_SEARCH_MODELS.find((entry) => entry.id === modelId);
    if (!model || record.profileKey !== embeddingProfileKey(model.tier) || !Array.isArray(record.entries)) {
      return entries;
    }
    for (const entry of record.entries) {
      if (!entry || typeof entry !== "object") continue;
      const row = entry as Partial<StoredEntry>;
      if (typeof row.assetId !== "string" || typeof row.revisionId !== "string" || !Array.isArray(row.vector)) continue;
      if (row.vector.length !== EMBEDDING_GEMMA2_DIMENSIONS) continue;
      if (row.vector.some((value) => typeof value !== "number" || !Number.isFinite(value))) continue;
      entries.set(row.assetId, {
        assetId: row.assetId,
        revisionId: row.revisionId,
        vector: row.vector,
      });
    }
    return entries;
  }

  #writeCache(
    libraryId: string,
    modelId: SemanticSearchModelId,
    entries: ReadonlyMap<string, StoredEntry>,
  ): void {
    const model = SEMANTIC_SEARCH_MODELS.find((entry) => entry.id === modelId);
    if (!model) return;
    const filePath = this.#cachePath(libraryId, modelId);
    mkdirSync(path.dirname(filePath), { recursive: true });
    const payload = JSON.stringify({
      version: 1,
      profileKey: embeddingProfileKey(model.tier),
      entries: [...entries.values()],
    });
    const temporary = `${filePath}.partial`;
    writeFileSync(temporary, payload);
    try {
      rmSync(filePath, { force: true });
      renameSync(temporary, filePath);
    } catch {
      rmSync(temporary, { force: true });
    }
  }

  #write(generation: number, patch: Partial<JobState>): void {
    if (!this.#state || this.#state.generation !== generation) return;
    this.#state = { ...this.#state, ...patch };
  }

  #enqueue<T>(job: () => Promise<T>): Promise<T> {
    const run = this.#queue.then(job, job);
    this.#queue = run.then(() => undefined, () => undefined);
    return run;
  }

  async #closeSession(): Promise<void> {
    const session = this.#session;
    this.#session = null;
    await session?.close();
  }
}
