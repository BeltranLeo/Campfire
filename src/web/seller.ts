// The seller's side of a trade: accepting a request, checking the terms the service built, depositing into
// the escrow and releasing it (docs/protocol.md, sections 4 to 6). No DOM here, so test/seller.test.ts can
// run every check the page makes before it asks the wallet to sign.

import { binToHex, hexToBin, secp256k1 } from '@bitauth/libauth';
import type { Contract, NetworkProvider } from 'cashscript';
import { encryptPaymentDetails, type SessionKeyPair } from '../protocol/crypto.js';
import {
  buildFundEscrowTransaction,
  buildReleaseRequest,
  createEscrowContract,
  expectedEscrowFunding,
  matchesEscrowFunding,
  type WalletContractSpendRequest,
} from '../protocol/escrow.js';
import {
  derivePayoutPkhFromXpub,
  derivePubkeyFromXpub,
  verifyDerivedPayoutPkh,
  verifyDerivedPubkey,
  type WalletSpendableUtxo,
  type WalletTransactionRequest,
} from '../protocol/keys.js';
import { computeTradeId, type TradeTerms } from '../protocol/trades.js';
import type { OfferDocument, Trade } from './api';
import { spendableBch } from './coins';
import type { SessionStore } from './take';
import { TradeActionError, checkForArbiter } from './trade';

/** Network fee for the deposit transaction itself (one or two inputs, the escrow output and the change). */
const DEPOSIT_FEE_RESERVE_SATS = 500n;
/** The escrow locks the seller's coins until the buyer takes them or this time passes. Longer than this is not normal. */
const MAX_REFUND_DELAY_SEC = 30 * 86_400;

/** What the service needs to accept a request (POST /api/trades/:id/accept). */
export interface AcceptBody {
  sellerIdentity: string;
  sellerPk: string;
  sellerDefiIndex: number;
  sellerPayoutPkh: string;
  sellerReceiveIndex: number;
  sellerSessionPk: string;
  encryptedPaymentDetails: string;
}

/**
 * The accept request: the seller's key for this trade and a payout address from the wallet, plus the payment
 * details encrypted in this browser for the buyer's session key, so the service only ever holds ciphertext.
 */
export async function buildAcceptBody(params: {
  identity: string;
  defiXpub: string;
  receiveXpub: string;
  defiIndex: number;
  receiveIndex: number;
  session: SessionKeyPair;
  buyerSessionPk: string;
  details: string;
}): Promise<AcceptBody> {
  const details = params.details.trim();
  if (details.length === 0) throw new TradeActionError('Write the payment details the buyer should pay to.');
  return {
    sellerIdentity: params.identity,
    sellerPk: binToHex(derivePubkeyFromXpub(params.defiXpub, params.defiIndex)),
    sellerDefiIndex: params.defiIndex,
    sellerPayoutPkh: binToHex(derivePayoutPkhFromXpub(params.receiveXpub, params.receiveIndex)),
    sellerReceiveIndex: params.receiveIndex,
    sellerSessionPk: params.session.publicKey,
    encryptedPaymentDetails: await encryptPaymentDetails(params.session.privateKey, params.buyerSessionPk, details),
  };
}

/** The coins the wallet must hold to deposit this trade: the escrow's value plus the deposit's own fee. */
export function depositNeeds(trade: Pick<Trade, 'asset' | 'amount'>): bigint {
  return expectedEscrowFunding(trade).satoshis + DEPOSIT_FEE_RESERVE_SATS;
}

/** Throws a sentence for the person if the wallet's coins cannot cover the deposit. */
export function assertCanDeposit(trade: Pick<Trade, 'asset' | 'amount'>, coins: WalletSpendableUtxo[]): void {
  if (trade.asset !== 'BCH') throw new TradeActionError('Depositing PUSD is not available yet.');
  const have = spendableBch(coins);
  const need = depositNeeds(trade);
  if (have < need) {
    throw new TradeActionError(
      `The deposit needs about ${need.toLocaleString('en-US')} sats and Campfire can see ${have.toLocaleString('en-US')} in this wallet. Send some BCH to it and try again.`,
    );
  }
}

export interface CheckedTrade {
  terms: TradeTerms;
  contract: Contract;
}

/**
 * Everything the seller can check about the terms before locking coins. The service built them, so none of it
 * is taken on trust: the trade id is the hash of the terms, the escrow address is the contract those terms
 * make, the keys are this wallet's, the arbiter is the one the offer names, the price is signed and the refund
 * time is not far away. A failure names the problem and the page does not ask the wallet to sign.
 */
export function checkAcceptedTrade(
  trade: Trade,
  params: {
    provider: NetworkProvider;
    defiXpub: string;
    receiveXpub: string;
    /** This browser's session key for the trade, when it has one. */
    sessionPrivateKey: string | null;
    offer: Pick<OfferDocument, 'arbiter' | 'price' | 'oracle'> | undefined;
    /** Unix seconds. */
    now: number;
  },
): CheckedTrade {
  const stop = (what: string) => new TradeActionError(`${what} Nothing was deposited.`);
  if (!trade.termsJson || !trade.tradeId || !trade.escrowAddress || trade.sellerDefiIndex === undefined || trade.sellerReceiveIndex === undefined) {
    throw stop('This trade has no escrow yet.');
  }
  let terms: TradeTerms;
  let contract: Contract;
  try {
    terms = JSON.parse(trade.termsJson) as TradeTerms;
    if (binToHex(computeTradeId(trade.termsJson)) !== trade.tradeId.toLowerCase()) throw stop('The trade ID is not the hash of the terms.');
    contract = createEscrowContract(terms, trade.tradeId, params.provider);
  } catch (err) {
    if (err instanceof TradeActionError) throw err;
    throw stop('The terms of this trade are not valid.');
  }
  if (contract.address !== trade.escrowAddress) throw stop('The escrow address is not the contract these terms make.');
  if (!verifyDerivedPubkey(params.defiXpub, trade.sellerDefiIndex, terms.sellerPk)) {
    throw stop('The terms name a signing key that does not belong to this wallet. Connect the wallet you accepted with.');
  }
  if (!verifyDerivedPayoutPkh(params.receiveXpub, trade.sellerReceiveIndex, terms.sellerPayoutPkh)) {
    throw stop('The terms return the coins to an address that does not belong to this wallet.');
  }
  if (terms.amount !== trade.amount || terms.asset !== trade.asset || terms.offerTxid !== trade.offerTxid) {
    throw stop('The terms do not match the request.');
  }
  if (params.offer && terms.arbiterPk.toLowerCase() !== params.offer.arbiter.toLowerCase()) {
    throw stop('The terms name a different arbiter than your offer.');
  }
  if (terms.refundTime > params.now + MAX_REFUND_DELAY_SEC) {
    throw stop('The refund time is unusually far away, so your coins could stay locked for too long.');
  }
  if (params.sessionPrivateKey) {
    const pk = secp256k1.derivePublicKeyCompressed(hexToBin(params.sessionPrivateKey));
    if (typeof pk === 'string' || binToHex(pk) !== terms.sellerSessionPk.toLowerCase()) {
      throw stop("The terms name a different chat key than this browser's.");
    }
  }
  const prices = checkForArbiter(trade, params.offer);
  if (prices.quote === 'wrong-signature' || prices.quote === 'other-oracle') throw stop("The price quote is not signed by your offer's oracle.");
  if (prices.fiat && !prices.fiat.ok) throw stop('The fiat amount does not match the price and the margin.');
  return { terms, contract };
}

/** A coin at the escrow that already holds the terms' value: the deposit exists and must not be made again. */
export async function findDeposit(contract: Contract, terms: TradeTerms) {
  const utxos = await contract.getUtxos();
  return utxos.find((u) => matchesEscrowFunding(u, terms));
}

/** The deposit transaction for the wallet to sign: the escrow's exact value, with the change back to the wallet. */
export function buildDeposit(params: {
  trade: Trade;
  checked: CheckedTrade;
  coins: WalletSpendableUtxo[];
  changeAddress: string;
}): WalletTransactionRequest {
  assertCanDeposit(params.trade, params.coins);
  return buildFundEscrowTransaction({
    contract: params.checked.contract,
    terms: params.checked.terms,
    utxos: params.coins,
    changeAddress: params.changeAddress,
  });
}

/**
 * The `release` transaction for the seller's wallet to sign: the escrow coin goes to the buyer's payout from the
 * signed terms. The coin is found at the address those terms make, so terms that differ from what was funded
 * find nothing and nothing can be built.
 */
export async function buildSellerRelease(trade: Trade, provider: NetworkProvider, sellerDefiXpub: string): Promise<WalletContractSpendRequest> {
  if (!trade.termsJson || !trade.tradeId || !trade.fundingTxid || trade.sellerDefiIndex === undefined) {
    throw new TradeActionError('There is no deposit to release yet.');
  }
  const terms = JSON.parse(trade.termsJson) as TradeTerms;
  // The wallet signs with whatever key it is told to and does not compare it with the contract (docs/decisions.md).
  if (!verifyDerivedPubkey(sellerDefiXpub, trade.sellerDefiIndex, terms.sellerPk)) {
    throw new TradeActionError('This wallet is not the one that accepted this trade. Connect the wallet you used to accept it.');
  }
  const contract = createEscrowContract(terms, trade.tradeId, provider);
  const utxos = await provider.getUtxos(contract.address);
  const utxo = utxos.find(
    (u) => u.txid === trade.fundingTxid && (trade.fundingVout === undefined || u.vout === trade.fundingVout) && matchesEscrowFunding(u, terms),
  );
  if (!utxo) throw new TradeActionError('The deposit is not visible on-chain. Try again in a moment.');
  return buildReleaseRequest({ contract, utxo, buyerPayoutPkh: terms.buyerPayoutPkh, sellerDefiIndex: trade.sellerDefiIndex });
}

// --- A signed deposit kept in this browser ---
// The deposit is signed once. If the service's answer is lost, the same signed transaction is sent again
// instead of asking the wallet for a second one, which would lock the coins twice.

const fundingKey = (tradeId: string) => `campfire.funding.${tradeId}`;

export const loadSavedDeposit = (store: SessionStore, tradeId: string) => store.getItem(fundingKey(tradeId));
export const saveDeposit = (store: SessionStore, tradeId: string, signedTxHex: string) => store.setItem(fundingKey(tradeId), signedTxHex);
export const clearSavedDeposit = (store: SessionStore, tradeId: string) => store.removeItem(fundingKey(tradeId));
