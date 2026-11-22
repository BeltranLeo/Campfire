// The service's own accounts, for the administration panel: the demo seller bot's wallet and the addresses
// where the arbiter and oracle fees are paid (protocol section 5.1). Read-only: nothing here spends.

import type { Utxo } from 'cashscript';
import { PUSD_CATEGORY, feePkh, pkhToCashAddress } from '../protocol/index.js';
import type { DemoSeller } from './demo.js';
import type { OracleService } from './oracle.js';
import type { CampfireService } from './service.js';

/** Amounts are strings in base units: sats for BCH, cents for PUSD. */
export interface AccountBalance {
  address: string;
  tokenAddress: string;
  bchSats: string;
  pusdUnits: string;
}

/** One account could not be read (for example an Electrum lookup failed); the others are still shown. */
export interface AccountError {
  address: string;
  error: string;
}

export interface BotAccount extends AccountBalance {
  /** Addresses the balance is summed over: the main one plus payouts of trades that paid the bot back. */
  addressCount: number;
  /** Whether the bot can fund one trade at its maximum amount, by the same rule it funds with; null if unknown. */
  canFundMax: { BCH: boolean | null; PUSD: boolean | null };
  maxBchSats: string;
  maxPusdUnits: string;
}

export interface ServiceAccounts {
  /** BCH price in USD from the oracle's feed; null when the feed did not answer. */
  bchUsd: string | null;
  /** Null when the demo seller is not enabled. */
  bot: BotAccount | AccountError | null;
  oracle: AccountBalance | AccountError;
  arbiter: AccountBalance | AccountError;
}

/** Sats on every coin, and PUSD on the fungible PUSD coins. */
export function sumCoins(utxos: readonly Utxo[]): { sats: bigint; pusdUnits: bigint } {
  let sats = 0n;
  let pusdUnits = 0n;
  for (const u of utxos) {
    sats += u.satoshis;
    if (u.token && !u.token.nft && u.token.category.toLowerCase() === PUSD_CATEGORY) {
      pusdUnits += u.token.amount;
    }
  }
  return { sats, pusdUnits };
}

/** The P2PKH address a fee to this public key is paid to (the fee output's pkh is hash160 of the key). */
export function feeAddress(pk: string, tokenAware = false): string {
  return pkhToCashAddress(feePkh(pk), { tokenAware });
}

const errorText = (err: unknown) => (err instanceof Error ? err.message : String(err));

export async function readServiceAccounts(deps: {
  service: CampfireService;
  oracle: OracleService;
  demo?: DemoSeller;
}): Promise<ServiceAccounts> {
  const { service, oracle, demo } = deps;

  const feeAccount = async (pk: string): Promise<AccountBalance | AccountError> => {
    const address = feeAddress(pk);
    try {
      const { sats, pusdUnits } = sumCoins(await service.getAddressUtxos(address));
      return { address, tokenAddress: feeAddress(pk, true), bchSats: sats.toString(), pusdUnits: pusdUnits.toString() };
    } catch (err) {
      return { address, error: errorText(err) };
    }
  };

  const botAccount = async (): Promise<BotAccount | AccountError | null> => {
    if (!demo) return null;
    try {
      const b = await demo.balance();
      return {
        address: demo.mainAddress,
        tokenAddress: demo.mainTokenAddress,
        bchSats: b.sats.toString(),
        pusdUnits: b.pusdUnits.toString(),
        addressCount: b.addressCount,
        canFundMax: b.canFundMax,
        maxBchSats: demo.limits.maxBchSats.toString(),
        maxPusdUnits: demo.limits.maxPusdUnits.toString(),
      };
    } catch (err) {
      return { address: demo.mainAddress, error: errorText(err) };
    }
  };

  // Each account is read on its own, so one failed lookup does not blank the whole panel.
  const [bot, oracleAccount, arbiter, bchUsd] = await Promise.all([
    botAccount(),
    feeAccount(service.oraclePublicKeyHex),
    feeAccount(service.arbiterPublicKeyHex),
    oracle.createQuote('BCH/USD').then(
      (q) => q.price,
      () => null,
    ),
  ]);
  return { bchUsd, bot, oracle: oracleAccount, arbiter };
}
