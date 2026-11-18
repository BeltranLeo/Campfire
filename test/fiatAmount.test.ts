import { describe, expect, it } from 'vitest';
import { fiatForUnits, parseFiatCents, unitsForFiat } from '../src/web/fiatAmount.js';

describe('parseFiatCents', () => {
  it('reads thousands separators and decimals', () => {
    expect(parseFiatCents('10,000')).toBe(1_000_000n);
    expect(parseFiatCents('10000.5')).toBe(1_000_050n);
    expect(parseFiatCents('0,5')).toBe(50n);
  });
  it('refuses zero, junk and more than two decimals', () => {
    expect(parseFiatCents('0')).toBeNull();
    expect(parseFiatCents('abc')).toBeNull();
    expect(parseFiatCents('1.234')).toBeNull();
  });
});

describe('unitsForFiat', () => {
  it('gives the sats that cost at most the typed amount', () => {
    // 10,000 ARS at 359,771 ARS/BCH = 0.0277954585… BCH, rounded down.
    const units = unitsForFiat({ fiatCents: 1_000_000n, unitPrice: '359771', assetDecimals: 8 });
    expect(units).toBe(2_779_545n);
    expect(Number(fiatForUnits({ units: units!, unitPrice: '359771', assetDecimals: 8 }))).toBeLessThanOrEqual(10_000);
  });
  it('applies the margin the same way the protocol does', () => {
    const units = unitsForFiat({ fiatCents: 1_000_000n, unitPrice: '359771.5', marginBps: 250, assetDecimals: 8 })!;
    const back = Number(fiatForUnits({ units, unitPrice: '359771.5', marginBps: 250, assetDecimals: 8 }));
    expect(back).toBeLessThanOrEqual(10_000);
    expect(back).toBeGreaterThan(9_999.98);
  });
  it('returns null for a price it cannot read', () => {
    expect(unitsForFiat({ fiatCents: 100n, unitPrice: '0', assetDecimals: 8 })).toBeNull();
    expect(unitsForFiat({ fiatCents: 100n, unitPrice: '1e5', assetDecimals: 8 })).toBeNull();
  });
});
