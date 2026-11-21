import { describe, expect, it } from 'vitest';
import type { Offer, Trade, TradeState } from '../src/web/api.js';
import { aliasFor } from '../src/web/alias.js';
import { completedWith, historyNote, myOffers, nextStep, otherParty, rowTitle, sortActive, sortHistory, tradesPerOffer } from '../src/web/mytrades.js';

const trade = (status: TradeState, extra: Partial<Trade> = {}): Trade => ({
  id: status,
  status,
  offerTxid: 'o',
  buyerIdentity: 'buyer',
  sellerIdentity: 'seller',
  asset: 'BCH',
  assetDecimals: 8,
  amount: '15000',
  fiat: 'USD',
  fiatAmount: '0.07',
  buyerPk: '02',
  buyerPayoutPkh: '00',
  arbiterPk: '02',
  createdAt: 1000,
  updatedAt: 1100,
  ...extra,
});

describe('what each trade needs next', () => {
  it('tells the seller to act on a request, a deposit and a payment', () => {
    expect(nextStep(trade('Requested', { quoteExpiresAt: 1600 }), 'seller', 1000)).toEqual({ step: 'Accept or decline the request', turn: true, deadline: 1600, windowSec: 600 });
    expect(nextStep(trade('Accepted', { fundingDeadline: 2800 }), 'seller', 1000)).toMatchObject({ step: 'Lock the BCH for this trade', turn: true, deadline: 2800 });
    expect(nextStep(trade('Paid'), 'seller')).toMatchObject({ step: 'Check the payment, then release', turn: true });
    expect(nextStep(trade('Funded', { fundedAt: 1000, paymentDeadline: 4600 }), 'seller')).toMatchObject({ turn: false, windowSec: 3600 });
  });

  it('tells the buyer to act only when it is time to pay', () => {
    expect(nextStep(trade('Requested'), 'buyer').turn).toBe(false);
    expect(nextStep(trade('Accepted'), 'buyer').turn).toBe(false);
    expect(nextStep(trade('Funded', { fundedAt: 1000, paymentDeadline: 1300 }), 'buyer')).toMatchObject({ step: 'Send the payment, then mark it as paid', turn: true, windowSec: 300 });
    expect(nextStep(trade('Paid'), 'buyer').turn).toBe(false);
  });

  it('shows a window that already ended as over, so it does not ask for a turn that is gone', () => {
    expect(nextStep(trade('Requested', { quoteExpiresAt: 1600 }), 'seller', 1600)).toEqual({ step: 'The request expired', turn: false });
    expect(nextStep(trade('Requested', { quoteExpiresAt: 1600 }), 'seller', 1599).turn).toBe(true);
    expect(nextStep(trade('Accepted', { fundingDeadline: 2800 }), 'buyer', 2900)).toEqual({ step: 'The time to lock ended', turn: false });
  });

  it('waits for the arbiter in a dispute, for either side', () => {
    expect(nextStep(trade('Disputed'), 'buyer')).toEqual({ step: 'Waiting for the arbiter', turn: false });
    expect(nextStep(trade('Disputed'), 'seller')).toEqual({ step: 'Waiting for the arbiter', turn: false });
  });

  it('puts what needs the person first, then what ends soonest', () => {
    const items = [
      { trade: trade('Funded', { id: 'waiting-late' }), next: { step: '', turn: false, deadline: 9000 } },
      { trade: trade('Accepted', { id: 'turn-late' }), next: { step: '', turn: true, deadline: 5000 } },
      { trade: trade('Requested', { id: 'turn-soon' }), next: { step: '', turn: true, deadline: 2000 } },
      { trade: trade('Paid', { id: 'waiting-soon' }), next: { step: '', turn: false, deadline: 3000 } },
    ];
    expect(sortActive(items).map((i) => i.trade.id)).toEqual(['turn-soon', 'turn-late', 'waiting-soon', 'waiting-late']);
  });
});

describe('rows', () => {
  it('words the title for the side and the outcome', () => {
    expect(rowTitle(trade('Funded'), 'buyer', '15,000 sats', '0.07 USD')).toBe('Buying 15,000 sats for 0.07 USD');
    expect(rowTitle(trade('Released'), 'buyer', '15,000 sats', '0.07 USD')).toBe('Bought 15,000 sats for 0.07 USD');
    expect(rowTitle(trade('Funded'), 'seller', '15,000 sats', '0.07 USD')).toBe('Selling 15,000 sats for 0.07 USD');
    expect(rowTitle(trade('ResolvedBuyer'), 'seller', '15,000 sats', '0.07 USD')).toBe('Sold 15,000 sats for 0.07 USD');
    expect(rowTitle(trade('Cancelled'), 'seller', '15,000 sats', '0.07 USD')).toBe('Selling 15,000 sats for 0.07 USD');
  });

  it('says how a finished trade ended', () => {
    const at = { completedAt: Date.UTC(2026, 10, 16, 13, 40) / 1000 };
    const how = (status: TradeState, role: 'buyer' | 'seller', extra: Partial<Trade> = {}) => historyNote(trade(status, { ...at, ...extra }), role).replace(/^.*?, \d\d:\d\d/, '').replace(/^ · /, '');
    expect(how('Released', 'buyer')).toBe('');
    expect(how('ResolvedBuyer', 'seller')).toBe('decided by the arbiter');
    expect(how('ResolvedSeller', 'buyer')).toBe('payment window ended');
    expect(how('ResolvedSeller', 'buyer', { disputedAt: 1 })).toBe('decided by the arbiter');
    expect(how('Cancelled', 'buyer')).toBe('cancelled by you');
    expect(how('Cancelled', 'seller')).toBe('cancelled by the buyer');
    expect(how('Refunded', 'seller')).toBe('returned after the refund time');
    expect(how('Dropped', 'buyer')).toBe('not accepted in time');
    expect(how('Dropped', 'seller')).toBe('declined or not locked in time');
    // A request taken back by the one who sent it says so, on either side and either kind of offer.
    expect(how('Dropped', 'buyer', { withdrawnAt: 1 })).toBe('request cancelled');
    expect(how('Dropped', 'seller', { withdrawnAt: 1, side: 'buy' })).toBe('request cancelled');
  });

  it('lists finished trades most recent first', () => {
    const rows = sortHistory([trade('Released', { id: 'a', completedAt: 100 }), trade('Cancelled', { id: 'b', completedAt: 300 }), trade('Dropped', { id: 'c', updatedAt: 200 })]);
    expect(rows.map((t) => t.id)).toEqual(['b', 'c', 'a']);
  });
});

describe('offers', () => {
  const offer = (id: string, seller: string, status: Offer['status'], createdAt: number): Offer =>
    ({ offerTxid: id, sellerIdentity: seller, status, createdAt, isDemo: false, document: {} as never }) as Offer;

  it('keeps only the offers of this person, open ones first', () => {
    const list = [offer('old-closed', 'me', 'Closed', 1), offer('other', 'you', 'Published', 9), offer('new-open', 'me', 'Published', 5), offer('old-open', 'me', 'Published', 2)];
    expect(myOffers(list, 'me').map((o) => o.offerTxid)).toEqual(['new-open', 'old-open', 'old-closed']);
  });

  it('counts the trades each offer has had', () => {
    const counts = tradesPerOffer([{ offerTxid: 'a' }, { offerTxid: 'a' }, { offerTxid: 'b' }]);
    expect(counts.get('a')).toBe(2);
    expect(counts.get('b')).toBe(1);
    expect(counts.get('c')).toBeUndefined();
  });
});

describe('the other person', () => {
  it('names the other person by alias, and the demo seller by role', () => {
    expect(otherParty(trade('Released'), 'buyer')).toBe(aliasFor('seller').name);
    expect(otherParty(trade('Released'), 'seller')).toBe(aliasFor('buyer').name);
    expect(otherParty(trade('Released', { isDemo: true }), 'buyer')).toBe('Demo seller');
  });

  it('puts the name between the time and how the trade ended', () => {
    const note = historyNote(trade('Cancelled', { updatedAt: 1_763_300_000 }), 'buyer', 'Silver Juniper');
    expect(note).toMatch(/^.+, \d\d:\d\d · Silver Juniper · .+$/);
  });

  it('counts only the trades completed between the two, either way round', () => {
    const list = [
      trade('Released', { buyerIdentity: 'me', sellerIdentity: 'you' }),
      trade('Released', { buyerIdentity: 'you', sellerIdentity: 'me' }),
      trade('ResolvedBuyer', { buyerIdentity: 'me', sellerIdentity: 'you' }),
      trade('ResolvedSeller', { buyerIdentity: 'me', sellerIdentity: 'you', disputedAt: 1 }),
      // Not completed: the buyer never paid, or it never got going.
      trade('ResolvedSeller', { buyerIdentity: 'me', sellerIdentity: 'you' }),
      trade('Cancelled', { buyerIdentity: 'me', sellerIdentity: 'you' }),
      trade('Funded', { buyerIdentity: 'me', sellerIdentity: 'you' }),
      // Someone else.
      trade('Released', { buyerIdentity: 'me', sellerIdentity: 'them' }),
    ];
    expect(completedWith(list, 'me', 'you')).toBe(4);
    expect(completedWith(list, 'me', 'them')).toBe(1);
    expect(completedWith(list, 'me', 'nobody')).toBe(0);
  });
});
