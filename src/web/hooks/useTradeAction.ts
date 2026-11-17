import { useState } from 'react';
import { ApiError, apiGet, type Trade } from '../api';
import { WALLET_DECLINED } from '../components/Button';
import { TradeActionError } from '../trade';
import { WalletDeclined } from '../wallet';

export interface ActionFailure {
  title: string;
  message: string;
}

/**
 * Runs the writes of a trade page one at a time. The answer to a write may be lost after the service recorded
 * it (the demo seller releases within the request; a broadcast happens within it), so after a failure the trade
 * is read again before an error is shown, and a trade that has moved on counts as done.
 * `run` gives back the trade the action left behind, or undefined when it failed.
 */
export function useTradeAction<A extends string>(trade: Trade, identity: string | null, onUpdate: (t: Trade) => void) {
  // Which action is running; the others wait, so two writes never race.
  const [busy, setBusy] = useState<A | null>(null);
  const [error, setError] = useState<ActionFailure | null>(null);

  async function run(action: A, failed: string, write: () => Promise<Trade>, from: Trade = trade): Promise<Trade | undefined> {
    setBusy(action);
    setError(null);
    try {
      const result = await write();
      onUpdate(result);
      return result;
    } catch (err) {
      if (err instanceof WalletDeclined) {
        setError({ title: failed, message: WALLET_DECLINED });
        return undefined;
      }
      if (err instanceof TradeActionError) {
        setError({ title: failed, message: err.message });
        return undefined;
      }
      try {
        const { trade: latest } = await apiGet<{ trade: Trade }>(`/api/trades/${from.id}${identity ? `?viewer=${identity}` : ''}`);
        onUpdate(latest);
        if (latest.status !== from.status) return latest;
      } catch {
        // Fall through to the original error.
      }
      setError({ title: failed, message: err instanceof ApiError ? err.message : 'Something went wrong. Try again.' });
      return undefined;
    } finally {
      setBusy(null);
    }
  }

  return { busy, error, setError, run };
}
