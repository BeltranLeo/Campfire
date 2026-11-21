// How many blocks a transaction has, asked of the chain from this browser.
//
// The server records the deposit once, with 0 confirmations, and does not follow it into a block, so its number
// is stale as soon as a block is found. The page asks an Electrum server instead: a verbose transaction carries
// `confirmations`, and one still in the mempool has none (0).

import { useEffect, useState } from 'react';
import { electrum } from '../electrum';

const RECHECK_MS = 30_000;

/**
 * The confirmations of `txid`, or `undefined` until the chain has answered (or when it cannot be asked). While
 * `follow` is set and the transaction is still unconfirmed, it asks again every 30 s; otherwise it asks once.
 */
export function useConfirmations(txid: string | undefined, follow: boolean): number | undefined {
  const [confirmations, setConfirmations] = useState<number>();

  useEffect(() => {
    setConfirmations(undefined);
    if (!txid) return;
    let current = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const ask = async () => {
      try {
        const tx = (await electrum().performRequest('blockchain.transaction.get', txid, true)) as { confirmations?: number } | null;
        if (!current) return;
        const n = tx?.confirmations ?? 0;
        setConfirmations(n);
        if (follow && n === 0) timer = setTimeout(ask, RECHECK_MS);
      } catch {
        // A lookup that fails leaves the number unknown: the page says nothing rather than a wrong count.
        if (current && follow) timer = setTimeout(ask, RECHECK_MS);
      }
    };
    void ask();
    return () => {
      current = false;
      clearTimeout(timer);
    };
  }, [txid, follow]);

  return confirmations;
}
