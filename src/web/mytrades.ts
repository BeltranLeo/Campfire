// The lists on My trades: what each trade needs next from this person, and how a finished one is described.
// No DOM here, so test/mytrades.test.ts can check every state for both roles.

import type { Offer, Trade } from './api';
import { isFinalState } from './api';
import { aliasFor } from './alias';
import { formatDayMonth, formatHourMinute } from './format';
import { lockedCoins } from './trade';
import { text } from './messages';

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
  const t = text().mytrades;
  if (trade.status === 'Requested' && trade.quoteExpiresAt !== undefined && now >= trade.quoteExpiresAt) {
    return { step: t.requestExpired, turn: false };
  }
  if (trade.status === 'Accepted' && trade.fundingDeadline !== undefined && now >= trade.fundingDeadline) {
    return { step: t.lockEnded, turn: false };
  }
  switch (trade.status) {
    case 'Requested':
      // On a buy offer the seller took it, and the buyer who published it accepts.
      if (trade.side === 'buy') {
        return seller
          ? { step: t.waitingBuyerAccept, turn: false, deadline: trade.quoteExpiresAt, windowSec: 600 }
          : { step: t.acceptOrDecline, turn: true, deadline: trade.quoteExpiresAt, windowSec: 600 };
      }
      return seller
        ? { step: t.acceptOrDecline, turn: true, deadline: trade.quoteExpiresAt, windowSec: 600 }
        : { step: t.waitingSellerAccept, turn: false, deadline: trade.quoteExpiresAt, windowSec: 600 };
    case 'Accepted':
      return seller
        ? {
            step: trade.side === 'buy' ? t.lockAndShare(lockedCoins(trade.asset)) : t.lockForTrade(lockedCoins(trade.asset)),
            turn: true,
            deadline: trade.fundingDeadline,
            windowSec: 1800,
          }
        : { step: t.waitingSellerLock(lockedCoins(trade.asset)), turn: false, deadline: trade.fundingDeadline, windowSec: 1800 };
    case 'Funded': {
      const windowSec = trade.paymentDeadline && trade.fundedAt ? trade.paymentDeadline - trade.fundedAt : undefined;
      return seller
        ? { step: t.waitingPayment, turn: false, deadline: trade.paymentDeadline, windowSec }
        : { step: t.sendPayment, turn: true, deadline: trade.paymentDeadline, windowSec };
    }
    case 'Paid':
      return seller ? { step: t.checkRelease, turn: true } : { step: t.waitingRelease, turn: false };
    case 'Disputed':
      return { step: t.waitingArbiter, turn: false };
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
  const done = trade.status === 'Released' || trade.status === 'ResolvedBuyer';
  return text().mytrades.rowTitle(role, done, amount, fiat);
}

/** The other person's name as this person sees it: the demo seller by role, anyone else by their alias. */
export function otherParty(trade: Pick<Trade, 'buyerIdentity' | 'sellerIdentity' | 'isDemo'>, role: 'buyer' | 'seller'): string {
  if (role === 'seller') return aliasFor(trade.buyerIdentity).name;
  return trade.isDemo ? text().mytrades.demoSeller : aliasFor(trade.sellerIdentity).name;
}

/**
 * How many trades between `me` and `other` ended with the coins delivered: released by the seller, or decided by the
 * arbiter after a dispute. A trade the seller got back because the buyer never paid is not counted. Read from the
 * person's own list (GET /api/trades?identity=, for that identity only), so it never shows anyone else's pairs.
 */
export function completedWith(trades: Trade[], me: string, other: string): number {
  return trades.filter(
    (t) =>
      ((t.buyerIdentity === me && t.sellerIdentity === other) || (t.sellerIdentity === me && t.buyerIdentity === other)) &&
      (t.status === 'Released' || t.status === 'ResolvedBuyer' || (t.status === 'ResolvedSeller' && t.disputedAt !== undefined)),
  ).length;
}

/** "16 Nov, 13:40 · Demo seller", and how it ended when it did not simply complete. `other` names the other person. */
export function historyNote(trade: Trade, role: 'buyer' | 'seller', other?: string): string {
  const at = endedAt(trade);
  const when = `${formatDayMonth(at)}, ${formatHourMinute(new Date(at * 1000))}`;
  const t = text().mytrades;
  let how: string | null = null;
  switch (trade.status) {
    case 'ResolvedBuyer':
      how = t.byArbiter;
      break;
    case 'ResolvedSeller':
      how = trade.disputedAt ? t.byArbiter : t.windowEnded;
      break;
    case 'Cancelled':
      how = role === 'buyer' ? t.cancelledByYou : t.cancelledByBuyer;
      break;
    case 'Refunded':
      how = t.returned;
      break;
    case 'Dropped':
      if (trade.side === 'buy') {
        // Accepting opens the funding window, so a deadline means the buyer accepted and the deposit never came.
        how = trade.fundingDeadline !== undefined ? t.notLockedInTime : role === 'buyer' ? t.declinedOrNotAccepted : t.notAcceptedInTime;
      } else {
        how = role === 'buyer' ? t.notAcceptedInTime : t.declinedOrNotLocked;
      }
      break;
  }
  return [when, other, how].filter(Boolean).join(' · ');
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
