import { describe, expect, it } from 'vitest';
import { parseAdvanced } from '../src/web/advanced.js';

describe('the technical details switch', () => {
  it('is on only when the browser stored "1"', () => {
    expect(parseAdvanced('1')).toBe(true);
    expect(parseAdvanced(null)).toBe(false);
    expect(parseAdvanced('true')).toBe(false);
    expect(parseAdvanced('')).toBe(false);
  });
});
