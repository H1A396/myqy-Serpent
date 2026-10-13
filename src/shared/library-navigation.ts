import { z } from 'zod';

import {
  collectionSummarySchema,
  linkedFolderSummarySchema,
  managedFolderSummarySchema,
  smartCollectionSummarySchema,
  tagSummarySchema,
  trashedFolderSummarySchema,
} from './asset-types';

/**
 * One coherent read model for navigation chrome and its count badges. The
 * Worker keys this model by the library change sequence so a navigation
 * cannot mix folder rows from one mutation with collection counts from
 * another.
 */
/** Custom folder cover for sidebar and breadcrumb chrome. */
export const folderNavigationCoverSchema = z.strictObject({
  folderId: z.string().min(1).max(4096),
  /** Cache token for a cover file stored under the library. */
  fileToken: z.string().min(1).max(64).optional(),
  /** Library asset used as the cover. */
  assetId: z.string().min(1).max(255).optional(),
  artifactId: z.string().min(1).max(255).optional(),
  revisionId: z.string().min(1).max(255).optional(),
});

export type FolderNavigationCover = z.infer<typeof folderNavigationCoverSchema>;

export const libraryNavigationSummarySchema = z.strictObject({
  libraryId: z.string().min(1),
  changeSequence: z.number().int().nonnegative(),
  allAssetCount: z.number().int().nonnegative(),
  rootAssetCount: z.number().int().nonnegative(),
  trashedAssetCount: z.number().int().nonnegative(),
  folders: z.array(managedFolderSummarySchema),
  linkedFolders: z.array(linkedFolderSummarySchema),
  tags: z.array(tagSummarySchema),
  collections: z.array(collectionSummarySchema),
  smartCollections: z.array(smartCollectionSummarySchema),
  trashedFolders: z.array(trashedFolderSummarySchema),
  folderCovers: z.array(folderNavigationCoverSchema).max(20_000).optional(),
});

export type LibraryNavigationSummary = z.infer<typeof libraryNavigationSummarySchema>;
