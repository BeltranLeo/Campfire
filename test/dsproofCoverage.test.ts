import { binToHex, encodeTransaction, hashTransaction, hexToBin } from '@bitauth/libauth';
import { describe, expect, it } from 'vitest';
import { dsProofCoverage, isP2pkh, MAX_UNCONFIRMED_ANCESTORS, type CoverageLookup } from '../src/web/dsproofCoverage';

const P2PKH = hexToBin(`76a914${'11'.repeat(20)}88ac`);
const P2SH = hexToBin(`a914${'22'.repeat(20)}87`);

interface Spend {
  txid: string;
  vout: number;
}

/** A small chain of transactions held in memory, looked up like the Electrum server would. */
function chain() {
  const txs = new Map<string, { hex: string; confirmed: boolean }>();
  const add = (spends: Spend[], outputs: Uint8Array[], confirmed: boolean): string => {
    const bin = encodeTransaction({
      version: 2,
      locktime: 0,
      inputs: spends.map((s) => ({
        outpointTransactionHash: hexToBin(s.txid),
        outpointIndex: s.vout,
        sequenceNumber: 0xffffffff,
        unlockingBytecode: new Uint8Array([0x51]),
      })),
      outputs: outputs.map((lockingBytecode) => ({ lockingBytecode, valueSatoshis: 10_000n })),
    });
    const txid = hashTransaction(bin);
    txs.set(txid, { hex: binToHex(bin), confirmed });
    return txid;
  };
  const lookup: CoverageLookup = {
    async getTransaction(txid) {
      const tx = txs.get(txid);
      if (!tx) throw new Error(`unknown ${txid}`);
      return tx;
    },
  };
  // Some confirmed coin to start from; its own inputs are never looked at.
  const coinbase = (output: Uint8Array) => add([{ txid: '00'.repeat(32), vout: 0 }], [output], true);
  return { add, lookup, coinbase };
}

describe('DSProof coverage of a zero-confirmation deposit', () => {
  it('recognises a P2PKH locking script and nothing else', () => {
    expect(isP2pkh(P2PKH)).toBe(true);
    expect(isP2pkh(P2SH)).toBe(false);
    expect(isP2pkh(new Uint8Array(25))).toBe(false);
  });

  it('covers a deposit that spends confirmed P2PKH coins, as the wallet does', async () => {
    const c = chain();
    const a = c.coinbase(P2PKH);
    const b = c.coinbase(P2PKH);
    const deposit = c.add([{ txid: a, vout: 0 }, { txid: b, vout: 0 }], [P2SH], false);
    expect(await dsProofCoverage(deposit, c.lookup)).toBe('covered');
  });

  it('does not cover a deposit that spends a contract coin', async () => {
    const c = chain();
    const a = c.coinbase(P2PKH);
    const contractCoin = c.coinbase(P2SH);
    const deposit = c.add([{ txid: a, vout: 0 }, { txid: contractCoin, vout: 0 }], [P2SH], false);
    expect(await dsProofCoverage(deposit, c.lookup)).toBe('uncovered');
  });

  it('does not cover a deposit whose unconfirmed parent spent a contract coin', async () => {
    const c = chain();
    const contractCoin = c.coinbase(P2SH);
    // The parent pays a plain address, so the deposit's own input looks fine.
    const parent = c.add([{ txid: contractCoin, vout: 0 }], [P2PKH], false);
    const deposit = c.add([{ txid: parent, vout: 0 }], [P2SH], false);
    expect(await dsProofCoverage(deposit, c.lookup)).toBe('uncovered');
  });

  it('stops at confirmed ancestors and covers an unconfirmed P2PKH chain', async () => {
    const c = chain();
    const contractCoin = c.coinbase(P2SH);
    // Confirmed, so its contract input can no longer be double-spent.
    const settled = c.add([{ txid: contractCoin, vout: 0 }], [P2PKH], true);
    const parent = c.add([{ txid: settled, vout: 0 }], [P2PKH], false);
    const deposit = c.add([{ txid: parent, vout: 0 }], [P2SH], false);
    expect(await dsProofCoverage(deposit, c.lookup)).toBe('covered');
  });

  it('treats a very long unconfirmed chain as not covered', async () => {
    const c = chain();
    let tip = c.coinbase(P2PKH);
    for (let i = 0; i <= MAX_UNCONFIRMED_ANCESTORS; i++) tip = c.add([{ txid: tip, vout: 0 }], [P2PKH], false);
    const deposit = c.add([{ txid: tip, vout: 0 }], [P2SH], false);
    expect(await dsProofCoverage(deposit, c.lookup)).toBe('uncovered');
  });

  it('rejects when a transaction cannot be looked up, so no verdict is shown', async () => {
    const c = chain();
    const deposit = c.add([{ txid: 'ab'.repeat(32), vout: 0 }], [P2SH], false);
    await expect(dsProofCoverage(deposit, c.lookup)).rejects.toThrow(/unknown/);
  });
});
