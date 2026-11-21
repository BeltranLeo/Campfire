// What a trade record looks like over HTTP, by who asks (protocol section 6, "Who reads a trade").
//
// A trade record links two identities to an amount, a fiat sum, payout addresses and, in a dispute, a reason in
// plain text. Only the two parties and the arbiter need that link. Everyone else, a judge without a wallet
// included, gets the public view: what the chain shows anyway (escrow, deposit, settlement) and the state.

import type { StoredTrade } from './storage.js';

// Never sent over HTTP: the chat keys the parties handed to the arbiter (only the service decrypts with them)
// and the demo seller's signed deposit, kept for rebroadcasts.
const SECRET_FIELDS = ['sharedTradeKeyHex', 'disputeKeys', 'pendingFundingTxHex'] as const;

/** The record without the fields no HTTP response carries. */
export function withoutSecrets(trade: StoredTrade): StoredTrade {
  const copy = { ...trade };
  for (const field of SECRET_FIELDS) delete copy[field];
  return copy;
}

// The fields anyone may read. Nothing here names a person or a fiat sum: the asset amount, the escrow and its
// transactions are on the chain already, and the arbiter key is public. A new field stays private until it is
// added here.
const PUBLIC_FIELDS = [
  'id',
  'side',
  'status',
  'asset',
  'assetDecimals',
  'amount',
  'arbiterPk',
  'tradeId',
  'escrowAddress',
  'escrowTokenAddress',
  'refundTime',
  'fundingDeadline',
  'fundingTxid',
  'fundingVout',
  'fundingConfirmations',
  'fundedAt',
  'paymentDeadline',
  'paidAt',
  'disputedAt',
  'verdict',
  'verdictIssuedAt',
  'settlementTxid',
  'isDemo',
  'createdAt',
  'updatedAt',
  'completedAt',
] as const satisfies readonly (keyof StoredTrade)[];

export type PublicTrade = Pick<StoredTrade, (typeof PUBLIC_FIELDS)[number]> & {
  /** Marks the public view, so a page knows the identities and fiat terms were left out, not missing. */
  public: true;
};

export function publicTradeView(trade: StoredTrade): PublicTrade {
  const view: Record<string, unknown> = { public: true };
  for (const field of PUBLIC_FIELDS) {
    if (trade[field] !== undefined) view[field] = trade[field];
  }
  return view as PublicTrade;
}

/** Totals for the front page, over every trade, so they do not depend on the page of the list a visitor reads. */
export interface TradeStats {
  /** Trades that ended with the coins going to the buyer: released, or decided for the buyer. */
  completed: number;
  /** BCH those trades moved, in satoshis, as a decimal string. */
  bchSats: string;
  /** How many of them were against the demo seller. */
  demo: number;
}

export function tradeStats(trades: StoredTrade[]): TradeStats {
  const completed = trades.filter((t) => t.status === 'Released' || t.status === 'ResolvedBuyer');
  const bchSats = completed.filter((t) => t.asset === 'BCH').reduce((sum, t) => sum + BigInt(t.amount), 0n);
  return { completed: completed.length, bchSats: bchSats.toString(), demo: completed.filter((t) => t.isDemo).length };
}

export const PUBLIC_PAGE_DEFAULT = 20;
export const PUBLIC_PAGE_MAX = 100;

/**
 * One page of the public list, newest change first. `cursor` is the number of trades already read; the answer's
 * `nextCursor` is the next one, or null on the last page.
 */
export function publicTradePage(
  trades: StoredTrade[],
  options: { limit?: number; cursor?: number } = {},
): { trades: PublicTrade[]; nextCursor: number | null } {
  const limit = Math.min(Math.max(1, options.limit ?? PUBLIC_PAGE_DEFAULT), PUBLIC_PAGE_MAX);
  const start = Math.max(0, options.cursor ?? 0);
  const sorted = [...trades].sort((a, b) => b.updatedAt - a.updatedAt || a.id.localeCompare(b.id));
  const page = sorted.slice(start, start + limit).map(publicTradeView);
  const next = start + limit;
  return { trades: page, nextCursor: next < sorted.length ? next : null };
}
