// The keys a new trade will use, chosen in the browser: the next signing key, and payout and change addresses
// that were never used on-chain, so a payout does not land on an address the owner already shared.

import { apiGet, type TradeSummary } from './api';
import { findUnusedReceiveIndex } from './electrum';
import { nextIndices } from './take';
import type { WalletXpubs } from './wallet';

export interface TradeIndices {
  /** The `defi` key index the trade signs with. */
  defi: number;
  /** The `receive` index of the payout address. */
  receive: number;
  /** False when the chain lookup failed: the address may have been used before, so the page does not call it fresh. */
  fresh: boolean;
  /** The `change` index for change from a deposit, or null without a change path or without a lookup. */
  change: number | null;
}

/**
 * A buyer's payout is used when the trade is released, so the next payout can move on from the last one used in
 * Campfire. A seller's payout is used only if the escrow comes back (a cancel, a refund or a verdict for the seller),
 * which on a normal sale never happens: searching from the last index would move it a few addresses further
 * every sale, past the 20 addresses wallets scan. So a seller's search starts at the beginning and takes the first
 * address nobody has used; two open trades may share one, which does no harm.
 */
export async function prepareIndices(identity: string, xpubs: WalletXpubs, role: 'buyer' | 'seller'): Promise<TradeIndices> {
  const { trades } = await apiGet<{ trades: TradeSummary[] }>(`/api/trades?identity=${identity}`);
  const next = nextIndices(trades, identity);
  try {
    const [receive, change] = await Promise.all([
      findUnusedReceiveIndex(xpubs.receive, role === 'seller' ? 0 : next.receive),
      // Only a seller deposits, so only a seller has change to send somewhere.
      role === 'seller' && xpubs.change ? findUnusedReceiveIndex(xpubs.change, 0).catch(() => null) : Promise.resolve(null),
    ]);
    return { defi: next.defi, receive, fresh: true, change };
  } catch {
    return { defi: next.defi, receive: next.receive, fresh: false, change: null };
  }
}
