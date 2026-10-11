import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  embeddingDownloadUrl,
  inspectEmbeddingTree,
  installedSemanticModels,
} from "../../src/main/embedding-install";
import { EMBEDDING_GEMMA2_MODEL_REVISION } from "../../src/shared/embedding/profile";

describe("embedding install lookup", () => {
  it("treats a tier as installed only when both of its files are present", () => {
    expect(installedSemanticModels(new Set([
      "embeddinggemma-2-UD-Q4_K_XL.gguf",
      "mmproj-Q8_0.gguf",
    ]))).toEqual(["embeddinggemma-2-compact"]);
    expect(installedSemanticModels(new Set(["embeddinggemma-2-UD-Q4_K_XL.gguf"]))).toEqual([]);
  });

  it("finds weights placed in an already downloaded folder", () => {
    const root = mkdtempSync(path.join(tmpdir(), "serpent-embedding-"));
    const models = path.join(root, "embeddinggemma-cache", "models");
    mkdirSync(models, { recursive: true });
    writeFileSync(path.join(models, "embeddinggemma-2-UD-Q4_K_XL.gguf"), "");
    writeFileSync(path.join(models, "mmproj-Q8_0.gguf"), "");
    mkdirSync(path.join(root, "embeddinggemma-cache", "runtime", "build"), { recursive: true });
    writeFileSync(path.join(root, "embeddinggemma-cache", "runtime", "build", "llama-server.exe"), "");

    const found = inspectEmbeddingTree([{ path: root, restrictNames: true }]);
    expect(installedSemanticModels(new Set(found.files.keys()))).toContain("embeddinggemma-2-compact");
    expect(found.runtimeFound).toBe(true);
    expect([...found.files.values()].some((filePath) => filePath.includes(tmpdir()))).toBe(true);
  });

  it("builds the pinned download address", () => {
    expect(embeddingDownloadUrl("embeddinggemma-2-UD-Q4_K_XL.gguf")).toBe(
      `https://huggingface.co/unsloth/embeddinggemma-2-GGUF/resolve/${EMBEDDING_GEMMA2_MODEL_REVISION}/embeddinggemma-2-UD-Q4_K_XL.gguf`,
    );
  });
});
