import { describe, expect, it } from 'vitest';
import { binToHex, encodeTransaction, hashTransaction, hexToBin, sha256, utf8ToBin } from '@bitauth/libauth';
import type { NetworkProvider, Utxo } from 'cashscript';
import {
  CampfireService,
  MARKER_GRACE_SEC,
  MARKER_RECHECK_SEC,
  MemoryStorage,
  OracleService,
  StaticPriceFeed,
  type StoredOffer,
} from '../src/server/index.js';

// The service notices on its own that an offer's marker was spent, which closes the offer (protocol section 2.1).

const ADDRESS = 'bitcoincash:qpm2qsznhks23z7629mms6s4cwef74vcwvy22gdx6a';
const T0 = 1_794_900_000;

function offer(txid: string, extra: Partial<StoredOffer> = {}): StoredOffer {
  return {
    offerTxid: txid,
    sellerIdentity: 'seller',
    contentHash: txid,
    offerJson: '{}',
    document: { side: 'sell', expiresAt: T0 + 86_400 } as StoredOffer['document'],
    onChain: {} as StoredOffer['onChain'],
    markerVout: 1,
    markerAddress: ADDRESS,
    status: 'Published',
    createdAt: T0,
    updatedAt: T0,
    ...extra,
  };
}

/** A transaction that spends outpoint txid:vout, as hex, with its txid. */
function spending(txid: string, vout = 1) {
  const hex = binToHex(
    encodeTransaction({
      version: 2,
      inputs: [{ outpointTransactionHash: hexToBin(txid), outpointIndex: vout, sequenceNumber: 0, unlockingBytecode: new Uint8Array() }],
      outputs: [{ lockingBytecode: Uint8Array.of(0x6a), valueSatoshis: 0n }],
      locktime: 0,
    }),
  );
  return { hex, txid: hashTransaction(hexToBin(hex)) };
}

async function setup(offers: StoredOffer[], options: { history?: boolean } = {}) {
  let now = T0 + MARKER_GRACE_SEC;
  const unspent = new Set(offers.map((o) => o.offerTxid));
  const chain = { down: false, lookups: 0, txs: new Map<string, string>(), sent: [] as string[] };
  const provider = {
    async getUtxos(): Promise<Utxo[]> {
      chain.lookups++;
      if (chain.down) throw new Error('indexer unreachable');
      return [...unspent].map((txid) => ({ txid, vout: 1, satoshis: 1000n }));
    },
    async getRawTransaction(txid: string) {
      const hex = chain.txs.get(txid);
      if (!hex) throw new Error('unknown transaction');
      return hex;
    },
    async sendRawTransaction(hex: string) {
      chain.sent.push(hex);
      return hashTransaction(hexToBin(hex));
    },
    ...(options.history
      ? {
          // The address's history: the offers, then every other transaction known, in order.
          async performRequest(method: string) {
            if (method !== 'blockchain.address.get_history') throw new Error(`unexpected ${method}`);
            return [...offers.map((o) => o.offerTxid), ...chain.txs.keys()].map((tx_hash) => ({ tx_hash, height: 0 }));
          },
        }
      : {}),
  } as unknown as NetworkProvider;
  const storage = new MemoryStorage();
  for (const o of offers) await storage.saveOffer(o);
  const oracle = new OracleService({ privateKey: sha256.hash(utf8ToBin('markers-oracle')), feed: new StaticPriceFeed({}), nowSeconds: () => now });
  const service = new CampfireService({ storage, provider, oracle, arbiterPrivateKey: sha256.hash(utf8ToBin('markers-arbiter')), nowSeconds: () => now });
  const status = async (txid: string) => (await service.listOffers()).find((o) => o.offerTxid === txid)?.status;
  const closeTxid = async (txid: string) => (await service.listOffers()).find((o) => o.offerTxid === txid)?.closeTxid;
  /** Records a transaction on the chain that spends the offer's marker, and returns its txid. */
  const spend = (txid: string) => {
    const tx = spending(txid);
    chain.txs.set(tx.txid, tx.hex);
    unspent.delete(txid);
    return tx.txid;
  };
  return { service, storage, unspent, chain, status, closeTxid, spend, advance: (sec: number) => (now += sec) };
}

describe('offers whose marker was spent', () => {
  it('are listed as closed once the service sees the marker gone', async () => {
    const ctx = await setup([offer('aa'.repeat(32)), offer('bb'.repeat(32))]);
    expect(await ctx.status('aa'.repeat(32))).toBe('Published');
    ctx.unspent.delete('aa'.repeat(32));
    ctx.advance(MARKER_RECHECK_SEC);
    expect(await ctx.status('aa'.repeat(32))).toBe('Closed');
    expect(await ctx.status('bb'.repeat(32))).toBe('Published');
  });

  it('are looked up at most once a minute, and in one lookup per address', async () => {
    const ctx = await setup([offer('aa'.repeat(32)), offer('bb'.repeat(32))]);
    await ctx.service.listOffers();
    await ctx.service.listOffers();
    expect(ctx.chain.lookups).toBe(1);
    ctx.advance(MARKER_RECHECK_SEC);
    await ctx.service.listOffers();
    expect(ctx.chain.lookups).toBe(2);
  });

  it('stay open when the indexer cannot be reached, and while the offer is too new to be indexed', async () => {
    const ctx = await setup([offer('aa'.repeat(32)), offer('cc'.repeat(32), { createdAt: T0 + MARKER_GRACE_SEC })]);
    ctx.unspent.clear();
    ctx.chain.down = true;
    expect(await ctx.status('aa'.repeat(32))).toBe('Published');
    ctx.chain.down = false;
    ctx.advance(MARKER_RECHECK_SEC);
    expect(await ctx.status('aa'.repeat(32))).toBe('Closed');
    expect(await ctx.status('cc'.repeat(32))).toBe('Published');
  });

  it('cannot be taken, even before a listing has noticed', async () => {
    const ctx = await setup([offer('aa'.repeat(32), { document: { side: 'sell', min: '1', max: '10', expiresAt: T0 + 86_400 } as StoredOffer['document'] })]);
    ctx.unspent.clear();
    const take = (ctx.service as unknown as { offerToTake(txid: string, side: 'sell' | 'buy', amount: string): Promise<unknown> }).offerToTake(
      'aa'.repeat(32),
      'sell',
      '5',
    );
    await expect(take).rejects.toThrow(/not open \(status: Closed\)/);
    expect(await ctx.status('aa'.repeat(32))).toBe('Closed');
  });

  it('keep the txid of the transaction that spent the marker, found in the address history', async () => {
    const ctx = await setup([offer('aa'.repeat(32)), offer('bb'.repeat(32))], { history: true });
    const other = spending('dd'.repeat(32));
    ctx.chain.txs.set(other.txid, other.hex);
    const closer = ctx.spend('aa'.repeat(32));
    expect(await ctx.status('aa'.repeat(32))).toBe('Closed');
    expect(await ctx.closeTxid('aa'.repeat(32))).toBe(closer);
    expect(await ctx.closeTxid('bb'.repeat(32))).toBeUndefined();
  });

  it('get the closing txid filled in when they were closed without it', async () => {
    const ctx = await setup([offer('aa'.repeat(32), { status: 'Closed' })], { history: true });
    const closer = ctx.spend('aa'.repeat(32));
    expect(await ctx.closeTxid('aa'.repeat(32))).toBe(closer);
  });

  it('close without a link when the provider keeps no history', async () => {
    const ctx = await setup([offer('aa'.repeat(32))]);
    ctx.spend('aa'.repeat(32));
    expect(await ctx.status('aa'.repeat(32))).toBe('Closed');
    expect(await ctx.closeTxid('aa'.repeat(32))).toBeUndefined();
  });
});

describe('closing an offer with a transaction', () => {
  it('records its txid at once, before the indexer lists the marker as spent', async () => {
    const ctx = await setup([offer('aa'.repeat(32))]);
    const tx = spending('aa'.repeat(32));
    const closed = await ctx.service.closeOffer({ sellerIdentity: 'seller', offerTxid: 'aa'.repeat(32), closeTxHex: tx.hex });
    expect(closed.status).toBe('Closed');
    expect(closed.closeTxid).toBe(tx.txid);
    expect(ctx.chain.sent).toEqual([tx.hex]);
  });

  it('refuses one that does not spend the marker, without broadcasting it', async () => {
    const ctx = await setup([offer('aa'.repeat(32))]);
    const close = (hex: string) => ctx.service.closeOffer({ sellerIdentity: 'seller', offerTxid: 'aa'.repeat(32), closeTxHex: hex });
    await expect(close(spending('aa'.repeat(32), 0).hex)).rejects.toThrow(/does not spend the offer marker/);
    await expect(close('zz')).rejects.toThrow(/does not spend the offer marker/);
    expect(ctx.chain.sent).toEqual([]);
    expect(await ctx.status('aa'.repeat(32))).toBe('Published');
  });
});
