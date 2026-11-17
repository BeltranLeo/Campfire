// Publishing a sell offer: the form's rules and the offer document they produce (docs/protocol.md,
// section 2.2). No DOM here, so test/sell.test.ts can check what ends up in the offer.

import { isPositiveDecimalString, validateOfferDocument, type OfferDocument } from '../protocol/offers.js';
import type { OfferDocument as ListedOfferDocument } from './api';
import { parseAmount } from './take';

export type PriceType = 'market' | 'fixed';

/** What the form holds, exactly as typed. */
export interface OfferForm {
  fiat: string;
  priceType: PriceType;
  /** Percent over the market price, e.g. "2.5". */
  margin: string;
  /** Fiat per whole coin, for a fixed price. */
  fixedPrice: string;
  /** Smallest and largest trade in sats. */
  min: string;
  max: string;
  /** Payment method names separated by commas. */
  methods: string;
  paymentWindowSec: number;
  expirySec: number;
}

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

  const min = parseAmount(form.min, 8, true);
  const max = parseAmount(form.max, 8, true);
  if (min === null || min < MIN_TRADE_SATS) errors.min = `The smallest trade must be at least ${MIN_TRADE_SATS.toLocaleString('en-US')} sats.`;
  if (max === null || max <= 0n) errors.max = 'Enter the largest trade in sats.';
  else if (min !== null && max < min) errors.max = 'The largest trade cannot be below the smallest.';

  const methods = parseMethods(form.methods);
  if (!methods) errors.methods = `Name 1 to ${MAX_METHODS} payment methods, separated by commas, up to ${MAX_METHOD_LENGTH} characters each.`;

  if (Object.keys(errors).length > 0 || !price || min === null || max === null || !methods) return { ok: false, errors };

  const document: OfferDocument = {
    v: 1,
    side: 'sell',
    asset: 'BCH',
    assetDecimals: 8,
    fiat: form.fiat,
    price,
    min: min.toString(),
    max: max.toString(),
    paymentMethods: methods,
    paymentWindowSec: form.paymentWindowSec,
    expiresAt: params.now + form.expirySec,
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
export function marginRange(offers: { document: ListedOfferDocument }[], fiat: string): { low: number; high: number } | null {
  const margins = offers
    .filter((o) => o.document.side === 'sell' && o.document.asset === 'BCH' && o.document.fiat === fiat && o.document.price.type === 'floating')
    .map((o) => (o.document.price.type === 'floating' ? o.document.price.marginBps : 0));
  return margins.length === 0 ? null : { low: Math.min(...margins), high: Math.max(...margins) };
}
