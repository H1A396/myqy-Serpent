import { randomBytes } from 'node:crypto';
import path from 'node:path';

import { z } from 'zod';

import {
  WEB_SHARE_DEFAULT_AUTO_TUNNEL,
  WEB_SHARE_DEFAULT_DOWNLOAD_PROGRESSIVE,
  WEB_SHARE_DEFAULT_DOWNLOAD_QUALITY,
  WEB_SHARE_DEFAULT_PORT,
  WEB_SHARE_DEFAULT_THUMBNAIL_EDGE,
  WEB_SHARE_DEFAULT_THUMBNAIL_MAX_KB,
  WEB_SHARE_DEFAULT_THUMBNAIL_SHARPEN,
  webShareServerPreferencesSchema,
  type WebShareServerPreferences,
} from '../../shared/web-share';
import { readAtomicJsonFile, writeAtomicJsonFile } from '../../main/atomic-json-file';

const passwordRecordSchema = z.strictObject({
  salt: z.string().regex(/^[A-Za-z0-9_-]{16,128}$/u),
  hash: z.string().regex(/^[A-Za-z0-9_-]{32,256}$/u),
});
type PasswordRecord = z.infer<typeof passwordRecordSchema>;

const persistedWebShareSettingsSchema = z.strictObject({
  version: z.literal(1),
  preferences: z.strictObject({
    enabled: z.boolean(),
    port: z.number().int().min(1024).max(65_535),
    allowDownload: z.boolean(),
    sharedLibraryId: z.string().min(1).max(255).nullable().optional(),
    thumbnailEdge: z.union([z.literal(128), z.literal(256)]).optional(),
    thumbnailSharpen: z.boolean().optional(),
    thumbnailMaxKb: z.number().int().min(4).max(2048).optional(),
    downloadQuality: z.number().int().min(1).max(100).optional(),
    downloadProgressive: z.boolean().optional(),
    autoTunnel: z.boolean().optional(),
    cloudflaredPath: z.string().max(1024).nullable().optional(),
    tunnelName: z.string().max(255).nullable().optional(),
    tunnelHostname: z.string().max(255).nullable().optional(),
  }),
  /** Absent until the operator sets a share password. */
  password: passwordRecordSchema.nullable().optional(),
  /** HMAC key for sessions; generated once and kept secret. */
  sessionSecret: z.string().regex(/^[A-Za-z0-9_-]{32,128}$/u).optional(),
});

const DEFAULT_PREFERENCES: WebShareServerPreferences = {
  enabled: false,
  port: WEB_SHARE_DEFAULT_PORT,
  allowDownload: true,
  sharedLibraryId: null,
  thumbnailEdge: WEB_SHARE_DEFAULT_THUMBNAIL_EDGE,
  thumbnailSharpen: WEB_SHARE_DEFAULT_THUMBNAIL_SHARPEN,
  thumbnailMaxKb: WEB_SHARE_DEFAULT_THUMBNAIL_MAX_KB,
  downloadQuality: WEB_SHARE_DEFAULT_DOWNLOAD_QUALITY,
  downloadProgressive: WEB_SHARE_DEFAULT_DOWNLOAD_PROGRESSIVE,
  autoTunnel: WEB_SHARE_DEFAULT_AUTO_TUNNEL,
  cloudflaredPath: null,
  tunnelName: null,
  tunnelHostname: null,
};

const SESSION_SECRET_BYTES = 32;

export class WebShareSettingsStore {
  readonly #filePath: string;
  #preferences: WebShareServerPreferences = { ...DEFAULT_PREFERENCES };
  #password: PasswordRecord | null = null;
  #sessionSecret: string;

  constructor(userDataPath: string) {
    this.#filePath = path.join(userDataPath, 'web-share-settings.json');
    this.#sessionSecret = randomBytes(SESSION_SECRET_BYTES).toString('base64url');
    this.load();
  }

  get preferences(): WebShareServerPreferences {
    return { ...this.#preferences };
  }

  get password(): PasswordRecord | null {
    return this.#password ? { ...this.#password } : null;
  }

  get sessionSecret(): string {
    return this.#sessionSecret;
  }

  setPreferences(patch: Partial<WebShareServerPreferences>): WebShareServerPreferences {
    const next = webShareServerPreferencesSchema.parse({
      ...this.#preferences,
      ...patch,
    });
    this.#preferences = next;
    this.persist();
    return this.preferences;
  }

  setPassword(record: PasswordRecord): void {
    this.#password = { ...record };
    this.persist();
  }

  clearPassword(): void {
    this.#password = null;
    this.persist();
  }

  /**
   * Replace the session-signing secret. Every previously issued session cookie
   * becomes invalid, which is exactly what a password change must guarantee.
   */
  rotateSessionSecret(): string {
    this.#sessionSecret = randomBytes(SESSION_SECRET_BYTES).toString('base64url');
    this.persist();
    return this.#sessionSecret;
  }

  private load(): void {
    try {
      const contents = readAtomicJsonFile(this.#filePath);
      if (contents === undefined) return;
      const parsed = persistedWebShareSettingsSchema.safeParse(JSON.parse(contents));
      if (!parsed.success) return;
      this.#preferences = {
        ...DEFAULT_PREFERENCES,
        ...parsed.data.preferences,
        sharedLibraryId: parsed.data.preferences.sharedLibraryId ?? null,
      };
      this.#password = parsed.data.password ?? null;
      if (parsed.data.sessionSecret !== undefined) {
        this.#sessionSecret = parsed.data.sessionSecret;
      }
    } catch {
      this.#preferences = { ...DEFAULT_PREFERENCES };
      this.#password = null;
    }
  }

  private persist(): void {
    writeAtomicJsonFile(
      this.#filePath,
      JSON.stringify(
        {
          version: 1,
          preferences: this.#preferences,
          password: this.#password,
          sessionSecret: this.#sessionSecret,
        },
        null,
        2,
      ),
    );
  }
}
