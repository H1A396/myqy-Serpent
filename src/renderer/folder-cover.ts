import type { FolderBrowseEntry } from "../shared/asset-types";
import type { FolderNavigationCover } from "../shared/library-navigation";
import { coverSrc, sourceSrc } from "./asset-card-hover-preview";

/**
 * Point sidebar/breadcrumb covers at a thumbnail that just became ready.
 * Folders that do not use this asset are left unchanged.
 */
export function patchFolderNavigationCoverArtifact(
  covers: readonly FolderNavigationCover[],
  assetId: string,
  artifactId: string,
): { covers: FolderNavigationCover[]; changed: boolean } {
  let changed = false;
  const next = covers.map((cover) => {
    if (cover.assetId !== assetId || cover.artifactId === artifactId) return cover;
    changed = true;
    return { ...cover, artifactId };
  });
  return { covers: changed ? next : [...covers], changed };
}

/** Cover image stored with the library, addressed without a filesystem path. */
export function folderCustomCoverSrc(
  libraryId: string,
  folderId: string,
  token: string,
): string {
  const url = new URL(`serpent://folder-cover/${encodeURIComponent(libraryId)}`);
  url.searchParams.set("folder", folderId);
  url.searchParams.set("v", token);
  return url.toString();
}

/** Custom cover when one is stored; otherwise the first automatic cover. */
export function folderCoverImageSrc(
  libraryId: string,
  entry: Pick<
    FolderBrowseEntry,
    | "folderId"
    | "coverArtifactIds"
    | "coverSourcePreviews"
    | "hasCustomCover"
    | "customCoverToken"
    | "customCoverAssetId"
    | "customCoverArtifactId"
    | "customCoverSourcePreview"
  >,
): string | null {
  if (entry.customCoverAssetId) {
    if (entry.customCoverArtifactId) return coverSrc(libraryId, entry.customCoverArtifactId);
    const source = entry.customCoverSourcePreview;
    if (source) return sourceSrc(libraryId, source.assetId, source.revisionId);
  } else if (entry.hasCustomCover && entry.customCoverToken) {
    return folderCustomCoverSrc(libraryId, entry.folderId, entry.customCoverToken);
  }
  const artifactId = entry.coverArtifactIds[0];
  if (artifactId) return coverSrc(libraryId, artifactId);
  const source = entry.coverSourcePreviews?.[0];
  if (!source) return null;
  return sourceSrc(libraryId, source.assetId, source.revisionId);
}

/** Automatic cover, ignoring a stored custom cover. Used when that image fails to load. */
export function folderAutomaticCoverSrc(
  libraryId: string,
  entry: Pick<FolderBrowseEntry, "coverArtifactIds" | "coverSourcePreviews">,
): string | null {
  const artifactId = entry.coverArtifactIds[0];
  if (artifactId) return coverSrc(libraryId, artifactId);
  const source = entry.coverSourcePreviews?.[0];
  if (!source) return null;
  return sourceSrc(libraryId, source.assetId, source.revisionId);
}

/** Sidebar and breadcrumb cover URLs, keyed by folder id. */
export function folderNavigationCoverSrcMap(
  libraryId: string,
  covers: readonly FolderNavigationCover[],
): Map<string, string> {
  const map = new Map<string, string>();
  for (const cover of covers) {
    const src = folderCoverImageSrc(libraryId, {
      folderId: cover.folderId,
      coverArtifactIds: [],
      hasCustomCover: true,
      ...(cover.fileToken ? { customCoverToken: cover.fileToken } : {}),
      ...(cover.assetId ? { customCoverAssetId: cover.assetId } : {}),
      ...(cover.artifactId ? { customCoverArtifactId: cover.artifactId } : {}),
      ...(cover.assetId && cover.revisionId && !cover.artifactId
        ? { customCoverSourcePreview: { assetId: cover.assetId, revisionId: cover.revisionId } }
        : {}),
    });
    if (src) map.set(cover.folderId, src);
  }
  return map;
}
