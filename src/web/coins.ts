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
/** Lookups sent at the same time. Electrum servers answer one request at a time per address, so this is a courtesy limit. */
const BATCH = 50;

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

function entry(pathName: Entry['pathName'], xpub: string, keyIndex: number): Entry {
  const pkh = hash160(derivePubkeyFromXpub(xpub, keyIndex));
  return { pathName, keyIndex, address: pkhToCashAddress(pkh), lockingBytecode: binToHex(pkhToLockingBytecode(pkh)) };
}

/** A provider that can list an address's history (Electrum can; the offline test provider cannot). */
type WithHistory = { performRequest: (method: string, ...params: unknown[]) => Promise<unknown> };
const hasHistory = (p: NetworkProvider): p is NetworkProvider & WithHistory => typeof (p as Partial<WithHistory>).performRequest === 'function';

/**
 * Finds the last used index of one path with a bisection, then reads its coins.
 *
 * A wallet never leaves `GAP_LIMIT` unused addresses in a row before one it used, so the window of `GAP_LIMIT`
 * addresses starting at i has history exactly when i is not past the last used index. That makes the answer
 * monotone and a bisection finds the boundary in about 2·log2(last) rounds of one window each, where reading
 * address by address takes last / 20 rounds. The addresses up to the last one are then read once, in parallel.
 */
async function scanPath(provider: NetworkProvider, name: Entry['pathName'], xpub: string, signal?: AbortSignal) {
  const entries = new Map<number, Entry>();
  const at = (i: number): Entry => {
    let e = entries.get(i);
    if (!e) entries.set(i, (e = entry(name, xpub, i)));
    return e;
  };
  // What is known about each index, so overlapping windows never ask twice.
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
    for (let k = i; k < i + GAP_LIMIT; k++) if (used.get(k)) return true;
    return false;
  }

  let last = -1;
  if (await probe(0)) {
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
    // What was learned past the boundary may be stale, and the probes skipped addresses: read everything up to
    // the end again, and widen the range if a used address turns up.
    for (const i of [...used.keys()]) {
      if (i > last) {
        used.delete(i);
        coinsAt.delete(i);
      }
    }
    for (;;) {
      await fill(0, last + 1 + GAP_LIMIT);
      let found = last;
      for (let i = last + 1; i < last + 1 + GAP_LIMIT; i++) if (used.get(i)) found = i;
      if (found === last) break;
      if (found + GAP_LIMIT > MAX_INDEX) throw tooMany();
      last = found;
    }
  }

  // The coins of every used address (with the offline provider they were read while looking).
  const usedIndices = [...used.entries()].filter(([i, isUsed]) => isUsed && i <= last).map(([i]) => i).sort((a, b) => a - b);
  const pending = usedIndices.filter((i) => !coinsAt.has(i));
  for (let k = 0; k < pending.length; k += BATCH) {
    signal?.throwIfAborted();
    await Promise.all(pending.slice(k, k + BATCH).map(async (i) => void coinsAt.set(i, await provider.getUtxos(at(i).address))));
  }
  const coins: WalletSpendableUtxo[] = [];
  for (const i of usedIndices) for (const utxo of coinsAt.get(i) ?? []) coins.push({ ...utxo, ...at(i) } as WalletSpendableUtxo);
  return { coins, scanned: used.size, lastUsed: last };
}

/**
 * Every unspent coin of the wallet and where it was looked for. An address counts as used when it has any history,
 * even if every coin on it was spent, which is what a wallet counts too. Token coins are included: callers must not
 * spend them as plain BCH. Throws if any lookup fails; a partial list would make the balance look smaller than it is.
 */
export async function scanWalletCoins(provider: NetworkProvider, keys: CoinKeys, signal?: AbortSignal): Promise<WalletScan> {
  const branches: [Entry['pathName'], string][] = [['receive', keys.receive]];
  if (keys.change) branches.push(['change', keys.change]);
  const results = await Promise.all(branches.map(async ([name, xpub]) => ({ name, ...(await scanPath(provider, name, xpub, signal)) })));
  return {
    coins: results.flatMap((r) => r.coins),
    paths: results.map(({ name, scanned, lastUsed }) => ({ name, scanned, lastUsed })),
    noChangePath: keys.change === undefined,
  };
}

/** The coins alone, for callers that do not show where they were found. */
export async function loadWalletCoins(provider: NetworkProvider, keys: CoinKeys, signal?: AbortSignal): Promise<WalletSpendableUtxo[]> {
  return (await scanWalletCoins(provider, keys, signal)).coins;
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
