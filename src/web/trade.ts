// The trade page's model: who is looking, what the title and tags say, the progress steps, and the
// browser's own check of the escrow (docs/protocol.md, section 5). No DOM here; see test/trade.test.ts.

import { binToHex } from '@bitauth/libauth';
import type { NetworkProvider } from 'cashscript';
import { createEscrowContract, matchesEscrowFunding } from '../protocol/escrow.js';
import { verifyDerivedPayoutPkh } from '../protocol/keys.js';
import { computeTradeId, type TradeTerms } from '../protocol/trades.js';
import type { Trade, TradeState } from './api';
import { isFinalState } from './api';

export type Role = 'buyer' | 'seller' | 'visitor';

export function roleOf(trade: Pick<Trade, 'buyerIdentity' | 'sellerIdentity'>, identity: string | null): Role {
  if (identity && identity === trade.buyerIdentity) return 'buyer';
  if (identity && identity === trade.sellerIdentity) return 'seller';
  return 'visitor';
}

/**
 * Keeps the newer of two copies of a trade. A poll that left before "Mark as paid" can arrive after
 * the answer to it; without this the page would step back from Released to Funded.
 */
export function newerTrade<T extends Pick<Trade, 'id' | 'updatedAt'>>(current: T | undefined, incoming: T): T {
  return current && current.id === incoming.id && current.updatedAt > incoming.updatedAt ? current : incoming;
}

export const isFinal = (trade: Pick<Trade, 'status'>) => isFinalState(trade.status);

/** "Buy 15,000 sats for 0.07 USD", "Bought …" once the buyer has the coins, no verb for visitors. */
export function tradeTitle(status: TradeState, role: Role, amount: string, fiat: string): string {
  const what = `${amount} for ${fiat}`;
  if (role === 'visitor') return what;
  return status === 'Released' || status === 'ResolvedBuyer' ? `Bought ${what}` : `Buy ${what}`;
}

export interface Step {
  state: 'done' | 'current' | 'todo' | 'failed';
  title: string;
  /** Unix seconds shown as HH:MM. */
  at?: number;
  /** A transaction to link. */
  txid?: string;
  /** The deposit's confirmation count, shown next to its transaction. */
  confirmations?: number;
  offchain?: boolean;
  simulated?: boolean;
  note?: string;
}

/**
 * Four fixed steps (take, fund, pay, release). An ending other than Released replaces the steps
 * that did not happen with what did. `amount` is the formatted amount ("15,000 sats").
 */
export function timeline(trade: Trade, role: Role, amount: string): Step[] {
  const you = role === 'buyer';
  const buyer = you ? 'You' : 'Buyer';
  const toBuyer = you ? 'to your wallet' : 'to the buyer';
  const s = trade.status;
  const funded = trade.fundingTxid !== undefined;
  const paid = trade.paidAt !== undefined;

  const steps: Step[] = [{ state: 'done', title: `${buyer} took the offer`, at: trade.createdAt, offchain: true }];

  // Step 2: the seller accepts and funds the escrow.
  if (funded) {
    steps.push({
      state: 'done',
      title: 'Seller funded the escrow',
      at: trade.fundedAt,
      txid: trade.fundingTxid,
      confirmations: trade.fundingConfirmations,
    });
  } else if (s === 'Requested' || s === 'Accepted') {
    steps.push({ state: 'current', title: 'Seller accepts and funds the escrow', note: 'Up to 10 min to accept, then 30 min to fund' });
  } else {
    // Dropped before any deposit: nothing reached the chain.
    steps.push({ state: 'failed', title: 'The seller did not accept and fund in time', at: trade.updatedAt });
    return steps;
  }

  // Step 3: the buyer pays off-chain and marks it.
  if (paid) {
    steps.push({ state: 'done', title: `${buyer} marked the payment as sent`, at: trade.paidAt, offchain: true, simulated: trade.isDemo });
  } else if (s === 'Funded') {
    steps.push({ state: 'current', title: `${buyer} send${you ? '' : 's'} the payment and mark${you ? '' : 's'} it as paid`, note: windowNote(trade) });
  } else if (s === 'Requested' || s === 'Accepted') {
    steps.push({ state: 'todo', title: `${buyer} send${you ? '' : 's'} the payment and mark${you ? '' : 's'} it as paid` });
  } else if (s === 'ResolvedSeller' && !trade.disputedAt) {
    steps.push({ state: 'failed', title: 'Payment window ended without a payment', at: trade.verdictIssuedAt });
  }

  // Step 4, or the ending that replaced it.
  const release = `Seller releases ${amount} ${toBuyer}`;
  switch (s) {
    case 'Requested':
    case 'Accepted':
    case 'Funded':
      steps.push({ state: 'todo', title: release });
      break;
    case 'Paid':
    case 'Disputed':
      steps.push({ state: s === 'Paid' ? 'current' : 'todo', title: release });
      break;
    case 'Released':
      steps.push({ state: 'done', title: `Seller released ${amount} ${toBuyer}`, at: trade.completedAt, txid: trade.settlementTxid });
      break;
    case 'ResolvedBuyer':
      steps.push({ state: 'done', title: `Arbiter released ${amount} ${toBuyer}`, at: trade.completedAt ?? trade.verdictIssuedAt, txid: trade.settlementTxid });
      break;
    case 'ResolvedSeller':
      steps.push({ state: 'done', title: `Arbiter returned ${amount} to the seller`, at: trade.completedAt ?? trade.verdictIssuedAt, txid: trade.settlementTxid });
      break;
    case 'Cancelled':
      steps.push({ state: 'done', title: `${buyer} cancelled: the escrow returned ${amount} to the seller`, at: trade.completedAt, txid: trade.settlementTxid });
      break;
    case 'Refunded':
      steps.push({ state: 'done', title: `The seller recovered ${amount} after the refund time`, at: trade.completedAt, txid: trade.settlementTxid });
      break;
    case 'Dropped':
      steps.push({ state: 'failed', title: 'The trade was dropped', at: trade.updatedAt });
      break;
  }
  return steps;
}

function windowNote(trade: Trade): string | undefined {
  if (trade.paymentDeadline === undefined || trade.fundedAt === undefined) return undefined;
  return `Payment window: ${Math.round((trade.paymentDeadline - trade.fundedAt) / 60)} min`;
}

// --- The browser's own check of the escrow ---

export interface EscrowCheck {
  /** The trade id is the hash of the published terms. */
  termsMatch: boolean;
  /** The escrow address is the contract built from those terms. */
  addressMatch: boolean;
  /** The buyer's payout in the terms belongs to this wallet (only when the viewer is the buyer). */
  payoutIsMine?: boolean;
  /** A coin at the escrow address holds exactly the amount and token from the terms. */
  funding: 'match' | 'missing' | 'unchecked';
}

export async function checkEscrow(
  trade: Trade,
  provider: NetworkProvider,
  buyerReceiveXpub: string | null,
): Promise<EscrowCheck | null> {
  if (!trade.termsJson || !trade.tradeId || !trade.escrowAddress) return null;
  const terms = JSON.parse(trade.termsJson) as TradeTerms;
  const termsMatch = binToHex(computeTradeId(trade.termsJson)) === trade.tradeId.toLowerCase();
  const contract = createEscrowContract(terms, trade.tradeId, provider);
  const addressMatch = contract.address === trade.escrowAddress;
  const payoutIsMine =
    buyerReceiveXpub && trade.buyerReceiveIndex !== undefined
      ? terms.buyerPayoutPkh.toLowerCase() === trade.buyerPayoutPkh.toLowerCase() &&
        verifyDerivedPayoutPkh(buyerReceiveXpub, trade.buyerReceiveIndex, terms.buyerPayoutPkh)
      : undefined;

  let funding: EscrowCheck['funding'] = 'unchecked';
  // Only while the escrow should still hold the coin; once settled it is spent and there is nothing to find.
  const shouldHold = trade.status === 'Funded' || trade.status === 'Paid' || trade.status === 'Disputed';
  if (trade.fundingTxid && addressMatch && shouldHold) {
    const utxos = await provider.getUtxos(contract.address);
    const coin = utxos.find((u) => u.txid === trade.fundingTxid && (trade.fundingVout === undefined || u.vout === trade.fundingVout));
    funding = coin && matchesEscrowFunding(coin, terms) ? 'match' : 'missing';
  }
  return { termsMatch, addressMatch, payoutIsMine, funding };
}
