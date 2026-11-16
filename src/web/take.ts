// Taking a sell offer: the buyer's side of POST /api/trades. No DOM here, so test/take.test.ts can
// check the request against the same derivation checks the service runs (docs/protocol.md, section 1).

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
  return {
    offerTxid: params.offerTxid,
    buyerIdentity: params.identity,
    amount: params.amount.toString(),
    buyerPk: binToHex(derivePubkeyFromXpub(params.defiXpub, params.defiIndex)),
    buyerDefiIndex: params.defiIndex,
    buyerPayoutPkh: binToHex(derivePayoutPkhFromXpub(params.receiveXpub, params.receiveIndex)),
    buyerReceiveIndex: params.receiveIndex,
    buyerSessionPk: params.session.publicKey,
  };
}

export { generateSessionKeyPair };

/**
 * Parses what the person typed into base units: whole sats for BCH (thousands separators allowed),
 * or a decimal with at most `decimals` places for a token. Null when it is not a valid amount.
 */
export function parseAmount(input: string, decimals: number, isBch: boolean): bigint | null {
  const clean = input.replace(/[,\s]/g, '');
  if (isBch || decimals === 0) return /^\d+$/.test(clean) ? BigInt(clean) : null;
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
 * trade this browser started by its session key. Final trades are ignored: there is nothing to resume.
 */
export function findStartedTrade(trades: TradeSummary[], sessionPk: string): TradeSummary | undefined {
  const pk = sessionPk.toLowerCase();
  return trades.find(
    (t) => t.buyerSessionPk?.toLowerCase() === pk && !['Dropped', 'Cancelled', 'Refunded', 'ResolvedSeller'].includes(t.status),
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
