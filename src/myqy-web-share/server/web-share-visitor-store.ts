import { randomBytes } from 'node:crypto';
import path from 'node:path';

import { z } from 'zod';

import {
  WEB_SHARE_MAX_USERNAME_LENGTH,
  type WebShareVisitorMark,
  type WebShareVisitorSummary,
} from '../../shared/web-share';
import { readAtomicJsonFile, writeAtomicJsonFile } from '../../main/atomic-json-file';

/** Bound the rich per-visitor activity log so the file cannot grow forever. */
const MAX_EVENTS_PER_VISITOR = 500;
const MAX_VISITORS = 5_000;
const MAX_MARKS_PER_VISITOR = 5_000;
const VISITOR_ID_BYTES = 16;

const markRecordSchema = z.strictObject({
  favorite: z.boolean(),
  rating: z.number().int().min(0).max(5),
  updatedAt: z.string(),
  assetName: z.string().max(512).nullable().optional(),
});

const eventSchema = z.strictObject({
  at: z.string(),
  kind: z.enum(['login', 'favorite', 'rating']),
  ip: z.string().max(128).nullable().optional(),
  userAgent: z.string().max(1024).nullable().optional(),
  libraryId: z.string().max(255).optional(),
  assetId: z.string().max(255).optional(),
  favorite: z.boolean().optional(),
  rating: z.number().int().min(0).max(5).optional(),
});

const visitorRecordSchema = z.strictObject({
  visitorId: z.string().min(1).max(64),
  username: z.string().min(1).max(WEB_SHARE_MAX_USERNAME_LENGTH),
  firstSeenAt: z.string(),
  lastSeenAt: z.string(),
  accesses: z.number().int().nonnegative(),
  lastIp: z.string().max(128).nullable(),
  lastUserAgent: z.string().max(1024).nullable(),
  marks: z.record(z.string(), markRecordSchema),
  events: z.array(eventSchema).max(MAX_EVENTS_PER_VISITOR),
});

const persistedSchema = z.strictObject({
  version: z.literal(1),
  visitors: z.record(z.string(), visitorRecordSchema),
});

type Event = z.infer<typeof eventSchema>;
type MarkRecord = z.infer<typeof markRecordSchema>;
type VisitorRecord = z.infer<typeof visitorRecordSchema>;

export interface VisitorSnapshot {
  favorite: boolean;
  rating: number;
}

function markKey(libraryId: string, assetId: string): string {
  return `${libraryId}\u0000${assetId}`;
}

function normalizeUsername(username: string): string {
  return username.trim().slice(0, WEB_SHARE_MAX_USERNAME_LENGTH);
}

/**
 * Device-level store for read-only web-share visitors.
 *
 * The share has no accounts: a visitor types a name and gets a long-lived id.
 * Their likes and ratings are kept here, never in the shared library, so a
 * visitor can never change the operator's metadata. The operator's records
 * panel and export read back exactly what is persisted (name, IP, user agent,
 * first/last seen, per-asset marks, and a bounded activity log).
 */
export class WebShareVisitorStore {
  readonly #filePath: string;
  readonly #visitors = new Map<string, VisitorRecord>();
  readonly #byUsername = new Map<string, string>();

  constructor(userDataPath: string) {
    this.#filePath = path.join(userDataPath, 'web-share-visitors.json');
    this.#load();
  }

  get count(): number {
    return this.#visitors.size;
  }

  /** True when the id still has a record (e.g. after the file was cleared). */
  has(visitorId: string): boolean {
    return this.#visitors.has(visitorId);
  }

  /** Resolve an existing visitor by name so a returning visitor resumes. */
  findIdByName(username: string): string | undefined {
    return this.#byUsername.get(normalizeUsername(username).toLowerCase());
  }

  /**
   * Sign a visitor in: reuse the record for a known name (or the same id when
   * supplied), otherwise create one. Returns the visitor id to put in the
   * session cookie.
   */
  authenticate(input: {
    username: string;
    ip: string | null;
    userAgent: string | null;
    now: string;
  }): string {
    const username = normalizeUsername(input.username);
    const knownId = this.#byUsername.get(username.toLowerCase());
    const visitorId = knownId ?? this.#createVisitor(username, input);
    const record = this.#visitors.get(visitorId)!;
    if (knownId !== undefined) {
      record.username = username;
      record.lastSeenAt = input.now;
      record.accesses += 1;
      record.lastIp = input.ip;
      record.lastUserAgent = input.userAgent;
      this.#pushEvent(record, {
        at: input.now,
        kind: 'login',
        ip: input.ip,
        userAgent: input.userAgent,
      });
      this.#byUsername.set(username.toLowerCase(), visitorId);
    }
    this.#persist();
    return visitorId;
  }

  usernameOf(visitorId: string): string | null {
    return this.#visitors.get(visitorId)?.username ?? null;
  }

  getMarks(visitorId: string, libraryId: string, assetId: string): VisitorSnapshot {
    const mark = this.#visitors.get(visitorId)?.marks[markKey(libraryId, assetId)];
    return { favorite: mark?.favorite ?? false, rating: mark?.rating ?? 0 };
  }

  /**
   * Apply a partial mark. Omitted fields keep their current value so a star
   * click never clobbers a previously toggled favorite.
   */
  setMark(input: {
    visitorId: string;
    libraryId: string;
    assetId: string;
    favorite?: boolean;
    rating?: number;
    assetName?: string;
    ip: string | null;
    userAgent: string | null;
    now: string;
  }): VisitorSnapshot {
    const record = this.#visitors.get(input.visitorId);
    if (record === undefined) return { favorite: false, rating: 0 };
    const key = markKey(input.libraryId, input.assetId);
    const previous = record.marks[key];
    if (previous === undefined && Object.keys(record.marks).length >= MAX_MARKS_PER_VISITOR) {
      return { favorite: false, rating: 0 };
    }
    const next: MarkRecord = {
      favorite: input.favorite ?? previous?.favorite ?? false,
      rating: input.rating ?? previous?.rating ?? 0,
      updatedAt: input.now,
      assetName: input.assetName ?? previous?.assetName ?? null,
    };
    record.marks[key] = next;
    if (input.favorite !== undefined) {
      this.#pushEvent(record, {
        at: input.now,
        kind: 'favorite',
        favorite: next.favorite,
        libraryId: input.libraryId,
        assetId: input.assetId,
        ip: input.ip,
        userAgent: input.userAgent,
      });
    }
    if (input.rating !== undefined) {
      this.#pushEvent(record, {
        at: input.now,
        kind: 'rating',
        rating: next.rating,
        libraryId: input.libraryId,
        assetId: input.assetId,
        ip: input.ip,
        userAgent: input.userAgent,
      });
    }
    record.lastSeenAt = input.now;
    record.lastIp = input.ip;
    record.lastUserAgent = input.userAgent;
    this.#touch(input.visitorId, record);
    this.#persist();
    return { favorite: next.favorite, rating: next.rating };
  }

  /** Every visitor with their marks, newest activity first, for the panel. */
  listSummaries(): WebShareVisitorSummary[] {
    const summaries: WebShareVisitorSummary[] = [];
    for (const record of this.#visitors.values()) {
      const marks: WebShareVisitorMark[] = Object.entries(record.marks).map(([key, mark]) => {
        const separator = key.indexOf('\u0000');
        return {
          libraryId: separator < 0 ? key : key.slice(0, separator),
          assetId: separator < 0 ? '' : key.slice(separator + 1),
          assetName: mark.assetName ?? null,
          favorite: mark.favorite,
          rating: mark.rating,
          updatedAt: mark.updatedAt,
        };
      });
      summaries.push({
        visitorId: record.visitorId,
        username: record.username,
        firstSeenAt: record.firstSeenAt,
        lastSeenAt: record.lastSeenAt,
        lastIp: record.lastIp,
        lastUserAgent: record.lastUserAgent,
        accesses: record.accesses,
        marks,
      });
    }
    summaries.sort((left, right) => (left.lastSeenAt < right.lastSeenAt ? 1 : -1));
    return summaries;
  }

  #createVisitor(
    username: string,
    input: { ip: string | null; userAgent: string | null; now: string },
  ): string {
    const visitorId = randomBytes(VISITOR_ID_BYTES).toString('base64url');
    const record: VisitorRecord = {
      visitorId,
      username,
      firstSeenAt: input.now,
      lastSeenAt: input.now,
      accesses: 1,
      lastIp: input.ip,
      lastUserAgent: input.userAgent,
      marks: {},
      events: [],
    };
    this.#pushEvent(record, {
      at: input.now,
      kind: 'login',
      ip: input.ip,
      userAgent: input.userAgent,
    });
    this.#visitors.set(visitorId, record);
    this.#byUsername.set(username.toLowerCase(), visitorId);
    // Bound the file: drop the least-recently-seen visitors past the cap.
    if (this.#visitors.size > MAX_VISITORS) {
      const oldest = this.listSummaries().slice(MAX_VISITORS);
      for (const summary of oldest) {
        this.#visitors.delete(summary.visitorId);
        this.#byUsername.delete(summary.username.toLowerCase());
      }
    }
    return visitorId;
  }

  #touch(visitorId: string, record: VisitorRecord): void {
    // Keep the id stable but refresh the name index in case the label changed.
    this.#byUsername.set(record.username.toLowerCase(), visitorId);
  }

  #pushEvent(record: VisitorRecord, event: Event): void {
    record.events.push(event);
    if (record.events.length > MAX_EVENTS_PER_VISITOR) {
      record.events.splice(0, record.events.length - MAX_EVENTS_PER_VISITOR);
    }
  }

  #load(): void {
    try {
      const contents = readAtomicJsonFile(this.#filePath);
      if (contents === undefined) return;
      const parsed = persistedSchema.safeParse(JSON.parse(contents));
      if (!parsed.success) return;
      for (const record of Object.values(parsed.data.visitors)) {
        this.#visitors.set(record.visitorId, record);
        this.#byUsername.set(record.username.toLowerCase(), record.visitorId);
      }
    } catch {
      this.#visitors.clear();
      this.#byUsername.clear();
    }
  }

  #persist(): void {
    const visitors: Record<string, VisitorRecord> = {};
    for (const [visitorId, record] of this.#visitors) visitors[visitorId] = record;
    writeAtomicJsonFile(
      this.#filePath,
      JSON.stringify({ version: 1, visitors }, null, 2),
    );
  }
}
