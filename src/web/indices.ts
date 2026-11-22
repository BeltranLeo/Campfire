// The keys a new trade will use, chosen in the browser: the next signing key, and payout and change addresses
// that were never used on-chain, so a payout does not land on an address the owner already shared.

import { apiGet, type TradeSummary } from './api';
import type { WalletScan } from './coins';
import { nextIndices } from './take';
import type { WalletXpubs } from './wallet';
import { latestWalletScan } from './walletCoins';

/**
 * The wallet shows its first unused address on its receive screen, and the owner may have shared it (a
 * donation or voting address). Campfire skips a few past it. Wallets look 20 addresses past the last used
 * one, so a payout this close is still found.
 */
export const SKIP_PAST_WALLET_ADDRESS = 5;

/**
 * An index on a path that was never used on-chain, at or after `start`: a few past the first one after the last
 * used address the scan found. The scan checked the 20 addresses after that one, so this one is unused too.
 */
export function unusedIndex(scan: WalletScan, path: 'receive' | 'change', start = 0): number | null {
  const found = scan.paths.find((p) => p.name === path);
  if (!found) return null;
  return Math.max(start, found.lastUsed + 1) + SKIP_PAST_WALLET_ADDRESS;
}

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
 * which on a normal sale never happens: starting from Campfire's last index would move it a few addresses further
 * every sale, past the 20 addresses wallets scan. So a seller's payout sits a few past the wallet's last used
 * address, which an unused payout never moves; two open trades may share one, which does no harm.
 */
export async function prepareIndices(identity: string, xpubs: WalletXpubs, role: 'buyer' | 'seller'): Promise<TradeIndices> {
  const { trades } = await apiGet<{ trades: TradeSummary[] }>(`/api/trades?identity=${identity}`);
  const next = nextIndices(trades, identity);
  try {
    // The shared scan already knows the last used address of each path: no address-by-address search.
    const scan = await latestWalletScan({ receive: xpubs.receive, change: xpubs.change });
    const receive = unusedIndex(scan, 'receive', role === 'seller' ? 0 : next.receive);
    if (receive === null) throw new Error('No receive path in the scan');
    // Only a seller deposits, so only a seller has change to send somewhere.
    const change = role === 'seller' ? unusedIndex(scan, 'change') : null;
    return { defi: next.defi, receive, fresh: true, change };
  } catch {
    return { defi: next.defi, receive: next.receive, fresh: false, change: null };
  }
}
