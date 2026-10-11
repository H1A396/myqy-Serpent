import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";
import { rendererResultSchema } from "../../src/shared/protocol/responses";

import {
  localEmbeddingFilesReady,
  readLocalEmbeddingTestConfig,
} from "../../src/main/embedding-local-config";
import {
  embeddingSkipKey,
  embeddingTargetsToEncode,
  rankEmbeddings,
  resolveContainedPath,
  scoreEmbeddings,
} from "../../src/main/embedding-test-index";

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
});
