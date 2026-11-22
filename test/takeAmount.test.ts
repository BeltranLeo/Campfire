import { describe, expect, it } from 'vitest';
import { effectiveMode, resolveAmount, usablePrice } from '../src/web/takeAmount';

const base = { min: 100_000n, max: 10_000_000n, assetDecimals: 8, unitPrice: '500000', marginBps: 0 };

describe('effectiveMode', () => {
  it('uses fiat whenever there is a price, for any coin', () => {
    expect(effectiveMode('fiat', { hasPrice: true })).toBe('fiat');
    expect(effectiveMode('fiat', { hasPrice: false })).toBe('coin');
    expect(effectiveMode('coin', { hasPrice: true })).toBe('coin');
  });

  it('turns pesos into PUSD cents, rounding down, and accepts exactly the price of the minimum', () => {
    // 1 PUSD at 1,776.43 ARS: 1,776.43 ARS buys 1.00 PUSD, 3,000 ARS buys 1.68 PUSD.
    const pusd = { mode: 'fiat' as const, min: 100n, max: 500n, assetDecimals: 2, unitPrice: '1776.43', marginBps: 0 };
    expect(resolveAmount({ ...pusd, input: '1776.43' })).toEqual({ units: 100n, state: 'ok' });
    expect(resolveAmount({ ...pusd, input: '3000' })).toEqual({ units: 168n, state: 'ok' });
    expect(resolveAmount({ ...pusd, input: '1000' })).toEqual({ units: 56n, state: 'range' });
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
