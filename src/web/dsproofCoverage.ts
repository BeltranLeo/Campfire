// Which zero-confirmation deposits a double-spend proof can protect.
//
// Bitcoin Cash nodes only build DSProofs for coins locked to a plain address (P2PKH). A deposit that spends a coin
// from a contract (P2SH), or that depends on an unconfirmed transaction that does, can be double-spent without any
// proof ever appearing, so "no proof after a few seconds" says nothing about it. BCHN's `getdsproofscore` gives such
// a transaction 0.25 instead of 1. The Electrum server has no such call, so the browser walks the deposit and its
// unconfirmed ancestors itself. The wallet's own coins are P2PKH, so a deposit built by this page is always covered;
// only a transaction made by hand can fail this check. See test/dsproofCoverage.test.ts.

import { binToHex, decodeTransactionUnsafe, hexToBin } from '@bitauth/libauth';

/** What the walk needs from the network: the transaction's bytes and whether it is in a block. */
export interface CoverageLookup {
  getTransaction(txid: string): Promise<{ hex: string; confirmed: boolean }>;
}

export type DsProofCoverage =
  /** Every coin spent, by the deposit and its unconfirmed ancestors, is P2PKH: a double spend would raise a proof. */
  | 'covered'
  /** Some coin is not P2PKH: a double spend would go unnoticed until a block. */
  | 'uncovered';

/** More unconfirmed ancestors than this are not walked: the deposit is treated as not covered. */
export const MAX_UNCONFIRMED_ANCESTORS = 25;

/** `OP_DUP OP_HASH160 <20 bytes> OP_EQUALVERIFY OP_CHECKSIG`. Token data is decoded apart, so it does not get in the way. */
export function isP2pkh(lockingBytecode: Uint8Array): boolean {
  return (
    lockingBytecode.length === 25 &&
    lockingBytecode[0] === 0x76 &&
    lockingBytecode[1] === 0xa9 &&
    lockingBytecode[2] === 0x14 &&
    lockingBytecode[23] === 0x88 &&
    lockingBytecode[24] === 0xac
  );
}

/** Walks an unconfirmed deposit and its unconfirmed ancestors. A failed lookup rejects: the caller shows no verdict. */
export async function dsProofCoverage(fundingTxid: string, lookup: CoverageLookup): Promise<DsProofCoverage> {
  const fetched = new Map<string, Promise<{ hex: string; confirmed: boolean }>>();
  const get = (txid: string) => {
    let tx = fetched.get(txid);
    if (!tx) fetched.set(txid, (tx = lookup.getTransaction(txid)));
    return tx;
  };

  const queue = [fundingTxid];
  const walked = new Set<string>();
  while (queue.length > 0) {
    const txid = queue.shift()!;
    if (walked.has(txid)) continue;
    walked.add(txid);
    if (walked.size > MAX_UNCONFIRMED_ANCESTORS) return 'uncovered';

    const tx = decodeTransactionUnsafe(hexToBin((await get(txid)).hex));
    for (const input of tx.inputs) {
      // libauth keeps the outpoint hash in the order explorers show it, the same as a txid.
      const parentId = binToHex(input.outpointTransactionHash);
      const parent = await get(parentId);
      const spent = decodeTransactionUnsafe(hexToBin(parent.hex)).outputs[input.outpointIndex];
      if (!spent || !isP2pkh(spent.lockingBytecode)) return 'uncovered';
      if (!parent.confirmed) queue.push(parentId);
    }
  }
  return 'covered';
}
