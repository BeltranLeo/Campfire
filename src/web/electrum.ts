// Chain lookups from the browser through an Electrum server (the same provider the protocol code uses).

import { ElectrumNetworkProvider } from 'cashscript';
import { payoutAddress } from './take';

let provider: ElectrumNetworkProvider | null = null;
const electrum = () => (provider ??= new ElectrumNetworkProvider('mainnet'));

/**
 * The first receive address at or after `start` that has never been used on-chain, so a payout goes to a
 * fresh address of the wallet. It stays close to the wallet's own addresses, inside the range wallets scan.
 */
export async function findUnusedReceiveIndex(receiveXpub: string, start: number, limit = 50): Promise<number> {
  for (let index = start; index < start + limit; index++) {
    const history = await electrum().performRequest('blockchain.address.get_history', payoutAddress(receiveXpub, index, false));
    if (Array.isArray(history) && history.length === 0) return index;
  }
  throw new Error('No unused receive address found');
}
