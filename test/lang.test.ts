import { describe, expect, it } from 'vitest';
import { langFromUrl, MESSAGES, parseLang } from '../src/web/messages.js';

describe('the interface language', () => {
  it('accepts only English and Spanish', () => {
    expect(parseLang('es')).toBe('es');
    expect(parseLang('en')).toBe('en');
    expect(parseLang('ES')).toBe(null);
    expect(parseLang('pt')).toBe(null);
    expect(parseLang(null)).toBe(null);
  });

  it('reads ?lang= before or inside the hash, the hash winning', () => {
    expect(langFromUrl('?lang=es', '#/')).toBe('es');
    expect(langFromUrl('', '#/welcome?lang=es')).toBe('es');
    expect(langFromUrl('?lang=es', '#/?lang=en')).toBe('en');
    expect(langFromUrl('', '#/offers')).toBe(null);
  });

  it('has every line in Spanish that it has in English', () => {
    const keys = (value: unknown, path = ''): string[] =>
      value && typeof value === 'object' && !Array.isArray(value)
        ? Object.entries(value).flatMap(([k, v]) => keys(v, `${path}.${k}`))
        : [path];
    expect(keys(MESSAGES.es)).toEqual(keys(MESSAGES.en));
    expect(MESSAGES.es.landing.how).toHaveLength(MESSAGES.en.landing.how.length);
  });
});

describe('Spanish outside components', () => {
  it('words the trade story in Spanish while Spanish is chosen, and goes back to English', async () => {
    const { setActiveLang } = await import('../src/web/messages.js');
    const { tradeTitle, lockedCoins } = await import('../src/web/trade.js');
    setActiveLang('es');
    try {
      expect(tradeTitle('Released', 'buyer', '0.001 BCH', '493.82 ARS')).toBe('Compraste 0.001 BCH por 493.82 ARS');
      expect(lockedCoins('BCH')).toBe('los BCH');
    } finally {
      setActiveLang('en');
    }
    expect(tradeTitle('Released', 'buyer', '0.001 BCH', '493.82 ARS')).toBe('Bought 0.001 BCH for 493.82 ARS');
  });
});
