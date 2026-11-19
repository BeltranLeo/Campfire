// What the offer lists need besides the offers themselves: the indicative price of each, the quotes it comes from
// and the seller's or buyer's track record. Shared by Offers and Home.

import { apiGet, type Offer, type PriceQuote, type Reputation } from './api';
import { applyMargin, formatDayMonth } from './format';

export function priceOf(offer: Offer, quotes: Map<string, PriceQuote> | undefined): number | null {
  const price = offer.document.price;
  if (price.type === 'fixed') return Number(price.value);
  const quote = quotes?.get(price.pair);
  return quote ? applyMargin(quote.price, price.marginBps) : null;
}

// The count for the role the person has on this offer: sellers on sell offers, buyers on buy offers.
export function describeReputation(rep: Reputation, offerSide: 'sell' | 'buy'): string {
  const count = offerSide === 'sell' ? rep.completedAsSeller : rep.completedAsBuyer;
  if (count === 0 || rep.firstCompletedAt === null) return `0 completed · new ${offerSide === 'sell' ? 'seller' : 'buyer'}`;
  return `${count} completed · since ${formatDayMonth(rep.firstCompletedAt)}`;
}

export async function loadQuotes(pairs: string[]): Promise<{ byPair: Map<string, PriceQuote>; updatedAt: Date | null }> {
  const results = await Promise.allSettled(
    pairs.map((pair) => apiGet<{ quote: PriceQuote }>(`/api/oracle/quote?pair=${encodeURIComponent(pair)}`)),
  );
  const byPair = new Map<string, PriceQuote>();
  results.forEach((result, i) => {
    if (result.status === 'fulfilled') byPair.set(pairs[i], result.value.quote);
  });
  // "Prices updated" tells when the oracle observed the oldest price shown, not when this page fetched it.
  const oldest = Math.min(...[...byPair.values()].map((q) => q.timestamp));
  return { byPair, updatedAt: byPair.size ? new Date(oldest * 1000) : null };
}

export async function loadReputations(identities: string[]): Promise<Map<string, Reputation>> {
  const results = await Promise.allSettled(identities.map((id) => apiGet<Reputation>(`/api/identities/${id}/reputation`)));
  const map = new Map<string, Reputation>();
  results.forEach((result, i) => {
    if (result.status === 'fulfilled') map.set(identities[i], result.value);
  });
  return map;
}

export function unique(values: string[]): string[] {
  return [...new Set(values)].sort();
}

/** The demo offers first (the way in for a first visit), the rest in the service's order. Nothing is removed. */
export function demoFirst(offers: Offer[]): Offer[] {
  return offers
    .map((offer, index) => ({ offer, index }))
    .sort((a, b) => Number(b.offer.isDemo) - Number(a.offer.isDemo) || a.index - b.index)
    .map((x) => x.offer);
}
