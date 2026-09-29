import { describe, expect, it } from 'vitest';

import {
  WEB_SHARE_DERIVATIVE_FORMATS,
  WEB_SHARE_DERIVATIVE_MAX_EDGE,
  WEB_SHARE_DERIVATIVE_QUALITY,
  WEB_SHARE_MIN_PASSWORD_LENGTH,
  webShareDerivativeFormatSchema,
  webSharePasswordSchema,
  webShareSettingsRequestSchema,
} from '../../src/shared/web-share';

describe('web share password contract', () => {
  it('accepts a password at the minimum length', () => {
    const password = 'a'.repeat(WEB_SHARE_MIN_PASSWORD_LENGTH);
    expect(webSharePasswordSchema.safeParse(password).success).toBe(true);
    expect(
      webShareSettingsRequestSchema.safeParse({ type: 'set-password', password }).success,
    ).toBe(true);
  });

  it('rejects a password shorter than the minimum length', () => {
    const password = 'a'.repeat(WEB_SHARE_MIN_PASSWORD_LENGTH - 1);
    expect(webSharePasswordSchema.safeParse(password).success).toBe(false);
    expect(
      webShareSettingsRequestSchema.safeParse({ type: 'set-password', password }).success,
    ).toBe(false);
  });

  it('keeps the minimum length at 4', () => {
    expect(WEB_SHARE_MIN_PASSWORD_LENGTH).toBe(4);
  });
});

describe('web share derivative contract', () => {
  it('accepts exactly the formats the encoder can produce', () => {
    expect([...WEB_SHARE_DERIVATIVE_FORMATS]).toEqual(['webp', 'jpeg', 'png']);
    for (const format of WEB_SHARE_DERIVATIVE_FORMATS) {
      expect(webShareDerivativeFormatSchema.safeParse(format).success).toBe(true);
    }
    expect(webShareDerivativeFormatSchema.safeParse('tiff').success).toBe(false);
  });

  it('bounds the size so a derivative cannot be a full-resolution copy', () => {
    expect(WEB_SHARE_DERIVATIVE_MAX_EDGE).toBeLessThanOrEqual(4096);
    expect(WEB_SHARE_DERIVATIVE_MAX_EDGE).toBeGreaterThanOrEqual(1024);
    expect(WEB_SHARE_DERIVATIVE_QUALITY).toBeGreaterThanOrEqual(60);
    expect(WEB_SHARE_DERIVATIVE_QUALITY).toBeLessThanOrEqual(95);
  });
});
