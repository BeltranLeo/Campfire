import { deriveHdPath, deriveHdPrivateNodeFromSeed, deriveHdPublicNode, encodeHdPublicKey, sha256, utf8ToBin } from '@bitauth/libauth';
import { describe, expect, it } from 'vitest';
import { freshReceiveAddress, type WalletScan } from '../src/web/coins.js';
import type { Offer } from '../src/web/api.js';
import { demoFirst } from '../src/web/offerData.js';
import { derivePayoutPkhFromXpub, pkhToCashAddress } from '../src/protocol/keys.js';

describe('the offers on Home', () => {
  const offer = (id: string, isDemo = false): Offer => ({ offerTxid: id, isDemo }) as unknown as Offer;
  const ids = (offers: Offer[]) => offers.map((o) => o.offerTxid);

  it('puts the demo offers first and keeps the service order otherwise, dropping nothing', () => {
    const offers = [offer('a'), offer('b'), offer('demo', true), offer('c')];
    expect(ids(demoFirst(offers))).toEqual(['demo', 'a', 'b', 'c']);
    expect(ids(demoFirst([offer('a'), offer('b')]))).toEqual(['a', 'b']);
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
