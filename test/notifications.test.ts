import { describe, expect, it } from 'vitest';
import type { ChatMessage, Trade, TradeState } from '../src/web/api.js';
import {
  countsOf,
  diff,
  documentTitle,
  eventHref,
  makeSnapshot,
  needsAction,
  openTradeId,
  toastFor,
  type Snapshot,
} from '../src/web/notifications.js';

const NOW = 1000;

const trade = (status: TradeState, extra: Partial<Trade> = {}): Trade => ({
  id: 't1',
  status,
  offerTxid: 'o',
  buyerIdentity: 'buyer',
  sellerIdentity: 'seller',
  asset: 'BCH',
  assetDecimals: 8,
  amount: '15000',
  fiat: 'USD',
  fiatAmount: '0.07',
  arbiterPk: '02',
  createdAt: 900,
  updatedAt: 900,
  ...extra,
});

const message = (senderRole: 'buyer' | 'seller', createdAt: number, id = `m${createdAt}`): ChatMessage => ({
  id,
  tradeRecordId: 't1',
  senderIdentity: senderRole,
  senderRole,
  ciphertext: '00:00',
  createdAt,
});

const snap = (trades: Trade[], chats: Record<string, ChatMessage[]> = {}, identity = 'seller', lastRead = () => 0): Snapshot =>
  makeSnapshot(trades, new Map(Object.entries(chats)), identity, lastRead);

describe('whose turn it is', () => {
  it('asks the seller of a sell offer to accept, lock and release', () => {
    expect(needsAction(trade('Requested', { quoteExpiresAt: 1600 }), 'seller', NOW)).toBe(true);
    expect(needsAction(trade('Accepted', { fundingDeadline: 2800 }), 'seller', NOW)).toBe(true);
    expect(needsAction(trade('Funded'), 'seller', NOW)).toBe(false);
    expect(needsAction(trade('Paid'), 'seller', NOW)).toBe(true);
  });

  it('asks the buyer of a sell offer only to pay', () => {
    expect(needsAction(trade('Requested', { quoteExpiresAt: 1600 }), 'buyer', NOW)).toBe(false);
    expect(needsAction(trade('Accepted', { fundingDeadline: 2800 }), 'buyer', NOW)).toBe(false);
    expect(needsAction(trade('Funded', { paymentDeadline: 2000 }), 'buyer', NOW)).toBe(true);
    expect(needsAction(trade('Paid'), 'buyer', NOW)).toBe(false);
  });

  it('flips the request on a buy offer: the buyer who published it accepts', () => {
    const request = trade('Requested', { side: 'buy', quoteExpiresAt: 1600 });
    expect(needsAction(request, 'buyer', NOW)).toBe(true);
    expect(needsAction(request, 'seller', NOW)).toBe(false);
    expect(needsAction(trade('Accepted', { side: 'buy', fundingDeadline: 2800 }), 'seller', NOW)).toBe(true);
  });

  it('never counts a dispute, an ending, an expired window or a stranger', () => {
    expect(needsAction(trade('Disputed'), 'seller', NOW)).toBe(false);
    expect(needsAction(trade('Released'), 'seller', NOW)).toBe(false);
    expect(needsAction(trade('Requested', { quoteExpiresAt: 1000 }), 'seller', NOW)).toBe(false);
    expect(needsAction(trade('Paid'), 'someone else', NOW)).toBe(false);
    expect(needsAction(trade('Paid'), null, NOW)).toBe(false);
  });
});

describe('counters and title', () => {
  it('counts trades waiting for the person and unread messages from the other party', () => {
    const s = snap(
      [trade('Paid', { id: 'a' }), trade('Funded', { id: 'b' }), trade('Accepted', { id: 'c', fundingDeadline: 2800 })],
      { b: [message('buyer', 950), message('seller', 960), message('buyer', 970)] },
      'seller',
      () => 955,
    );
    expect(countsOf(s, 'seller', NOW)).toEqual({ trades: 2, chats: 1 });
    expect(countsOf(null, 'seller', NOW)).toEqual({ trades: 0, chats: 0 });
  });

  it('puts the total in front of the title, and nothing at zero', () => {
    expect(documentTitle('Campfire', { trades: 1, chats: 2 })).toBe('(3) Campfire');
    expect(documentTitle('Campfire', { trades: 0, chats: 0 })).toBe('Campfire');
  });
});

describe('what changed', () => {
  it('reports nothing on the first read, so a reload replays nothing', () => {
    const current = snap([trade('Requested', { quoteExpiresAt: 1600 })], { t1: [message('buyer', 950)] });
    expect(diff(null, current, 'seller', () => 0, NOW)).toEqual([]);
  });

  it('reports a new request to the seller of a sell offer, not to the buyer who sent it', () => {
    const request = trade('Requested', { quoteExpiresAt: 1600 });
    expect(diff(snap([]), snap([request]), 'seller', () => 0, NOW)).toEqual([{ kind: 'request', trade: request }]);
    expect(diff(snap([], {}, 'buyer'), snap([request], {}, 'buyer'), 'buyer', () => 0, NOW)).toEqual([]);
  });

  it('reports a new request on a buy offer to the buyer who published it', () => {
    const request = trade('Requested', { side: 'buy', quoteExpiresAt: 1600 });
    expect(diff(snap([]), snap([request]), 'buyer', () => 0, NOW).map((e) => e.kind)).toEqual(['request']);
    expect(diff(snap([]), snap([request]), 'seller', () => 0, NOW)).toEqual([]);
  });

  it('stays quiet about a new trade the person started, even one that already waits for them', () => {
    // Taking a demo offer returns the trade already funded: the buyer's turn, but they know.
    expect(diff(snap([]), snap([trade('Funded')]), 'buyer', () => 0, NOW)).toEqual([]);
  });

  it('reports a turn when the state changes to one that needs the person', () => {
    const before = snap([trade('Requested', { quoteExpiresAt: 1600 })]);
    const accepted = trade('Accepted', { fundingDeadline: 2800 });
    expect(diff(before, snap([accepted]), 'seller', () => 0, NOW)).toEqual([{ kind: 'turn', trade: accepted }]);
    expect(diff(before, snap([accepted]), 'buyer', () => 0, NOW)).toEqual([]);

    const paid = trade('Paid');
    expect(diff(snap([trade('Funded')]), snap([paid]), 'seller', () => 0, NOW)).toEqual([{ kind: 'turn', trade: paid }]);
    expect(diff(snap([trade('Accepted')]), snap([trade('Funded')]), 'buyer', () => 0, NOW).map((e) => e.kind)).toEqual(['turn']);
  });

  it('reports nothing when the state did not change', () => {
    expect(diff(snap([trade('Paid')]), snap([trade('Paid', { updatedAt: 990 })]), 'seller', () => 0, NOW)).toEqual([]);
  });

  it('reports a dispute to the party who did not open it', () => {
    const disputed = trade('Disputed', { disputedBy: 'buyer' });
    expect(diff(snap([trade('Paid')]), snap([disputed]), 'seller', () => 0, NOW)).toEqual([{ kind: 'disputed', trade: disputed }]);
    expect(diff(snap([trade('Paid')]), snap([disputed]), 'buyer', () => 0, NOW)).toEqual([]);
  });

  it('reports every ending, except a cancel to the buyer who cancelled', () => {
    for (const status of ['Released', 'ResolvedBuyer', 'ResolvedSeller', 'Refunded', 'Dropped', 'Cancelled'] as const) {
      expect(diff(snap([trade('Funded')]), snap([trade(status)]), 'seller', () => 0, NOW).map((e) => e.kind)).toEqual(['ended']);
    }
    expect(diff(snap([trade('Funded')]), snap([trade('Cancelled')]), 'buyer', () => 0, NOW)).toEqual([]);
    expect(diff(snap([trade('Paid')]), snap([trade('Released')]), 'buyer', () => 0, NOW).map((e) => e.kind)).toEqual(['ended']);
  });

  it('reports a new message from the other party, never one of the person', () => {
    const t = trade('Funded');
    const before = snap([t], { t1: [message('buyer', 950)] });
    const after = snap([t], { t1: [message('buyer', 950), message('buyer', 980)] });
    expect(diff(before, after, 'seller', () => 0, NOW)).toEqual([{ kind: 'message', trade: t, unread: 2 }]);

    const mine = snap([t], { t1: [message('buyer', 950), message('seller', 980)] });
    expect(diff(before, mine, 'seller', () => 0, NOW)).toEqual([]);
  });

  it('reports a message that arrives after the chat was read, even with fewer unread than before', () => {
    const t = trade('Funded');
    const before = snap([t], { t1: [message('buyer', 950), message('buyer', 960)] });
    // The chat was read up to 960, then one more message came.
    const after = snap([t], { t1: [message('buyer', 950), message('buyer', 960), message('buyer', 970)] }, 'seller', () => 960);
    expect(diff(before, after, 'seller', () => 960, NOW)).toEqual([{ kind: 'message', trade: t, unread: 1 }]);
  });

  it('does not report a message already shown in the chat', () => {
    const t = trade('Funded');
    const before = snap([t], { t1: [] });
    const after = snap([t], { t1: [message('buyer', 970)] }, 'seller', () => 970);
    expect(diff(before, after, 'seller', () => 970, NOW)).toEqual([]);
  });

  it('reports the first message after the chat opens, measured against what was read', () => {
    const before = snap([trade('Requested', { quoteExpiresAt: 1600 })]);
    const accepted = trade('Accepted', { fundingDeadline: 2800 });
    const after = snap([accepted], { t1: [message('seller', 990)] }, 'buyer');
    expect(diff(before, after, 'buyer', () => 0, NOW)).toEqual([{ kind: 'message', trade: accepted, unread: 1 }]);
  });

  it('puts state changes before messages', () => {
    const before = snap([trade('Funded')], { t1: [] });
    const paid = trade('Paid');
    const after = snap([paid], { t1: [message('buyer', 990)] });
    expect(diff(before, after, 'seller', () => 0, NOW).map((e) => e.kind)).toEqual(['turn', 'message']);
  });
});

describe('toasts', () => {
  const what = 'Selling 0.00015 BCH for 0.07 USD';

  it('links to the trade, and to its chat for a message', () => {
    expect(eventHref({ kind: 'turn', trade: trade('Paid') })).toBe('/trade/t1');
    expect(eventHref({ kind: 'message', trade: trade('Paid'), unread: 1 })).toBe('/trade/t1?chat');
  });

  it('uses the step My trades shows for a request and a turn', () => {
    expect(toastFor({ kind: 'request', trade: trade('Requested', { quoteExpiresAt: 1600 }) }, 'seller', what, NOW)).toMatchObject({
      label: 'New request',
      title: 'Accept or decline the request',
      body: what,
      tone: 'attention',
    });
    expect(toastFor({ kind: 'turn', trade: trade('Paid') }, 'seller', what, NOW).title).toBe('Check the payment, then release');
  });

  it('names the other party, and never carries the message text', () => {
    expect(toastFor({ kind: 'disputed', trade: trade('Disputed', { disputedBy: 'buyer' }) }, 'seller', what, NOW).title).toBe(
      'The buyer opened a dispute',
    );
    expect(toastFor({ kind: 'message', trade: trade('Funded'), unread: 1 }, 'buyer', what, NOW)).toMatchObject({
      title: 'The seller sent you a message',
      href: '/trade/t1?chat',
    });
    expect(toastFor({ kind: 'message', trade: trade('Funded'), unread: 3 }, 'buyer', what, NOW).title).toBe('3 unread messages from the seller');
  });

  it('says how a trade ended', () => {
    expect(toastFor({ kind: 'ended', trade: trade('Released') }, 'buyer', what, NOW)).toMatchObject({ tone: 'verified' });
    expect(toastFor({ kind: 'ended', trade: trade('ResolvedSeller') }, 'buyer', what, NOW).title).toMatch(/payment window ended/);
    expect(toastFor({ kind: 'ended', trade: trade('ResolvedSeller', { disputedAt: 950 }) }, 'buyer', what, NOW).title).toBe(
      'The arbiter decided for the seller',
    );
    expect(toastFor({ kind: 'ended', trade: trade('Dropped') }, 'seller', what, NOW)).toMatchObject({ tone: 'neutral' });
  });
});

describe('the open trade', () => {
  it('reads the record id from the route', () => {
    expect(openTradeId('/trade/abc123')).toBe('abc123');
    expect(openTradeId('/trade/abc123/arbiter')).toBe('abc123');
    expect(openTradeId('/trades')).toBeNull();
    expect(openTradeId('/')).toBeNull();
  });
});
