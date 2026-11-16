// Chain lookups from the browser through an Electrum server (the same provider the protocol code uses).

import { ElectrumNetworkProvider } from 'cashscript';
import { payoutAddress } from './take';

let provider: ElectrumNetworkProvider | null = null;
/** One shared mainnet connection; it opens on demand and closes when idle. */
export const electrum = () => (provider ??= new ElectrumNetworkProvider('mainnet'));

// Address-history lookups ask many questions in a row. The on-demand provider above reconnects for each
// burst (about 1.5 s), so these use their own connection, opened once and kept for the page's lifetime.
let lookup: Promise<ElectrumNetworkProvider> | null = null;
function lookupProvider(): Promise<ElectrumNetworkProvider> {
  if (!lookup) {
    const p = new ElectrumNetworkProvider('mainnet', { manualConnectionManagement: true });
    lookup = p.connect().then(() => p);
    lookup.catch(() => {
      lookup = null;
    });
  }
  return lookup;
}

const BATCH = 25;
/**
 * The wallet shows its first unused address on its receive screen, and the owner may have shared it (a
 * donation or voting address). Campfire skips a few past it. Wallets look 20 addresses past the last used
 * one, so a payout this close is still found.
 */
const SKIP_PAST_WALLET_ADDRESS = 5;

/**
 * A receive address at or after `start` that has never been used on-chain, so a payout goes to a fresh
 * address of the wallet and not to one its owner may have handed out. Addresses are asked about in parallel
 * batches. Gives up after `budgetMs` so a long-used wallet never blocks the page.
 */
export async function findUnusedReceiveIndex(receiveXpub: string, start: number, budgetMs = 8000): Promise<number> {
  const deadline = Date.now() + budgetMs;
  const p = await withDeadline(lookupProvider(), deadline);
  let firstUnused = -1;
  for (let from = start; Date.now() < deadline; from += BATCH) {
    const histories = await withDeadline(
      Promise.all(
        Array.from({ length: BATCH }, (_, i) =>
          p.performRequest('blockchain.address.get_history', payoutAddress(receiveXpub, from + i, false)),
        ),
      ),
      deadline,
    );
    for (let i = 0; i < histories.length; i++) {
      const history = histories[i];
      if (!Array.isArray(history) || history.length > 0) continue;
      const index = from + i;
      if (firstUnused < 0) firstUnused = index;
      if (index >= firstUnused + SKIP_PAST_WALLET_ADDRESS) return index;
    }
  }
  throw new Error('No unused receive address found in time');
}

function withDeadline<T>(promise: Promise<T>, deadline: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Electrum lookup timed out')), Math.max(0, deadline - Date.now()));
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (err) => {
        clearTimeout(timer);
        reject(err);
      },
    );
  });
}
