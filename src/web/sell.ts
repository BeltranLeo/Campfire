// Publishing an offer: the form's rules and the offer document they produce (docs/protocol.md, section 3.2).
// A sell offer is signed and paid for by the seller's wallet; a buy offer is published by Campfire for the buyer.
// No DOM here, so test/sell.test.ts can check what ends up in the offer.

import { binToHex } from '@bitauth/libauth';
import type { NetworkProvider } from 'cashscript';
import { buildCloseOfferTransaction, isPositiveDecimalString, validateOfferDocument, type OfferDocument } from '../protocol/offers.js';
import { cashAddressToPkh, derivePayoutPkhFromXpub, pkhToLockingBytecode, type WalletSpendableUtxo, type WalletTransactionRequest } from '../protocol/keys.js';
import type { Offer as ListedOffer, OfferDocument as ListedOfferDocument } from './api';
import { formatBch } from './format';
import { parseAmount } from './take';
import { TradeActionError } from './trade';

export type PriceType = 'market' | 'fixed';

/** What the form holds, exactly as typed. */
export interface OfferForm {
  /** "sell": I give BCH and get money. "buy": I give money and get BCH. */
  side: 'sell' | 'buy';
  fiat: string;
  priceType: PriceType;
  /** Percent over the market price, e.g. "2.5". */
  margin: string;
  /** Fiat per whole coin, for a fixed price. */
  fixedPrice: string;
  /** Smallest and largest trade in BCH, as typed ("0.001"). */
  min: string;
  max: string;
  /** Payment method names separated by commas. */
  methods: string;
  paymentWindowSec: number;
  expirySec: number;
  /** Buy offers only: ask the demo seller to answer, with a simulated fiat payment. */
  demo?: boolean;
}

/** The payment method the demo seller answers to (src/server/demo.ts). The fiat payment is simulated. */
export const DEMO_METHOD = 'simulated';

export type FormField = 'margin' | 'fixedPrice' | 'min' | 'max' | 'methods';
export type FormErrors = Partial<Record<FormField, string>>;

/** The currencies the oracle signs a market price for. Others would need a fixed price (not offered yet). */
export const SELL_FIATS = [
  { code: 'ARS', label: 'Pesos', name: 'Argentine pesos' },
  { code: 'USD', label: 'Dollars', name: 'US dollars' },
] as const;

export const PAYMENT_WINDOWS_SEC = [3600, 1800, 900] as const;
export const EXPIRIES_SEC = [7 * 86_400, 86_400] as const;

/** Below this the buyer's payout is too close to the network's dust limit once fees are paid. */
export const MIN_TRADE_SATS = 10_000n;
const MAX_METHODS = 5;
const MAX_METHOD_LENGTH = 30;
const MIN_MARGIN_BPS = -5_000;
const MAX_MARGIN_BPS = 10_000;

/** "2.5" → 250. Null if it is not a number with at most two decimals, or is outside -50% to +100%. */
export function parseMarginBps(input: string): number | null {
  const clean = input.trim().replace(',', '.');
  if (!/^[+-]?\d{1,3}(\.\d{1,2})?$/.test(clean)) return null;
  const bps = Math.round(Number(clean) * 100);
  return bps >= MIN_MARGIN_BPS && bps <= MAX_MARGIN_BPS ? bps : null;
}

/** A price typed as digits with an optional decimal point (commas are thousands separators). */
export function parseFixedPrice(input: string): string | null {
  const clean = input.replace(/[,\s]/g, '');
  return isPositiveDecimalString(clean) ? clean : null;
}

/** The names the person typed, trimmed and without repeats. Null if there are none or one is too long. */
export function parseMethods(input: string): string[] | null {
  const names = [...new Set(input.split(/[,\n]/).map((m) => m.trim()).filter(Boolean))];
  if (names.length === 0 || names.length > MAX_METHODS || names.some((m) => m.length > MAX_METHOD_LENGTH)) return null;
  return names;
}

export type OfferBuild = { ok: true; document: OfferDocument; json: string } | { ok: false; errors: FormErrors };

/**
 * The offer document for a BCH sell offer, or what is wrong with the form. The document is validated with the
 * same function the service runs, so a rejection there cannot come as a surprise after the wallet signed.
 */
export function buildOfferDocument(params: {
  form: OfferForm;
  arbiter: string;
  oracle: string;
  /** Unix seconds. */
  now: number;
  /** The longest expiry Campfire pays for, for buy offers. */
  maxExpirySec?: number;
  /** The largest trade the demo seller takes, in sats: above it the demo seller silently skips the offer. */
  demoMaxSats?: bigint;
}): OfferBuild {
  const { form } = params;
  const errors: FormErrors = {};

  let price: OfferDocument['price'] | undefined;
  if (form.priceType === 'market') {
    const marginBps = parseMarginBps(form.margin);
    if (marginBps === null) errors.margin = 'Enter a percentage between -50 and 100, with up to two decimals.';
    else price = { type: 'floating', pair: `BCH/${form.fiat}`, marginBps };
  } else {
    const value = parseFixedPrice(form.fixedPrice);
    if (value === null) errors.fixedPrice = 'Enter the price with digits and a dot for decimals, for example 480000.50.';
    else price = { type: 'fixed', value };
  }

  const min = parseAmount(form.min, 8);
  const max = parseAmount(form.max, 8);
  if (min === null || min < MIN_TRADE_SATS) errors.min = `The smallest trade must be at least ${formatBch(MIN_TRADE_SATS)}.`;
  if (max === null || max <= 0n) errors.max = 'Enter the largest trade in BCH, for example 0.02.';
  else if (min !== null && max < min) errors.max = 'The largest trade cannot be below the smallest.';

  // A demo buy offer carries the simulated method the demo seller looks for; real methods are optional then.
  const demo = form.side === 'buy' && form.demo === true;
  const typed = demo && form.methods.trim() === '' ? [] : parseMethods(form.methods);
  const methods = typed && demo && !typed.includes(DEMO_METHOD) ? [...typed, DEMO_METHOD] : typed;
  if (!methods || methods.length > MAX_METHODS) {
    errors.methods = `Name 1 to ${MAX_METHODS - (demo ? 1 : 0)} payment methods, separated by commas, up to ${MAX_METHOD_LENGTH} characters each.`;
  }
  if (demo && params.demoMaxSats !== undefined && min !== null && min > params.demoMaxSats && !errors.min) {
    errors.min = `For a demo answer, keep the smallest trade at ${formatBch(params.demoMaxSats)} or less.`;
  }

  if (Object.keys(errors).length > 0 || !price || min === null || max === null || !methods) return { ok: false, errors };

  const document: OfferDocument = {
    v: 1,
    side: form.side,
    asset: 'BCH',
    assetDecimals: 8,
    fiat: form.fiat,
    price,
    min: min.toString(),
    max: max.toString(),
    paymentMethods: methods,
    paymentWindowSec: form.paymentWindowSec,
    // A buy offer never asks Campfire to pay for longer than it does.
    expiresAt: params.now + (form.side === 'buy' && params.maxExpirySec !== undefined ? Math.min(form.expirySec, params.maxExpirySec) : form.expirySec),
    arbiter: params.arbiter.toLowerCase(),
    // A fixed price takes no oracle: the protocol rejects the field on those offers.
    ...(price.type === 'floating' ? { oracle: params.oracle.toLowerCase() } : {}),
  };
  try {
    validateOfferDocument(document);
  } catch (err) {
    // The form checks everything the protocol does, so this means the service's keys are unusable.
    return { ok: false, errors: { margin: err instanceof Error ? err.message : 'The offer is not valid.' } };
  }
  return { ok: true, document, json: JSON.stringify(document) };
}

/**
 * Typical margins of the open offers for the same coin and currency, to help choose one. Null when there are
 * none: nothing is invented to fill the space.
 */
export function marginRange(
  offers: { document: ListedOfferDocument }[],
  fiat: string,
  side: 'sell' | 'buy' = 'sell',
): { low: number; high: number } | null {
  const margins = offers
    .filter((o) => o.document.side === side && o.document.asset === 'BCH' && o.document.fiat === fiat && o.document.price.type === 'floating')
    .map((o) => (o.document.price.type === 'floating' ? o.document.price.marginBps : 0));
  return margins.length === 0 ? null : { low: Math.min(...margins), high: Math.max(...margins) };
}

// --- Closing an offer ---

/** How far into the receive path to look for the address that holds an offer's marker, when its index is not recorded. */
const MARKER_SEARCH_LIMIT = 200;

/**
 * The transaction that closes an offer: it spends the 1,000-sat marker back to the same address (minus the network
 * fee), and the service sees the marker gone. The marker sits on a `receive` address of this wallet, found by
 * deriving the path, because the service does not keep the index. Anything that does not fit stops here with a
 * sentence, before the wallet is asked to sign.
 */
export async function buildCloseOffer(params: {
  offer: Pick<ListedOffer, 'offerTxid' | 'markerAddress' | 'markerVout' | 'markerReceiveIndex'>;
  provider: NetworkProvider;
  receiveXpub: string;
}): Promise<WalletTransactionRequest> {
  const { offer } = params;
  if (!offer.markerAddress) throw new TradeActionError('This offer has no marker to spend.');
  const wanted = binToHex(cashAddressToPkh(offer.markerAddress));
  // The service records the index for offers published since buy offers exist; older offers are searched for.
  const recorded = offer.markerReceiveIndex;
  let index = recorded !== undefined && binToHex(derivePayoutPkhFromXpub(params.receiveXpub, recorded)) === wanted ? recorded : -1;
  for (let i = 0; i < MARKER_SEARCH_LIMIT && index < 0; i++) {
    if (binToHex(derivePayoutPkhFromXpub(params.receiveXpub, i)) === wanted) index = i;
  }
  if (index < 0) throw new TradeActionError("This offer's marker does not belong to the connected wallet. Connect the wallet that published it.");
  const utxos = await params.provider.getUtxos(offer.markerAddress);
  const marker = utxos.find((u) => u.txid === offer.offerTxid && u.vout === (offer.markerVout ?? 1));
  if (!marker) throw new TradeActionError('The marker of this offer is already spent. Reload the page to see its state.');
  const markerUtxo = {
    ...marker,
    lockingBytecode: binToHex(pkhToLockingBytecode(wanted)),
    pathName: 'receive',
    keyIndex: index,
    address: offer.markerAddress,
  } as WalletSpendableUtxo;
  return buildCloseOfferTransaction({ provider: params.provider, markerUtxo, destinationAddress: offer.markerAddress });
}
