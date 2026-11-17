// The trade page's model: who is looking, what the title and tags say, the progress steps, and the
// browser's own check of the escrow (docs/protocol.md, section 5). No DOM here; see test/trade.test.ts.

import { binToHex } from '@bitauth/libauth';
import type { NetworkProvider } from 'cashscript';
import { deriveSharedTradeKey } from '../protocol/crypto.js';
import { buildCancelRequest, createEscrowContract, matchesEscrowFunding, type WalletContractSpendRequest } from '../protocol/escrow.js';
import { verifyDerivedPayoutPkh, verifyDerivedPubkey } from '../protocol/keys.js';
import { computeFiatAmount, computeTradeId, verifyPriceQuote, type TradeTerms } from '../protocol/trades.js';
import type { OfferDocument, Trade, TradeState } from './api';
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

/** "Buy 15,000 sats for 0.07 USD", "Bought …" once the buyer has the coins; "Sell …" / "Sold …" for the seller; no verb for visitors. */
export function tradeTitle(status: TradeState, role: Role, amount: string, fiat: string): string {
  const what = `${amount} for ${fiat}`;
  if (role === 'visitor') return what;
  const done = status === 'Released' || status === 'ResolvedBuyer';
  if (role === 'seller') return done ? `Sold ${what}` : `Sell ${what}`;
  return done ? `Bought ${what}` : `Buy ${what}`;
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
 * that did not happen with what did. `amount` is the formatted amount ("15,000 sats"). The seller's own
 * view adds a step for accepting before the deposit and words every step as "you".
 */
export function timeline(trade: Trade, role: Role, amount: string): Step[] {
  const you = role === 'buyer';
  const mine = role === 'seller';
  const buyer = you ? 'You' : 'Buyer';
  const toBuyer = you ? 'to your wallet' : 'to the buyer';
  const s = trade.status;
  const funded = trade.fundingTxid !== undefined;
  const paid = trade.paidAt !== undefined;

  const steps: Step[] = [{ state: 'done', title: mine ? 'Buyer took your offer' : `${buyer} took the offer`, at: trade.createdAt, offchain: true }];

  // Step 2: the seller accepts and funds the escrow.
  if (funded) {
    steps.push({
      state: 'done',
      title: mine ? 'You funded the escrow' : 'Seller funded the escrow',
      at: trade.fundedAt,
      txid: trade.fundingTxid,
      confirmations: trade.fundingConfirmations,
    });
  } else if (mine && s === 'Accepted') {
    steps.push({ state: 'done', title: 'You accepted', offchain: true, note: 'Payment details encrypted for the buyer' });
    steps.push({ state: 'current', title: 'You fund the escrow', note: 'Funding window: 30 min' });
  } else if (s === 'Requested' || s === 'Accepted') {
    steps.push({
      state: 'current',
      title: mine ? 'You accept and fund the escrow' : 'Seller accepts and funds the escrow',
      note: 'Up to 10 min to accept, then 30 min to fund',
    });
  } else {
    // Dropped before any deposit: nothing reached the chain.
    steps.push({ state: 'failed', title: mine ? 'The trade was dropped' : 'The seller did not accept and fund in time', at: trade.updatedAt });
    return steps;
  }

  // Step 3: the buyer pays off-chain and marks it.
  const pays = `${buyer} send${you ? '' : 's'} the payment and mark${you ? '' : 's'} it as paid`;
  if (paid) {
    steps.push({ state: 'done', title: `${buyer} marked the payment as sent`, at: trade.paidAt, offchain: true, simulated: trade.isDemo });
  } else if (s === 'Funded') {
    steps.push({ state: 'current', title: pays, note: windowNote(trade) });
  } else if (s === 'Requested' || s === 'Accepted') {
    steps.push({ state: 'todo', title: pays });
  } else if (s === 'ResolvedSeller' && !trade.disputedAt) {
    steps.push({ state: 'failed', title: 'Payment window ended without a payment', at: trade.verdictIssuedAt });
  } else if (trade.disputedAt !== undefined && s !== 'Dropped') {
    // A dispute opened before the payment was marked as sent: whoever reads the story must see that.
    steps.push({ state: 'failed', title: `${buyer} had not marked the payment as sent`, note: 'The dispute was opened first' });
  }

  // A dispute takes the place of the release while it is open, and stays in the story once it is decided.
  if (trade.disputedAt !== undefined && s !== 'Dropped') {
    const opener = trade.disputedBy;
    const by = opener === 'seller' ? (mine ? 'you' : 'the seller') : opener === 'buyer' ? (you ? 'you' : 'the buyer') : undefined;
    steps.push({
      state: s === 'Disputed' ? 'current' : 'done',
      title: by ? `Dispute opened by ${by}` : 'Dispute opened',
      at: trade.disputedAt,
      note: s === 'Disputed' ? 'Waiting for the arbiter' : undefined,
    });
  }

  // Step 4, or the ending that replaced it.
  const release = mine ? 'You confirm the payment and release' : `Seller releases ${amount} ${toBuyer}`;
  switch (s) {
    case 'Requested':
    case 'Accepted':
    case 'Funded':
      steps.push({ state: 'todo', title: release });
      break;
    case 'Paid':
      steps.push({ state: 'current', title: release });
      break;
    case 'Disputed':
      steps.push({ state: 'todo', title: 'Arbiter decides: funds go to buyer or seller' });
      break;
    case 'Released':
      steps.push({ state: 'done', title: `${mine ? 'You released' : 'Seller released'} ${amount} ${toBuyer}`, at: trade.completedAt, txid: trade.settlementTxid });
      break;
    case 'ResolvedBuyer':
      steps.push({ state: 'done', title: `Arbiter released ${amount} ${toBuyer}`, at: trade.completedAt ?? trade.verdictIssuedAt, txid: trade.settlementTxid });
      break;
    case 'ResolvedSeller':
      steps.push({ state: 'done', title: `Arbiter returned ${amount} to ${mine ? 'you' : 'the seller'}`, at: trade.completedAt ?? trade.verdictIssuedAt, txid: trade.settlementTxid });
      break;
    case 'Cancelled':
      steps.push({ state: 'done', title: `${buyer} cancelled: the escrow returned ${amount} to ${mine ? 'you' : 'the seller'}`, at: trade.completedAt, txid: trade.settlementTxid });
      break;
    case 'Refunded':
      steps.push({ state: 'done', title: `${mine ? 'You' : 'The seller'} recovered ${amount} after the refund time`, at: trade.completedAt, txid: trade.settlementTxid });
      break;
    case 'Dropped':
      steps.push({ state: 'failed', title: 'The trade was dropped', at: trade.updatedAt });
      break;
  }
  return steps;
}

/**
 * The key buyer and seller share for the chat, handed to the arbiter with a dispute so it can read the
 * messages (protocol section 6). `peerSessionPk` is the OTHER party's session key: the seller's for the buyer,
 * the buyer's for the seller. Undefined when this browser has no session key for the trade.
 */
export function disputeKeyHex(sessionPrivateKey: string | null, peerSessionPk: string | undefined): string | undefined {
  if (!sessionPrivateKey || !peerSessionPk) return undefined;
  try {
    return binToHex(deriveSharedTradeKey(sessionPrivateKey, peerSessionPk));
  } catch {
    return undefined;
  }
}

/** The seller's payment details as the buyer reads them: labelled fields (the demo seller's JSON) or plain text. */
export type PaymentDetailsView = { kind: 'fields'; fields: Record<string, unknown> } | { kind: 'text'; text: string };

/**
 * A real seller types the details as free text ("Bank, CBU, alias"); the demo seller sends a JSON object. Only an
 * object is read as fields: a bare number such as an account number is valid JSON but is text.
 */
export function readPaymentDetails(plaintext: string): PaymentDetailsView {
  try {
    const value: unknown = JSON.parse(plaintext);
    if (value !== null && typeof value === 'object' && !Array.isArray(value)) return { kind: 'fields', fields: value as Record<string, unknown> };
  } catch {
    // Not JSON: it is text.
  }
  return { kind: 'text', text: plaintext };
}

/** A refusal with a sentence that is already written for the person reading it. */
export class TradeActionError extends Error {}

/**
 * The `cancel` transaction for the buyer's wallet to sign: the escrow coin goes back to the seller's payout.
 * It is built from the same terms and coin the server will check against, so the signed result passes there.
 */
export async function buildBuyerCancel(
  trade: Trade,
  provider: NetworkProvider,
  buyerDefiXpub: string,
): Promise<WalletContractSpendRequest> {
  if (!trade.termsJson || !trade.tradeId || !trade.fundingTxid || trade.buyerDefiIndex === undefined) {
    throw new TradeActionError('There is no deposit to cancel yet.');
  }
  const terms = JSON.parse(trade.termsJson) as TradeTerms;
  // The wallet signs with whatever key it is told to and does not compare it with the contract (docs/decisions.md).
  if (!verifyDerivedPubkey(buyerDefiXpub, trade.buyerDefiIndex, terms.buyerPk)) {
    throw new TradeActionError('This wallet is not the one that took this trade. Connect the wallet you used to take it.');
  }
  const contract = createEscrowContract(terms, trade.tradeId, provider);
  const utxos = await provider.getUtxos(contract.address);
  const utxo = utxos.find(
    (u) => u.txid === trade.fundingTxid && (trade.fundingVout === undefined || u.vout === trade.fundingVout) && matchesEscrowFunding(u, terms),
  );
  if (!utxo) throw new TradeActionError('The deposit is not visible on-chain yet. Try again in a moment.');
  return buildCancelRequest({ contract, utxo, sellerPayoutPkh: terms.sellerPayoutPkh, buyerDefiIndex: trade.buyerDefiIndex });
}

/**
 * The terms that count: the ones hashed into the trade id and checked against the escrow address. The same
 * fields also sit on the trade record, put there by the service, so a check must not read those.
 */
export function signedTerms(trade: Trade): Pick<TradeTerms, 'amount' | 'fiatAmount' | 'quote' | 'oraclePk' | 'marginBps'> {
  if (trade.termsJson) {
    try {
      return JSON.parse(trade.termsJson) as TradeTerms;
    } catch {
      // Fall through: the escrow check reports a terms mismatch for damaged terms.
    }
  }
  return trade;
}

/** Where the buyer's or the seller's coins go, from the signed terms (the service's copy is only a fallback). */
export function signedPayoutPkh(trade: Trade, party: 'buyer' | 'seller'): string | undefined {
  let terms: Partial<TradeTerms> = {};
  try {
    if (trade.termsJson) terms = JSON.parse(trade.termsJson) as TradeTerms;
  } catch {
    // Damaged terms: fall back to the record; the escrow check reports the mismatch.
  }
  return party === 'buyer' ? (terms.buyerPayoutPkh ?? trade.buyerPayoutPkh) : (terms.sellerPayoutPkh ?? trade.sellerPayoutPkh);
}

export interface ArbiterChecks {
  /**
   * The oracle's signature on the quote, and whether that oracle is the one the offer names.
   * `signature-only`: the signature is valid but the offer was not read, so there is nothing to compare with.
   */
  quote: 'valid' | 'signature-only' | 'wrong-signature' | 'other-oracle' | 'none';
  /** The fiat amount recomputed from amount, price and margin; null when there is no price to compute with. */
  fiat: { price: string; expected: string; ok: boolean } | null;
}

/**
 * What the arbiter can check without trusting the service (protocol section 7.2): the quote's signature
 * and the fiat amount, both on the signed terms. `offer` is the published offer, or undefined if it could
 * not be read.
 */
export function checkForArbiter(trade: Trade, offer: Pick<OfferDocument, 'price' | 'oracle'> | undefined): ArbiterChecks {
  const terms = signedTerms(trade);
  let quote: ArbiterChecks['quote'] = 'none';
  if (terms.quote && terms.oraclePk) {
    quote = !verifyPriceQuote(terms.quote, terms.oraclePk)
      ? 'wrong-signature'
      : offer?.oracle === undefined
        ? 'signature-only'
        : offer.oracle.toLowerCase() !== terms.oraclePk.toLowerCase()
          ? 'other-oracle'
          : 'valid';
  }
  const price = terms.quote?.price ?? (offer?.price.type === 'fixed' ? offer.price.value : undefined);
  let fiat: ArbiterChecks['fiat'] = null;
  if (price !== undefined) {
    try {
      const expected = computeFiatAmount({ amount: terms.amount, assetDecimals: trade.assetDecimals, unitPrice: price, marginBps: terms.marginBps });
      fiat = { price, expected, ok: expected === terms.fiatAmount };
    } catch {
      fiat = null;
    }
  }
  return { quote, fiat };
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
