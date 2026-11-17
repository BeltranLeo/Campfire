// The wallet's own coins, read from the chain in the browser. WizardConnect gives Campfire public keys only,
// so the coins of the wallet are found by deriving its addresses and asking an Electrum server about each.

import type { NetworkProvider } from 'cashscript';
import { deriveWalletAddressMap, type WalletSpendableUtxo } from '../protocol/keys.js';

/**
 * Addresses scanned on each of the `receive` and `change` paths. Wallets show the first unused address, so
 * funds sit near the start; wallets themselves stop looking after a gap of 20, so 40 is twice that reach.
 */
export const SCAN_COUNT = 40;
const BATCH = 20;

export interface CoinKeys {
  receive: string;
  change?: string;
}

/**
 * Every unspent coin on the wallet's first addresses, tagged with the path and index that the wallet needs in
 * order to sign it. Token coins are included: callers must not spend them as plain BCH.
 * Throws if any lookup fails; a partial list would hide coins and make the balance look smaller than it is.
 */
export async function loadWalletCoins(provider: NetworkProvider, keys: CoinKeys, count = SCAN_COUNT): Promise<WalletSpendableUtxo[]> {
  const entries = [...deriveWalletAddressMap({ receiveXpub: keys.receive, changeXpub: keys.change, count }).values()];
  const coins: WalletSpendableUtxo[] = [];
  for (let from = 0; from < entries.length; from += BATCH) {
    const batch = entries.slice(from, from + BATCH);
    const lists = await Promise.all(batch.map((entry) => provider.getUtxos(entry.address)));
    lists.forEach((utxos, i) => {
      const entry = batch[i];
      for (const utxo of utxos) {
        coins.push({
          ...utxo,
          lockingBytecode: entry.lockingBytecodeHex,
          pathName: entry.pathName,
          keyIndex: entry.keyIndex,
          address: entry.address,
        } as WalletSpendableUtxo);
      }
    });
  }
  return coins;
}

/** The plain BCH the wallet can spend (coins that carry no token), in satoshis. */
export function spendableBch(coins: WalletSpendableUtxo[]): bigint {
  return coins.filter((c) => !c.token).reduce((sum, c) => sum + c.satoshis, 0n);
}
