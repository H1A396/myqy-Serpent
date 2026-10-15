import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";
import { rendererResultSchema } from "../../src/shared/protocol/responses";
import type { WorkerCommand } from "../../src/shared/protocol/requests";
import type { WorkerResult } from "../../src/shared/protocol/responses";

import {
  localEmbeddingFilesReady,
  readLocalEmbeddingTestConfig,
} from "../../src/main/embedding-local-config";
import {
  embeddingSkipKey,
  EmbeddingTestIndex,
  embeddingTargetsToEncode,
  rankEmbeddings,
  resolveContainedPath,
  scoreEmbeddings,
} from "../../src/main/embedding-test-index";
import { EMBEDDING_GEMMA2_TIER_FILES } from "../../src/shared/embedding/profile";

const temporaryRoots: string[] = [];

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("embedding test index", () => {
  it("encodes only pictures that are missing or replaced", () => {
    const encoded = new Map([
      ["kept", { revisionId: "1" }],
      ["replaced", { revisionId: "1" }],
    ]);
    const pending = embeddingTargetsToEncode([
      { assetId: "kept", revisionId: "1" },
      { assetId: "replaced", revisionId: "2" },
      { assetId: "new", revisionId: "1" },
      { assetId: "failed", revisionId: "1" },
    ], encoded, new Set([embeddingSkipKey("failed", "1")]));
    expect(pending.map((target) => target.assetId)).toEqual(["replaced", "new"]);
  });

  it("ranks the closer vector first", () => {
    const query = [1, 0];
    const ids = rankEmbeddings(query, [
      { assetId: "far", vector: [0, 1] },
      { assetId: "near", vector: [0.9, 0.1] },
    ], 1);
    expect(ids).toEqual(["near"]);
  });

  it("keeps the complete cosine ranking even when adjacent scores differ by over 0.02", () => {
    const entries = [
      { assetId: "tail", vector: [0.4, Math.sqrt(0.84)] },
      { assetId: "reflection", vector: [0.66, Math.sqrt(1 - 0.66 ** 2)] },
      { assetId: "text-screenshot", vector: [0.7, Math.sqrt(1 - 0.7 ** 2)] },
    ];
    const ids = rankEmbeddings([1, 0], entries, entries.length);
    expect(ids).toEqual(["text-screenshot", "reflection", "tail"]);
    expect(ids.slice(0, 2)).toEqual(["text-screenshot", "reflection"]);
  });

  it("ranks mixed text and image rows by raw cosine without a type penalty", () => {
    const ranked = scoreEmbeddings([1, 0], [
      { assetId: "text-doc", revisionId: "r\ntext:v1:2500", vector: [0.95, Math.sqrt(1 - 0.95 ** 2)] },
      { assetId: "photo", revisionId: "r", vector: [0.88, Math.sqrt(1 - 0.88 ** 2)] },
    ]);
    expect(ranked.map(({ assetId }) => assetId)).toEqual(["text-doc", "photo"]);
    expect(ranked[0]?.score).toBeCloseTo(0.95);
    expect(ranked[1]?.score).toBeCloseTo(0.88);
  });

  it("exposes raw cosine scores and uses a stable ID tie-break", () => {
    const ranked = scoreEmbeddings([1, 0], [
      { assetId: "z", vector: [0.7, Math.sqrt(1 - 0.7 ** 2)] },
      { assetId: "a", vector: [0.7, Math.sqrt(1 - 0.7 ** 2)] },
      { assetId: "lower", vector: [0.66, Math.sqrt(1 - 0.66 ** 2)] },
    ]);
    expect(ranked.map(({ assetId }) => assetId)).toEqual(["a", "z", "lower"]);
    expect(ranked[0]?.score).toBeCloseTo(0.7);
    expect(ranked[2]?.score).toBeCloseTo(0.66);
  });

  it("accepts complete ranked ID snapshots within the library asset cap", () => {
    const result = (count: number) => ({
      ok: true,
      type: "embedding.search",
      phase: "ready",
      done: count,
      total: count,
      failedCount: 0,
      assetIds: Array.from({ length: count }, (_, index) => `asset-${index}`),
      scores: [],
    });
    expect(rendererResultSchema.safeParse(result(101)).success).toBe(true);
    expect(rendererResultSchema.safeParse(result(100_001)).success).toBe(false);
  });

  it("validates finite raw cosine scores without rejecting negatives or values above one", () => {
    const base = {
      ok: true as const,
      type: "embedding.search" as const,
      phase: "ready" as const,
      done: 3,
      total: 3,
      failedCount: 0,
      assetIds: ["negative", "zero", "above-one"],
    };
    expect(rendererResultSchema.safeParse({
      ...base,
      scores: [
        { assetId: "negative", score: -0.2 },
        { assetId: "zero", score: 0 },
        { assetId: "above-one", score: 1.2 },
      ],
    }).success).toBe(true);
    expect(rendererResultSchema.safeParse({
      ...base,
      scores: [{ assetId: "negative", score: Number.NaN }],
    }).success).toBe(false);
    expect(rendererResultSchema.safeParse({
      ...base,
      scores: [{ assetId: "negative", score: Number.POSITIVE_INFINITY }],
    }).success).toBe(false);
    expect(rendererResultSchema.safeParse({
      ...base,
      scores: [{ assetId: "unknown", score: 0.5 }],
    }).success).toBe(false);
    expect(rendererResultSchema.safeParse({
      ...base,
      scores: [
        { assetId: "negative", score: 0.2 },
        { assetId: "negative", score: 0.1 },
      ],
    }).success).toBe(false);
    // The new field remains optional for older Main processes.
    expect(rendererResultSchema.safeParse(base).success).toBe(true);
  });

  it("keeps a relative file inside its root", () => {
    const root = path.join(tmpdir(), "serpent-embedding-root");
    expect(resolveContainedPath(root, "folder/picture.png")).toBe(path.resolve(root, "folder", "picture.png"));
    expect(resolveContainedPath(root, "../picture.png")).toBeNull();
    expect(resolveContainedPath(root, "")).toBeNull();
  });

  it("uses only the named local config and does not discover nearby weights", () => {
    const root = mkdtempSync(path.join(tmpdir(), "serpent-embedding-config-"));
    try {
      const models = path.join(root, "models");
      mkdirSync(models, { recursive: true });
      writeFileSync(path.join(models, "embeddinggemma-2-UD-Q4_K_XL.gguf"), "");
      writeFileSync(path.join(models, "mmproj-Q8_0.gguf"), "");
      const runtime = path.join(root, "llama-server.exe");
      writeFileSync(runtime, "");

      expect(readLocalEmbeddingTestConfig([root])).toBeNull();

      writeFileSync(path.join(root, "embedding-gemma.local.json"), JSON.stringify({
        modelDirectory: models,
        runtimePath: runtime,
      }));
      const config = readLocalEmbeddingTestConfig([root]);
      expect(config).toEqual({ modelDirectory: models, runtimePath: runtime });
      expect(localEmbeddingFilesReady(config!, "embeddinggemma-2-compact")).toBe(true);
      expect(localEmbeddingFilesReady(config!, "embeddinggemma-2-quality")).toBe(false);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("sends prepared video targets to the native video provider path", async () => {
    const root = mkdtempSync(path.join(tmpdir(), "serpent-semantic-video-index-"));
    temporaryRoots.push(root);
    const modelDirectory = path.join(root, "models");
    mkdirSync(modelDirectory, { recursive: true });
    const files = EMBEDDING_GEMMA2_TIER_FILES.Q4_K_XL;
    writeFileSync(path.join(modelDirectory, files.coreFile), "synthetic core weights");
    writeFileSync(path.join(modelDirectory, files.projectorFile), "synthetic projector weights");
    const runtimePath = path.join(root, "llama-server");
    writeFileSync(runtimePath, "synthetic runtime");

    const videoEmbedding = vi.fn(async () => [1, 0, 0]);
    const session = {
      embedText: vi.fn(async () => [1, 0, 0]),
      embedImage: vi.fn(async () => [1, 0, 0]),
      embedImagePayload: vi.fn(async () => [1, 0, 0]),
      embedVideoPayload: videoEmbedding,
      embedAudio: vi.fn(async () => [1, 0, 0]),
      embedAudioPayload: vi.fn(async () => [1, 0, 0]),
      close: vi.fn(async () => undefined),
    };
    const commands: WorkerCommand[] = [];
    const requestWorker = vi.fn(async (command: WorkerCommand): Promise<WorkerResult> => {
      commands.push(command);
      if (command.type === "semantic.index.begin") return {
        ok: true, type: "semantic.index.started", profileId: "a".repeat(64), nativeCosineAvailable: false,
      };
      if (command.type === "semantic.index.import-legacy") return {
        ok: true, type: "semantic.index.legacy-imported", attempted: true, acceptedRows: 0, rejectedRows: 0,
      };
      if (command.type === "semantic.index.targets") return {
        ok: true, type: "semantic.index.targets", revisionSnapshot: 1, total: 1, nextOffset: null,
        targets: [{ assetId: "video-asset", sourceRevision: "video-revision", kind: "video",
          modality: "video", alreadyIndexed: false }],
      };
      if (command.type === "semantic.index.job" && command.action === "claim") return {
        ok: true, type: "semantic.index.job-updated", updated: true,
      };
      if (command.type === "semantic.index.prepare") return {
        ok: true, type: "semantic.index.prepared", assetId: "video-asset", sourceRevision: "video-revision",
        kind: "video", mimeType: "video/mp4", bytesBase64: Buffer.from("synthetic mp4 payload").toString("base64"),
      };
      if (command.type === "semantic.index.write") return {
        ok: true, type: "semantic.index.written", accepted: ["video-asset"], rejected: [],
      };
      if (command.type === "semantic.index.close") return { ok: true, type: "semantic.index.closed" };
      throw new Error(`Unexpected Worker command: ${command.type}`);
    });
    const index = new EmbeddingTestIndex({
      configDirectories: [],
      installedLayout: () => ({ modelDirectory, runtimePath }),
      requestWorker,
      startSession: vi.fn(async () => session),
      resolveMediaBinaries: () => undefined,
    });

    index.handleStatus({ libraryId: "library-video", modelId: "embeddinggemma-2-compact", run: true, restart: false });
    await vi.waitFor(() => {
      expect(index.handleStatus({ libraryId: "library-video", modelId: "embeddinggemma-2-compact", run: false, restart: false }))
        .toMatchObject({ ok: true, type: "embedding.index.status", phase: "ready", total: 1 });
    });

    expect(commands.find((command) => command.type === "semantic.index.targets")).toMatchObject({
      type: "semantic.index.targets", modalities: ["image", "video", "audio", "text"],
    });
    expect(commands.find((command) => command.type === "semantic.index.prepare")).toMatchObject({
      type: "semantic.index.prepare", kind: "video", sourceRevision: "video-revision",
    });
    expect(videoEmbedding).toHaveBeenCalledWith(Buffer.from("synthetic mp4 payload").toString("base64"));
    expect(session.embedImagePayload).not.toHaveBeenCalled();
    await index.close();
  });

  it("cancels an opening session when switching models without failing the replacement", async () => {
    const root = mkdtempSync(path.join(tmpdir(), "serpent-semantic-session-switch-"));
    temporaryRoots.push(root);
    const files = Object.values(EMBEDDING_GEMMA2_TIER_FILES).flatMap((entry) => [entry.coreFile, entry.projectorFile]);
    const modelDirectory = path.join(root, "models");
    mkdirSync(modelDirectory, { recursive: true });
    for (const file of files) writeFileSync(path.join(modelDirectory, file), "fixture");
    const runtimePath = path.join(root, "fake-runtime");
    writeFileSync(runtimePath, "fixture runtime");
    const session = {
      embedText: vi.fn(async () => [1]),
      embedImage: vi.fn(async () => [1]),
      embedImagePayload: vi.fn(async () => [1]),
      embedVideoPayload: vi.fn(async () => [1]),
      embedAudio: vi.fn(async () => [1]),
      embedAudioPayload: vi.fn(async () => [1]),
      close: vi.fn(async () => undefined),
    };
    const requestWorker = vi.fn(async (command: WorkerCommand): Promise<WorkerResult> => {
      if (command.type === "semantic.index.begin") return {
        ok: true, type: "semantic.index.started", profileId: "a".repeat(64), nativeCosineAvailable: false,
      };
      if (command.type === "semantic.index.import-legacy") return {
        ok: true, type: "semantic.index.legacy-imported", attempted: true, acceptedRows: 0, rejectedRows: 0,
      };
      if (command.type === "semantic.index.targets") return {
        ok: true, type: "semantic.index.targets", revisionSnapshot: 1, total: 0, nextOffset: null, targets: [],
      };
      if (command.type === "semantic.index.close") return { ok: true, type: "semantic.index.closed" };
      throw new Error(`Unexpected Worker command: ${command.type}`);
    });
    let firstSignal: AbortSignal | undefined;
    const startSession = vi.fn(async (options: Parameters<typeof import("../../src/main/embedding-llama-session").startLlamaEmbeddingSession>[0]) => {
      if (options.files.corePath.endsWith(EMBEDDING_GEMMA2_TIER_FILES.Q4_K_XL.coreFile)) {
        firstSignal = options.signal;
        return new Promise<typeof session>((_resolve, reject) => {
          options.signal?.addEventListener("abort", () => reject(options.signal?.reason), { once: true });
        });
      }
      return session;
    });
    const index = new EmbeddingTestIndex({
      configDirectories: [],
      installedLayout: () => ({ modelDirectory, runtimePath }),
      requestWorker,
      startSession,
    });

    index.handleStatus({ libraryId: "library-switch", modelId: "embeddinggemma-2-compact", run: true, restart: false });
    await vi.waitFor(() => expect(startSession).toHaveBeenCalledTimes(1));
    index.handleStatus({ libraryId: "library-switch", modelId: "embeddinggemma-2-balanced", run: true, restart: false });
    expect(firstSignal?.aborted).toBe(true);
    await vi.waitFor(() => {
      expect(index.handleStatus({ libraryId: "library-switch", modelId: "embeddinggemma-2-balanced", run: false, restart: false }))
        .toMatchObject({ ok: true, type: "embedding.index.status", phase: "ready" });
    });
    expect(startSession).toHaveBeenCalledTimes(2);
    await Promise.all([index.close(), index.close()]);
    expect(session.close).toHaveBeenCalledTimes(1);
  });

  it("does not start a CPU fallback when GPU runtime cleanup failed", async () => {
    const root = mkdtempSync(path.join(tmpdir(), "serpent-semantic-start-cleanup-"));
    temporaryRoots.push(root);
    const modelDirectory = path.join(root, "models");
    mkdirSync(modelDirectory, { recursive: true });
    const files = EMBEDDING_GEMMA2_TIER_FILES.Q4_K_XL;
    writeFileSync(path.join(modelDirectory, files.coreFile), "fixture");
    writeFileSync(path.join(modelDirectory, files.projectorFile), "fixture");
    const runtimePath = path.join(root, "fake-runtime");
    writeFileSync(runtimePath, "fixture runtime");
    const cleanupFailure = new AggregateError([new Error("fixture cleanup failed")]);
    const requestWorker = vi.fn(async (command: WorkerCommand): Promise<WorkerResult> => {
      if (command.type === "semantic.index.begin") return {
        ok: true, type: "semantic.index.started", profileId: "a".repeat(64), nativeCosineAvailable: false,
      };
      if (command.type === "semantic.index.import-legacy") return {
        ok: true, type: "semantic.index.legacy-imported", attempted: true, acceptedRows: 0, rejectedRows: 0,
      };
      if (command.type === "semantic.index.close") return { ok: true, type: "semantic.index.closed" };
      throw new Error(`Unexpected Worker command: ${command.type}`);
    });
    const startSession = vi.fn(async (_options: Parameters<typeof import("../../src/main/embedding-llama-session").startLlamaEmbeddingSession>[0]) => {
      throw cleanupFailure;
    });
    const index = new EmbeddingTestIndex({
      configDirectories: [],
      installedLayout: () => ({ modelDirectory, runtimePath }),
      requestWorker,
      startSession,
    });

    index.handleStatus({ libraryId: "library-cleanup", modelId: "embeddinggemma-2-compact", run: true, restart: false });
    await vi.waitFor(() => {
      expect(index.handleStatus({ libraryId: "library-cleanup", modelId: "embeddinggemma-2-compact", run: false, restart: false }))
        .toMatchObject({ ok: true, type: "embedding.index.status", phase: "failed" });
    });
    expect(startSession).toHaveBeenCalledTimes(1);
    expect(startSession.mock.calls[0]?.[0]).toMatchObject({ gpuLayers: 99 });
    await expect(index.close()).rejects.toBe(cleanupFailure);
  });
});
