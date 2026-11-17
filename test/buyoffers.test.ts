import { describe, expect, it } from 'vitest';
import { MockNetworkProvider, Network, SignatureTemplate, TransactionBuilder, randomUtxo } from 'cashscript';
import {
  binToHex,
  deriveHdPath,
  deriveHdPrivateNodeChild,
  deriveHdPrivateNodeFromSeed,
  deriveHdPublicNode,
  encodeHdPublicKey,
  sha256,
  utf8ToBin,
} from '@bitauth/libauth';
import {
  BCH_ASSET,
  BCH_DECIMALS,
  buildFundEscrowTransaction,
  buildReleaseRequest,
  createEscrowContract,
  decryptPaymentDetails,
  derivePayoutPkhFromXpub,
  derivePubkeyFromXpub,
  deriveWalletAddressMap,
  encryptPaymentDetails,
  generateSessionKeyPair,
  pkhToCashAddress,
  pkhToLockingBytecode,
  signChatMessage,
  signPaymentDetails,
  tagWalletUtxos,
  type OfferDocument,
} from '../src/protocol/index.js';
import {
  CampfireService,
  DemoSeller,
  MemoryStorage,
  OracleService,
  StaticPriceFeed,
  createApiHandler,
  deriveDemoSellerWallet,
  type SponsorshipLimits,
  type StoredOffer,
  type StoredTrade,
} from '../src/server/index.js';

function makeWallet(label: string) {
  const seed = new Uint8Array(64);
  seed.set(sha256.hash(utf8ToBin(label)), 0);
  const master = deriveHdPrivateNodeFromSeed(seed);
  const receiveNode = deriveHdPath(master, "m/44'/145'/0'/0");
  const defiNode = deriveHdPath(master, "m/44'/145'/0'/7");
  if (typeof receiveNode === 'string' || typeof defiNode === 'string') throw new Error('HD derivation failed');
  const receiveXpub = encodeHdPublicKey({ network: 'mainnet', node: deriveHdPublicNode(receiveNode) }).hdPublicKey;
  const defiXpub = encodeHdPublicKey({ network: 'mainnet', node: deriveHdPublicNode(defiNode) }).hdPublicKey;
  const childPriv = (branch: typeof receiveNode, index: number) => {
    const c = deriveHdPrivateNodeChild(branch, index);
    if (typeof c === 'string') throw new Error(c);
    return c.privateKey;
  };
  return {
    receiveXpub,
    defiXpub,
    defiPriv: (i: number) => childPriv(defiNode, i),
    receivePriv: (i: number) => childPriv(receiveNode, i),
    defiPkHex: (i: number) => binToHex(derivePubkeyFromXpub(defiXpub, i)),
    receivePkhHex: (i: number) => binToHex(derivePayoutPkhFromXpub(receiveXpub, i)),
    receiveAddr: (i: number) => pkhToCashAddress(derivePayoutPkhFromXpub(receiveXpub, i)),
  };
}

const buyer = makeWallet('buyoffer-buyer');
const buyer2 = makeWallet('buyoffer-buyer-2');
const seller = makeWallet('buyoffer-seller');
const botWallet = deriveDemoSellerWallet(sha256.hash(utf8ToBin('buyoffer-bot-seed')));
const ADMIN_TOKEN = 'buyoffer-admin';

async function setup(options?: { limits?: Partial<SponsorshipLimits>; botSats?: bigint; withBot?: boolean }) {
  let now = 1_794_900_000;
  const nowSeconds = () => now;
  const provider = new MockNetworkProvider();
  provider.network = Network.MAINNET;
  const oracle = new OracleService({
    privateKey: sha256.hash(utf8ToBin('buyoffer-oracle')),
    feed: new StaticPriceFeed({ 'BCH/USD': '450.00', 'BCH/ARS': '500000.00' }),
    nowSeconds,
  });
  const service = new CampfireService({
    storage: new MemoryStorage(),
    provider,
    oracle,
    arbiterPrivateKey: sha256.hash(utf8ToBin('buyoffer-arbiter')),
    nowSeconds,
    demoSellerIdentity: botWallet.identity,
    fundingLookupDelayMs: 0,
    sponsorshipLimits: options?.limits,
  });
  const demo =
    options?.withBot === false
      ? undefined
      : new DemoSeller({ service, provider, wallet: botWallet, nowSeconds, indexPollMs: 0 });
  await demo?.init();
  provider.addUtxo(botWallet.receiveAddress(0), randomUtxo({ satoshis: options?.botSats ?? 500_000n }));
  const api = createApiHandler({ service, oracle, demo, adminToken: ADMIN_TOKEN });

  const req = async <T = any>(method: string, path: string, body?: unknown): Promise<{ status: number; data: T }> => {
    const res = await api(
      new Request(`http://localhost${path}`, {
        method,
        headers: body ? { 'content-type': 'application/json' } : {},
        body: body ? JSON.stringify(body) : undefined,
      }),
    );
    return { status: res.status, data: (await res.json()) as T };
  };

  const register = async (w: ReturnType<typeof makeWallet>): Promise<string> =>
    (await req('POST', '/api/identities', { defiXpub: w.defiXpub, receiveXpub: w.receiveXpub })).data.identity;
  const cfg = (await req('GET', '/api/config')).data;

  const buyOffer = (overrides: Partial<OfferDocument> = {}): OfferDocument => ({
    v: 1,
    side: 'buy',
    asset: BCH_ASSET,
    assetDecimals: BCH_DECIMALS,
    fiat: 'ARS',
    price: { type: 'floating', pair: 'BCH/ARS', marginBps: 50 },
    min: '100000',
    max: '1000000',
    paymentMethods: ['bank-transfer'],
    paymentWindowSec: 3600,
    expiresAt: now + 86_400,
    arbiter: cfg.arbiterPk,
    oracle: cfg.oraclePk,
    ...overrides,
  });
  const publish = (identity: string, doc: OfferDocument, markerReceiveIndex = 0) =>
    req<{ offer: StoredOffer; trade: StoredTrade | null; error?: string }>('POST', '/api/offers/sponsored', {
      buyerIdentity: identity,
      offerJson: JSON.stringify(doc),
      markerReceiveIndex,
    });

  return { provider, service, req, register, buyOffer, publish, advance: (s: number) => (now += s), now: () => now };
}

type Ctx = Awaited<ReturnType<typeof setup>>;

const sellerKeys = (index: number, session = generateSessionKeyPair()) => ({
  sellerPk: seller.defiPkHex(index),
  sellerDefiIndex: index,
  sellerPayoutPkh: seller.receivePkhHex(index),
  sellerReceiveIndex: index,
  sellerSessionPk: session.publicKey,
});
const buyerKeys = (w: typeof buyer, index: number, session = generateSessionKeyPair()) => ({
  buyerPk: w.defiPkHex(index),
  buyerDefiIndex: index,
  buyerPayoutPkh: w.receivePkhHex(index),
  buyerReceiveIndex: index,
  buyerSessionPk: session.publicKey,
});

// A seller takes the offer for `amount`, and the buyer who published it accepts.
async function takeAndAccept(ctx: Ctx, offerTxid: string, buyerId: string, sellerId: string, amount = '200000') {
  const sellerSession = generateSessionKeyPair();
  const buyerSession = generateSessionKeyPair();
  const taken = await ctx.req<{ trade: StoredTrade }>('POST', '/api/trades', {
    offerTxid,
    amount,
    sellerIdentity: sellerId,
    ...sellerKeys(0, sellerSession),
  });
  const accepted = await ctx.req<{ trade: StoredTrade }>('POST', `/api/trades/${taken.data.trade.id}/accept`, {
    buyerIdentity: buyerId,
    ...buyerKeys(buyer, 0, buyerSession),
  });
  return { taken, accepted, sellerSession, buyerSession };
}

describe('Buy offers published and paid for by the service', () => {
  it('goes through the whole path: publish, take, accept, deposit with details, pay, release', async () => {
    const ctx = await setup();
    const buyerId = await ctx.register(buyer);
    const sellerId = await ctx.register(seller);

    const published = await ctx.publish(buyerId, ctx.buyOffer());
    expect(published.status).toBe(201);
    expect(published.data.trade).toBeNull();
    const offer = published.data.offer;
    expect(offer.document.side).toBe('buy');
    expect(offer.sellerIdentity).toBe(buyerId); // the publisher
    expect(offer.isDemo).toBeFalsy();
    // The marker went to a fresh address of the buyer, so the buyer can close the offer alone.
    expect(offer.markerAddress).toBe(buyer.receiveAddr(0));
    const marker = (await ctx.provider.getUtxos(buyer.receiveAddr(0)))[0];
    expect(marker.satoshis).toBe(1000n);
    expect(marker.txid).toBe(offer.offerTxid);

    const listed = await ctx.req('GET', '/api/offers?onlyOpen=true');
    expect(listed.data.offers.map((o: StoredOffer) => o.offerTxid)).toContain(offer.offerTxid);

    // The seller takes it for 200,000 sats: the request carries the seller's keys and the buyer is the publisher.
    const sellerSession = generateSessionKeyPair();
    const buyerSession = generateSessionKeyPair();
    const taken = await ctx.req<{ trade: StoredTrade }>('POST', '/api/trades', {
      offerTxid: offer.offerTxid,
      amount: '200000',
      sellerIdentity: sellerId,
      ...sellerKeys(0, sellerSession),
    });
    expect(taken.status).toBe(201);
    const trade = taken.data.trade;
    expect(trade).toMatchObject({ status: 'Requested', side: 'buy', buyerIdentity: buyerId, sellerIdentity: sellerId });
    expect(trade.fiatAmount).toBe('1005.00'); // 0.002 BCH at 500,000 ARS + 0.5%
    expect(trade.buyerPk).toBeUndefined();
    expect(trade.isDemo).toBeFalsy();

    // Both parties find it under their own identity.
    for (const id of [buyerId, sellerId]) {
      const mine = await ctx.req('GET', `/api/trades?identity=${id}`);
      expect(mine.data.trades.map((t: StoredTrade) => t.id)).toContain(trade.id);
    }

    // Only the buyer who published the offer accepts, with their own keys and no signature.
    const bySeller = await ctx.req('POST', `/api/trades/${trade.id}/accept`, {
      buyerIdentity: sellerId,
      ...buyerKeys(seller, 5),
    });
    expect(bySeller.status).toBe(400);
    expect(bySeller.data.error).toMatch(/Only the buyer who published this offer/);
    const accepted = await ctx.req<{ trade: StoredTrade }>('POST', `/api/trades/${trade.id}/accept`, {
      buyerIdentity: buyerId,
      ...buyerKeys(buyer, 0, buyerSession),
    });
    expect(accepted.status).toBe(200);
    const acceptedTrade = accepted.data.trade;
    expect(acceptedTrade.status).toBe('Accepted');
    expect(acceptedTrade.terms).toMatchObject({
      sellerPk: seller.defiPkHex(0),
      buyerPk: buyer.defiPkHex(0),
      sellerSessionPk: sellerSession.publicKey,
      buyerSessionPk: buyerSession.publicKey,
    });
    expect(acceptedTrade.encryptedPaymentDetails).toBeUndefined();

    // The seller builds the deposit with their wallet.
    const contract = createEscrowContract(acceptedTrade.terms!, acceptedTrade.tradeId!, ctx.provider);
    const sellerMap = deriveWalletAddressMap({ receiveXpub: seller.receiveXpub, count: 5 });
    const funds = ctx.provider.addUtxo(seller.receiveAddr(1), randomUtxo({ satoshis: 600_000n }));
    const fundTx = buildFundEscrowTransaction({
      contract,
      terms: acceptedTrade.terms!,
      utxos: tagWalletUtxos([funds], sellerMap).map((u) => ({ ...u, signer: new SignatureTemplate(seller.receivePriv(u.keyIndex)) })),
      changeAddress: seller.receiveAddr(1),
    });

    // Without the details, or with details the seller did not sign, nothing is broadcast.
    const details = await encryptPaymentDetails(sellerSession.privateKey, buyerSession.publicKey, 'CBU 0000003100012345678901');
    const noDetails = await ctx.req('POST', `/api/trades/${trade.id}/funding`, { fundingTxHex: fundTx.hex });
    expect(noDetails.status).toBe(400);
    expect(noDetails.data.error).toMatch(/must send the encrypted payment details/);
    const unsigned = await ctx.req('POST', `/api/trades/${trade.id}/funding`, { fundingTxHex: fundTx.hex, encryptedPaymentDetails: details });
    expect(unsigned.status).toBe(400);
    expect(unsigned.data.error).toMatch(/signed with the seller's session key/);
    // The buyer shares the ECDH key, so they could encrypt an account of their own; they cannot sign as the seller.
    const forged = await encryptPaymentDetails(buyerSession.privateKey, sellerSession.publicKey, 'CBU of the buyer');
    expect(await decryptPaymentDetails(buyerSession.privateKey, sellerSession.publicKey, forged)).toBe('CBU of the buyer');
    const byBuyer = await ctx.req('POST', `/api/trades/${trade.id}/funding`, {
      fundingTxHex: fundTx.hex,
      encryptedPaymentDetails: forged,
      paymentDetailsSignature: signPaymentDetails(buyerSession.privateKey, acceptedTrade.tradeId!, forged),
    });
    expect(byBuyer.status).toBe(400);
    expect(await contract.getUtxos()).toHaveLength(0);

    const funded = await ctx.req<{ trade: StoredTrade }>('POST', `/api/trades/${trade.id}/funding`, {
      fundingTxHex: fundTx.hex,
      encryptedPaymentDetails: details,
      paymentDetailsSignature: signPaymentDetails(sellerSession.privateKey, acceptedTrade.tradeId!, details),
    });
    expect(funded.status).toBe(200);
    expect(funded.data.trade.status).toBe('Funded');
    // Once funded, the buyer still cannot swap the details.
    const swap = await ctx.req('POST', `/api/trades/${trade.id}/funding`, {
      encryptedPaymentDetails: forged,
      paymentDetailsSignature: signPaymentDetails(buyerSession.privateKey, acceptedTrade.tradeId!, forged),
    });
    expect(swap.status).toBe(400);
    expect(await decryptPaymentDetails(buyerSession.privateKey, sellerSession.publicKey, funded.data.trade.encryptedPaymentDetails!)).toBe(
      'CBU 0000003100012345678901',
    );

    const paid = await ctx.req<{ trade: StoredTrade }>('POST', `/api/trades/${trade.id}/paid`, { buyerIdentity: buyerId });
    expect(paid.data.trade.status).toBe('Paid');

    const escrow = (await contract.getUtxos())[0];
    const { fee } = buildReleaseRequest({ contract, utxo: escrow, buyerPayoutPkh: acceptedTrade.terms!.buyerPayoutPkh, sellerDefiIndex: 0 });
    const signedReleaseHex = new TransactionBuilder({ provider: ctx.provider })
      .addInput(escrow, contract.unlock.release(new SignatureTemplate(seller.defiPriv(0))))
      .addOutput({ to: pkhToLockingBytecode(acceptedTrade.terms!.buyerPayoutPkh), amount: escrow.satoshis - fee })
      .build();
    const released = await ctx.req<{ trade: StoredTrade }>('POST', `/api/trades/${trade.id}/settle`, { path: 'release', signedTxHex: signedReleaseHex });
    expect(released.data.trade.status).toBe('Released');
    expect((await ctx.provider.getUtxos(buyer.receiveAddr(0))).some((u) => u.satoshis >= 200_000n)).toBe(true);

    expect((await ctx.req('GET', `/api/identities/${buyerId}/reputation`)).data.completedAsBuyer).toBe(1);
    expect((await ctx.req('GET', `/api/identities/${sellerId}/reputation`)).data.completedAsSeller).toBe(1);
  });

  it('keeps sell and buy offers apart: each is taken and accepted by the right side only', async () => {
    const ctx = await setup();
    const buyerId = await ctx.register(buyer);
    const sellerId = await ctx.register(seller);
    const offer = (await ctx.publish(buyerId, ctx.buyOffer())).data.offer;

    // A buyer cannot take a buy offer: the buyer's route is for sell offers.
    await expect(
      ctx.service.requestTrade({ offerTxid: offer.offerTxid, amount: '200000', buyerIdentity: sellerId, ...buyerKeys(seller, 0) }),
    ).rejects.toThrow(/buy offer/);

    const taken = await ctx.req<{ trade: StoredTrade }>('POST', '/api/trades', { offerTxid: offer.offerTxid, amount: '200000', sellerIdentity: sellerId, ...sellerKeys(0) });
    // The seller who took the request cannot accept it for the buyer.
    const viaSellerRoute = await ctx.req('POST', `/api/trades/${taken.data.trade.id}/accept`, {
      sellerIdentity: sellerId,
      ...sellerKeys(1),
      encryptedPaymentDetails: 'x:y',
    });
    expect(viaSellerRoute.status).toBe(400);
    // The amount is chosen by the seller within the offer's range.
    const outOfRange = await ctx.req('POST', '/api/trades', { offerTxid: offer.offerTxid, amount: '50', sellerIdentity: sellerId, ...sellerKeys(2) });
    expect(outOfRange.status).toBe(400);
    expect(outOfRange.data.error).toMatch(/outside offer range/);
  });

  it('lets only the buyer who published the offer decline a request', async () => {
    const ctx = await setup();
    const buyerId = await ctx.register(buyer);
    const sellerId = await ctx.register(seller);
    const offer = (await ctx.publish(buyerId, ctx.buyOffer())).data.offer;
    const request = async () =>
      (await ctx.req<{ trade: StoredTrade }>('POST', '/api/trades', { offerTxid: offer.offerTxid, amount: '200000', sellerIdentity: sellerId, ...sellerKeys(0) })).data.trade;

    const first = await request();
    const bySeller = await ctx.req('POST', `/api/trades/${first.id}/decline`, { sellerIdentity: sellerId });
    expect(bySeller.status).toBe(400);
    expect(bySeller.data.error).toMatch(/Only the buyer who published/);
    const byBuyer = await ctx.req<{ trade: StoredTrade }>('POST', `/api/trades/${first.id}/decline`, { buyerIdentity: buyerId });
    expect(byBuyer.data.trade.status).toBe('Dropped');

    // An unanswered request lapses with its 10-minute quote, so the buyer must accept in time.
    const second = await request();
    ctx.advance(601);
    const late = await ctx.req('POST', `/api/trades/${second.id}/accept`, { buyerIdentity: buyerId, ...buyerKeys(buyer, 0) });
    expect(late.status).toBe(400);
    expect(late.data.error).toMatch(/state "Dropped"/);
  });

  it('keeps client-signed publication for sell offers only', async () => {
    const ctx = await setup();
    const buyerId = await ctx.register(buyer);
    const doc = ctx.buyOffer();
    // A buy offer built and signed by the buyer would skip the limits the service applies to paid ones.
    const res = await ctx.req('POST', '/api/offers', {
      sellerIdentity: buyerId,
      offerJson: JSON.stringify(doc),
      offerTxHex: '00',
      markerReceiveIndex: 0,
    });
    expect(res.status).toBe(400);
  });
});

describe('Limits on offers the service pays for', () => {
  it('stops at the daily limit across identities, tells when a slot frees up, and counts only paid offers', async () => {
    const ctx = await setup({ limits: { dailyOffers: 2, openOffersPerIdentity: 5 } });
    const a = await ctx.register(buyer);
    const b = await ctx.register(buyer2);

    expect((await ctx.req('GET', '/api/offers/sponsored')).data).toMatchObject({ enabled: true, dailyOffers: 2, remainingToday: 2, nextSlotAt: null });
    expect((await ctx.publish(a, ctx.buyOffer(), 0)).status).toBe(201);
    ctx.advance(60);
    expect((await ctx.publish(b, ctx.buyOffer(), 0)).status).toBe(201);
    const third = await ctx.publish(a, ctx.buyOffer(), 1);
    expect(third.status).toBe(429);
    expect(third.data.error).toMatch(/Today's free offers are used up/);
    const status = (await ctx.req('GET', `/api/offers/sponsored?identity=${a}`)).data;
    expect(status).toMatchObject({ usedToday: 2, remainingToday: 0, openNow: 1, nextSlotAt: 1_794_900_000 + 86_400 });

    // The first publication leaves the 24-hour window, and its slot is free again.
    ctx.advance(86_400 - 60 + 1);
    expect((await ctx.publish(a, ctx.buyOffer(), 1)).status).toBe(201);
  });

  it('allows a few open offers per identity, and a closed or expired one frees its place', async () => {
    const ctx = await setup({ limits: { openOffersPerIdentity: 2 } });
    const a = await ctx.register(buyer);
    expect((await ctx.publish(a, ctx.buyOffer(), 0)).status).toBe(201);
    expect((await ctx.publish(a, ctx.buyOffer({ expiresAt: ctx.now() + 3600 }), 1)).status).toBe(201);
    const over = await ctx.publish(a, ctx.buyOffer(), 2);
    expect(over.status).toBe(429);
    expect(over.data.error).toMatch(/already have 2 open offers/);
    // The short one expires.
    ctx.advance(3601);
    expect((await ctx.publish(a, ctx.buyOffer({ expiresAt: ctx.now() + 3600 }), 2)).status).toBe(201);
  });

  it('refuses an expiry beyond 7 days, a sell offer, and a marker that is not the buyer\'s', async () => {
    const ctx = await setup();
    const a = await ctx.register(buyer);
    const tooLong = await ctx.publish(a, ctx.buyOffer({ expiresAt: ctx.now() + 8 * 86_400 }));
    expect(tooLong.status).toBe(400);
    expect(tooLong.data.error).toMatch(/7 days at most/);
    expect((await ctx.publish(a, ctx.buyOffer({ expiresAt: ctx.now() + 7 * 86_400 }))).status).toBe(201);

    const sell = await ctx.publish(a, ctx.buyOffer({ side: 'sell' }), 1);
    expect(sell.status).toBe(400);
    expect(sell.data.error).toMatch(/only pays for buy offers/);

    const unknown = await ctx.publish('f'.repeat(64), ctx.buyOffer(), 1);
    expect(unknown.status).toBe(400);
    expect(unknown.data.error).toMatch(/not registered/);
    // Nothing was spent on the refused ones: one publication so far.
    expect((await ctx.req('GET', '/api/offers/sponsored')).data.usedToday).toBe(1);
  });

  it('pays only for offers it can serve: its arbiter, its oracle and a pair the oracle signs', async () => {
    const ctx = await setup();
    const a = await ctx.register(buyer);
    const other = seller.defiPkHex(9); // a valid key that is not Campfire's
    const foreignArbiter = await ctx.publish(a, ctx.buyOffer({ arbiter: other }));
    expect(foreignArbiter.data.error).toMatch(/Campfire arbiter/);
    const foreignOracle = await ctx.publish(a, ctx.buyOffer({ oracle: other }));
    expect(foreignOracle.data.error).toMatch(/Campfire price oracle/);
    const wrongPair = await ctx.publish(a, ctx.buyOffer({ price: { type: 'floating', pair: 'BCH/USD', marginBps: 0 } }));
    expect(wrongPair.data.error).toMatch(/pair BCH\/ARS/);
    const unsigned = await ctx.publish(a, ctx.buyOffer({ fiat: 'EUR', price: { type: 'floating', pair: 'BCH/EUR', marginBps: 0 } }));
    expect(unsigned.status).toBe(400);
    expect((await ctx.req('GET', '/api/offers/sponsored')).data.usedToday).toBe(0);
  });

  it('says so when the service has no money to pay with, and when it is not enabled at all', async () => {
    const poor = await setup({ botSats: 1_000n });
    const a = await poor.register(buyer);
    const res = await poor.publish(a, poor.buyOffer());
    expect(res.status).toBe(429);
    expect(res.data.error).toMatch(/cannot pay for new offers/);

    const off = await setup({ withBot: false });
    const b = await off.register(buyer);
    expect((await off.publish(b, off.buyOffer())).status).toBe(404);
    expect((await off.req('GET', '/api/offers/sponsored')).data).toEqual({ enabled: false });
  });
});

describe('Chat on a buy offer', () => {
  it('opens once both session keys are in the terms, and takes only messages signed by the sender', async () => {
    const ctx = await setup();
    const buyerId = await ctx.register(buyer);
    const sellerId = await ctx.register(seller);
    const offer = (await ctx.publish(buyerId, ctx.buyOffer())).data.offer;
    const { taken, accepted, sellerSession } = await takeAndAccept(ctx, offer.offerTxid, buyerId, sellerId);
    expect(accepted.data.trade.status).toBe('Accepted');

    const badSignature = await ctx.req('POST', `/api/trades/${taken.data.trade.id}/chat`, { senderIdentity: sellerId, ciphertext: 'aa:bb', signature: '00'.repeat(64) });
    expect(badSignature.status).toBe(400);
    const tradeId = accepted.data.trade.tradeId!;
    const ok = await ctx.req('POST', `/api/trades/${taken.data.trade.id}/chat`, {
      senderIdentity: sellerId,
      ciphertext: 'aa:bb',
      signature: signChatMessage(sellerSession.privateKey, tradeId, 'aa:bb'),
    });
    expect(ok.status).toBe(201);
    expect(ok.data.message.senderRole).toBe('seller');
  });

  it('is closed while the request waits for the buyer', async () => {
    const ctx = await setup();
    const buyerId = await ctx.register(buyer);
    const sellerId = await ctx.register(seller);
    const offer = (await ctx.publish(buyerId, ctx.buyOffer())).data.offer;
    const trade = (await ctx.req<{ trade: StoredTrade }>('POST', '/api/trades', { offerTxid: offer.offerTxid, amount: '200000', sellerIdentity: sellerId, ...sellerKeys(0) })).data.trade;
    const res = await ctx.req('POST', `/api/trades/${trade.id}/chat`, { senderIdentity: sellerId, ciphertext: 'aa:bb', signature: '00'.repeat(64) });
    expect(res.status).toBe(400);
    expect(res.data.error).toMatch(/opens once the trade is accepted/);
  });
});

describe('Refund time chosen by the party who accepts', () => {
  it('must fall between 7 and 30 days after acceptance', async () => {
    const ctx = await setup();
    const buyerId = await ctx.register(buyer);
    const sellerId = await ctx.register(seller);
    const offer = (await ctx.publish(buyerId, ctx.buyOffer())).data.offer;
    const trade = (await ctx.req<{ trade: StoredTrade }>('POST', '/api/trades', { offerTxid: offer.offerTxid, amount: '200000', sellerIdentity: sellerId, ...sellerKeys(0) })).data.trade;
    for (const refundTime of [ctx.now() + 3600, ctx.now() + 31 * 86_400]) {
      const res = await ctx.req('POST', `/api/trades/${trade.id}/accept`, { buyerIdentity: buyerId, ...buyerKeys(buyer, 0), refundTime });
      expect(res.status).toBe(400);
      expect(res.data.error).toMatch(/between 7 and 30 days/);
    }
    const ok = await ctx.req<{ trade: StoredTrade }>('POST', `/api/trades/${trade.id}/accept`, { buyerIdentity: buyerId, ...buyerKeys(buyer, 0), refundTime: ctx.now() + 10 * 86_400 });
    expect(ok.data.trade.terms?.refundTime).toBe(ctx.now() + 10 * 86_400);
  });
});

describe('The demo seller and buy offers', () => {
  it('takes an offer that names the simulated payment, deposits once the buyer accepts, and releases', async () => {
    const ctx = await setup();
    const buyerId = await ctx.register(buyer);
    const published = await ctx.publish(buyerId, ctx.buyOffer({ paymentMethods: ['simulated'], fiat: 'USD', price: { type: 'floating', pair: 'BCH/USD', marginBps: 0 }, min: '5000', max: '50000' }));
    expect(published.status).toBe(201);
    const request = published.data.trade!;
    // The smallest amount the bot sells, with itself as the seller and the demo flag set by the service.
    expect(request).toMatchObject({ status: 'Requested', side: 'buy', amount: '5000', buyerIdentity: buyerId, sellerIdentity: botWallet.identity, isDemo: true });

    // Nothing is deposited until the buyer accepts: reading the trade does not move it.
    expect((await ctx.req<{ trade: StoredTrade }>('GET', `/api/trades/${request.id}`)).data.trade.status).toBe('Requested');

    const buyerSession = generateSessionKeyPair();
    const accepted = await ctx.req<{ trade: StoredTrade }>('POST', `/api/trades/${request.id}/accept`, { buyerIdentity: buyerId, ...buyerKeys(buyer, 0, buyerSession) });
    expect(accepted.status).toBe(200);
    // The bot deposits a real escrow within the same request and sends its simulated details with it.
    expect(accepted.data.trade.status).toBe('Funded');
    const details = JSON.parse(await decryptPaymentDetails(buyerSession.privateKey, accepted.data.trade.sellerSessionPk!, accepted.data.trade.encryptedPaymentDetails!));
    expect(details.simulated).toBe(true);

    const paid = await ctx.req<{ trade: StoredTrade }>('POST', `/api/trades/${request.id}/paid`, { buyerIdentity: buyerId });
    expect(paid.data.trade.status).toBe('Released');
    expect((await ctx.provider.getUtxos(buyer.receiveAddr(0))).some((u) => u.satoshis >= 5_000n)).toBe(true);
  });

  it('leaves alone offers that do not ask for the simulated payment or are out of its range', async () => {
    const ctx = await setup();
    const buyerId = await ctx.register(buyer);
    const real = await ctx.publish(buyerId, ctx.buyOffer());
    expect(real.data.trade).toBeNull();
    const big = await ctx.publish(buyerId, ctx.buyOffer({ paymentMethods: ['simulated'], min: '30000', max: '90000' }), 1);
    expect(big.status).toBe(201);
    expect(big.data.trade).toBeNull();
    const ars = await ctx.publish(buyerId, ctx.buyOffer({ paymentMethods: ['simulated'], min: '5000', max: '20000' }), 2);
    expect(ars.status).toBe(201);
    expect(ars.data.trade?.fiatAmount).toBe('25.13'); // the bot takes it too: 5,000 sats at 500,000 ARS + 0.5%, rounded up
  });

  it('retries the deposit on the next read when it failed right after the buyer accepted', async () => {
    const ctx = await setup({ botSats: 500_000n });
    const buyerId = await ctx.register(buyer);
    const request = (await ctx.publish(buyerId, ctx.buyOffer({ paymentMethods: ['simulated'], fiat: 'USD', price: { type: 'fixed', value: '450' }, oracle: undefined, min: '5000', max: '20000' }))).data.trade!;
    const realSend = ctx.provider.sendRawTransaction.bind(ctx.provider);
    let fail = true;
    ctx.provider.sendRawTransaction = async (hex: string) => {
      if (fail) throw new Error('simulated network error');
      return realSend(hex);
    };
    const accepted = await ctx.req<{ trade: StoredTrade }>('POST', `/api/trades/${request.id}/accept`, { buyerIdentity: buyerId, ...buyerKeys(buyer, 0) });
    expect(accepted.status).toBe(200);
    expect(accepted.data.trade.status).toBe('Accepted');
    fail = false;
    expect((await ctx.req<{ trade: StoredTrade }>('GET', `/api/trades/${request.id}`)).data.trade.status).toBe('Funded');
  });
});
