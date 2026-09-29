import {
  createHmac,
  randomBytes,
  scryptSync,
  timingSafeEqual,
} from 'node:crypto';

const PASSWORD_SALT_BYTES = 16;
const PASSWORD_KEY_BYTES = 32;
const SESSION_TOKEN_PREFIX = 'v1';

/** Stored form of the operator's share password. */
export interface WebSharePasswordRecord {
  salt: string;
  hash: string;
}

function deriveKey(password: string, salt: Buffer): Buffer {
  return scryptSync(password, salt, PASSWORD_KEY_BYTES);
}

function constantTimeEqual(left: Buffer, right: Buffer): boolean {
  return left.byteLength === right.byteLength && timingSafeEqual(left, right);
}

export function createWebSharePasswordRecord(password: string): WebSharePasswordRecord {
  const salt = randomBytes(PASSWORD_SALT_BYTES);
  const hash = deriveKey(password, salt);
  return { salt: salt.toString('base64url'), hash: hash.toString('base64url') };
}

export function verifyWebSharePassword(
  password: string,
  record: WebSharePasswordRecord,
): boolean {
  try {
    const salt = Buffer.from(record.salt, 'base64url');
    const expected = Buffer.from(record.hash, 'base64url');
    if (expected.byteLength !== PASSWORD_KEY_BYTES) return false;
    return constantTimeEqual(deriveKey(password, salt), expected);
  } catch {
    return false;
  }
}

/**
 * Stateless signed session cookie. The value is
 * `<version>.<subject>.<issuedAtMs>.<hmac>` where `subject` is the visitor id,
 * so a restart keeps existing visitors signed in as long as the secret and the
 * TTL allow it. The cookie proves only that this browser signed in; it grants
 * no library write access.
 */
const SESSION_SUBJECT_PATTERN = /^[A-Za-z0-9_-]{1,64}$/u;

export class WebShareSessionSigner {
  readonly #secret: string;
  readonly #ttlMs: number;

  constructor(secret: string, ttlMs: number) {
    this.#secret = secret;
    this.#ttlMs = ttlMs;
  }

  #signature(subject: string, issuedAtMs: number): string {
    return createHmac('sha256', this.#secret)
      .update(`${SESSION_TOKEN_PREFIX}.${subject}.${issuedAtMs}`)
      .digest('base64url');
  }

  issue(subject: string, nowMs: number = Date.now()): string {
    return `${SESSION_TOKEN_PREFIX}.${subject}.${nowMs}.${this.#signature(subject, nowMs)}`;
  }

  /** Returns the visitor id when authentic and fresh, otherwise `null`. */
  verify(value: string, nowMs: number = Date.now()): string | null {
    const parts = value.split('.');
    if (parts.length !== 4) return null;
    const [version, subject, issuedAtText, signature] = parts as [
      string,
      string,
      string,
      string,
    ];
    if (version !== SESSION_TOKEN_PREFIX) return null;
    if (!SESSION_SUBJECT_PATTERN.test(subject)) return null;
    if (!/^\d{1,20}$/u.test(issuedAtText)) return null;
    const issuedAtMs = Number(issuedAtText);
    if (!Number.isSafeInteger(issuedAtMs) || issuedAtMs <= 0) return null;
    const age = nowMs - issuedAtMs;
    if (age < 0 || age > this.#ttlMs) return null;
    const expected = Buffer.from(this.#signature(subject, issuedAtMs));
    const provided = Buffer.from(signature);
    return constantTimeEqual(expected, provided) ? subject : null;
  }
}

interface ThrottleEntry {
  failures: number;
  blockedUntilMs: number;
}

const THROTTLE_THRESHOLD = 5;
const THROTTLE_BASE_DELAY_MS = 1_000;
const THROTTLE_MAX_DELAY_MS = 5 * 60_000;
/** Bound memory from a stream of spoofed/rotating keys. */
const THROTTLE_MAX_KEYS = 512;

/**
 * Small in-memory login throttle. Read-only visitors share one password, so a
 * tunnel-exposed endpoint needs a bounded, monotonically degrading delay rather
 * than an unlimited password oracle.
 */
export class WebShareLoginThrottle {
  readonly #entries = new Map<string, ThrottleEntry>();
  readonly #now: () => number;

  constructor(now: () => number = Date.now) {
    this.#now = now;
  }

  isBlocked(key: string): boolean {
    const entry = this.#entries.get(key);
    if (entry === undefined) return false;
    return entry.blockedUntilMs > this.#now();
  }

  /** Returns the remaining block duration in ms (0 when not blocked). */
  blockedForMs(key: string): number {
    const entry = this.#entries.get(key);
    if (entry === undefined) return 0;
    return Math.max(0, entry.blockedUntilMs - this.#now());
  }

  recordFailure(key: string): void {
    const now = this.#now();
    const previous = this.#entries.get(key);
    const failures = (previous?.failures ?? 0) + 1;
    let blockedUntilMs = previous?.blockedUntilMs ?? 0;
    if (failures >= THROTTLE_THRESHOLD) {
      const step = failures - THROTTLE_THRESHOLD;
      const delay = Math.min(THROTTLE_MAX_DELAY_MS, THROTTLE_BASE_DELAY_MS * 2 ** step);
      blockedUntilMs = now + delay;
    }
    this.#entries.set(key, { failures, blockedUntilMs });
    this.#prune(now);
  }

  reset(key: string): void {
    this.#entries.delete(key);
  }

  #prune(now: number): void {
    if (this.#entries.size <= THROTTLE_MAX_KEYS) return;
    for (const [key, entry] of this.#entries) {
      if (entry.blockedUntilMs <= now) this.#entries.delete(key);
      if (this.#entries.size <= THROTTLE_MAX_KEYS) return;
    }
    // Still over budget: drop the oldest insertions (Map preserves order).
    const overflow = this.#entries.size - THROTTLE_MAX_KEYS;
    let dropped = 0;
    for (const key of this.#entries.keys()) {
      this.#entries.delete(key);
      dropped += 1;
      if (dropped >= overflow) break;
    }
  }
}
