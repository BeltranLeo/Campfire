import { apiGet, type Trade } from '../api';
import { completedWith } from '../mytrades';
import { useWallet } from '../wallet';
import { usePoll } from './usePoll';

/**
 * How many trades the signed-in person has completed with `other` (src/web/mytrades.ts, completedWith), or null
 * while unknown: no wallet, the other person is this person, or the list could not be read. The list is the
 * person's own, which the service gives only to that identity's session, so no one else's pairs are ever read.
 */
export function useCompletedWith(other: string | null | undefined): number | null {
  const wallet = useWallet();
  const me = wallet.status === 'connected' ? wallet.identity : null;
  const ask = me !== null && !!other && other !== me;
  const list = usePoll(
    () => (ask ? apiGet<{ trades: Trade[] }>(`/api/trades?identity=${me}`).then((r) => r.trades) : Promise.resolve(null)),
    ask ? `${me}:${other}` : '',
  );
  if (!ask || !list.data) return null;
  return completedWith(list.data, me, other);
}
