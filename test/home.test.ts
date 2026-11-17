import { deriveHdPath, deriveHdPrivateNodeFromSeed, deriveHdPublicNode, encodeHdPublicKey, sha256, utf8ToBin } from '@bitauth/libauth';
import { describe, expect, it } from 'vitest';
import { freshReceiveAddress, type WalletScan } from '../src/web/coins.js';
import type { Offer } from '../src/web/api.js';
import { describePrefs, parsePrefs, rankOffers, type Prefs } from '../src/web/prefs.js';
import { derivePayoutPkhFromXpub, pkhToCashAddress } from '../src/protocol/keys.js';

describe('stored preferences', () => {
  it('reads what was saved and nothing else', () => {
    const saved = JSON.stringify({ intent: 'buy', fiat: ['ARS'], assets: ['BCH', 'PUSD'] });
    expect(parsePrefs(saved)).toEqual({ intent: 'buy', fiat: ['ARS'], assets: ['BCH', 'PUSD'] });
    // Skipping stores empty lists: the questions were answered, with no preference.
    expect(parsePrefs(JSON.stringify({ intent: 'both', fiat: [], assets: [] }))).toEqual({ intent: 'both', fiat: [], assets: [] });
  });

  it('treats a missing or damaged value as unanswered, so the questions are asked again', () => {
    expect(parsePrefs(null)).toBeNull();
    expect(parsePrefs('not json')).toBeNull();
    expect(parsePrefs('{"intent":"trade"}')).toBeNull();
    expect(parsePrefs('42')).toBeNull();
    // A list with something else in it keeps only the text entries.
    expect(parsePrefs('{"intent":"sell","fiat":["USD",3],"assets":"BCH"}')).toEqual({ intent: 'sell', fiat: ['USD'], assets: [] });
  });

  it('describes them for the line under "For you"', () => {
    expect(describePrefs({ intent: 'buy', fiat: ['ARS'], assets: ['BCH'] })).toBe('Buying BCH with Argentine pesos');
    expect(describePrefs({ intent: 'sell', fiat: ['ARS', 'USD'], assets: [] })).toBe('Selling any coin with Argentine pesos and US dollars');
    expect(describePrefs({ intent: 'both', fiat: [], assets: [] })).toBeNull();
    expect(describePrefs(null)).toBeNull();
  });
});

describe('ordering offers by preference', () => {
  const offer = (id: string, side: 'sell' | 'buy', fiat: string, asset: string, isDemo = false): Offer =>
    ({ offerTxid: id, isDemo, document: { side, fiat, asset } }) as unknown as Offer;
  const symbol = (o: Offer) => o.document.asset;
  const ids = (offers: Offer[]) => offers.map((o) => o.offerTxid);

  const offers = [
    offer('buy-ars', 'buy', 'ARS', 'BCH'),
    offer('sell-usd-pusd', 'sell', 'USD', 'PUSD'),
    offer('sell-ars-bch', 'sell', 'ARS', 'BCH'),
    offer('sell-usd-bch', 'sell', 'USD', 'BCH'),
  ];

  it('puts first the side the person wants, then the currency, then the coin', () => {
    const prefs: Prefs = { intent: 'buy', fiat: ['ARS'], assets: ['BCH'] };
    expect(ids(rankOffers(offers, prefs, symbol))).toEqual(['sell-ars-bch', 'sell-usd-bch', 'sell-usd-pusd', 'buy-ars']);
  });

  it('shows a seller the buy offers first', () => {
    expect(ids(rankOffers(offers, { intent: 'sell', fiat: [], assets: [] }, symbol))[0]).toBe('buy-ars');
  });

  it('keeps the service order when nothing is preferred, with the demo offer ahead', () => {
    expect(ids(rankOffers(offers, null, symbol))).toEqual(ids(offers));
    const withDemo = [...offers, offer('demo', 'sell', 'USD', 'BCH', true)];
    expect(ids(rankOffers(withDemo, { intent: 'both', fiat: [], assets: [] }, symbol))[0]).toBe('demo');
  });

  it('never drops an offer', () => {
    expect(rankOffers(offers, { intent: 'buy', fiat: ['EUR'], assets: ['XYZ'] }, symbol)).toHaveLength(offers.length);
  });
});

describe('the receive address shown on Home', () => {
  const seed = new Uint8Array(64);
  seed.set(sha256.hash(utf8ToBin('home')), 0);
  const node = deriveHdPath(deriveHdPrivateNodeFromSeed(seed), "m/44'/145'/0'/0");
  if (typeof node === 'string') throw new Error(node);
  const xpub = encodeHdPublicKey({ network: 'mainnet', node: deriveHdPublicNode(node) }).hdPublicKey;
  const scan = (lastUsed: number): WalletScan => ({ coins: [], paths: [{ name: 'receive', scanned: 30, lastUsed }], noChangePath: false });

  it('is the address after the last one the wallet used', () => {
    expect(freshReceiveAddress(scan(-1), xpub)).toBe(pkhToCashAddress(derivePayoutPkhFromXpub(xpub, 0)));
    expect(freshReceiveAddress(scan(4), xpub)).toBe(pkhToCashAddress(derivePayoutPkhFromXpub(xpub, 5)));
  });

  it('is not shown before the network has been read', () => {
    expect(freshReceiveAddress(null, xpub)).toBeNull();
  });
});
