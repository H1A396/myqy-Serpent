import { describe, expect, it } from "vitest";

import {
  resolveFindSimilar,
  similarImageSupported,
} from "../../src/renderer/find-similar";
import {
  rankSimilarAssetIds,
  takeNextEmbeddingTarget,
} from "../../src/main/embedding-test-index";
import { isDamagedEmbeddingAsset } from "../../src/shared/embedding/profile";
import { rendererResultSchema } from "../../src/shared/protocol/responses";

describe("find similar", () => {
  it("uses the original still, a sound, a document, or a ready thumbnail", () => {
    expect(similarImageSupported({
      mediaType: "image",
      relativeFilePath: "refs/hero.PNG",
    })).toBe(true);
    expect(similarImageSupported({
      mediaType: "video",
      relativeFilePath: "clip.mov",
    })).toBe(false);
    expect(similarImageSupported({
      mediaType: "video",
      relativeFilePath: "clip.mov",
      thumbnailStatus: "ready",
      thumbnailArtifactId: "thumb-1",
    })).toBe(true);
    expect(similarImageSupported({
      mediaType: "audio",
      relativeFilePath: "take.wav",
    })).toBe(true);
    expect(similarImageSupported({
      mediaType: "audio",
      relativeFilePath: "take.wav",
      thumbnailStatus: "failed",
    })).toBe(true);
    expect(similarImageSupported({
      mediaType: "text",
      relativeFilePath: "notes.md",
    })).toBe(true);
    expect(similarImageSupported({
      mediaType: "audio",
      relativeFilePath: "broken.wav",
      currentRevisionId: "corrupt:asset-1",
    })).toBe(false);
    expect(similarImageSupported({
      mediaType: "image",
      relativeFilePath: "broken.jpg",
      currentRevisionId: "rev-1",
      thumbnailStatus: "failed",
      thumbnailArtifactId: "thumb-4",
    })).toBe(false);
  });

  it("treats a failed preview or a missing revision as damaged", () => {
    expect(isDamagedEmbeddingAsset({
      currentRevisionId: "rev-1",
      thumbnailStatus: "failed",
    })).toBe(true);
    expect(isDamagedEmbeddingAsset({
      currentRevisionId: "corrupt:asset-1",
      thumbnailStatus: null,
    })).toBe(true);
    expect(isDamagedEmbeddingAsset({
      currentRevisionId: "rev-1",
      thumbnailStatus: "pending",
    })).toBe(false);
    expect(isDamagedEmbeddingAsset({
      currentRevisionId: "rev-1",
      thumbnailStatus: "ready",
    })).toBe(false);
  });

  it("ranks other images and leaves the source out", () => {
    const ids = rankSimilarAssetIds("source", [
      { assetId: "source", vector: [1, 0] },
      { assetId: "far", vector: [0, 1] },
      { assetId: "near", vector: [0.9, 0.1] },
    ]);
    expect(ids).toEqual(["near", "far"]);
  });

  it("encodes a requested picture before the rest of the queue", () => {
    const next = takeNextEmbeddingTarget(
      [{ assetId: "a" }, { assetId: "needed" }, { assetId: "c" }],
      "needed",
    );
    expect(next?.target.assetId).toBe("needed");
    expect(next?.rest.map((item) => item.assetId)).toEqual(["a", "c"]);
    expect(takeNextEmbeddingTarget([], "needed")).toBeNull();
  });

  it("waits through preparing, then returns the ranked page", async () => {
    const statuses = ["preparing", "preparing", "ready"] as const;
    let calls = 0;
    let preparing = 0;
    const page = await resolveFindSimilar({
      query: async () => {
        const status = statuses[calls] ?? "ready";
        calls += 1;
        return { status, assetIds: status === "ready" ? ["other"] : [] };
      },
      shouldContinue: () => true,
      delay: async () => undefined,
      onPreparing: () => {
        preparing += 1;
      },
    });
    expect(page).toEqual({ status: "ready", assetIds: ["other"] });
    expect(preparing).toBe(1);
    expect(calls).toBe(3);
  });

  it("stops polling when the caller cancels", async () => {
    let continuePolling = true;
    const page = await resolveFindSimilar({
      query: async () => {
        continuePolling = false;
        return { status: "preparing", assetIds: [] };
      },
      shouldContinue: () => continuePolling,
      delay: async () => undefined,
    });
    expect(page).toBeNull();
  });

  it("accepts a similar-result payload without scores", () => {
    const parsed = rendererResultSchema.safeParse({
      ok: true,
      type: "embedding.similar",
      phase: "indexing",
      done: 2,
      total: 4,
      failedCount: 0,
      status: "ready",
      sourceAssetId: "source",
      assetIds: ["near", "far"],
    });
    expect(parsed.success).toBe(true);
  });
});
