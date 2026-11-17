// The connected wallet's coins, read once for the whole page and shared: the balance in the header, the create-offer
// page and the seller's deposit all look at the same scan instead of each asking the network. One store lives
// outside React, like the wallet; the Shell points it at the connected wallet's keys.

import { useEffect, useSyncExternalStore } from 'react';
import { scanWalletCoins, type CoinKeys, type WalletScan } from './coins';
import { keptElectrum } from './electrum';
import { useWallet } from './wallet';

/** How often the balance is read again while a wallet is connected. */
export const BALANCE_REFRESH_MS = 30_000;

export interface WalletCoinsState {
  /** The last scan that succeeded, for the keys now in use; null until the first one. */
  scan: WalletScan | null;
  /** The latest attempt failed. An older scan, if there is one, is still in `scan`. */
  failed: boolean;
}

export class WalletCoinsStore {
  private state: WalletCoinsState = { scan: null, failed: false };
  private listeners = new Set<() => void>();
  private keys: CoinKeys | null = null;
  private keyId: string | null = null;
  private inflight: Promise<void> | null = null;
  private timer: ReturnType<typeof setInterval> | undefined;

  constructor(
    private readonly scan: (keys: CoinKeys) => Promise<WalletScan> = async (keys) => scanWalletCoins(await keptElectrum(), keys),
    private readonly intervalMs = BALANCE_REFRESH_MS,
  ) {}

  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getSnapshot = () => this.state;

  private set(state: WalletCoinsState) {
    this.state = state;
    for (const listener of this.listeners) listener();
  }

  /** Points the store at a wallet (or at none). The same keys again change nothing; other keys start from scratch. */
  setKeys(keys: CoinKeys | null) {
    const id = keys ? `${keys.receive}|${keys.change ?? ''}` : null;
    if (id === this.keyId) return;
    clearInterval(this.timer);
    this.keyId = id;
    this.keys = keys;
    this.inflight = null;
    this.set({ scan: null, failed: false });
    if (keys) {
      void this.refresh();
      this.timer = setInterval(() => void this.refresh(), this.intervalMs);
    }
  }

  /** Reads the coins now. A read already under way is joined, not repeated. */
  refresh = (): Promise<void> => {
    const keys = this.keys;
    const id = this.keyId;
    if (!keys) return Promise.resolve();
    if (this.inflight) return this.inflight;
    const run: Promise<void> = this.scan(keys).then(
      (scan) => {
        if (this.keyId === id) this.set({ scan, failed: false });
      },
      () => {
        // Keep the last good scan: a balance that disappears for a failed refresh would look like an empty wallet.
        if (this.keyId === id) this.set({ scan: this.state.scan, failed: true });
      },
    ).finally(() => {
      if (this.inflight === run) this.inflight = null;
    });
    this.inflight = run;
    return run;
  };
}

export const walletCoins = new WalletCoinsStore();

/** Called once by the Shell: reads the coins of the connected wallet, and stops when it disconnects. */
export function useWalletCoinsSync() {
  const wallet = useWallet();
  const xpubs = wallet.status === 'connected' ? wallet.xpubs : null;
  const receive = xpubs?.receive;
  const change = xpubs?.change;
  useEffect(() => {
    walletCoins.setKeys(receive ? { receive, change } : null);
  }, [receive, change]);
}

/**
 * The shared scan. With `refreshMs` the page also asks for a fresh read at that rhythm while it is on screen
 * (the store already refreshes every 30 s, so a page that waits for a deposit to arrive asks more often).
 * The shape follows usePoll, so a page can swap one for the other.
 */
export function useWalletCoins(refreshMs?: number) {
  const state = useSyncExternalStore(walletCoins.subscribe, walletCoins.getSnapshot);
  useEffect(() => {
    if (!refreshMs) return;
    void walletCoins.refresh();
    const timer = setInterval(() => void walletCoins.refresh(), refreshMs);
    return () => clearInterval(timer);
  }, [refreshMs]);
  return {
    data: state.scan ?? undefined,
    error: state.failed ? new Error('The wallet coins could not be read') : null,
    loading: state.scan === null && !state.failed,
    reload: () => void walletCoins.refresh(),
  };
}

/** Reads the coins right away, for after the wallet signed something that changes the balance. */
export const refreshWalletCoins = () => walletCoins.refresh();
