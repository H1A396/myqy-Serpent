import type { EmbeddingIndexSnapshot } from "../shared/embedding/profile";
import type { AssetSummary } from "../shared/asset-types";

export function embeddingIndexCopyKey(snapshot: EmbeddingIndexSnapshot): string {
  if (snapshot.hold === "grant") return "dialog.mediaJobs.embeddingGrant";
  switch (snapshot.phase) {
    case "starting":
      return "dialog.mediaJobs.embeddingStarting";
    case "indexing":
      return "dialog.mediaJobs.embeddingProgress";
    case "ready":
      if (snapshot.total === 0) return "dialog.mediaJobs.embeddingReadyEmpty";
      return snapshot.failedCount > 0
        ? "dialog.mediaJobs.embeddingReadyPartial"
        : "dialog.mediaJobs.embeddingReady";
    case "failed":
      return "dialog.mediaJobs.embeddingFailed";
    default:
      return "dialog.mediaJobs.embeddingUnavailable";
  }
}

export function semanticSearchNotice(input: {
  phase: EmbeddingIndexSnapshot["phase"];
  done: number;
  total: number;
  matched: number;
  hold?: "grant";
}): { key: string; params: Record<string, number> } {
  if (input.hold === "grant") {
    return { key: "toast.semanticSearchGrant", params: {} };
  }
  if (input.matched > 0 && input.phase !== "ready") {
    return {
      key: "toast.semanticSearchPartial",
      params: { total: input.matched, done: input.done, libraryTotal: input.total },
    };
  }
  if (input.matched > 0) {
    return { key: "toast.semanticSearchDone", params: { total: input.matched } };
  }
  if (input.phase === "starting" || input.done === 0) {
    return { key: "toast.semanticSearchWaiting", params: {} };
  }
  return {
    key: "toast.semanticSearchEmpty",
    params: { done: input.done, total: input.total },
  };
}

export function orderAssetsById(assets: readonly AssetSummary[], assetIds: readonly string[]): AssetSummary[] {
  const order = new Map(assetIds.map((assetId, index) => [assetId, index]));
  return [...assets].sort((left, right) =>
    (order.get(left.assetId) ?? assetIds.length) - (order.get(right.assetId) ?? assetIds.length));
}
