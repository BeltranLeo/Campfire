import { describe, expect, it } from 'vitest';
import { deriveHdPath, deriveHdPrivateNodeFromSeed, deriveHdPublicNode, encodeHdPublicKey, sha256, utf8ToBin } from '@bitauth/libauth';
import { isCompressedPubkeyHex, verifyDerivedPayoutPkh, verifyDerivedPubkey } from '../src/protocol/index.js';
import type { TradeSummary } from '../src/web/api.js';
import {
  buildTakeRequest,
  commitSession,
  demoLimitKind,
  findStartedTrade,
  generateSessionKeyPair,
  loadPendingSession,
  nextIndices,
  parseAmount,
  savePendingSession,
} from '../src/web/take.js';

function xpub(label: string, branch: number): string {
  const seed = new Uint8Array(64);
  seed.set(sha256.hash(utf8ToBin(label)), 0);
  const node = deriveHdPath(deriveHdPrivateNodeFromSeed(seed), `m/44'/145'/0'/${branch}`);
  if (typeof node === 'string') throw new Error(node);
  return encodeHdPublicKey({ network: 'mainnet', node: deriveHdPublicNode(node) }).hdPublicKey;
}

const trade = (fields: Partial<TradeSummary>): TradeSummary => ({
  id: 'id',
  status: 'Released',
  offerTxid: 'o',
  buyerIdentity: 'someone',
  sellerIdentity: 'someone-else',
  ...fields,
});

describe('taking an offer (web)', () => {
  it('builds keys that pass the service checks for the chosen indices', () => {
    const defiXpub = xpub('take-test', 7);
    const receiveXpub = xpub('take-test', 0);
    const session = generateSessionKeyPair();
    const request = buildTakeRequest({
      offerTxid: 'f'.repeat(64),
      identity: 'me',
      amount: 15000n,
      defiXpub,
      receiveXpub,
      defiIndex: 3,
      receiveIndex: 12,
      session,
    });
    // The same three checks requestTrade runs before recording a take.
    expect(verifyDerivedPubkey(defiXpub, request.buyerDefiIndex, request.buyerPk)).toBe(true);
    expect(verifyDerivedPayoutPkh(receiveXpub, request.buyerReceiveIndex, request.buyerPayoutPkh)).toBe(true);
    expect(isCompressedPubkeyHex(request.buyerSessionPk)).toBe(true);
    expect(request.amount).toBe('15000');
  });

  it('allocates the next indices across both roles', () => {
    expect(nextIndices([], 'me')).toEqual({ defi: 0, receive: 0 });
    const trades = [
      trade({ buyerIdentity: 'me', buyerDefiIndex: 0, buyerReceiveIndex: 4 }),
      trade({ sellerIdentity: 'me', sellerDefiIndex: 2, sellerReceiveIndex: 1 }),
      trade({ buyerDefiIndex: 9, buyerReceiveIndex: 9 }),
    ];
    expect(nextIndices(trades, 'me')).toEqual({ defi: 3, receive: 5 });
  });

  it('parses amounts into base units', () => {
    // BCH is typed in BCH, with up to 8 decimals.
    expect(parseAmount('0.0001', 8)).toBe(10_000n);
    expect(parseAmount('1', 8)).toBe(100_000_000n);
    expect(parseAmount('0.00000001', 8)).toBe(1n);
    expect(parseAmount('0.000000001', 8)).toBeNull();
    expect(parseAmount('1,000.5', 8)).toBe(100_050_000_000n);
    // A lone comma is a decimal mark, never a thousands separator: "0,001" must not become 1 BCH.
    expect(parseAmount('0,001', 8)).toBe(100_000n);
    expect(parseAmount('0,0153', 8)).toBe(1_530_000n);
    expect(parseAmount('0,05', 2)).toBe(5n);
    expect(parseAmount('1,000,000', 0)).toBe(1_000_000n);
    expect(parseAmount('0,1,2', 8)).toBeNull();
    expect(parseAmount('abc', 8)).toBeNull();
    expect(parseAmount('0.05', 2)).toBe(5n);
    expect(parseAmount('1', 2)).toBe(100n);
    expect(parseAmount('.5', 2)).toBe(50n);
    expect(parseAmount('0.005', 2)).toBeNull();
    expect(parseAmount('', 2)).toBeNull();
    expect(parseAmount('15.5', 0)).toBeNull();
  });

  it('recognises the demo seller limits by the server wording', () => {
    expect(demoLimitKind('The demo seller is busy with other visitors. Please try again in a few minutes.')).toBe('busy');
    expect(demoLimitKind('The demo seller has reached its daily limit of trades. Please try again tomorrow.')).toBe('daily');
    expect(demoLimitKind('The demo seller has run out of funds for this offer. Please try again later.')).toBe('funds');
    expect(demoLimitKind('Too many requests')).toBeNull();
  });

  it('finds a started trade by its session key and keeps the key', () => {
    const session = generateSessionKeyPair();
    const trades = [
      trade({ id: 'dropped', status: 'Dropped', buyerSessionPk: session.publicKey }),
      trade({ id: 'live', status: 'Funded', buyerSessionPk: session.publicKey.toUpperCase() }),
    ];
    expect(findStartedTrade(trades, session.publicKey)?.id).toBe('live');
    expect(findStartedTrade([trades[0]], session.publicKey)).toBeUndefined();

    const store = new Map<string, string>();
    const storage = {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
      removeItem: (k: string) => void store.delete(k),
    };
    savePendingSession(storage, 'offer-1', session);
    expect(loadPendingSession(storage, 'offer-2')).toBeNull();
    expect(loadPendingSession(storage, 'offer-1')).toEqual(session);
    commitSession(storage, 'live', session);
    expect(store.get('campfire.session.live')).toBe(session.privateKey);
    expect(loadPendingSession(storage, 'offer-1')).toBeNull();
  });
});
