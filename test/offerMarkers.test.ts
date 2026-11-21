import { describe, expect, it } from 'vitest';
import { sha256, utf8ToBin } from '@bitauth/libauth';
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

async function setup(offers: StoredOffer[]) {
  let now = T0 + MARKER_GRACE_SEC;
  const unspent = new Set(offers.map((o) => o.offerTxid));
  const chain = { down: false, lookups: 0 };
  const provider = {
    async getUtxos(): Promise<Utxo[]> {
      chain.lookups++;
      if (chain.down) throw new Error('indexer unreachable');
      return [...unspent].map((txid) => ({ txid, vout: 1, satoshis: 1000n }));
    },
  } as unknown as NetworkProvider;
  const storage = new MemoryStorage();
  for (const o of offers) await storage.saveOffer(o);
  const oracle = new OracleService({ privateKey: sha256.hash(utf8ToBin('markers-oracle')), feed: new StaticPriceFeed({}), nowSeconds: () => now });
  const service = new CampfireService({ storage, provider, oracle, arbiterPrivateKey: sha256.hash(utf8ToBin('markers-arbiter')), nowSeconds: () => now });
  const status = async (txid: string) => (await service.listOffers()).find((o) => o.offerTxid === txid)?.status;
  return { service, unspent, chain, status, advance: (sec: number) => (now += sec) };
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
});
