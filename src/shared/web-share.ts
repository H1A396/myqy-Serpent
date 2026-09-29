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
  z.strictObject({
    type: z.literal('set-library'),
    libraryId: z.string().min(1).max(255).nullable(),
  }),
  z.strictObject({ type: z.literal('set-password'), password: webSharePasswordSchema }),
  z.strictObject({ type: z.literal('clear-password') }),
  z.strictObject({ type: z.literal('start') }),
  z.strictObject({ type: z.literal('stop') }),
]);
export type WebShareSettingsRequest = z.infer<typeof webShareSettingsRequestSchema>;

export const webShareSettingsResponseSchema = z.union([
  z.strictObject({
    ok: z.literal(true),
    snapshot: webShareSettingsSnapshotSchema,
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
