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
import { gatherFungibleTokenUtxos } from 'cashscript';
import {
  derivePayoutPkhFromXpub,
  derivePubkeyFromXpub,
  verifyDerivedPayoutPkh,
  verifyDerivedPubkey,
  type WalletSpendableUtxo,
  type WalletTransactionRequest,
} from '../protocol/keys.js';
import { MAX_FEE_BPS, totalFeeSats, tradeValueSats, type TradeFee } from '../protocol/fees.js';
import { PUSD_CATEGORY } from '../protocol/offers.js';
import { computeTradeId, type TradeTerms } from '../protocol/trades.js';
import type { OfferDocument, Trade } from './api';
import { spendableBch, tokenBalance } from './coins';
import { formatBch, fromBaseUnits } from './format';
import { text } from './messages';
import type { SessionStore } from './take';
import { TradeActionError, checkForArbiter } from './trade';

/** Network fee for the deposit transaction itself (one or two inputs, the escrow output and the change). */
const DEPOSIT_FEE_RESERVE_SATS = 500n;
/** The escrow locks the seller's coins until the buyer takes them or this time passes. Longer than this is not normal. */
const MAX_REFUND_DELAY_SEC = 30 * 86_400;
/** How far the BCH price may have moved between the request and the deposit when the fees of a PUSD trade are capped. */
const PUSD_FEE_PRICE_SLACK_PCT = 20n;

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
  if (details.length === 0) throw new TradeActionError(text().seller.writeDetails);
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
  if (details.length === 0) throw new TradeActionError(text().seller.writeHow);
  const encryptedPaymentDetails = await encryptPaymentDetails(params.sessionPrivateKey, params.buyerSessionPk, details);
  return { encryptedPaymentDetails, paymentDetailsSignature: signPaymentDetails(params.sessionPrivateKey, params.tradeId, encryptedPaymentDetails) };
}

/**
 * The deposit of a token trade sends this much BCH beyond the escrow value and the fees: the deposit's own network
 * fee and the dust of the token change output. It must match the margin buildFundEscrowTransaction asks for.
 */
const TOKEN_DEPOSIT_EXTRA_SATS = 2000n;

/** The coins the wallet must hold to deposit a BCH trade: the escrow's value, the service fees and the deposit's own fee. */
export function depositNeeds(trade: Pick<Trade, 'asset' | 'amount' | 'fees'>): bigint {
  return expectedEscrowFunding(trade).satoshis + totalFeeSats(trade.fees) + DEPOSIT_FEE_RESERVE_SATS;
}

/** What a deposit takes from the wallet and what the wallet has, for BCH and, on a token trade, for the token. */
export interface DepositCheck {
  bch: { need: bigint; have: bigint };
  token?: { category: string; need: bigint; have: bigint };
}

/**
 * Mirrors the coin selection of buildFundEscrowTransaction, so a wallet that passes here can always be built for.
 * On a token trade the token coins it would pick carry satoshis too, and those count toward the BCH it needs.
 */
export function checkDeposit(trade: Pick<Trade, 'asset' | 'amount' | 'fees'>, coins: WalletSpendableUtxo[]): DepositCheck {
  const expected = expectedEscrowFunding(trade);
  const plain = spendableBch(coins);
  if (!expected.token) return { bch: { need: depositNeeds(trade), have: plain } };
  const { category, amount } = expected.token;
  const have = tokenBalance(coins, category);
  const outgoing = expected.satoshis + totalFeeSats(trade.fees) + TOKEN_DEPOSIT_EXTRA_SATS;
  let tokenSats = 0n;
  if (have >= amount) {
    const normalized = coins.map((c) => (c.token ? { ...c, token: { ...c.token, category: c.token.category.toLowerCase() } } : c));
    tokenSats = gatherFungibleTokenUtxos(normalized, category, amount).utxos.reduce((sum, u) => sum + u.satoshis, 0n);
  }
  const need = outgoing > tokenSats ? outgoing - tokenSats : 0n;
  return { bch: { need, have: plain }, token: { category, need: amount, have } };
}

/** True when the wallet's coins cover the deposit. */
export function canDeposit(check: DepositCheck): boolean {
  return check.bch.have >= check.bch.need && (!check.token || check.token.have >= check.token.need);
}

/** "PUSD" for the service's dollar token; the shortened category for any other token. */
function tokenName(category: string): string {
  return category === PUSD_CATEGORY ? 'PUSD' : `tokens ${category.slice(0, 8)}…`;
}

/** Fees are equal when they pay the same roles, addresses and amounts, in any order. */
function sameFees(a: readonly TradeFee[] | undefined, b: readonly TradeFee[] | undefined): boolean {
  const key = (fees: readonly TradeFee[] | undefined) =>
    (fees ?? []).map((f) => `${f.role}:${f.pkh.toLowerCase()}:${f.satoshis}`).sort().join('|');
  return key(a) === key(b);
}

/** Throws a sentence for the person if the wallet's coins cannot cover the deposit. */
export function assertCanDeposit(trade: Pick<Trade, 'asset' | 'amount' | 'fees'>, coins: WalletSpendableUtxo[]): void {
  const check = checkDeposit(trade, coins);
  if (check.token && check.token.have < check.token.need) {
    const name = tokenName(check.token.category);
    const decimals = check.token.category === PUSD_CATEGORY ? 2 : 0;
    throw new TradeActionError(
      text().seller.depositNeedsToken(fromBaseUnits(check.token.need, decimals), name, fromBaseUnits(check.token.have, decimals)),
    );
  }
  if (check.bch.have < check.bch.need) {
    throw new TradeActionError(text().seller.depositNeedsBch(formatBch(check.bch.need), formatBch(check.bch.have), Boolean(check.token)));
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
    /** A BCH/USD price signed by the service's oracle and checked by the caller, needed to cap the fees of a PUSD trade. */
    bchUsd?: string | null;
  },
): CheckedTrade {
  const stop = (what: string) => new TradeActionError(text().seller.nothingDeposited(what));
  const why = text().seller.stop;
  if (!trade.termsJson || !trade.tradeId || !trade.escrowAddress || trade.sellerDefiIndex === undefined || trade.sellerReceiveIndex === undefined) {
    throw stop(why.noEscrow);
  }
  let terms: TradeTerms;
  let contract: Contract;
  try {
    terms = JSON.parse(trade.termsJson) as TradeTerms;
    if (binToHex(computeTradeId(trade.termsJson)) !== trade.tradeId.toLowerCase()) throw stop(why.badId);
    contract = createEscrowContract(terms, trade.tradeId, params.provider);
  } catch (err) {
    if (err instanceof TradeActionError) throw err;
    throw stop(why.badTerms);
  }
  if (contract.address !== trade.escrowAddress) throw stop(why.badAddress);
  if (!verifyDerivedPubkey(params.defiXpub, trade.sellerDefiIndex, terms.sellerPk)) {
    throw stop(why.foreignKey);
  }
  if (!verifyDerivedPayoutPkh(params.receiveXpub, trade.sellerReceiveIndex, terms.sellerPayoutPkh)) {
    throw stop(why.foreignRefund);
  }
  if (terms.amount !== trade.amount || terms.asset !== trade.asset || terms.offerTxid !== trade.offerTxid) {
    throw stop(why.notRequest);
  }
  // The fees were shown with the request; the terms must not charge anything else. Their addresses and the
  // cap on BCH trades were already checked with the terms (validateTradeFees).
  if (!sameFees(terms.fees, trade.fees)) {
    throw stop(why.otherFees);
  }
  // The terms do not carry the BCH price a PUSD trade's fees were computed with, so the cap is checked here
  // against a fresh one, with room for the price to move since the request.
  if (terms.asset.toLowerCase() === PUSD_CATEGORY && totalFeeSats(terms.fees) > 0n) {
    if (!params.bchUsd) throw stop(why.noBchPrice);
    const value = tradeValueSats({ asset: terms.asset, amount: terms.amount, assetDecimals: 2, bchUsd: params.bchUsd }) ?? 0n;
    const cap = (value * BigInt(MAX_FEE_BPS) * (100n + PUSD_FEE_PRICE_SLACK_PCT)) / (10_000n * 100n);
    if (totalFeeSats(terms.fees) > cap) throw stop(why.feesTooHigh);
  }
  if (params.offer && terms.arbiterPk.toLowerCase() !== params.offer.arbiter.toLowerCase()) {
    throw stop(why.otherArbiter);
  }
  if (terms.refundTime > params.now + MAX_REFUND_DELAY_SEC) {
    throw stop(why.farRefund);
  }
  if (params.sessionPrivateKey) {
    const pk = secp256k1.derivePublicKeyCompressed(hexToBin(params.sessionPrivateKey));
    if (typeof pk === 'string' || binToHex(pk) !== terms.sellerSessionPk.toLowerCase()) {
      throw stop(why.otherChatKey);
    }
  }
  const prices = checkForArbiter(trade, params.offer);
  if (prices.quote === 'wrong-signature' || prices.quote === 'other-oracle') throw stop(why.otherOracle);
  if (prices.fiat && !prices.fiat.ok) throw stop(why.badFiat);
  return { terms, contract };
}

/** A coin at the escrow that already holds the terms' value: the deposit exists and must not be made again. */
export async function findDeposit(contract: Contract, terms: TradeTerms) {
  const utxos = await contract.getUtxos();
  return utxos.find((u) => matchesEscrowFunding(u, terms));
}

/** The deposit transaction for the wallet to sign: the escrow's exact value and tokens, with the change back to the wallet. */
export function buildDeposit(params: {
  trade: Trade;
  checked: CheckedTrade;
  coins: WalletSpendableUtxo[];
  changeAddress: string;
  /** The same address in its token-aware form (bitcoincash:z…), where the token change of a token trade goes. */
  tokenChangeAddress: string;
}): WalletTransactionRequest {
  assertCanDeposit(params.trade, params.coins);
  return buildFundEscrowTransaction({
    contract: params.checked.contract,
    terms: params.checked.terms,
    utxos: params.coins,
    changeAddress: params.changeAddress,
    tokenChangeAddress: params.tokenChangeAddress,
  });
}

/**
 * The `release` transaction for the seller's wallet to sign: the escrow coin goes to the buyer's payout from the
 * signed terms. The coin is found at the address those terms make, so terms that differ from what was funded
 * find nothing and nothing can be built.
 */
export async function buildSellerRelease(trade: Trade, provider: NetworkProvider, sellerDefiXpub: string): Promise<WalletContractSpendRequest> {
  if (!trade.termsJson || !trade.tradeId || !trade.fundingTxid || trade.sellerDefiIndex === undefined) {
    throw new TradeActionError(text().seller.noDepositYet);
  }
  const terms = JSON.parse(trade.termsJson) as TradeTerms;
  // The wallet signs with whatever key it is told to and does not compare it with the contract (docs/decisions.md).
  if (!verifyDerivedPubkey(sellerDefiXpub, trade.sellerDefiIndex, terms.sellerPk)) {
    throw new TradeActionError(text().seller.notYourWallet);
  }
  const contract = createEscrowContract(terms, trade.tradeId, provider);
  const utxos = await provider.getUtxos(contract.address);
  const utxo = utxos.find(
    (u) => u.txid === trade.fundingTxid && (trade.fundingVout === undefined || u.vout === trade.fundingVout) && matchesEscrowFunding(u, terms),
  );
  if (!utxo) throw new TradeActionError(text().seller.depositNotVisible);
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
