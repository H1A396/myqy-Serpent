import { describe, expect, it } from 'vitest';

import { mediaTypeLabel, truncateMiddle } from '../../src/myqy-web-share/client/format';

describe('web share format helpers', () => {
  it('localizes media types for the detail panel', () => {
    expect(mediaTypeLabel('image', true)).toBe('图片');
    expect(mediaTypeLabel('image', false)).toBe('Image');
    expect(mediaTypeLabel('unknown', true)).toBe('unknown');
  });

  it('keeps short filenames unchanged', () => {
    expect(truncateMiddle('Krea2-文生图_00070.png')).toBe('Krea2-文生图_00070.png');
  });

  it('truncates long filenames in the middle and preserves the extension', () => {
    const result = truncateMiddle('Krea2-文生图_061_27094a7294e66ab2b81f752eed274a13d5964923f650fa12.png');
    expect(result.startsWith('Krea2-文生')).toBe(true);
    expect(result).toContain('…');
    expect(result.endsWith('.png')).toBe(true);
  });
});
