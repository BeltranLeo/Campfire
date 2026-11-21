// The connected wallet's coins, read once for the whole page and shared: the balance in the header, the create-offer
// page and the seller's deposit all look at the same scan instead of each asking the network. One store lives
// outside React, like the wallet; the Shell points it at the connected wallet's keys.

import { binToHex, sha256, utf8ToBin } from '@bitauth/libauth';
import { useEffect, useSyncExternalStore } from 'react';
import { scanWalletCoins, type CoinKeys, type ScanMemory, type ScanOptions, type ScanProgress, type WalletScan } from './coins';
import { keptElectrum } from './electrum';
import { text } from './messages';
import { useWallet } from './wallet';

/**
 * The last used index of each path, kept in this browser so the next visit starts where the last one ended
 * (a long-used wallet otherwise searches its whole history again). The key is a hash of the xpub: the xpub
 * itself is never stored. Without storage it still works for the page's lifetime.
 */
export function browserScanMemory(storage: Pick<Storage, 'getItem' | 'setItem'> | null): ScanMemory {
  const inPage = new Map<string, number>();
  const key = (xpub: string) => `campfire.lastUsed.${binToHex(sha256.hash(utf8ToBin(xpub))).slice(0, 32)}`;
  return {
    lastUsed(xpub) {
      if (inPage.has(xpub)) return inPage.get(xpub);
      try {
        const raw = storage?.getItem(key(xpub));
        const value = raw === null || raw === undefined ? NaN : Number(raw);
        return Number.isInteger(value) && value >= -1 ? value : undefined;
      } catch {
        return undefined;
      }
    },
    remember(xpub, lastUsed) {
      inPage.set(xpub, lastUsed);
      try {
        storage?.setItem(key(xpub), String(lastUsed));
      } catch {
        // Storage full or blocked: the page still remembers it.
      }
    },
  };
}

function localStore(): Storage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

/** How often the balance is read again while a wallet is connected. */
export const BALANCE_REFRESH_MS = 30_000;

export interface WalletCoinsState {
  /** The last scan that succeeded, for the keys now in use; null until the first one. */
  scan: WalletScan | null;
  /** The latest attempt failed. An older scan, if there is one, is still in `scan`. */
  failed: boolean;
  /** How far the read under way has got; null when none is running. */
  progress: ScanProgress | null;
}

type Scanner = (keys: CoinKeys, options: Pick<ScanOptions, 'onProgress'>) => Promise<WalletScan>;
const memory = browserScanMemory(localStore());

export class WalletCoinsStore {
  private state: WalletCoinsState = { scan: null, failed: false, progress: null };
  private listeners = new Set<() => void>();
  private keys: CoinKeys | null = null;
  private keyId: string | null = null;
  private inflight: Promise<void> | null = null;
  private timer: ReturnType<typeof setInterval> | undefined;

  constructor(
    private readonly scan: Scanner = async (keys, options) => scanWalletCoins(await keptElectrum(), keys, { ...options, memory }),
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
    this.set({ scan: null, failed: false, progress: null });
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
    // Progress may come before the read's promise exists, so reads are told apart by number.
    const ticket = ++this.reads;
    const onProgress = (progress: ScanProgress) => {
      if (this.keyId === id && this.reads === ticket) this.set({ ...this.state, progress });
    };
    const run: Promise<void> = this.scan(keys, { onProgress }).then(
      (scan) => {
        if (this.keyId === id) this.set({ scan, failed: false, progress: null });
      },
      (err) => {
        // Keep the last good scan: a balance that disappears for a failed refresh would look like an empty wallet.
        if (this.keyId === id) this.set({ scan: this.state.scan, failed: true, progress: null });
        this.lastError = err;
      },
    ).finally(() => {
      if (this.inflight === run) this.inflight = null;
    });
    this.inflight = run;
    return run;
  };

  private lastError: unknown = null;
  private reads = 0;

  /**
   * A scan that started now, for an action about to spend: a read already under way may predate a coin the
   * wallet just spent, so it is waited for and then one more read runs. Other keys than the store's (the Shell
   * has not caught up yet) get a scan of their own. Throws when the read fails, so the action stops.
   */
  /**
   * The scan the page already has, or the first one once it arrives. For what only grows (the last used index of
   * each path), an older scan is as good as a new one and costs nothing.
   */
  async latest(keys: CoinKeys): Promise<WalletScan> {
    const id = `${keys.receive}|${keys.change ?? ''}`;
    if (id === this.keyId && this.state.scan) return this.state.scan;
    return this.fresh(keys);
  }

  async fresh(keys: CoinKeys): Promise<WalletScan> {
    const id = `${keys.receive}|${keys.change ?? ''}`;
    if (id !== this.keyId) return this.scan(keys, {});
    if (this.inflight) await this.inflight;
    this.lastError = null;
    await this.refresh();
    if (this.state.failed || !this.state.scan) throw this.lastError ?? new Error('The wallet coins could not be read');
    return this.state.scan;
  }
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
    progress: state.progress,
    reload: () => void walletCoins.refresh(),
  };
}

/** Reads the coins right away, for after the wallet signed something that changes the balance. */
export const refreshWalletCoins = () => walletCoins.refresh();

/** A fresh read of the wallet's coins before spending them, shared with the balance (see WalletCoinsStore.fresh). */
export const freshWalletScan = (keys: CoinKeys) => walletCoins.fresh(keys);

/** The scan the page has, for the last used addresses (see WalletCoinsStore.latest). */
export const latestWalletScan = (keys: CoinKeys) => walletCoins.latest(keys);

/**
 * "Finding your addresses… 40" or "Reading your balance… 25%", for a busy button. A percent, not "120 of 480":
 * a count of addresses means little to someone who never saw their wallet's addresses.
 */
export function describeProgress(progress: ScanProgress | null): string | null {
  if (!progress) return null;
  const t = text().common;
  if (progress.phase === 'addresses') return progress.done > 0 ? `${t.findingAddresses} ${progress.done}` : t.findingAddresses;
  return t.readingBalance(scanPercent(progress) ?? 0);
}

/** Percent of the addresses read, or null while the scan is still finding how many there are. */
export function scanPercent(progress: ScanProgress | null): number | null {
  if (!progress || progress.phase !== 'coins' || progress.total <= 0) return null;
  return Math.min(100, Math.floor((progress.done / progress.total) * 100));
}
