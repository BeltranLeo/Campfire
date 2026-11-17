// Taking an offer (POST /api/trades) and, on a buy offer, the buyer's acceptance: the keys each side sends.
// No DOM here, so test/take.test.ts can check the requests against the same derivation checks the service runs
// (docs/protocol.md, section 1).

import { binToHex } from '@bitauth/libauth';
import { derivePayoutPkhFromXpub, derivePubkeyFromXpub, pkhToCashAddress } from '../protocol/keys.js';
import { generateSessionKeyPair, type SessionKeyPair } from '../protocol/crypto.js';
import type { TradeSummary } from './api';

export interface TakeRequest {
  offerTxid: string;
  buyerIdentity: string;
  amount: string;
  buyerPk: string;
  buyerDefiIndex: number;
  buyerPayoutPkh: string;
  buyerReceiveIndex: number;
  buyerSessionPk: string;
}

/**
 * The next unused key indices for this identity in Campfire. Each trade signs with a new `defi` key and,
 * as buyer, is paid to a new `receive` address; both roles share the two paths.
 */
export function nextIndices(trades: TradeSummary[], identity: string): { defi: number; receive: number } {
  let defi = -1;
  let receive = -1;
  for (const t of trades) {
    if (t.buyerIdentity === identity) {
      defi = Math.max(defi, t.buyerDefiIndex ?? -1);
      receive = Math.max(receive, t.buyerReceiveIndex ?? -1);
    }
    if (t.sellerIdentity === identity) {
      defi = Math.max(defi, t.sellerDefiIndex ?? -1);
      receive = Math.max(receive, t.sellerReceiveIndex ?? -1);
    }
  }
  return { defi: defi + 1, receive: receive + 1 };
}

export function payoutAddress(receiveXpub: string, index: number, tokenAware: boolean): string {
  return pkhToCashAddress(derivePayoutPkhFromXpub(receiveXpub, index), { tokenAware });
}

export function buildTakeRequest(params: {
  offerTxid: string;
  identity: string;
  amount: bigint;
  defiXpub: string;
  receiveXpub: string;
  defiIndex: number;
  receiveIndex: number;
  session: SessionKeyPair;
}): TakeRequest {
  return { offerTxid: params.offerTxid, buyerIdentity: params.identity, amount: params.amount.toString(), ...buyerKeys(params) };
}

/** A buyer's keys for one trade: a fresh signing key, a fresh payout address and the session key. */
export function buyerKeys(params: { defiXpub: string; receiveXpub: string; defiIndex: number; receiveIndex: number; session: SessionKeyPair }) {
  return {
    buyerPk: binToHex(derivePubkeyFromXpub(params.defiXpub, params.defiIndex)),
    buyerDefiIndex: params.defiIndex,
    buyerPayoutPkh: binToHex(derivePayoutPkhFromXpub(params.receiveXpub, params.receiveIndex)),
    buyerReceiveIndex: params.receiveIndex,
    buyerSessionPk: params.session.publicKey,
  };
}

/** What a seller sends to take a buy offer: the amount and the seller's keys. Nothing is signed yet. */
export interface SellerTakeRequest {
  offerTxid: string;
  sellerIdentity: string;
  amount: string;
  sellerPk: string;
  sellerDefiIndex: number;
  sellerPayoutPkh: string;
  sellerReceiveIndex: number;
  sellerSessionPk: string;
}

export function buildSellerTakeRequest(params: {
  offerTxid: string;
  identity: string;
  amount: bigint;
  defiXpub: string;
  receiveXpub: string;
  defiIndex: number;
  receiveIndex: number;
  session: SessionKeyPair;
}): SellerTakeRequest {
  return {
    offerTxid: params.offerTxid,
    sellerIdentity: params.identity,
    amount: params.amount.toString(),
    sellerPk: binToHex(derivePubkeyFromXpub(params.defiXpub, params.defiIndex)),
    sellerDefiIndex: params.defiIndex,
    sellerPayoutPkh: binToHex(derivePayoutPkhFromXpub(params.receiveXpub, params.receiveIndex)),
    sellerReceiveIndex: params.receiveIndex,
    sellerSessionPk: params.session.publicKey,
  };
}

/** What the buyer who published a buy offer sends to accept a seller's request: their keys only, no signature. */
export function buildBuyerAcceptBody(params: {
  identity: string;
  defiXpub: string;
  receiveXpub: string;
  defiIndex: number;
  receiveIndex: number;
  session: SessionKeyPair;
}) {
  return { buyerIdentity: params.identity, ...buyerKeys(params) };
}

export { generateSessionKeyPair };

/**
 * Parses what the person typed into base units: a decimal with at most `decimals` places (8 for BCH,
 * so "0.001" is 100,000 sats). Null when it is not a valid amount.
 *
 * A lone comma with no dot is the decimal mark ("0,001" in Argentina, and the comma key on a Spanish
 * phone keypad). Read as a thousands separator it would turn 0.001 BCH into 1 BCH. Commas are thousands
 * separators only next to a dot ("1,000.5") or when there are several ("1,000,000").
 */
export function parseAmount(input: string, decimals: number): bigint | null {
  const compact = input.replace(/\s/g, '');
  const commas = compact.split(',').length - 1;
  const decimalComma = decimals > 0 && commas === 1 && !compact.includes('.');
  // Thousands separators must group the whole part by three; anything else is a typo, not a number.
  if (commas > 0 && !decimalComma && !/^\d{1,3}(,\d{3})+(\.\d*)?$/.test(compact)) return null;
  const clean = decimalComma ? compact.replace(',', '.') : compact.replace(/,/g, '');
  if (decimals === 0) return /^\d+$/.test(clean) ? BigInt(clean) : null;
  const match = clean.match(/^(\d*)(?:\.(\d*))?$/);
  if (!match || (match[1] === '' && !match[2]) || (match[2]?.length ?? 0) > decimals) return null;
  return BigInt((match[1] || '0') + (match[2] ?? '').padEnd(decimals, '0'));
}

/** Which of the demo seller's limits a 429 refers to (the three Take-* screens), from the server's wording. */
export function demoLimitKind(message: string): 'busy' | 'daily' | 'funds' | null {
  const text = message.toLowerCase();
  if (text.includes('busy')) return 'busy';
  if (text.includes('daily limit')) return 'daily';
  if (text.includes('run out of funds')) return 'funds';
  return null;
}

/**
 * After a take whose answer was lost (a timeout, or an error after the trade was recorded), finds the
 * trade this browser started by its session key: the buyer's on a sell offer, the seller's on a buy offer.
 * Final trades are ignored: there is nothing to resume.
 */
export function findStartedTrade(trades: TradeSummary[], sessionPk: string): TradeSummary | undefined {
  const pk = sessionPk.toLowerCase();
  return trades.find(
    (t) =>
      (t.buyerSessionPk?.toLowerCase() === pk || t.sellerSessionPk?.toLowerCase() === pk) &&
      !['Dropped', 'Cancelled', 'Refunded', 'ResolvedSeller'].includes(t.status),
  );
}

// --- Session keys in this browser (docs/protocol.md, section 6) ---
// The key is created before the request, so a lost answer can still be matched to its trade.

const sessionKey = (tradeId: string) => `campfire.session.${tradeId}`;
const PENDING_KEY = 'campfire.session.pending';

export interface SessionStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export function savePendingSession(store: SessionStore, offerTxid: string, session: SessionKeyPair): void {
  store.setItem(PENDING_KEY, JSON.stringify({ offerTxid, ...session }));
}

/** Files the pending key under its trade, once the trade id is known. */
export function commitSession(store: SessionStore, tradeId: string, session: SessionKeyPair): void {
  store.setItem(sessionKey(tradeId), session.privateKey);
  store.removeItem(PENDING_KEY);
}

export function loadPendingSession(store: SessionStore, offerTxid: string): SessionKeyPair | null {
  try {
    const value = JSON.parse(store.getItem(PENDING_KEY) ?? 'null');
    return value?.offerTxid === offerTxid ? { privateKey: value.privateKey, publicKey: value.publicKey } : null;
  } catch {
    return null;
  }
}

// localStorage can be blocked (private windows); a trade still works, but this browser then cannot
// read the payment details or the chat later.
export function browserStore(): SessionStore | null {
  try {
    localStorage.setItem('campfire.storage-check', '1');
    localStorage.removeItem('campfire.storage-check');
    return localStorage;
  } catch {
    return null;
  }
}

/** This browser's session private key for a trade, if it has one. */
export function readSessionKey(tradeId: string): string | null {
  try {
    return localStorage.getItem(sessionKey(tradeId));
  } catch {
    return null;
  }
}
