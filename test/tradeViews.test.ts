import { describe, expect, it } from 'vitest';
import type { StoredTrade } from '../src/server/storage.js';
import { publicTradePage, publicTradeView, tradeStats } from '../src/server/tradeViews.js';

const trade = (id: string, updatedAt: number, extra: Partial<StoredTrade> = {}): StoredTrade => ({
  id,
  offerTxid: 'aa'.repeat(32),
  sellerIdentity: '11'.repeat(32),
  buyerIdentity: '22'.repeat(32),
  status: 'Released',
  asset: 'BCH',
  assetDecimals: 8,
  amount: '1000',
  fiat: 'ARS',
  fiatAmount: '5000.00',
  arbiterPk: '02'.padEnd(66, '0'),
  sharedTradeKeyHex: 'ff'.repeat(32),
  disputeReason: 'reason',
  createdAt: 1,
  updatedAt,
  ...extra,
});

describe('Public view of trades (src/server/tradeViews.ts)', () => {
  it('keeps only the fields that name nobody', () => {
    const view = publicTradeView(trade('a', 5, { settlementTxid: 'bb'.repeat(32) })) as Record<string, unknown>;
    expect(view).toEqual({
      public: true,
      id: 'a',
      status: 'Released',
      asset: 'BCH',
      assetDecimals: 8,
      amount: '1000',
      arbiterPk: '02'.padEnd(66, '0'),
      settlementTxid: 'bb'.repeat(32),
      createdAt: 1,
      updatedAt: 5,
    });
  });

  it('pages newest first and counts totals over every trade', () => {
    const all = [
      trade('a', 1),
      trade('b', 3, { isDemo: true }),
      trade('c', 2, { status: 'ResolvedBuyer', asset: 'PUSD', amount: '7' }),
      trade('d', 4, { status: 'Disputed' }),
    ];
    const first = publicTradePage(all, { limit: 3 });
    expect(first.trades.map((t) => t.id)).toEqual(['d', 'b', 'c']);
    expect(first.nextCursor).toBe(3);
    const second = publicTradePage(all, { limit: 3, cursor: 3 });
    expect(second.trades.map((t) => t.id)).toEqual(['a']);
    expect(second.nextCursor).toBeNull();
    expect(publicTradePage(all).trades).toHaveLength(4);
    expect(tradeStats(all)).toEqual({ completed: 3, bchSats: '2000', demo: 1 });
  });
});
