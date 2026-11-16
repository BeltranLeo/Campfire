// Oracle price quotes, trade-terms validation, tradeId and arbiter verdicts (protocol sections 3.3 and 4.3).

import {
  binToHex,
  binToUtf8,
  hexToBin,
  secp256k1,
  sha256,
  utf8ToBin,
} from '@bitauth/libauth';
import { isBytes20Hex, isBytes32Hex, isCompressedPubkeyHex, toBytes } from './keys.js';
import {
  BCH_ASSET,
  FORMAT_VERSION,
  MIN_UNIX_TIMESTAMP,
  isPositiveDecimalString,
} from './offers.js';

export const QUOTE_PREFIX = 'CMPF-QUOTE';
export const VERDICT_BUYER = '01' as const;
export const VERDICT_SELLER = '02' as const;
export type VerdictHex = typeof VERDICT_BUYER | typeof VERDICT_SELLER;

export interface PriceQuote {
  pair: string;
  price: string;
  timestamp: number;
  signature: string;
}

export interface TradeTerms {
  v: 1;
  offerTxid: string;
  asset: string;
  amount: string;
  fiat: string;
  fiatAmount: string;
  quote?: PriceQuote;
  marginBps?: number;
  sellerPk: string;
  buyerPk: string;
  arbiterPk: string;
  oraclePk?: string;
  sellerPayoutPkh: string;
  buyerPayoutPkh: string;
  sellerSessionPk: string;
  buyerSessionPk: string;
  refundTime: number;
  nonce: string;
}

const POSITIVE_INT_RE = /^[1-9][0-9]*$/;
const FIAT_RE = /^[A-Z]{3}$/;

// SHA-256("CMPF-QUOTE" ‖ pair ‖ price ‖ timestamp) as specified in protocol section 3.3.
export function quoteMessageHash(pair: string, price: string, timestamp: number): Uint8Array {
  if (!pair || typeof pair !== 'string') {
    throw new Error('Quote pair must be a non-empty string');
  }
  if (!isPositiveDecimalString(price)) {
    throw new Error('Quote price must be a positive decimal string');
  }
  if (!Number.isInteger(timestamp) || timestamp < MIN_UNIX_TIMESTAMP) {
    throw new Error('Quote timestamp must be a Unix timestamp (>= 500,000,000)');
  }
  return sha256.hash(utf8ToBin(`${QUOTE_PREFIX}${pair}${price}${timestamp}`));
}

export function signPriceQuote(
  oraclePrivateKey: Uint8Array | string,
  quote: { pair: string; price: string; timestamp: number },
): PriceQuote {
  const sk = toBytes(oraclePrivateKey, 'oraclePrivateKey');
  if (!secp256k1.validatePrivateKey(sk)) {
    throw new Error('Invalid oracle private key');
  }
  const msgHash = quoteMessageHash(quote.pair, quote.price, quote.timestamp);
  const sig = secp256k1.signMessageHashSchnorr(sk, msgHash);
  if (typeof sig === 'string') {
    throw new Error(`Failed to sign price quote: ${sig}`);
  }
  return {
    pair: quote.pair,
    price: quote.price,
    timestamp: quote.timestamp,
    signature: binToHex(sig),
  };
}

export function verifyPriceQuote(quote: PriceQuote, oraclePk: Uint8Array | string): boolean {
  try {
    const pk = toBytes(oraclePk, 'oraclePk');
    if (pk.length !== 33 || !secp256k1.validatePublicKey(pk)) return false;
    const sig = toBytes(quote.signature, 'quote.signature');
    if (sig.length !== 64) return false;
    const msgHash = quoteMessageHash(quote.pair, quote.price, quote.timestamp);
    return secp256k1.verifySignatureSchnorr(sig, pk, msgHash);
  } catch {
    return false;
  }
}

// Computes the fiat amount (2 decimal places, half-up) from base units, unit price and marginBps.
export function computeFiatAmount(params: {
  amount: bigint | string;
  assetDecimals: number;
  unitPrice: string;
  marginBps?: number;
}): string {
  const baseUnits = typeof params.amount === 'bigint' ? params.amount : BigInt(params.amount);
  if (baseUnits <= 0n) {
    throw new Error('Trade amount must be positive');
  }
  if (!Number.isInteger(params.assetDecimals) || params.assetDecimals < 0 || params.assetDecimals > 18) {
    throw new Error(`Invalid assetDecimals: ${params.assetDecimals}`);
  }
  if (!isPositiveDecimalString(params.unitPrice)) {
    throw new Error(`Invalid unitPrice: ${params.unitPrice}`);
  }
  const marginBps = params.marginBps ?? 0;
  if (!Number.isInteger(marginBps) || marginBps <= -10_000) {
    throw new Error(`Invalid marginBps: ${marginBps}`);
  }

  const [wholePart, fracPart = ''] = params.unitPrice.split('.');
  const priceDecimals = BigInt(fracPart.length);
  const scaledPrice = BigInt(wholePart + fracPart);

  // fiatCents = baseUnits * scaledPrice * (10000 + marginBps) * 100 / (10^assetDecimals * 10^priceDecimals * 10000)
  const numerator = baseUnits * scaledPrice * BigInt(10_000 + marginBps) * 100n;
  const denominator = 10n ** BigInt(params.assetDecimals) * 10n ** priceDecimals * 10_000n;
  const cents = (numerator + denominator / 2n) / denominator;

  const wholeFiat = cents / 100n;
  const remCents = (cents % 100n).toString().padStart(2, '0');
  return `${wholeFiat}.${remCents}`;
}

export function validateTradeTerms(terms: TradeTerms): void {
  if (!terms || typeof terms !== 'object') {
    throw new Error('Trade terms must be an object');
  }
  if (terms.v !== FORMAT_VERSION) {
    throw new Error(`Unsupported trade-terms version: ${String(terms.v)}`);
  }
  if (!isBytes32Hex(terms.offerTxid)) {
    throw new Error('offerTxid must be a 64-character hex transaction ID');
  }
  if (terms.asset !== BCH_ASSET && !isBytes32Hex(terms.asset)) {
    throw new Error('Trade asset must be "BCH" or a 64-character hex token category ID');
  }
  if (typeof terms.amount !== 'string' || !POSITIVE_INT_RE.test(terms.amount)) {
    throw new Error('Trade amount must be a positive integer string in base units');
  }
  if (!FIAT_RE.test(terms.fiat)) {
    throw new Error(`Trade fiat must be a 3-letter ISO 4217 code, got "${String(terms.fiat)}"`);
  }
  if (!isPositiveDecimalString(terms.fiatAmount)) {
    throw new Error('Trade fiatAmount must be a positive decimal string');
  }
  if (!isCompressedPubkeyHex(terms.sellerPk)) {
    throw new Error('Invalid sellerPk');
  }
  if (!isCompressedPubkeyHex(terms.buyerPk)) {
    throw new Error('Invalid buyerPk');
  }
  if (!isCompressedPubkeyHex(terms.arbiterPk)) {
    throw new Error('Invalid arbiterPk');
  }
  if (!isBytes20Hex(terms.sellerPayoutPkh)) {
    throw new Error('Invalid sellerPayoutPkh');
  }
  if (!isBytes20Hex(terms.buyerPayoutPkh)) {
    throw new Error('Invalid buyerPayoutPkh');
  }
  if (!isCompressedPubkeyHex(terms.sellerSessionPk)) {
    throw new Error('Invalid sellerSessionPk');
  }
  if (!isCompressedPubkeyHex(terms.buyerSessionPk)) {
    throw new Error('Invalid buyerSessionPk');
  }
  // A refundTime below 500,000,000 would be treated as a block height by OP_CHECKLOCKTIMEVERIFY.
  if (!Number.isInteger(terms.refundTime) || terms.refundTime < MIN_UNIX_TIMESTAMP) {
    throw new Error('refundTime must be a Unix timestamp (>= 500,000,000)');
  }
  if (typeof terms.nonce !== 'string' || terms.nonce.trim().length === 0) {
    throw new Error('Trade terms require a non-empty nonce');
  }

  const hasQuote = terms.quote !== undefined;
  const hasOracle = terms.oraclePk !== undefined;
  const hasMargin = terms.marginBps !== undefined;
  if (hasQuote || hasOracle || hasMargin) {
    if (!terms.quote || !terms.oraclePk || terms.marginBps === undefined) {
      throw new Error('Floating-price trade terms must include quote, oraclePk and marginBps together');
    }
    if (!isCompressedPubkeyHex(terms.oraclePk)) {
      throw new Error('Invalid oraclePk');
    }
    if (!Number.isInteger(terms.marginBps) || terms.marginBps <= -10_000) {
      throw new Error('Invalid marginBps');
    }
    if (!verifyPriceQuote(terms.quote, terms.oraclePk)) {
      throw new Error('Invalid oracle signature on price quote');
    }
  }
}

// Validates the trade-terms JSON bytes and returns their 32-byte SHA-256 (`tradeId`).
export function computeTradeId(termsJsonBytesOrString: Uint8Array | string): Uint8Array {
  const bytes = typeof termsJsonBytesOrString === 'string'
    ? utf8ToBin(termsJsonBytesOrString)
    : termsJsonBytesOrString;
  let parsed: unknown;
  try {
    parsed = JSON.parse(binToUtf8(bytes));
  } catch {
    throw new Error('Trade terms are not valid UTF-8 JSON');
  }
  validateTradeTerms(parsed as TradeTerms);
  return sha256.hash(bytes);
}

// Concatenates `tradeId ‖ verdict` (33 bytes), the preimage hashed by `checkDataSig` on-chain.
export function verdictMessage(tradeId: Uint8Array | string, verdict: VerdictHex): Uint8Array {
  const idBytes = toBytes(tradeId, 'tradeId');
  if (idBytes.length !== 32) {
    throw new Error(`Expected 32-byte tradeId, got ${idBytes.length} bytes`);
  }
  if (verdict !== VERDICT_BUYER && verdict !== VERDICT_SELLER) {
    throw new Error(`Unknown verdict "${String(verdict)}"`);
  }
  return Uint8Array.from([...idBytes, ...hexToBin(verdict)]);
}

// Produces the 64-byte Schnorr data signature over `SHA-256(tradeId ‖ verdict)` for `arbitrate`.
export function signVerdict(
  arbiterPrivateKey: Uint8Array | string,
  tradeId: Uint8Array | string,
  verdict: VerdictHex,
): Uint8Array {
  const sk = toBytes(arbiterPrivateKey, 'arbiterPrivateKey');
  if (!secp256k1.validatePrivateKey(sk)) {
    throw new Error('Invalid arbiter private key');
  }
  const msgHash = sha256.hash(verdictMessage(tradeId, verdict));
  const sig = secp256k1.signMessageHashSchnorr(sk, msgHash);
  if (typeof sig === 'string') {
    throw new Error(`Failed to sign verdict: ${sig}`);
  }
  return sig;
}

// Verifies an arbiter's 64-byte Schnorr data signature over `SHA-256(tradeId ‖ verdict)`.
export function verifyVerdict(
  signature: Uint8Array | string,
  tradeId: Uint8Array | string,
  verdict: VerdictHex,
  arbiterPk: Uint8Array | string,
): boolean {
  try {
    const sig = toBytes(signature, 'verdictSignature');
    if (sig.length !== 64) return false;
    const pk = toBytes(arbiterPk, 'arbiterPk');
    if (pk.length !== 33 || !secp256k1.validatePublicKey(pk)) return false;
    const msgHash = sha256.hash(verdictMessage(tradeId, verdict));
    return secp256k1.verifySignatureSchnorr(sig, pk, msgHash);
  } catch {
    return false;
  }
}
