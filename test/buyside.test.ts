// The buy-offer side of the web app: the requests each party sends, the checks they make, and how the pages word
// each state. The server side is in test/buyoffers.test.ts.
import { binToHex, deriveHdPath, deriveHdPrivateNodeFromSeed, deriveHdPublicNode, encodeHdPublicKey, secp256k1, sha256, utf8ToBin } from '@bitauth/libauth';
import { MockNetworkProvider, Network, randomUtxo } from 'cashscript';
import { describe, expect, it } from 'vitest';
import { decryptPaymentDetails, verifyPaymentDetailsSignature } from '../src/protocol/crypto.js';
import { derivePayoutPkhFromXpub, pkhToCashAddress, verifyDerivedPayoutPkh, verifyDerivedPubkey } from '../src/protocol/keys.js';
import { signPriceQuote } from '../src/protocol/trades.js';
import type { Offer, OfferDocument, Trade } from '../src/web/api.js';
import { historyNote, nextStep } from '../src/web/mytrades.js';
import { buildCloseOffer, buildOfferDocument, marginRange, type OfferForm } from '../src/web/sell.js';
import { clearSavedDetails, loadSavedDetails, saveDetails, sealPaymentDetails } from '../src/web/seller.js';
import { buildBuyerAcceptBody, buildSellerTakeRequest, findStartedTrade, generateSessionKeyPair } from '../src/web/take.js';
import { checkBuyRequest, timeline } from '../src/web/trade.js';

function xpub(label: string, branch: number): string {
  const seed = new Uint8Array(64);
  seed.set(sha256.hash(utf8ToBin(label)), 0);
  const node = deriveHdPath(deriveHdPrivateNodeFromSeed(seed), `m/44'/145'/0'/${branch}`);
  if (typeof node === 'string') throw new Error(node);
  return encodeHdPublicKey({ network: 'mainnet', node: deriveHdPublicNode(node) }).hdPublicKey;
}
const pk = (label: string) => binToHex(secp256k1.derivePublicKeyCompressed(sha256.hash(utf8ToBin(label))) as Uint8Array);
const arbiter = pk('arbiter');
const oracleSk = sha256.hash(utf8ToBin('oracle'));
const oracle = pk('oracle');

const form: OfferForm = {
  side: 'buy',
  fiat: 'ARS',
  priceType: 'market',
  margin: '0.5',
  fixedPrice: '',
  min: '100,000',
  max: '2,000,000',
  methods: 'bank-transfer, simulated',
  paymentWindowSec: 3600,
  expirySec: 7 * 86_400,
};

describe('publishing a buy offer', () => {
  it('produces a buy document with the oracle and the pair of its coin and currency', () => {
    const built = buildOfferDocument({ form, arbiter, oracle, now: 1_800_000_000, maxExpirySec: 7 * 86_400 });
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    expect(built.document).toMatchObject({ side: 'buy', asset: 'BCH', fiat: 'ARS', price: { type: 'floating', pair: 'BCH/ARS', marginBps: 50 }, oracle });
    expect(built.document.paymentMethods).toEqual(['bank-transfer', 'simulated']);
  });

  it('never asks Campfire to pay for longer than it does', () => {
    const built = buildOfferDocument({ form: { ...form, expirySec: 30 * 86_400 }, arbiter, oracle, now: 1_800_000_000, maxExpirySec: 7 * 86_400 });
    expect(built.ok && built.document.expiresAt).toBe(1_800_000_000 + 7 * 86_400);
  });

  it('compares margins only with offers of the same side', () => {
    const doc = (side: 'sell' | 'buy', marginBps: number) => ({ document: { side, asset: 'BCH', fiat: 'ARS', price: { type: 'floating', pair: 'BCH/ARS', marginBps } } as OfferDocument });
    const offers = [doc('sell', 300), doc('buy', 50), doc('buy', 100)];
    expect(marginRange(offers, 'ARS', 'buy')).toEqual({ low: 50, high: 100 });
    expect(marginRange(offers, 'ARS')).toEqual({ low: 300, high: 300 });
  });
});

describe('the requests of a buy offer', () => {
  const defi = xpub('party', 7);
  const receive = xpub('party', 0);
  const session = generateSessionKeyPair();

  it('a seller takes it with keys that pass the service checks', () => {
    const body = buildSellerTakeRequest({ offerTxid: 'o', identity: 'me', amount: 250_000n, defiXpub: defi, receiveXpub: receive, defiIndex: 3, receiveIndex: 9, session });
    expect(body).toMatchObject({ offerTxid: 'o', sellerIdentity: 'me', amount: '250000', sellerDefiIndex: 3, sellerReceiveIndex: 9, sellerSessionPk: session.publicKey });
    expect(verifyDerivedPubkey(defi, 3, body.sellerPk)).toBe(true);
    expect(verifyDerivedPayoutPkh(receive, 9, body.sellerPayoutPkh)).toBe(true);
  });

  it('the buyer accepts with their keys only', () => {
    const body = buildBuyerAcceptBody({ identity: 'me', defiXpub: defi, receiveXpub: receive, defiIndex: 1, receiveIndex: 2, session });
    expect(Object.keys(body).sort()).toEqual(['buyerDefiIndex', 'buyerIdentity', 'buyerPayoutPkh', 'buyerPk', 'buyerReceiveIndex', 'buyerSessionPk']);
    expect(verifyDerivedPubkey(defi, 1, body.buyerPk)).toBe(true);
  });

  it('finds a lost request by the seller session key too', () => {
    const t = { id: 'x', status: 'Requested', offerTxid: 'o', buyerIdentity: 'b', sellerIdentity: 's', sellerSessionPk: session.publicKey } as const;
    expect(findStartedTrade([t], session.publicKey)?.id).toBe('x');
  });
});

describe("the buyer's check before accepting", () => {
  const quote = signPriceQuote(oracleSk, { pair: 'BCH/ARS', price: '500000.00', timestamp: 1_800_000_000 });
  const offer = { side: 'buy', arbiter, oracle, price: { type: 'floating', pair: 'BCH/ARS', marginBps: 50 }, min: '100000', max: '2000000' } as const;
  const request: Trade = {
    id: 'r',
    side: 'buy',
    status: 'Requested',
    offerTxid: 'o',
    buyerIdentity: 'b',
    sellerIdentity: 's',
    asset: 'BCH',
    assetDecimals: 8,
    amount: '200000',
    fiat: 'ARS',
    fiatAmount: '1005.00',
    quote,
    marginBps: 50,
    oraclePk: oracle,
    arbiterPk: arbiter,
    createdAt: 1,
    updatedAt: 1,
  };

  it('accepts a request that matches the offer', () => {
    expect(checkBuyRequest(request, offer)).toBeNull();
  });

  it('stops on a wrong amount, arbiter, signature or fiat amount', () => {
    expect(checkBuyRequest({ ...request, amount: '50' }, offer)).toMatch(/range/);
    expect(checkBuyRequest({ ...request, arbiterPk: pk('other') }, offer)).toMatch(/arbiter/);
    expect(checkBuyRequest({ ...request, quote: { ...quote, price: '400000.00' } }, offer)).toMatch(/not signed/);
    expect(checkBuyRequest({ ...request, fiatAmount: '2000.00' }, offer)).toMatch(/does not match/);
    expect(checkBuyRequest({ ...request, quote: undefined }, offer)).toMatch(/no signed price/);
  });
});

describe('sealed payment details', () => {
  it('are encrypted for the buyer and signed by the seller session key', async () => {
    const seller = generateSessionKeyPair();
    const buyer = generateSessionKeyPair();
    const tradeId = 'ab'.repeat(32);
    const sealed = await sealPaymentDetails({ sessionPrivateKey: seller.privateKey, buyerSessionPk: buyer.publicKey, tradeId, details: '  CBU 123  ' });
    expect(await decryptPaymentDetails(buyer.privateKey, seller.publicKey, sealed.encryptedPaymentDetails)).toBe('CBU 123');
    expect(verifyPaymentDetailsSignature(seller.publicKey, tradeId, sealed.encryptedPaymentDetails, sealed.paymentDetailsSignature)).toBe(true);
    expect(verifyPaymentDetailsSignature(buyer.publicKey, tradeId, sealed.encryptedPaymentDetails, sealed.paymentDetailsSignature)).toBe(false);
    await expect(sealPaymentDetails({ sessionPrivateKey: seller.privateKey, buyerSessionPk: buyer.publicKey, tradeId, details: ' ' })).rejects.toThrow(/Write how/);
  });

  it('are kept for a deposit recorded after a reload', () => {
    const map = new Map<string, string>();
    const store = { getItem: (k: string) => map.get(k) ?? null, setItem: (k: string, v: string) => void map.set(k, v), removeItem: (k: string) => void map.delete(k) };
    const sealed = { encryptedPaymentDetails: 'a:b', paymentDetailsSignature: 'cd' };
    saveDetails(store, 't', sealed);
    expect(loadSavedDetails(store, 't')).toEqual(sealed);
    clearSavedDetails(store, 't');
    expect(loadSavedDetails(store, 't')).toBeNull();
  });
});

describe('how a buy trade reads', () => {
  const t = (patch: Partial<Trade>): Trade =>
    ({ id: 'r', side: 'buy', status: 'Requested', offerTxid: 'o', buyerIdentity: 'b', sellerIdentity: 's', asset: 'BCH', assetDecimals: 8, amount: '250000', fiat: 'ARS', fiatAmount: '1210.47', arbiterPk: arbiter, createdAt: 1000, updatedAt: 1000, quoteExpiresAt: 1600, ...patch }) as Trade;
  const steps = (trade: Trade, role: 'buyer' | 'seller') => timeline(trade, role, '250,000 sats').map((s) => `${s.state}:${s.title}`);

  it('puts the buyer first while the request waits', () => {
    expect(nextStep(t({}), 'buyer', 1100)).toMatchObject({ step: 'Accept or decline the request', turn: true, deadline: 1600 });
    expect(nextStep(t({}), 'seller', 1100)).toMatchObject({ step: 'Waiting for the buyer to accept', turn: false });
    expect(steps(t({}), 'buyer').slice(0, 2)).toEqual(['done:A seller answered your offer', 'current:You accept, then the seller locks the coins']);
    expect(steps(t({}), 'seller').slice(0, 2)).toEqual(['done:You answered the buyer’s offer', 'current:Buyer accepts, then you lock the coins']);
  });

  it('then the seller locks the coins', () => {
    const accepted = t({ status: 'Accepted', fundingDeadline: 3000 });
    expect(steps(accepted, 'seller')[1]).toBe('current:Buyer accepted. You lock the coins');
    expect(steps(accepted, 'buyer').slice(1, 3)).toEqual(['done:You accepted', 'current:Seller locks the coins']);
    expect(nextStep(accepted, 'seller', 1300)).toMatchObject({ turn: true });
  });

  it('says why a dropped request ended', () => {
    expect(steps(t({ status: 'Dropped' }), 'buyer')[1]).toBe('failed:You did not accept the request');
    expect(steps(t({ status: 'Dropped', fundingDeadline: 3000 }), 'buyer')[1]).toBe('failed:The seller did not lock the coins in time');
    expect(historyNote(t({ status: 'Dropped', updatedAt: 1_794_900_000 }), 'seller')).toMatch(/not accepted in time$/);
    expect(historyNote(t({ status: 'Dropped', fundingDeadline: 3000, updatedAt: 1_794_900_000 }), 'buyer')).toMatch(/not funded in time$/);
  });
});

describe('closing an offer whose marker is far into the wallet', () => {
  it('uses the index the service recorded instead of searching', async () => {
    const receive = xpub('closer', 0);
    const address = pkhToCashAddress(derivePayoutPkhFromXpub(receive, 5_000));
    const provider = new MockNetworkProvider();
    provider.network = Network.MAINNET;
    const utxo = provider.addUtxo(address, randomUtxo({ satoshis: 1000n }));
    const offer: Pick<Offer, 'offerTxid' | 'markerAddress' | 'markerVout' | 'markerReceiveIndex'> = {
      offerTxid: utxo.txid,
      markerAddress: address,
      markerVout: utxo.vout,
      markerReceiveIndex: 5_000,
    };
    const tx = await buildCloseOffer({ offer, provider, receiveXpub: receive });
    expect(tx.inputPaths[0]).toEqual([0, 'receive', 5_000]);
    // Without the recorded index the search stops long before it.
    await expect(buildCloseOffer({ offer: { ...offer, markerReceiveIndex: undefined }, provider, receiveXpub: receive })).rejects.toThrow(/does not belong/);
  });
});
