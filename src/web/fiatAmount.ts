// Turns an amount of money the person types ("10,000" pesos) into the coin amount an offer would give for it.
// The trade itself is always made in base units of the coin; the fiat figure shown afterwards is computed back
// from those units with the protocol's own rounding, so the screen never promises a number the trade won't have.
// No DOM here; see test/fiatAmount.test.ts.

import { computeFiatAmount } from '../protocol/trades.js';
import { parseAmount } from './take';

/**
 * "10,000" or "10000.5" or "0,5" → cents, or null when it is not a positive amount of money. Money has two
 * decimals, so a comma followed by groups of exactly three digits ("10,000") separates thousands; any other lone
 * comma is the decimal mark, as parseAmount reads it.
 */
export function parseFiatCents(input: string): bigint | null {
  const compact = input.replace(/\s/g, '');
  const cents = parseAmount(/^\d{1,3}(,\d{3})+$/.test(compact) ? compact.replace(/,/g, '') : compact, 2);
  return cents !== null && cents > 0n ? cents : null;
}

/**
 * The base units of the coin that cost at most `fiatCents` at this price, rounded down so the person never pays
 * more than they typed. `unitPrice` is the price of one whole coin as a decimal string, before the margin.
 */
export function unitsForFiat(params: { fiatCents: bigint; unitPrice: string; marginBps?: number; assetDecimals: number }): bigint | null {
  const match = params.unitPrice.match(/^(\d+)(?:\.(\d+))?$/);
  const marginBps = params.marginBps ?? 0;
  if (!match || params.fiatCents <= 0n || marginBps <= -10_000) return null;
  const priceDecimals = BigInt(match[2]?.length ?? 0);
  const scaledPrice = BigInt(match[1] + (match[2] ?? ''));
  if (scaledPrice === 0n) return null;
  // Inverse of computeFiatAmount: units = cents * 10^decimals * 10^priceDecimals * 10000 / (scaledPrice * (10000 + margin) * 100)
  const numerator = params.fiatCents * 10n ** BigInt(params.assetDecimals) * 10n ** priceDecimals * 10_000n;
  const denominator = scaledPrice * BigInt(10_000 + marginBps) * 100n;
  return numerator / denominator;
}

/** What the trade will really cost for these units, as a decimal string ("9999.98"), using the protocol's rounding. */
export function fiatForUnits(params: { units: bigint; unitPrice: string; marginBps?: number; assetDecimals: number }): string | null {
  if (params.units <= 0n) return null;
  return computeFiatAmount({ amount: params.units, assetDecimals: params.assetDecimals, unitPrice: params.unitPrice, marginBps: params.marginBps });
}
