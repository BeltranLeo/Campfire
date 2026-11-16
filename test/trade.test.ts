import { describe, expect, it } from 'vitest';
import type { Trade } from '../src/web/api.js';
import { newerTrade, roleOf, timeline, tradeTitle } from '../src/web/trade.js';

const base: Trade = {
  id: 'rec',
  status: 'Funded',
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
  isDemo: true,
  createdAt: 1000,
  updatedAt: 1100,
  fundingTxid: 'f'.repeat(64),
  fundingConfirmations: 0,
  fundedAt: 1050,
  paymentDeadline: 1350,
};
const titles = (t: Trade, role: 'buyer' | 'visitor' = 'buyer') =>
  timeline(t, role, '15,000 sats').map((s) => `${s.state}:${s.title}`);

describe('trade page model (web)', () => {
  it('tells the roles apart', () => {
    expect(roleOf(base, 'buyer')).toBe('buyer');
    expect(roleOf(base, 'seller')).toBe('seller');
    expect(roleOf(base, 'someone')).toBe('visitor');
    expect(roleOf(base, null)).toBe('visitor');
  });

  it('never steps back to an older copy of the trade', () => {
    const paid = { ...base, status: 'Released' as const, updatedAt: 1200 };
    const stalePoll = { ...base, updatedAt: 1100 };
    expect(newerTrade(paid, stalePoll)).toBe(paid);
    expect(newerTrade(stalePoll, paid)).toBe(paid);
    expect(newerTrade(undefined, stalePoll)).toBe(stalePoll);
    // Another trade always replaces the one shown.
    const other = { ...base, id: 'other', updatedAt: 1 };
    expect(newerTrade(paid, other)).toBe(other);
  });

  it('writes the title for each viewer', () => {
    expect(tradeTitle('Funded', 'buyer', '15,000 sats', '0.07 USD')).toBe('Buy 15,000 sats for 0.07 USD');
    expect(tradeTitle('Released', 'buyer', '15,000 sats', '0.07 USD')).toBe('Bought 15,000 sats for 0.07 USD');
    expect(tradeTitle('Released', 'visitor', '15,000 sats', '0.07 USD')).toBe('15,000 sats for 0.07 USD');
  });

  it('follows the happy path', () => {
    expect(titles({ ...base, status: 'Requested', fundingTxid: undefined })).toEqual([
      'done:You took the offer',
      'current:Seller accepts and funds the escrow',
      'todo:You send the payment and mark it as paid',
      'todo:Seller releases 15,000 sats to your wallet',
    ]);
    expect(titles(base)).toEqual([
      'done:You took the offer',
      'done:Seller funded the escrow',
      'current:You send the payment and mark it as paid',
      'todo:Seller releases 15,000 sats to your wallet',
    ]);
    const released = { ...base, status: 'Released' as const, paidAt: 1100, completedAt: 1110, settlementTxid: 'a'.repeat(64) };
    expect(titles(released)).toEqual([
      'done:You took the offer',
      'done:Seller funded the escrow',
      'done:You marked the payment as sent',
      'done:Seller released 15,000 sats to your wallet',
    ]);
    expect(timeline(released, 'buyer', '15,000 sats')[2].simulated).toBe(true);
    expect(titles(released, 'visitor')[3]).toBe('done:Seller released 15,000 sats to the buyer');
  });

  it('replaces the remaining steps when the payment window ends', () => {
    const expired = { ...base, status: 'ResolvedSeller' as const, verdictIssuedAt: 1360, settlementTxid: 'e'.repeat(64) };
    expect(titles(expired)).toEqual([
      'done:You took the offer',
      'done:Seller funded the escrow',
      'failed:Payment window ended without a payment',
      'done:Arbiter returned 15,000 sats to the seller',
    ]);
    const dropped = { ...base, status: 'Dropped' as const, fundingTxid: undefined };
    expect(titles(dropped)).toEqual(['done:You took the offer', 'failed:The seller did not accept and fund in time']);
  });
});
