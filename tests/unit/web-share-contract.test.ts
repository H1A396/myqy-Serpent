import { describe, expect, it } from 'vitest';

import {
  WEB_SHARE_MIN_PASSWORD_LENGTH,
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
