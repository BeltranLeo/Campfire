// Zero-confirmation deposits, protected by double-spend proofs (DSProofs).
//
// When someone tries to spend the same coins twice, Bitcoin Cash nodes relay a DSProof within seconds.
// A deposit that has been in the mempool for a few seconds without one is safe to act on, so the buyer
// does not wait for a block. The Electrum server (Fulcrum) answers `blockchain.transaction.dsproof.get`.

import { useEffect, useState } from 'react';
import { dsProofCoverage, type CoverageLookup, type DsProofCoverage } from './dsproofCoverage';
import { electrum } from './electrum';

/** How long a deposit must sit in the mempool with no DSProof before the buyer is told to go ahead. */
export const DSPROOF_WATCH_SEC = 5;
const POLL_MS = 3000;
/** How long past the window the page waits to learn whether a DSProof could cover the deposit at all. */
const COVERAGE_WAIT_SEC = 10;

export type DoubleSpendState =
  /** Not applicable: no deposit yet, already in a block, or the trade has ended. */
  | { phase: 'idle' }
  /** In the mempool for less than the watch window, no proof so far. */
  | { phase: 'watching'; secondsLeft: number }
  /** Watched for the whole window with no proof: safe at zero confirmations. */
  | { phase: 'clear'; checkedAt: Date }
  /**
   * No proof, but the deposit spends a coin no DSProof can cover (a contract coin, here or in an unconfirmed
   * ancestor), so the silence proves nothing. The trade goes on at zero confirmations; the page says so.
   */
  | { phase: 'uncovered' }
  /** A double-spend proof exists for the deposit. */
  | { phase: 'proof' }
  /** The Electrum server could not be asked. */
  | { phase: 'error' };

export async function hasDoubleSpendProof(txid: string): Promise<boolean> {
  const proof = await electrum().performRequest('blockchain.transaction.dsproof.get', txid);
  return proof !== null && proof !== undefined;
}

// The deposit and its parents, with whether each is in a block. Verbose answers carry `confirmations`; a mempool
// transaction has none.
const coverageLookup: CoverageLookup = {
  async getTransaction(txid) {
    const tx = (await electrum().performRequest('blockchain.transaction.get', txid, true)) as { hex?: string; confirmations?: number };
    if (typeof tx?.hex !== 'string') throw new Error('The Electrum server gave no verbose transaction');
    return { hex: tx.hex, confirmed: (tx.confirmations ?? 0) > 0 };
  },
};

/**
 * Watches a zero-confirmation deposit for a DSProof while `active`. `seenAt` is when the network saw it
 * (Unix seconds); the watch window counts from then. A proof, once seen, is never cleared.
 */
export function useDoubleSpendWatch(txid: string | undefined, seenAt: number | undefined, active: boolean): DoubleSpendState {
  const [state, setState] = useState<DoubleSpendState>({ phase: 'idle' });

  useEffect(() => {
    if (!txid || !active) {
      setState({ phase: 'idle' });
      return;
    }
    let current = true;
    let found = false;
    // Asked once per deposit: which coins it spends does not change. The window waits a little for the answer, so
    // the page does not say "safe" and then take it back; a lookup that fails keeps the plain DSProof verdict.
    let coverage: DsProofCoverage | 'failed' | null = null;
    dsProofCoverage(txid, coverageLookup).then(
      (c) => {
        coverage = c;
        if (current) void check();
      },
      () => {
        coverage = 'failed';
        if (current) void check();
      },
    );
    const check = async () => {
      try {
        if (found || (await hasDoubleSpendProof(txid))) {
          found = true;
          if (current) setState({ phase: 'proof' });
          return;
        }
        if (!current) return;
        const elapsed = Date.now() / 1000 - (seenAt ?? Date.now() / 1000);
        const waitingForCoverage = coverage === null && elapsed < DSPROOF_WATCH_SEC + COVERAGE_WAIT_SEC;
        setState(
          elapsed < DSPROOF_WATCH_SEC || waitingForCoverage
            ? { phase: 'watching', secondsLeft: Math.max(1, Math.ceil(DSPROOF_WATCH_SEC - elapsed)) }
            : coverage === 'uncovered'
              ? { phase: 'uncovered' }
              : { phase: 'clear', checkedAt: new Date() },
        );
      } catch {
        if (current && !found) setState({ phase: 'error' });
      }
    };
    void check();
    // Keeps watching until the deposit is in a block: a proof can still arrive later.
    const timer = setInterval(check, POLL_MS);
    return () => {
      current = false;
      clearInterval(timer);
    };
  }, [txid, seenAt, active]);

  return state;
}
