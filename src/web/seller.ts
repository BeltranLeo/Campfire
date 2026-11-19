// The seller's side of a trade: accepting a request, checking the terms the service built, depositing into
// the escrow and releasing it (docs/protocol.md, sections 4 to 6). No DOM here, so test/seller.test.ts can
// run every check the page makes before it asks the wallet to sign.

import { binToHex, hexToBin, secp256k1 } from '@bitauth/libauth';
import type { Contract, NetworkProvider } from 'cashscript';
import { encryptPaymentDetails, signPaymentDetails, type SessionKeyPair } from '../protocol/crypto.js';
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
import { totalFeeSats, type TradeFee } from '../protocol/fees.js';
import { computeTradeId, type TradeTerms } from '../protocol/trades.js';
import type { OfferDocument, Trade } from './api';
import { spendableBch } from './coins';
import { formatBch } from './format';
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

/** Payment details for a buy offer, sent with the deposit: encrypted for the buyer and signed by this session key. */
export interface SealedDetails {
  encryptedPaymentDetails: string;
  paymentDetailsSignature: string;
}

/**
 * On a buy offer the seller learns the buyer's session key only once the buyer accepts, so the details are sealed
 * at the deposit. The signature by the seller's session key (committed in the terms) shows the service and the
 * buyer that the seller wrote them; the buyer shares the encryption key and could otherwise write their own.
 */
/**
 * How the buyer should pay, typed in fields instead of one free-text box. They travel as a JSON object inside the
 * same encrypted text as before, and the buyer's page already shows an object as labelled rows (readPaymentDetails
 * in trade.ts). Nothing is stored: the details are written for one trade.
 */
export interface PaymentFields {
  account: string;
  holder: string;
  note: string;
}
export const EMPTY_PAYMENT_FIELDS: PaymentFields = { account: '', holder: '', note: '' };
/** The service and the form both cap the details at 500 characters. */
export const MAX_DETAILS_LENGTH = 500;

/** "Alias, CBU or CVU" for pesos, where those are what people share; a general name for other money. */
export function accountLabel(fiat: string): string {
  return fiat === 'ARS' ? 'Alias, CBU or CVU' : 'Account number or alias';
}

/** The text to encrypt, or '' while the required fields are empty (so a saved earlier version can still be used). */
export function composePaymentDetails(fields: PaymentFields, fiat: string): string {
  const account = fields.account.trim();
  const holder = fields.holder.trim();
  const note = fields.note.trim();
  if (!account && !holder && !note) return '';
  return JSON.stringify({ [accountLabel(fiat)]: account, 'Account holder': holder, ...(note ? { Note: note } : {}) });
}

/** Both the account and its holder are needed for a transfer; the note is optional. */
export function paymentFieldsReady(fields: PaymentFields, fiat: string): boolean {
  return fields.account.trim() !== '' && fields.holder.trim() !== '' && composePaymentDetails(fields, fiat).length <= MAX_DETAILS_LENGTH;
}

export async function sealPaymentDetails(params: {
  sessionPrivateKey: string;
  buyerSessionPk: string;
  tradeId: string;
  details: string;
}): Promise<SealedDetails> {
  const details = params.details.trim();
  if (details.length === 0) throw new TradeActionError('Write how the buyer should pay you.');
  const encryptedPaymentDetails = await encryptPaymentDetails(params.sessionPrivateKey, params.buyerSessionPk, details);
  return { encryptedPaymentDetails, paymentDetailsSignature: signPaymentDetails(params.sessionPrivateKey, params.tradeId, encryptedPaymentDetails) };
}

/** The coins the wallet must hold to deposit this trade: the escrow's value, the service fees and the deposit's own fee. */
export function depositNeeds(trade: Pick<Trade, 'asset' | 'amount' | 'fees'>): bigint {
  return expectedEscrowFunding(trade).satoshis + totalFeeSats(trade.fees) + DEPOSIT_FEE_RESERVE_SATS;
}

/** Fees are equal when they pay the same roles, addresses and amounts, in any order. */
function sameFees(a: readonly TradeFee[] | undefined, b: readonly TradeFee[] | undefined): boolean {
  const key = (fees: readonly TradeFee[] | undefined) =>
    (fees ?? []).map((f) => `${f.role}:${f.pkh.toLowerCase()}:${f.satoshis}`).sort().join('|');
  return key(a) === key(b);
}

/** Throws a sentence for the person if the wallet's coins cannot cover the deposit. */
export function assertCanDeposit(trade: Pick<Trade, 'asset' | 'amount' | 'fees'>, coins: WalletSpendableUtxo[]): void {
  if (trade.asset !== 'BCH') throw new TradeActionError('Depositing PUSD is not available yet.');
  const have = spendableBch(coins);
  const need = depositNeeds(trade);
  if (have < need) {
    throw new TradeActionError(
      `The deposit needs about ${formatBch(need)} and Campfire can see ${formatBch(have)} in this wallet. Send some BCH to it and try again.`,
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
  // The fees were shown with the request; the terms must not charge anything else. Their addresses and the
  // cap on BCH trades were already checked with the terms (validateTradeFees).
  if (!sameFees(terms.fees, trade.fees)) {
    throw stop('The terms charge different service fees than the ones shown with this request.');
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

// On a buy offer the sealed details travel with the deposit, and the service refuses the deposit without them. They
// are kept next to the signed deposit, so a deposit whose answer was lost can still be recorded after a reload.
const detailsKey = (tradeId: string) => `campfire.details.${tradeId}`;

export function loadSavedDetails(store: SessionStore, tradeId: string): SealedDetails | null {
  try {
    const value = JSON.parse(store.getItem(detailsKey(tradeId)) ?? 'null');
    return value && typeof value.encryptedPaymentDetails === 'string' && typeof value.paymentDetailsSignature === 'string' ? value : null;
  } catch {
    return null;
  }
}
export const saveDetails = (store: SessionStore, tradeId: string, sealed: SealedDetails) => store.setItem(detailsKey(tradeId), JSON.stringify(sealed));
export const clearSavedDetails = (store: SessionStore, tradeId: string) => store.removeItem(detailsKey(tradeId));
