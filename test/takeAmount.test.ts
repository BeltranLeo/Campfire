import { describe, expect, it } from 'vitest';
import { effectiveMode, resolveAmount, usablePrice } from '../src/web/takeAmount';

const base = { min: 100_000n, max: 10_000_000n, assetDecimals: 8, unitPrice: '500000', marginBps: 0 };

describe('effectiveMode', () => {
  it('uses fiat only for BCH with a price', () => {
    expect(effectiveMode('fiat', { isBch: true, hasPrice: true })).toBe('fiat');
    expect(effectiveMode('fiat', { isBch: true, hasPrice: false })).toBe('coin');
    expect(effectiveMode('fiat', { isBch: false, hasPrice: true })).toBe('coin');
    expect(effectiveMode('coin', { isBch: true, hasPrice: true })).toBe('coin');
  });
});

describe('usablePrice', () => {
  it('rejects missing or malformed prices', () => {
    expect(usablePrice('500000', 0, 8)).toBe(true);
    expect(usablePrice(null, 0, 8)).toBe(false);
    expect(usablePrice('1e5', 0, 8)).toBe(false);
    expect(usablePrice('0', 0, 8)).toBe(false);
  });
});

describe('resolveAmount', () => {
  it('converts fiat to units at the offer price', () => {
    // 10,000 at 500,000 per BCH = 0.02 BCH
    expect(resolveAmount({ ...base, mode: 'fiat', input: '10,000' })).toEqual({ units: 2_000_000n, state: 'ok' });
  });
  it('applies the margin', () => {
    expect(resolveAmount({ ...base, mode: 'fiat', input: '10000', marginBps: 1000 }).units).toBe(1_818_181n);
  });
  it('flags out-of-range and invalid fiat', () => {
    expect(resolveAmount({ ...base, mode: 'fiat', input: '1' }).state).toBe('range');
    expect(resolveAmount({ ...base, mode: 'fiat', input: '999999' }).state).toBe('range');
    expect(resolveAmount({ ...base, mode: 'fiat', input: 'abc' })).toEqual({ units: null, state: 'invalid' });
    expect(resolveAmount({ ...base, mode: 'fiat', input: '' }).state).toBe('invalid');
  });
  it('accepts the exact fiat price of the minimum even when rounding falls short', () => {
    const odd = { ...base, unitPrice: '333333.33', min: 123_457n };
    expect(resolveAmount({ ...odd, mode: 'fiat', input: '411.52' }).state).toBe('ok');
  });
  it('reads coin amounts as before', () => {
    expect(resolveAmount({ ...base, mode: 'coin', input: '0.02' })).toEqual({ units: 2_000_000n, state: 'ok' });
    expect(resolveAmount({ ...base, mode: 'coin', input: '0.0001' }).state).toBe('range');
    expect(resolveAmount({ ...base, mode: 'coin', input: 'x' }).state).toBe('invalid');
  });
});
