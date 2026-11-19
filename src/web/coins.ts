// The wallet's own coins, read from the chain in the browser. WizardConnect gives Campfire public keys only,
// so the coins of the wallet are found by deriving its addresses and asking an Electrum server about each.

import { binToHex, hash160 } from '@bitauth/libauth';
import type { NetworkProvider, Utxo } from 'cashscript';
import {
  derivePubkeyFromXpub,
  pkhToCashAddress,
  pkhToLockingBytecode,
  type WalletPathName,
  type WalletSpendableUtxo,
} from '../protocol/keys.js';

/**
 * Wallets stop looking after 20 unused addresses in a row (the "gap limit"), and so does this scan. A path is
 * therefore read up to its last used address plus this many.
 */
export const GAP_LIMIT = 20;
/**
 * A ceiling on the index of the last address a path may use. A server that answered "used" to everything would
 * otherwise send the scan out to the 2^31 limit of non-hardened keys.
 */
const MAX_INDEX = 20_000;
/** Lookups sent at the same time on the one kept connection. Each is small; the limit keeps a burst polite. */
const BATCH = 100;

export interface CoinKeys {
  receive: string;
  change?: string;
}

export interface WalletScan {
  coins: WalletSpendableUtxo[];
  /** How many addresses were looked at on each path, and the highest index in use (-1 if none). */
  paths: { name: 'receive' | 'change'; scanned: number; lastUsed: number }[];
  /** The wallet did not share its change path, so coins sent to its change addresses cannot be seen. */
  noChangePath: boolean;
}

interface Entry {
  pathName: Extract<WalletPathName, 'receive' | 'change'>;
  keyIndex: number;
  address: string;
  lockingBytecode: string;
}

// Deriving an address is pure CPU (about half a millisecond), and every scan of a long-used wallet needs the
// same hundreds of them, every few seconds. They are kept for the page's lifetime, per path and xpub.
const entries = new Map<string, Map<number, Entry>>();
const MAX_CACHED_ENTRIES = 100_000;
let cachedEntries = 0;

function entry(pathName: Entry['pathName'], xpub: string, keyIndex: number): Entry {
  const pathKey = `${pathName}|${xpub}`;
  let path = entries.get(pathKey);
  if (!path) entries.set(pathKey, (path = new Map()));
  let e = path.get(keyIndex);
  if (!e) {
    const pkh = hash160(derivePubkeyFromXpub(xpub, keyIndex));
    e = { pathName, keyIndex, address: pkhToCashAddress(pkh), lockingBytecode: binToHex(pkhToLockingBytecode(pkh)) };
    if (++cachedEntries > MAX_CACHED_ENTRIES) {
      entries.clear();
      cachedEntries = 1;
      entries.set(pathKey, (path = new Map()));
    }
    path.set(keyIndex, e);
  }
  return e;
}

/**
 * What earlier scans learned about a wallet: the last used index of each path, by xpub. An address that was used
 * stays used forever, so this is a floor the next scan starts from instead of searching the whole path again.
 */
export interface ScanMemory {
  lastUsed(xpub: string): number | undefined;
  remember(xpub: string, lastUsed: number): void;
}

/** How far a scan has got, for a page to show instead of a frozen button. */
export interface ScanProgress {
  /** Finding the last used address, then reading the coins of every address up to it. */
  phase: 'addresses' | 'coins';
  done: number;
  total: number;
}

export interface ScanOptions {
  signal?: AbortSignal;
  memory?: ScanMemory;
  onProgress?: (progress: ScanProgress) => void;
}

/** A provider that can list an address's history (Electrum can; the offline test provider cannot). */
type WithHistory = { performRequest: (method: string, ...params: unknown[]) => Promise<unknown> };
const hasHistory = (p: NetworkProvider): p is NetworkProvider & WithHistory => typeof (p as Partial<WithHistory>).performRequest === 'function';

/**
 * Finds the last used index of one path, then reads the coins of every address up to it.
 *
 * With a remembered last index the search only looks at the `GAP_LIMIT` addresses after it, and further while it
 * finds used ones. Without one it bisects: a wallet never leaves `GAP_LIMIT` unused addresses in a row before one
 * it used, so the window of `GAP_LIMIT` addresses starting at i has history exactly when i is not past the last
 * used index. That makes the answer monotone, and the boundary is found in about 2·log2(last) windows.
 *
 * Only the addresses past the last used one need their history (and theirs is empty, so it is small). The coins
 * are read with `listunspent` for every address up to the last: an address used long ago answers with an empty
 * list, where its history could hold thousands of transactions.
 */
async function scanPath(
  provider: NetworkProvider,
  name: Entry['pathName'],
  xpub: string,
  options: ScanOptions & { report: (p: ScanProgress) => void },
) {
  const { signal, memory, report } = options;
  const at = (i: number): Entry => entry(name, xpub, i);
  // What is known about each index in this scan, so overlapping windows never ask twice.
  const used = new Map<number, boolean>();
  const coinsAt = new Map<number, Utxo[]>();

  async function lookup(i: number) {
    const address = at(i).address;
    if (hasHistory(provider)) {
      const history = await provider.performRequest('blockchain.address.get_history', address);
      used.set(i, !Array.isArray(history) || history.length > 0);
    } else {
      // Without history, an address counts as used while it holds a coin.
      const utxos = await provider.getUtxos(address);
      coinsAt.set(i, utxos);
      used.set(i, utxos.length > 0);
    }
  }

  /** Makes sure every index in [from, to) has been looked up. */
  async function fill(from: number, to: number) {
    const missing: number[] = [];
    for (let i = from; i < to; i++) if (!used.has(i)) missing.push(i);
    for (let k = 0; k < missing.length; k += BATCH) {
      signal?.throwIfAborted();
      await Promise.all(missing.slice(k, k + BATCH).map(lookup));
    }
  }

  const tooMany = () => new Error(`This wallet has more than ${MAX_INDEX.toLocaleString('en-US')} used addresses, more than Campfire can read.`);

  /** True if any address in the window [i, i + GAP_LIMIT) has been used. */
  async function probe(i: number): Promise<boolean> {
    if (i + GAP_LIMIT > MAX_INDEX) throw tooMany();
    await fill(i, i + GAP_LIMIT);
    report({ phase: 'addresses', done: used.size, total: 0 });
    for (let k = i; k < i + GAP_LIMIT; k++) if (used.get(k)) return true;
    return false;
  }

  const remembered = memory?.lastUsed(xpub);
  let last = remembered !== undefined && Number.isInteger(remembered) && remembered >= -1 && remembered < MAX_INDEX ? remembered : -1;
  if (remembered === undefined && (await probe(0))) {
    // Double until a window is empty, then bisect between the last full one and that one.
    let lo = 0;
    let hi = 1;
    while (await probe(hi)) {
      lo = hi;
      hi *= 2;
    }
    while (hi - lo > 1) {
      const mid = lo + ((hi - lo) >> 1);
      if (await probe(mid)) lo = mid;
      else hi = mid;
    }
    last = lo;
    // What was learned past the boundary may be stale: read it again below.
    for (const i of [...used.keys()]) {
      if (i > last) {
        used.delete(i);
        coinsAt.delete(i);
      }
    }
  }
  // The addresses after the last used one, until a whole window of them is unused.
  for (;;) {
    await fill(last + 1, last + 1 + GAP_LIMIT);
    let found = last;
    for (let i = last + 1; i < last + 1 + GAP_LIMIT; i++) if (used.get(i)) found = i;
    if (found === last) break;
    if (found + GAP_LIMIT > MAX_INDEX) throw tooMany();
    last = found;
  }
  memory?.remember(xpub, last);

  // The coins of every address up to the last used one (with the offline provider some were read while looking).
  const pending: number[] = [];
  for (let i = 0; i <= last; i++) if (!coinsAt.has(i)) pending.push(i);
  let read = last + 1 - pending.length;
  report({ phase: 'coins', done: read, total: last + 1 });
  for (let k = 0; k < pending.length; k += BATCH) {
    signal?.throwIfAborted();
    const slice = pending.slice(k, k + BATCH);
    await Promise.all(slice.map(async (i) => void coinsAt.set(i, await provider.getUtxos(at(i).address))));
    read += slice.length;
    report({ phase: 'coins', done: read, total: last + 1 });
  }
  const coins: WalletSpendableUtxo[] = [];
  for (let i = 0; i <= last; i++) for (const utxo of coinsAt.get(i) ?? []) coins.push({ ...utxo, ...at(i) } as WalletSpendableUtxo);
  return { coins, scanned: last + 1 + GAP_LIMIT, lastUsed: last };
}

/**
 * Every unspent coin of the wallet and where it was looked for. An address counts as used when it has any history,
 * even if every coin on it was spent, which is what a wallet counts too. Token coins are included: callers must not
 * spend them as plain BCH. Throws if any lookup fails; a partial list would make the balance look smaller than it is.
 * `options` may be an AbortSignal, as before options existed.
 */
export async function scanWalletCoins(provider: NetworkProvider, keys: CoinKeys, options?: AbortSignal | ScanOptions): Promise<WalletScan> {
  const opts: ScanOptions = options instanceof AbortSignal ? { signal: options } : (options ?? {});
  const branches: [Entry['pathName'], string][] = [['receive', keys.receive]];
  if (keys.change) branches.push(['change', keys.change]);
  // One figure for both paths: the addresses checked so far, then the coins read out of the total.
  const progress = new Map<string, ScanProgress>();
  const report = (name: string) => (p: ScanProgress) => {
    progress.set(name, p);
    const all = [...progress.values()];
    const phase = all.some((x) => x.phase === 'addresses') || all.length < branches.length ? 'addresses' : 'coins';
    opts.onProgress?.({ phase, done: all.reduce((n, x) => n + x.done, 0), total: phase === 'coins' ? all.reduce((n, x) => n + x.total, 0) : 0 });
  };
  const results = await Promise.all(
    branches.map(async ([name, xpub]) => ({ name, ...(await scanPath(provider, name, xpub, { ...opts, report: report(name) })) })),
  );
  return {
    coins: results.flatMap((r) => r.coins),
    paths: results.map(({ name, scanned, lastUsed }) => ({ name, scanned, lastUsed })),
    noChangePath: keys.change === undefined,
  };
}

/** The coins alone, for callers that do not show where they were found. */
export async function loadWalletCoins(provider: NetworkProvider, keys: CoinKeys, options?: AbortSignal | ScanOptions): Promise<WalletSpendableUtxo[]> {
  return (await scanWalletCoins(provider, keys, options)).coins;
}

/**
 * The first receive address the scan found unused (the one after the last used), for showing where to send coins.
 * One address per use: showing a used one would invite reusing it. Null until a scan has read the receive path.
 */
export function freshReceiveAddress(scan: WalletScan | null, receiveXpub: string): string | null {
  const path = scan?.paths.find((p) => p.name === 'receive');
  return path ? entry('receive', receiveXpub, path.lastUsed + 1).address : null;
}

/** The plain BCH the wallet can spend (coins that carry no token), in satoshis. */
export function spendableBch(coins: WalletSpendableUtxo[]): bigint {
  return coins.filter((c) => !c.token).reduce((sum, c) => sum + c.satoshis, 0n);
}

/** The amount of one fungible token the wallet holds, in the token's base units. */
export function tokenBalance(coins: WalletSpendableUtxo[], category: string): bigint {
  const wanted = category.toLowerCase();
  return coins.reduce((sum, c) => (c.token && c.token.category.toLowerCase() === wanted ? sum + c.token.amount : sum), 0n);
}

/** One sentence on where the scan looked, to show when the balance is not what the person expects. */
export function describeScan(scan: WalletScan): string {
  const looked = [...scan.paths]
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((p) => `${p.scanned} ${p.name} addresses`)
    .join(' and ');
  return scan.noChangePath
    ? `Campfire looked at ${looked}. This wallet did not share its change addresses, so coins sent there cannot be seen.`
    : `Campfire looked at ${looked}.`;
}
