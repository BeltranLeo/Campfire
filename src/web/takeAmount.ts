// What the buyer typed on the Take page, turned into the base units the take request carries.
// The request always holds units; fiat is only a way to choose them. No DOM here; see test/takeAmount.test.ts.

import { fiatForUnits, parseFiatCents, unitsForFiat } from './fiatAmount';
import { parseAmount } from './take';

export type AmountMode = 'fiat' | 'coin';

/** A price the fiat maths can use (guards against a malformed quote before computeFiatAmount would throw). */
export function usablePrice(unitPrice: string | null, marginBps: number, assetDecimals: number): boolean {
  return unitPrice !== null && unitsForFiat({ fiatCents: 100n, unitPrice, marginBps, assetDecimals }) !== null;
}

/** Fiat input whenever the offer has a usable price, for BCH and tokens alike; without one, the coin is typed. */
export function effectiveMode(wanted: AmountMode, opts: { hasPrice: boolean }): AmountMode {
  return wanted === 'fiat' && opts.hasPrice ? 'fiat' : 'coin';
}

export interface AmountResult {
  units: bigint | null;
  /** invalid: not a number; range: a number the offer does not accept. */
  state: 'ok' | 'invalid' | 'range';
}

export function resolveAmount(p: {
  mode: AmountMode;
  input: string;
  min: bigint;
  max: bigint;
  assetDecimals: number;
  unitPrice: string | null;
  marginBps: number;
}): AmountResult {
  let units: bigint | null;
  if (p.mode === 'fiat') {
    const cents = parseFiatCents(p.input);
    units = cents !== null && p.unitPrice ? unitsForFiat({ fiatCents: cents, unitPrice: p.unitPrice, marginBps: p.marginBps, assetDecimals: p.assetDecimals }) : null;
    // Typing exactly the fiat price of the minimum must be accepted even if rounding down lands one unit short.
    if (cents !== null && units !== null && units < p.min && p.unitPrice) {
      const minFiat = fiatForUnits({ units: p.min, unitPrice: p.unitPrice, marginBps: p.marginBps, assetDecimals: p.assetDecimals });
      const minCents = minFiat ? parseAmount(minFiat, 2) : null;
      if (minCents !== null && cents >= minCents) units = p.min;
    }
  } else {
    units = parseAmount(p.input, p.assetDecimals);
  }
  if (units === null) return { units: null, state: 'invalid' };
  return { units, state: units >= p.min && units <= p.max ? 'ok' : 'range' };
}
