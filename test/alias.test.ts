import { describe, expect, it } from 'vitest';
import { aliasFor } from '../src/web/alias.js';

const hex = (n: number) => n.toString(16).padStart(64, 'a');

describe('aliasFor', () => {
  it('gives the same alias for the same identity', () => {
    expect(aliasFor(hex(7))).toEqual(aliasFor(hex(7)));
  });

  it('usually gives different aliases for different identities', () => {
    const names = new Set(Array.from({ length: 200 }, (_, i) => aliasFor(hex(i)).name));
    expect(names.size).toBeGreaterThan(150);
  });

  it('gives two uppercase letters and a hue in range', () => {
    for (let i = 0; i < 100; i++) {
      const { initials, hue, name } = aliasFor(hex(i));
      expect(initials).toMatch(/^[A-Z]{2}$/);
      expect(hue).toBeGreaterThanOrEqual(0);
      expect(hue).toBeLessThan(360);
      expect(name.split(' ')).toHaveLength(2);
    }
  });

  it('does not throw on short or odd input', () => {
    for (const input of ['', 'a', '  ', 'zz-ñ-😀', '0'.repeat(5000)]) {
      const alias = aliasFor(input);
      expect(alias.initials).toHaveLength(2);
    }
  });
});
