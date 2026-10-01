import { z } from 'zod';

import {
  assetMetadataResultSchema,
  assetSummarySchema,
  extractedMetadataResultSchema,
} from './asset-types';

/**
 * Device-level "read-only web share" settings and runtime contract.
 *
 * A friend opens a browser through a tunnel (e.g. a local FRP client) and
 * browses the active library read-only. The desktop application owns the HTTP
 * listener; Main only advertises a loopback address here. The literal public
 * URL is supplied by the tunnel operator, never by Serpent.
 */
export const WEB_SHARE_DEFAULT_PORT = 47_890;
export const WEB_SHARE_MIN_PORT = 1_024;
export const WEB_SHARE_MAX_PORT = 65_535;
export const WEB_SHARE_SESSION_COOKIE = 'serpent_web_share' as const;
export const WEB_SHARE_SESSION_TTL_MS = 12 * 60 * 60 * 1_000;
/** Minimum share-password length; kept low because the tunnel is opt-in. */
export const WEB_SHARE_MIN_PASSWORD_LENGTH = 4;

/**
 * Bounded re-encode parameters for `GET /media/view`. The viewer loads the WebP
 * by default so a slow tunnel does not pull a 10–30 MB source.
 */
export const WEB_SHARE_DERIVATIVE_MAX_EDGE = 2_560;
export const WEB_SHARE_DERIVATIVE_QUALITY = 82;
/**
 * Second LOD tier. The viewer loads the 82 tier first; when the visitor zooms
 * in, it upgrades to this one. Same bounding edge, higher quality (larger
 * bytes). The settings page can pre-generate and size both tiers.
 */
export const WEB_SHARE_DERIVATIVE_QUALITY_HIGH = 100;
export const WEB_SHARE_DERIVATIVE_FORMATS = ['webp', 'jpeg', 'png'] as const;
export const webShareDerivativeFormatSchema = z.enum(WEB_SHARE_DERIVATIVE_FORMATS);
export type WebShareDerivativeFormat = z.infer<typeof webShareDerivativeFormatSchema>;

/**
 * The "Download" button re-encodes the *original* at full resolution to JPEG,
 * matching a Photoshop "quality 10" save: 4:4:4 chroma (colour edges stay
 * crisp), baseline by default, quality ~91. The original file stays behind the
 * separate "Download original" action.
 */
export const WEB_SHARE_DEFAULT_DOWNLOAD_QUALITY = 91;
export const WEB_SHARE_DEFAULT_DOWNLOAD_PROGRESSIVE = false;
export const WEB_SHARE_DOWNLOAD_CHROMA_SUBSAMPLING = '4:4:4' as const;

/**
 * Bounded re-encode parameters for `GET /media/thumbnail`. The grid tile is at
 * least 150 CSS px wide, but a page can request dozens of tiles at once, so the
 * share downscales the library's cached card artifact (never the original) to a
 * small longest edge. The desktop keeps its own larger card artifact; only the
 * read-only web share is reduced.
 */
export const WEB_SHARE_THUMBNAIL_FORMAT = 'webp' as const;
export const WEB_SHARE_THUMBNAIL_EDGES = [128, 256] as const;
export const webShareThumbnailEdgeSchema = z.union([z.literal(128), z.literal(256)]);
export type WebShareThumbnailEdge = z.infer<typeof webShareThumbnailEdgeSchema>;
export const WEB_SHARE_DEFAULT_THUMBNAIL_EDGE: WebShareThumbnailEdge = 128;
/** Sharpen is opt-in: a USM over-sharpens edge-dense art (halos). */
export const WEB_SHARE_DEFAULT_THUMBNAIL_SHARPEN = false;
/** Adaptive byte budget for one share tile; quality drops until it fits. */
export const WEB_SHARE_DEFAULT_THUMBNAIL_MAX_KB = 20;
export const WEB_SHARE_THUMBNAIL_MIN_KB = 4;
export const WEB_SHARE_THUMBNAIL_MAX_KB = 2048;

/** Progress of a running "regenerate share thumbnails" sweep. */
export const webShareThumbnailProgressSchema = z.strictObject({
  active: z.boolean(),
  total: z.number().int().nonnegative(),
  generated: z.number().int().nonnegative(),
  skipped: z.number().int().nonnegative(),
  failed: z.number().int().nonnegative(),
});
export type WebShareThumbnailProgress = z.infer<typeof webShareThumbnailProgressSchema>;

/**
 * A visitor names themselves; the share has no accounts, so the name is only a
 * label the operator sees in the visitor records. It is not a credential.
 */
export const WEB_SHARE_MAX_USERNAME_LENGTH = 64;
export const webShareUsernameSchema = z
  .string()
  .trim()
  .min(1)
  .max(WEB_SHARE_MAX_USERNAME_LENGTH);

/** A visitor's own mark on one asset, independent of the library's metadata. */
export const webShareVisitorMarkSchema = z.strictObject({
  libraryId: z.string().min(1).max(255),
  assetId: z.string().min(1).max(255),
  /** Display name captured when the mark was set, so the panel is readable. */
  assetName: z.string().max(512).nullable(),
  favorite: z.boolean(),
  rating: z.number().int().min(0).max(5),
  updatedAt: z.string().datetime(),
});
export type WebShareVisitorMark = z.infer<typeof webShareVisitorMarkSchema>;

/** Projection of one visitor for the operator's records panel and export. */
export const webShareVisitorSummarySchema = z.strictObject({
  visitorId: z.string().min(1).max(64),
  username: z.string().min(1).max(WEB_SHARE_MAX_USERNAME_LENGTH),
  firstSeenAt: z.string().datetime(),
  lastSeenAt: z.string().datetime(),
  lastIp: z.string().max(128).nullable(),
  lastUserAgent: z.string().max(1024).nullable(),
  /** Number of times the visitor signed in. */
  accesses: z.number().int().nonnegative(),
  marks: z.array(webShareVisitorMarkSchema).max(5_000),
});
export type WebShareVisitorSummary = z.infer<typeof webShareVisitorSummarySchema>;

/** Bound on how many visitors the settings panel loads in one response. */
export const WEB_SHARE_VISITOR_LIST_LIMIT = 500;

export const webShareServerPreferencesSchema = z.strictObject({
  enabled: z.boolean(),
  port: z.number().int().min(WEB_SHARE_MIN_PORT).max(WEB_SHARE_MAX_PORT),
  /** Whether visitors may download the original source file. */
  allowDownload: z.boolean(),
  /**
   * The single library exposed to visitors. `null` shares the first currently
   * open library so a newly enabled share is useful without extra setup.
   */
  sharedLibraryId: z.string().min(1).max(255).nullable(),
  /** Longest edge of the share-only grid thumbnails served to visitors. */
  thumbnailEdge: webShareThumbnailEdgeSchema,
  /** Apply a mild unsharp mask so downscaled tiles keep crisp edges. */
  thumbnailSharpen: z.boolean(),
  /** Byte budget per share tile; encode quality drops until it fits. */
  thumbnailMaxKb: z
    .number()
    .int()
    .min(WEB_SHARE_THUMBNAIL_MIN_KB)
    .max(WEB_SHARE_THUMBNAIL_MAX_KB),
  /** JPEG quality for the "Download" button (full-resolution re-encode). */
  downloadQuality: z.number().int().min(1).max(100),
  /** Progressive ("continuous") JPEG for the download; off = baseline. */
  downloadProgressive: z.boolean(),
});
export type WebShareServerPreferences = z.infer<typeof webShareServerPreferencesSchema>;

export const webShareRuntimeStateSchema = z.discriminatedUnion('status', [
  z.strictObject({ status: z.literal('stopped') }),
  z.strictObject({ status: z.literal('starting') }),
  z.strictObject({
    status: z.literal('running'),
    /** Loopback origin the local tunnel should forward to. */
    address: z.string().min(1).max(255),
    port: z.number().int().min(WEB_SHARE_MIN_PORT).max(WEB_SHARE_MAX_PORT),
    connectedSessionCount: z.number().int().nonnegative(),
    startedAt: z.string().datetime(),
  }),
  z.strictObject({ status: z.literal('stopping') }),
  z.strictObject({
    status: z.literal('error'),
    code: z.enum([
      'WEB_SHARE_PORT_UNAVAILABLE',
      'WEB_SHARE_START_FAILED',
      'WEB_SHARE_STOP_FAILED',
    ]),
    message: z.string().min(1).max(500),
  }),
]);
export type WebShareRuntimeState = z.infer<typeof webShareRuntimeStateSchema>;

/** Minimal projection of a library safe to expose to a read-only visitor. */
export const webShareLibrarySummarySchema = z.strictObject({
  libraryId: z.string().min(1).max(255),
  displayName: z.string().min(1).max(512),
});
export type WebShareLibrarySummary = z.infer<typeof webShareLibrarySummarySchema>;

export const webShareSettingsSnapshotSchema = z.strictObject({
  preferences: webShareServerPreferencesSchema,
  runtime: webShareRuntimeStateSchema,
  /** The snapshot never carries the password or its hash. */
  hasPassword: z.boolean(),
  /** Number of distinct visitors with a stored record. */
  visitorCount: z.number().int().nonnegative(),
  /** `null` when no regenerate sweep has run in this session. */
  thumbnailProgress: webShareThumbnailProgressSchema.nullable(),
  /** Libraries currently open on this device (same projection as the web API). */
  libraries: z.array(webShareLibrarySummarySchema).max(64),
});
export type WebShareSettingsSnapshot = z.infer<typeof webShareSettingsSnapshotSchema>;

export const webSharePasswordSchema = z
  .string()
  .min(WEB_SHARE_MIN_PASSWORD_LENGTH)
  .max(128);

export const webShareSettingsRequestSchema = z.discriminatedUnion('type', [
  z.strictObject({ type: z.literal('get') }),
  z.strictObject({ type: z.literal('enable'), enabled: z.boolean() }),
  z.strictObject({
    type: z.literal('set-port'),
    port: z.number().int().min(WEB_SHARE_MIN_PORT).max(WEB_SHARE_MAX_PORT),
  }),
  z.strictObject({ type: z.literal('set-allow-download'), enabled: z.boolean() }),
  z.strictObject({ type: z.literal('set-thumbnail-edge'), edge: webShareThumbnailEdgeSchema }),
  z.strictObject({ type: z.literal('set-thumbnail-sharpen'), enabled: z.boolean() }),
  z.strictObject({
    type: z.literal('set-thumbnail-max-kb'),
    maxKb: z.number().int().min(WEB_SHARE_THUMBNAIL_MIN_KB).max(WEB_SHARE_THUMBNAIL_MAX_KB),
  }),
  z.strictObject({
    type: z.literal('set-download-quality'),
    quality: z.number().int().min(1).max(100),
  }),
  z.strictObject({ type: z.literal('set-download-progressive'), enabled: z.boolean() }),
  z.strictObject({ type: z.literal('regenerate-thumbnails') }),
  z.strictObject({ type: z.literal('delete-thumbnails') }),
  z.strictObject({
    type: z.literal('set-library'),
    libraryId: z.string().min(1).max(255).nullable(),
  }),
  z.strictObject({ type: z.literal('set-password'), password: webSharePasswordSchema }),
  z.strictObject({ type: z.literal('clear-password') }),
  z.strictObject({ type: z.literal('start') }),
  z.strictObject({ type: z.literal('stop') }),
  z.strictObject({ type: z.literal('list-visitors') }),
  z.strictObject({ type: z.literal('export-visitors'), format: z.enum(['json', 'csv']) }),
]);
export type WebShareSettingsRequest = z.infer<typeof webShareSettingsRequestSchema>;

export const webShareSettingsResponseSchema = z.union([
  z.strictObject({
    ok: z.literal(true),
    snapshot: webShareSettingsSnapshotSchema,
  }),
  z.strictObject({
    ok: z.literal(true),
    visitors: z.array(webShareVisitorSummarySchema).max(WEB_SHARE_VISITOR_LIST_LIMIT),
  }),
  z.strictObject({
    ok: z.literal(true),
    /** Absolute path the export was written to; `null` when the user canceled. */
    exportedPath: z.string().min(1).max(4096).nullable(),
  }),
  z.strictObject({
    ok: z.literal(false),
    code: z.string().min(1).max(128),
    message: z.string().min(1).max(500),
    snapshot: webShareSettingsSnapshotSchema.optional(),
  }),
]);
export type WebShareSettingsResponse = z.infer<typeof webShareSettingsResponseSchema>;

export interface SerpentWebShareSettingsApi {
  request(input: WebShareSettingsRequest): Promise<WebShareSettingsResponse>;
  onChanged(listener: (snapshot: WebShareSettingsSnapshot) => void): () => void;
}

/**
 * Read-only asset detail returned by `GET /api/libraries/:id/assets/:assetId`.
 * It deliberately reuses the desktop summary/metadata shapes so the web client
 * and the desktop projection stay in sync.
 */
export const webShareAssetDetailSchema = z.strictObject({
  asset: assetSummarySchema,
  metadata: assetMetadataResultSchema,
  extracted: extractedMetadataResultSchema,
});
export type WebShareAssetDetail = z.infer<typeof webShareAssetDetailSchema>;

export const webShareSearchResultSchema = z.strictObject({
  items: z.array(assetSummarySchema),
  total: z.number().int().nonnegative(),
  offset: z.number().int().nonnegative(),
});
export type WebShareSearchResult = z.infer<typeof webShareSearchResultSchema>;
