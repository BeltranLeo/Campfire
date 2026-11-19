import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { formatBchBalance } from '../src/web/format.js';
import { tokenBalance, type CoinKeys, type ScanProgress, type WalletScan } from '../src/web/coins.js';
import { WalletCoinsStore, browserScanMemory, describeProgress } from '../src/web/walletCoins.js';
import { unusedIndex } from '../src/web/indices.js';
import type { WalletSpendableUtxo } from '../src/protocol/keys.js';

const scanOf = (sats: bigint): WalletScan => ({
  coins: [{ satoshis: sats } as WalletSpendableUtxo],
  paths: [],
  noChangePath: false,
});
const keysA: CoinKeys = { receive: 'xpubA', change: 'xpubAc' };
const keysB: CoinKeys = { receive: 'xpubB' };

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('the shared wallet coins', () => {
  it('reads the coins once keys are set, and again on the interval', async () => {
    const scan = vi.fn(async () => scanOf(5_000n));
    const store = new WalletCoinsStore(scan, 30_000);
    expect(store.getSnapshot()).toEqual({ scan: null, failed: false, progress: null });
    store.setKeys(keysA);
    await vi.advanceTimersByTimeAsync(0);
    expect(scan).toHaveBeenCalledTimes(1);
    expect(store.getSnapshot().scan?.coins[0].satoshis).toBe(5_000n);
    await vi.advanceTimersByTimeAsync(30_000);
    expect(scan).toHaveBeenCalledTimes(2);
    store.setKeys(null);
  });

  it('does nothing when the same keys are set again, and starts over for other keys', async () => {
    const scan = vi.fn(async (keys: CoinKeys) => scanOf(keys === keysA ? 1_000n : 2_000n));
    const store = new WalletCoinsStore(scan, 30_000);
    store.setKeys(keysA);
    await vi.advanceTimersByTimeAsync(0);
    store.setKeys({ ...keysA });
    expect(scan).toHaveBeenCalledTimes(1);
    store.setKeys(keysB);
    // The old wallet's balance is gone at once: it must never be shown for the new one.
    expect(store.getSnapshot().scan).toBeNull();
    await vi.advanceTimersByTimeAsync(0);
    expect(store.getSnapshot().scan?.coins[0].satoshis).toBe(2_000n);
    store.setKeys(null);
    expect(store.getSnapshot()).toEqual({ scan: null, failed: false, progress: null });
  });

  it('joins a read already under way instead of asking the network twice', async () => {
    let release!: (s: WalletScan) => void;
    const scan = vi.fn(() => new Promise<WalletScan>((r) => (release = r)));
    const store = new WalletCoinsStore(scan, 30_000);
    store.setKeys(keysA);
    const again = store.refresh();
    const third = store.refresh();
    expect(scan).toHaveBeenCalledTimes(1);
    release(scanOf(7n));
    await Promise.all([again, third]);
    expect(store.getSnapshot().scan?.coins[0].satoshis).toBe(7n);
    store.setKeys(null);
  });

  it('keeps the last balance when a refresh fails, and says it failed', async () => {
    let fail = false;
    const scan = vi.fn(async () => {
      if (fail) throw new Error('network');
      return scanOf(9_000n);
    });
    const store = new WalletCoinsStore(scan, 30_000);
    store.setKeys(keysA);
    await vi.advanceTimersByTimeAsync(0);
    fail = true;
    await store.refresh();
    expect(store.getSnapshot().failed).toBe(true);
    expect(store.getSnapshot().scan?.coins[0].satoshis).toBe(9_000n);
    fail = false;
    await store.refresh();
    expect(store.getSnapshot()).toMatchObject({ failed: false });
    store.setKeys(null);
  });

  it('ignores an answer that arrives after the wallet changed', async () => {
    let release!: (s: WalletScan) => void;
    const scan = vi.fn((keys: CoinKeys) => (keys === keysA ? new Promise<WalletScan>((r) => (release = r)) : Promise.resolve(scanOf(2n))));
    const store = new WalletCoinsStore(scan, 30_000);
    store.setKeys(keysA);
    store.setKeys(keysB);
    await vi.advanceTimersByTimeAsync(0);
    release(scanOf(1n));
    await vi.advanceTimersByTimeAsync(0);
    expect(store.getSnapshot().scan?.coins[0].satoshis).toBe(2n);
    store.setKeys(null);
  });
});

describe('a fresh read before spending', () => {
  it('waits for a read under way and then reads once more, so a coin spent meanwhile is not offered', async () => {
    const releases: ((s: WalletScan) => void)[] = [];
    const scan = vi.fn(() => new Promise<WalletScan>((r) => releases.push(r)));
    const store = new WalletCoinsStore(scan, 30_000);
    store.setKeys(keysA);
    const fresh = store.fresh(keysA);
    releases[0](scanOf(1n));
    await vi.advanceTimersByTimeAsync(0);
    expect(scan).toHaveBeenCalledTimes(2);
    releases[1](scanOf(2n));
    expect((await fresh).coins[0].satoshis).toBe(2n);
    store.setKeys(null);
  });

  it('throws when the read fails, and scans other keys on their own', async () => {
    const scan = vi.fn(async (keys: CoinKeys) => {
      if (keys === keysA) throw new Error('connection lost');
      return scanOf(3n);
    });
    const store = new WalletCoinsStore(scan, 30_000);
    store.setKeys(keysA);
    await expect(store.fresh(keysA)).rejects.toThrow(/connection lost/);
    expect((await store.fresh(keysB)).coins[0].satoshis).toBe(3n);
    store.setKeys(null);
  });

  it('shows how far the read has got while it runs', async () => {
    let release!: (s: WalletScan) => void;
    const scan = vi.fn((_keys: CoinKeys, options: { onProgress?: (p: ScanProgress) => void }) => {
      options.onProgress?.({ phase: 'coins', done: 120, total: 480 });
      return new Promise<WalletScan>((r) => (release = r));
    });
    const store = new WalletCoinsStore(scan, 30_000);
    store.setKeys(keysA);
    expect(describeProgress(store.getSnapshot().progress)).toBe('Reading your coins… 120 of 480');
    release(scanOf(1n));
    await vi.advanceTimersByTimeAsync(0);
    expect(store.getSnapshot().progress).toBeNull();
    expect(describeProgress({ phase: 'addresses', done: 0, total: 0 })).toBe('Finding your addresses…');
    store.setKeys(null);
  });
});

describe('the remembered last used address', () => {
  it('keeps one number per xpub under a hash, never the xpub itself, and survives broken storage', () => {
    const saved = new Map<string, string>();
    const storage = { getItem: (k: string) => saved.get(k) ?? null, setItem: (k: string, v: string) => void saved.set(k, v) };
    const memory = browserScanMemory(storage);
    expect(memory.lastUsed('xpub-one')).toBeUndefined();
    memory.remember('xpub-one', 412);
    expect([...saved.keys()].join()).not.toContain('xpub');
    // A new page reads it back from storage.
    expect(browserScanMemory(storage).lastUsed('xpub-one')).toBe(412);
    expect(browserScanMemory(storage).lastUsed('xpub-two')).toBeUndefined();
    saved.set([...saved.keys()][0], 'garbage');
    expect(browserScanMemory(storage).lastUsed('xpub-one')).toBeUndefined();
    const broken = { getItem: () => { throw new Error('blocked'); }, setItem: () => { throw new Error('blocked'); } };
    const inPage = browserScanMemory(broken);
    inPage.remember('xpub-one', 7);
    expect(inPage.lastUsed('xpub-one')).toBe(7);
  });
});

describe('balance text', () => {
  it('writes a BCH balance without trailing zeros', () => {
    expect(formatBchBalance(0n)).toBe('0');
    expect(formatBchBalance(5_516n)).toBe('0.00005516');
    expect(formatBchBalance(4_120_000n)).toBe('0.0412');
    expect(formatBchBalance(150_000_000n)).toBe('1.5');
    expect(formatBchBalance(100_000_000n)).toBe('1');
    expect(formatBchBalance(1_234_567_890n)).toBe('12.3456789');
    expect(formatBchBalance(2_100_000_000_000_000n)).toBe('21,000,000');
  });

  it('adds up one token category and ignores the others', () => {
    const coin = (category: string, amount: bigint) => ({ satoshis: 800n, token: { category, amount } }) as unknown as WalletSpendableUtxo;
    const coins = [coin('AA'.repeat(32), 1_250n), coin('aa'.repeat(32), 250n), coin('bb'.repeat(32), 999n), { satoshis: 5_000n } as WalletSpendableUtxo];
    expect(tokenBalance(coins, 'aa'.repeat(32))).toBe(1_500n);
    expect(tokenBalance(coins, 'cc'.repeat(32))).toBe(0n);
  });
});

describe('a fresh address from the scan', () => {
  const scan: WalletScan = {
    coins: [],
    paths: [
      { name: 'receive', scanned: 433, lastUsed: 412 },
      { name: 'change', scanned: 20, lastUsed: -1 },
    ],
    noChangePath: false,
  };
  it('skips a few past the first unused address, and never goes below where Campfire already is', () => {
    expect(unusedIndex(scan, 'receive')).toBe(418);
    expect(unusedIndex(scan, 'change')).toBe(5);
    // A buyer's next payout follows Campfire's own last one when that is further.
    expect(unusedIndex(scan, 'receive', 500)).toBe(505);
    expect(unusedIndex({ ...scan, paths: scan.paths.slice(0, 1) }, 'change')).toBeNull();
  });
});
