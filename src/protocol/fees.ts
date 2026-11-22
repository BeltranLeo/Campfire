// Service fees for the arbiter and the oracle, paid by the seller in the escrow funding transaction
// (protocol section 5.1). The escrow contract does not change: the fees are extra outputs next to the
// escrow output, fixed in the trade terms and checked by the service before it counts the trade as funded.

import { binToHex, hash160 } from '@bitauth/libauth';
import { isBytes20Hex, toBytes } from './keys.js';
import { BCH_ASSET, PUSD_CATEGORY } from './offers.js';

export type FeeRole = 'arbiter' | 'oracle';

/** One fee output of the funding transaction, as committed in the trade terms. */
export interface TradeFee {
  role: FeeRole;
  /** hash160 of the role's public key in the terms: the fee goes to that key's P2PKH address. */
  pkh: string;
  /** Satoshis, as a decimal string like every amount in the terms. */
  satoshis: string;
}

/** The fee rates the administrator sets, in basis points of the trade's value (25 = 0.25%). */
export interface FeeRates {
  arbiterBps: number;
  oracleBps: number;
}

export const DEFAULT_FEE_RATES: FeeRates = { arbiterBps: 25, oracleBps: 25 };

// Upper bound for each rate. Clients refuse terms above it, so the service cannot raise a fee on a trade
// beyond what a person would notice.
export const MAX_FEE_BPS = 500;

// A P2PKH output below this value is non-standard dust and would not relay; such a fee is left out.
export const FEE_DUST_LIMIT_SATS = 546n;

const SATS_PER_BCH = 100_000_000n;
const POSITIVE_INT_RE = /^[1-9][0-9]*$/;

export function validateFeeRates(rates: FeeRates): void {
  for (const [name, value] of Object.entries({ arbiterBps: rates?.arbiterBps, oracleBps: rates?.oracleBps })) {
    if (!Number.isInteger(value) || (value as number) < 0 || (value as number) > MAX_FEE_BPS) {
      throw new Error(`${name} must be a whole number of basis points between 0 and ${MAX_FEE_BPS}`);
    }
  }
}

export function feePkh(pk: Uint8Array | string): string {
  return binToHex(hash160(toBytes(pk, 'feePk'))).toLowerCase();
}

/**
 * The trade's value in satoshis, the base the rates apply to. BCH trades are worth their amount. PUSD is
 * pegged to the dollar, so its value comes from a BCH/USD price; any other token has no known price and
 * pays no fee (null).
 */
export function tradeValueSats(params: {
  asset: string;
  amount: string;
  assetDecimals: number;
  /** BCH price in USD as a decimal string, required for PUSD. */
  bchUsd?: string;
}): bigint | null {
  const amount = BigInt(params.amount);
  if (params.asset === BCH_ASSET) return amount;
  if (params.asset.toLowerCase() !== PUSD_CATEGORY) return null;
  if (!params.bchUsd || !/^[0-9]+(\.[0-9]+)?$/.test(params.bchUsd)) {
    throw new Error('A BCH/USD price is needed to compute the fees of a PUSD trade');
  }
  const [whole, frac = ''] = params.bchUsd.split('.');
  const scaledPrice = BigInt(whole + frac);
  if (scaledPrice === 0n) throw new Error('The BCH/USD price must be positive');
  // sats = amount / 10^decimals USD / (scaledPrice / 10^frac) USD per BCH * 10^8
  return (amount * SATS_PER_BCH * 10n ** BigInt(frac.length)) / (10n ** BigInt(params.assetDecimals) * scaledPrice);
}

/**
 * The fee outputs for a new trade. The oracle is paid only on a floating-price trade, where it signed the
 * price; a fee below the dust limit is left out. Rounds down, so the seller never pays more than the rate.
 */
export function computeTradeFees(params: {
  valueSats: bigint | null;
  rates: FeeRates;
  arbiterPk: string;
  oraclePk?: string;
}): TradeFee[] {
  validateFeeRates(params.rates);
  if (params.valueSats === null || params.valueSats <= 0n) return [];
  const fees: TradeFee[] = [];
  const add = (role: FeeRole, pk: string | undefined, bps: number) => {
    if (!pk || bps === 0) return;
    const satoshis = (params.valueSats! * BigInt(bps)) / 10_000n;
    if (satoshis < FEE_DUST_LIMIT_SATS) return;
    fees.push({ role, pkh: feePkh(pk), satoshis: satoshis.toString() });
  };
  add('arbiter', params.arbiterPk, params.rates.arbiterBps);
  add('oracle', params.oraclePk, params.rates.oracleBps);
  return fees;
}

/** Total satoshis of the fee outputs. */
export function totalFeeSats(fees: readonly TradeFee[] | undefined): bigint {
  return (fees ?? []).reduce((sum, f) => sum + BigInt(f.satoshis), 0n);
}

/**
 * Structural checks on the `fees` field of trade terms: each fee pays the key its role names in the terms,
 * at most once per role, above the dust limit. On a BCH trade the rate is also checked against MAX_FEE_BPS;
 * a PUSD trade's value depends on a price the terms do not carry, so its cap is checked by the client.
 */
export function validateTradeFees(terms: {
  fees?: unknown;
  asset: string;
  amount: string;
  arbiterPk: string;
  oraclePk?: string;
}): void {
  if (terms.fees === undefined) return;
  if (!Array.isArray(terms.fees)) throw new Error('Trade fees must be an array');
  const seen = new Set<string>();
  for (const fee of terms.fees as TradeFee[]) {
    if (!fee || typeof fee !== 'object') throw new Error('Each trade fee must be an object');
    if (fee.role !== 'arbiter' && fee.role !== 'oracle') throw new Error(`Unknown fee role "${String(fee.role)}"`);
    if (seen.has(fee.role)) throw new Error(`The ${fee.role} fee appears twice`);
    seen.add(fee.role);
    if (!isBytes20Hex(fee.pkh)) throw new Error(`Invalid ${fee.role} fee pkh`);
    if (typeof fee.satoshis !== 'string' || !POSITIVE_INT_RE.test(fee.satoshis)) {
      throw new Error(`The ${fee.role} fee must be a positive integer string of satoshis`);
    }
    const sats = BigInt(fee.satoshis);
    if (sats < FEE_DUST_LIMIT_SATS) throw new Error(`The ${fee.role} fee is below the dust limit`);
    const pk = fee.role === 'arbiter' ? terms.arbiterPk : terms.oraclePk;
    if (!pk) throw new Error('An oracle fee needs an oracle in the terms');
    if (fee.pkh.toLowerCase() !== feePkh(pk)) throw new Error(`The ${fee.role} fee does not pay the ${fee.role} key of the terms`);
    if (terms.asset === BCH_ASSET && sats * 10_000n > BigInt(terms.amount) * BigInt(MAX_FEE_BPS)) {
      throw new Error(`The ${fee.role} fee is above ${MAX_FEE_BPS / 100}% of the trade`);
    }
  }
}
