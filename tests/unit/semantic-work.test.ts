import { describe, expect, it } from "vitest";

import { semanticBackgroundWorkActive, semanticToolbarReady } from "../../src/renderer/semantic-work";
import { embeddingIndexCopyKey, embeddingIndexJobsVisible } from "../../src/renderer/semantic-index-copy";
import { semanticBrowseRegistration } from "../../src/renderer/semantic-browse";
import { similarMenuBlock } from "../../src/shared/embedding/modalities";

describe("semantic readiness", () => {
  it("offers the toolbar only when the library model can search text", () => {
    expect(semanticToolbarReady({
      selectionId: "embeddinggemma-2-compact",
      runtimeInstalled: true,
      models: [{ modelId: "embeddinggemma-2-compact", installed: false }],
      service: null,
    })).toBe(false);
    expect(semanticToolbarReady({
      selectionId: "embeddinggemma-2-compact",
      runtimeInstalled: true,
      models: [{ modelId: "embeddinggemma-2-compact", installed: true }],
      service: null,
    })).toBe(true);
    expect(semanticToolbarReady({
      selectionId: "svc_readytext",
      runtimeInstalled: false,
      models: [],
      service: { modalities: ["image"], textStatus: "verified", dimensions: 1024 },
    })).toBe(false);
    expect(semanticToolbarReady({
      selectionId: "svc_readytext",
      runtimeInstalled: false,
      models: [],
      service: { modalities: ["text", "image"], textStatus: "verified", dimensions: 1024 },
    })).toBe(true);
  });

  it("keeps the jobs indicator quiet unless a download or index is running", () => {
    expect(semanticBackgroundWorkActive({ installing: false, enabled: true, phase: "ready" })).toBe(false);
    expect(semanticBackgroundWorkActive({ installing: false, enabled: false, phase: "starting" })).toBe(false);
    expect(semanticBackgroundWorkActive({ installing: true, enabled: false, phase: "unavailable" })).toBe(true);
    expect(semanticBackgroundWorkActive({ installing: false, enabled: true, phase: "indexing" })).toBe(true);
  });

  it("keeps the toolbar query when semantic results are registered", () => {
    const registration = semanticBrowseRegistration({
      libraryId: "library-1",
      query: { clauses: [] },
      showIgnored: false,
      rankedAssetIds: ["asset-1"],
      rankedPageSize: 50,
      items: [],
    });
    expect(registration.query).toEqual({ clauses: [] });
    expect(registration.total).toBe(1);
  });

  it("blocks find-similar when the model does not claim the asset or the adapter cannot run it", () => {
    expect(similarMenuBlock({
      mediaType: "image",
      implementation: "http",
      declared: ["text", "image"],
    })).toBe("service");
    expect(similarMenuBlock({
      mediaType: "audio",
      implementation: "gemma",
      declared: ["image", "text"],
    })).toBe("modality");
    expect(similarMenuBlock({
      mediaType: "image",
      implementation: "gemma",
      declared: ["image", "video", "audio", "text"],
    })).toBeNull();
  });
});

describe("semantic index jobs copy", () => {
  it("keeps picture wording for local models and text wording for custom services", () => {
    expect(embeddingIndexCopyKey({ phase: "indexing", done: 1, total: 3, failedCount: 0 }))
      .toBe("dialog.mediaJobs.embeddingProgress");
    expect(embeddingIndexCopyKey(
      { phase: "indexing", done: 1, total: 3, failedCount: 0 },
      { textOnly: true },
    )).toBe("dialog.mediaJobs.embeddingProgressText");
    expect(embeddingIndexCopyKey(
      { phase: "ready", done: 0, total: 0, failedCount: 0 },
      { textOnly: true },
    )).toBe("dialog.mediaJobs.embeddingReadyEmptyText");
  });

  it("hides the jobs panel semantic section once the index is ready", () => {
    expect(embeddingIndexJobsVisible({ phase: "starting", done: 0, total: 0, failedCount: 0 })).toBe(true);
    expect(embeddingIndexJobsVisible({ phase: "indexing", done: 1, total: 3, failedCount: 0 })).toBe(true);
    expect(embeddingIndexJobsVisible({ phase: "ready", done: 3, total: 3, failedCount: 0 })).toBe(false);
  });
});
