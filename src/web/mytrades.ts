// The lists on My trades: what each trade needs next from this person, and how a finished one is described.
// No DOM here, so test/mytrades.test.ts can check every state for both roles.

import type { Offer, Trade } from './api';
import { isFinalState } from './api';
import { formatDayMonth, formatHourMinute } from './format';
import { lockedCoins } from './trade';

export interface NextStep {
  /** What happens next, in a few words. */
  step: string;
  /** The person has to act. */
  turn: boolean;
  /** Unix seconds when the current window ends, with its length, for a countdown. */
  deadline?: number;
  windowSec?: number;
}

/**
 * What an unfinished trade waits for, from the point of view of `role`. `now` is Unix seconds: a request or a
 * deposit whose window already ended is shown as over, since the service only drops it when it is next read.
 */
export function nextStep(trade: Trade, role: 'buyer' | 'seller', now = Math.floor(Date.now() / 1000)): NextStep {
  const seller = role === 'seller';
  if (trade.status === 'Requested' && trade.quoteExpiresAt !== undefined && now >= trade.quoteExpiresAt) {
    return { step: 'The request expired', turn: false };
  }
  if (trade.status === 'Accepted' && trade.fundingDeadline !== undefined && now >= trade.fundingDeadline) {
    return { step: 'The time to lock ended', turn: false };
  }
  switch (trade.status) {
    case 'Requested':
      // On a buy offer the seller took it, and the buyer who published it accepts.
      if (trade.side === 'buy') {
        return seller
          ? { step: 'Waiting for the buyer to accept', turn: false, deadline: trade.quoteExpiresAt, windowSec: 600 }
          : { step: 'Accept or decline the request', turn: true, deadline: trade.quoteExpiresAt, windowSec: 600 };
      }
      return seller
        ? { step: 'Accept or decline the request', turn: true, deadline: trade.quoteExpiresAt, windowSec: 600 }
        : { step: 'Waiting for the seller to accept', turn: false, deadline: trade.quoteExpiresAt, windowSec: 600 };
    case 'Accepted':
      return seller
        ? {
            step: trade.side === 'buy' ? `Lock ${lockedCoins(trade.asset)} and share how to pay you` : `Lock ${lockedCoins(trade.asset)} for this trade`,
            turn: true,
            deadline: trade.fundingDeadline,
            windowSec: 1800,
          }
        : { step: `Waiting for the seller to lock ${lockedCoins(trade.asset)}`, turn: false, deadline: trade.fundingDeadline, windowSec: 1800 };
    case 'Funded': {
      const windowSec = trade.paymentDeadline && trade.fundedAt ? trade.paymentDeadline - trade.fundedAt : undefined;
      return seller
        ? { step: "Waiting for the buyer's payment", turn: false, deadline: trade.paymentDeadline, windowSec }
        : { step: 'Send the payment, then mark it as paid', turn: true, deadline: trade.paymentDeadline, windowSec };
    }
    case 'Paid':
      return seller ? { step: 'Check the payment, then release', turn: true } : { step: 'Waiting for the seller to release', turn: false };
    case 'Disputed':
      return { step: 'Waiting for the arbiter', turn: false };
    default:
      return { step: '', turn: false };
  }
}

/** Active trades: the ones that need the person first, then the ones whose window ends soonest. */
export function sortActive(items: { trade: Trade; next: NextStep }[]): typeof items {
  return [...items].sort((a, b) => {
    if (a.next.turn !== b.next.turn) return a.next.turn ? -1 : 1;
    return (a.next.deadline ?? Infinity) - (b.next.deadline ?? Infinity) || b.trade.createdAt - a.trade.createdAt;
  });
}

/** Finished trades, most recent first. */
export const sortHistory = (trades: Trade[]): Trade[] => [...trades].sort((a, b) => endedAt(b) - endedAt(a));

export const endedAt = (trade: Trade) => trade.completedAt ?? trade.verdictIssuedAt ?? trade.updatedAt;

/** "Buying 15,000 sats for 0.07 USD" while it lasts, "Bought …" / "Sold …" once the buyer has the coins. */
export function rowTitle(trade: Trade, role: 'buyer' | 'seller', amount: string, fiat: string): string {
  const what = `${amount} for ${fiat}`;
  const done = trade.status === 'Released' || trade.status === 'ResolvedBuyer';
  if (role === 'seller') return `${done ? 'Sold' : 'Selling'} ${what}`;
  return `${done ? 'Bought' : 'Buying'} ${what}`;
}

/** "16 Nov, 13:40", and how it ended when it did not simply complete. */
export function historyNote(trade: Trade, role: 'buyer' | 'seller'): string {
  const at = endedAt(trade);
  const when = `${formatDayMonth(at)}, ${formatHourMinute(new Date(at * 1000))}`;
  let how: string | null = null;
  switch (trade.status) {
    case 'ResolvedBuyer':
      how = 'decided by the arbiter';
      break;
    case 'ResolvedSeller':
      how = trade.disputedAt ? 'decided by the arbiter' : 'payment window ended';
      break;
    case 'Cancelled':
      how = role === 'buyer' ? 'cancelled by you' : 'cancelled by the buyer';
      break;
    case 'Refunded':
      how = 'returned after the refund time';
      break;
    case 'Dropped':
      if (trade.side === 'buy') {
        // Accepting opens the funding window, so a deadline means the buyer accepted and the deposit never came.
        how = trade.fundingDeadline !== undefined ? 'not locked in time' : role === 'buyer' ? 'declined or not accepted in time' : 'not accepted in time';
      } else {
        how = role === 'buyer' ? 'not accepted in time' : 'declined or not locked in time';
      }
      break;
  }
  return how ? `${when} · ${how}` : when;
}

export const isActive = (trade: Trade) => !isFinalState(trade.status);

/** How many trades each offer has had, by offer transaction. */
export function tradesPerOffer(trades: Pick<Trade, 'offerTxid'>[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const t of trades) counts.set(t.offerTxid, (counts.get(t.offerTxid) ?? 0) + 1);
  return counts;
}

/** An offer of this person's, most useful first: open ones, then the newest. */
export function myOffers(offers: Offer[], identity: string): Offer[] {
  return offers
    .filter((o) => o.sellerIdentity === identity)
    .sort((a, b) => Number(b.status === 'Published') - Number(a.status === 'Published') || b.createdAt - a.createdAt);
}
