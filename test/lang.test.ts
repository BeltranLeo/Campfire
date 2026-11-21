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
    expect(MESSAGES.es.tradePage.disputeReasons).toHaveLength(MESSAGES.en.tradePage.disputeReasons.length);
    expect(MESSAGES.es.seller.disputeReasons).toHaveLength(MESSAGES.en.seller.disputeReasons.length);
  });

  it('has a label for every field name the seller seals, which stay in English', async () => {
    const { accountLabel, composePaymentDetails } = await import('../src/web/seller.js');
    for (const fiat of ['ARS', 'USD']) {
      const sealed = JSON.parse(composePaymentDetails({ account: 'a', holder: 'h', note: 'n' }, fiat)) as Record<string, string>;
      expect(Object.keys(sealed)).toEqual([accountLabel(fiat), 'Account holder', 'Note']);
      for (const key of Object.keys(sealed)) expect(MESSAGES.es.seller.detailLabels[key]).toBeTruthy();
    }
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
      const { describeScan } = await import('../src/web/coins.js');
      expect(describeScan({ paths: [{ name: 'receive', scanned: 20, lastUsed: -1 }], noChangePath: true } as never)).toBe(
        'Campfire revisó 20 direcciones de recepción. Esta billetera no compartió sus direcciones de cambio, así que no se ven las monedas enviadas ahí.',
      );
    } finally {
      setActiveLang('en');
    }
    expect(tradeTitle('Released', 'buyer', '0.001 BCH', '493.82 ARS')).toBe('Bought 0.001 BCH for 493.82 ARS');
  });
});
