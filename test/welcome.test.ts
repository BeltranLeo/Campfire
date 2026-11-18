import { describe, expect, it } from 'vitest';
import { afterQuestions, buildPrefs, initialFiat, offersPath } from '../src/web/welcome.js';

describe('welcome answers', () => {
  it('saves one currency and keeps the saved coins, or any', () => {
    expect(buildPrefs('buy', 'USD', null)).toEqual({ intent: 'buy', fiat: ['USD'], assets: [] });
    expect(buildPrefs('sell', 'ARS', { intent: 'both', fiat: ['ARS', 'USD'], assets: ['BCH'] })).toEqual({
      intent: 'sell',
      fiat: ['ARS'],
      assets: ['BCH'],
    });
  });
  it('opens the side of offers the person wants', () => {
    expect(offersPath('sell')).toBe('/offers?side=sell');
    expect(offersPath('buy')).toBe('/offers?side=buy');
    expect(offersPath('both')).toBe('/offers?side=buy');
  });
  it('lets people who are just looking skip the wallet steps', () => {
    expect(afterQuestions('both')).toBe('looking');
    expect(afterQuestions('buy')).toBe('wallet');
    expect(afterQuestions('sell')).toBe('wallet');
  });
  it('starts on the saved currency, else pesos', () => {
    expect(initialFiat(null)).toBe('ARS');
    expect(initialFiat({ intent: 'buy', fiat: [], assets: [] })).toBe('ARS');
    expect(initialFiat({ intent: 'buy', fiat: ['USD'], assets: [] })).toBe('USD');
  });
});
