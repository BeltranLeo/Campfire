import { MockNetworkProvider, Network } from 'cashscript';
import { binToHex, deriveHdPath, deriveHdPrivateNodeFromSeed, deriveHdPublicNode, encodeHdPublicKey, secp256k1, sha256, utf8ToBin } from '@bitauth/libauth';
import { describe, expect, it } from 'vitest';
import { buildPublishOfferTransaction, decodeOfferOpReturn, validateOfferDocument, verifyOfferAgainstOpReturn } from '../src/protocol/offers.js';
import { derivePayoutPkhFromXpub, pkhToCashAddress } from '../src/protocol/keys.js';
import { loadWalletCoins, spendableBch } from '../src/web/coins.js';
import {
  MIN_TRADE_SATS,
  buildCloseOffer,
  buildOfferDocument,
  marginRange,
  parseFixedPrice,
  parseMarginBps,
  parseMethods,
  type OfferForm,
} from '../src/web/sell.js';

function wallet(label: string) {
  const seed = new Uint8Array(64);
  seed.set(sha256.hash(utf8ToBin(label)), 0);
  const master = deriveHdPrivateNodeFromSeed(seed);
  const xpub = (branch: number) => {
    const node = deriveHdPath(master, `m/44'/145'/0'/${branch}`);
    if (typeof node === 'string') throw new Error(node);
    return encodeHdPublicKey({ network: 'mainnet', node: deriveHdPublicNode(node) }).hdPublicKey;
  };
  return { receive: xpub(0), change: xpub(1) };
}

const arbiter = binToHex(secp256k1.derivePublicKeyCompressed(sha256.hash(utf8ToBin('arbiter'))) as Uint8Array);
const oracle = binToHex(secp256k1.derivePublicKeyCompressed(sha256.hash(utf8ToBin('oracle'))) as Uint8Array);

const form: OfferForm = {
  fiat: 'ARS',
  priceType: 'market',
  margin: '2.5',
  fixedPrice: '',
  min: '100,000',
  max: '2,000,000',
  methods: 'bank-transfer, mercadopago',
  paymentWindowSec: 3600,
  expirySec: 7 * 86_400,
};
const build = (patch: Partial<OfferForm> = {}) => buildOfferDocument({ form: { ...form, ...patch }, arbiter, oracle, now: 1_800_000_000 });

describe('the offer form', () => {
  it('reads a margin in percent as basis points', () => {
    expect(parseMarginBps('2.5')).toBe(250);
    expect(parseMarginBps('2,5')).toBe(250);
    expect(parseMarginBps('-1')).toBe(-100);
    expect(parseMarginBps('0')).toBe(0);
    expect(parseMarginBps('+3')).toBe(300);
    // A typo such as 250 for 2.5 must not become a 250% margin.
    expect(parseMarginBps('250')).toBeNull();
    expect(parseMarginBps('-60')).toBeNull();
    expect(parseMarginBps('2.555')).toBeNull();
    expect(parseMarginBps('abc')).toBeNull();
    expect(parseMarginBps('')).toBeNull();
  });

  it('reads a fixed price and the payment methods', () => {
    expect(parseFixedPrice('480,000.50')).toBe('480000.50');
    expect(parseFixedPrice('0')).toBeNull();
    expect(parseFixedPrice('1.2.3')).toBeNull();
    expect(parseMethods('bank-transfer, mercadopago, bank-transfer')).toEqual(['bank-transfer', 'mercadopago']);
    expect(parseMethods(' , ')).toBeNull();
    expect(parseMethods('a,b,c,d,e,f')).toBeNull();
    expect(parseMethods('x'.repeat(31))).toBeNull();
  });

  it('builds a valid market-price offer that names the oracle', () => {
    const built = build();
    if (!built.ok) throw new Error(JSON.stringify(built.errors));
    expect(() => validateOfferDocument(built.document)).not.toThrow();
    expect(built.document).toMatchObject({
      side: 'sell',
      asset: 'BCH',
      assetDecimals: 8,
      fiat: 'ARS',
      price: { type: 'floating', pair: 'BCH/ARS', marginBps: 250 },
      min: '100000',
      max: '2000000',
      paymentMethods: ['bank-transfer', 'mercadopago'],
      paymentWindowSec: 3600,
      expiresAt: 1_800_000_000 + 7 * 86_400,
      arbiter,
      oracle,
    });
    expect(JSON.parse(built.json)).toEqual(built.document);
  });

  it('leaves the oracle out of a fixed-price offer, which the protocol requires', () => {
    const built = build({ priceType: 'fixed', fixedPrice: '480000.5', fiat: 'USD' });
    if (!built.ok) throw new Error(JSON.stringify(built.errors));
    expect(built.document.price).toEqual({ type: 'fixed', value: '480000.5' });
    expect('oracle' in built.document).toBe(false);
  });

  it('says which field is wrong', () => {
    expect(build({ margin: '999' })).toMatchObject({ ok: false, errors: { margin: expect.any(String) } });
    expect(build({ priceType: 'fixed', fixedPrice: '' })).toMatchObject({ ok: false, errors: { fixedPrice: expect.any(String) } });
    expect(build({ min: String(MIN_TRADE_SATS - 1n) })).toMatchObject({ ok: false, errors: { min: expect.any(String) } });
    expect(build({ min: '500,000', max: '400,000' })).toMatchObject({ ok: false, errors: { max: expect.any(String) } });
    expect(build({ max: '' })).toMatchObject({ ok: false, errors: { max: expect.any(String) } });
    expect(build({ methods: '' })).toMatchObject({ ok: false, errors: { methods: expect.any(String) } });
    // Several mistakes are all reported together.
    const many = build({ margin: 'x', min: '1', methods: '' });
    expect(many.ok).toBe(false);
    if (!many.ok) expect(Object.keys(many.errors).sort()).toEqual(['margin', 'methods', 'min']);
  });

  it('summarises the margins of the open offers for the same coin and currency', () => {
    const offer = (fiat: string, price: unknown) => ({ document: { side: 'sell', asset: 'BCH', fiat, price } as never });
    const offers = [
      offer('ARS', { type: 'floating', pair: 'BCH/ARS', marginBps: 150 }),
      offer('ARS', { type: 'floating', pair: 'BCH/ARS', marginBps: 300 }),
      offer('ARS', { type: 'fixed', value: '1' }),
      offer('USD', { type: 'floating', pair: 'BCH/USD', marginBps: 900 }),
    ];
    expect(marginRange(offers, 'ARS')).toEqual({ low: 150, high: 300 });
    expect(marginRange(offers, 'EUR')).toBeNull();
  });
});

describe('the wallet coins and the publication transaction', () => {
  const keys = wallet('seller-web');
  const provider = new MockNetworkProvider();
  provider.network = Network.MAINNET;
  const address = (xpub: string, index: number, tokenAware = false) => pkhToCashAddress(derivePayoutPkhFromXpub(xpub, index), { tokenAware });

  it('finds coins on the receive and change paths and tags them for signing', async () => {
    provider.addUtxo(address(keys.receive, 0), { txid: '11'.repeat(32), vout: 0, satoshis: 5_000n });
    provider.addUtxo(address(keys.change, 3), { txid: '22'.repeat(32), vout: 1, satoshis: 7_000n });
    // A coin past the scanned reach is not seen: the scan is bounded.
    provider.addUtxo(address(keys.receive, 500), { txid: '33'.repeat(32), vout: 0, satoshis: 9_000n });

    const coins = await loadWalletCoins(provider, keys);
    const tagged = coins.map((c) => `${c.pathName}/${c.keyIndex}:${c.satoshis}`).sort();
    expect(tagged).toEqual(['change/3:7000', 'receive/0:5000']);
    expect(spendableBch(coins)).toBe(12_000n);
  });

  it('does not count token coins as plain BCH', async () => {
    const tokens = new MockNetworkProvider();
    tokens.network = Network.MAINNET;
    tokens.addUtxo(address(keys.receive, 1), { txid: '44'.repeat(32), vout: 0, satoshis: 1_000n, token: { amount: 50n, category: '55'.repeat(32) } });
    tokens.addUtxo(address(keys.receive, 2), { txid: '66'.repeat(32), vout: 0, satoshis: 2_000n });
    const coins = await loadWalletCoins(tokens, keys);
    expect(coins).toHaveLength(2);
    expect(spendableBch(coins)).toBe(2_000n);
  });

  it('builds a publication the service accepts: OP_RETURN, 1,000-sat marker on receive, change back', async () => {
    const coins = await loadWalletCoins(provider, keys);
    const built = build();
    if (!built.ok) throw new Error('form');
    const markerAddress = address(keys.receive, 9);
    const changeAddress = address(keys.change, 9);
    const tx = buildPublishOfferTransaction({ provider, document: built.document, offerJson: built.json, utxos: coins, markerAddress, changeAddress });

    // The inputs are the wallet's own coins, each with the path the wallet needs to sign it.
    expect(tx.inputPaths.length).toBeGreaterThan(0);
    for (const [, path] of tx.inputPaths) expect(['receive', 'change']).toContain(path);

    // What the service decodes from the transaction matches the offer JSON it is sent with.
    const outputs = (tx.builder as unknown as { outputs: { to: Uint8Array | string; amount: bigint }[] }).outputs;
    expect(outputs[0].amount).toBe(0n);
    expect(outputs[1].amount).toBe(1000n);
    const record = decodeOfferOpReturn(outputs[0].to as Uint8Array);
    expect(record.arbiterPk).toBe(arbiter);
    expect(() => verifyOfferAgainstOpReturn(built.json, outputs[0].to as Uint8Array)).not.toThrow();
  });
});

describe('closing an offer', () => {
  const keys = wallet('seller-close');
  const markerAddress = pkhToCashAddress(derivePayoutPkhFromXpub(keys.receive, 7));
  const offerTxid = 'ab'.repeat(32);

  function chain() {
    const p = new MockNetworkProvider();
    p.network = Network.MAINNET;
    p.addUtxo(markerAddress, { txid: offerTxid, vout: 1, satoshis: 1000n });
    return p;
  }

  it('spends the marker back to its own address with the path and index the wallet needs to sign it', async () => {
    const tx = await buildCloseOffer({ offer: { offerTxid, markerAddress, markerVout: 1 }, provider: chain(), receiveXpub: keys.receive });
    expect(tx.inputPaths).toEqual([[0, 'receive', 7]]);
    const outputs = (tx.builder as unknown as { outputs: { to: string; amount: bigint }[] }).outputs;
    expect(outputs).toHaveLength(1);
    expect(outputs[0].to).toBe(markerAddress);
    // The marker pays its own fee and leaves more than the dust limit.
    expect(outputs[0].amount).toBeGreaterThan(546n);
    expect(outputs[0].amount).toBeLessThan(1000n);
  });

  it('refuses a wallet that did not publish the offer, an offer without a marker and a marker already spent', async () => {
    const other = wallet('someone-else');
    await expect(buildCloseOffer({ offer: { offerTxid, markerAddress, markerVout: 1 }, provider: chain(), receiveXpub: other.receive })).rejects.toThrow(/does not belong/);
    await expect(buildCloseOffer({ offer: { offerTxid, markerAddress: undefined, markerVout: 1 }, provider: chain(), receiveXpub: keys.receive })).rejects.toThrow(/no marker/);
    const empty = new MockNetworkProvider();
    empty.network = Network.MAINNET;
    await expect(buildCloseOffer({ offer: { offerTxid, markerAddress, markerVout: 1 }, provider: empty, receiveXpub: keys.receive })).rejects.toThrow(/already spent/);
  });
});
