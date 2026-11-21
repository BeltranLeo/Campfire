import { describe, expect, it } from 'vitest';
import {
  MockNetworkProvider,
  Network,
  SignatureTemplate,
  TransactionBuilder,
  randomUtxo,
} from 'cashscript';
import {
  binToHex,
  deriveHdPath,
  deriveHdPrivateNodeChild,
  deriveHdPrivateNodeFromSeed,
  deriveHdPublicNode,
  encodeHdPublicKey,
  hashTransaction,
  hexToBin,
  secp256k1,
  sha256,
  utf8ToBin,
} from '@bitauth/libauth';
import {
  BCH_ASSET,
  BCH_DECIMALS,
  CHAT_OPEN_AFTER_END_SECONDS,
  PUSD_CATEGORY,
  MAX_CHAT_CIPHERTEXT_LENGTH,
  MAX_CHAT_IMAGE_PLAINTEXT_CHARS,
  MAX_CHAT_MESSAGE_CHARS,
  PUSD_DECIMALS,
  VERDICT_BUYER,
  VERDICT_SELLER,
  buildCancelRequest,
  buildCloseOfferTransaction,
  buildFundEscrowTransaction,
  buildPublishOfferTransaction,
  buildPublishNftOfferTransaction,
  buildCloseNftOfferTransaction,
  offerMinter,
  buildReleaseRequest,
  computeTradeFees,
  createEscrowContract,
  decryptPaymentDetails,
  derivePayoutPkhFromXpub,
  derivePubkeyFromXpub,
  deriveSharedTradeKey,
  deriveWalletAddressMap,
  encryptChatMessage,
  signChatMessage,
  encryptPaymentDetails,
  feePkh,
  generateSessionKeyPair,
  identityFromDefiXpub,
  missingFundingFees,
  pkhToCashAddress,
  pkhToLockingBytecode,
  tagWalletUtxos,
  tradeValueSats,
  validateTradeFees,
  type OfferDocument,
} from '../src/protocol/index.js';
import {
  CampfireService,
  LivePriceFeed,
  MemoryStorage,
  OracleService,
  PostgresStorage,
  StaticPriceFeed,
  createApiHandler,
  type StoredOffer,
  type StoredTrade,
} from '../src/server/index.js';
import { registerSignedIn, sessionHeaders, signInProof } from './signin-helper.js';

function makeWallet(label: string) {
  const seed = new Uint8Array(64);
  seed.set(sha256.hash(utf8ToBin(label)), 0);
  const master = deriveHdPrivateNodeFromSeed(seed);
  const receiveNode = deriveHdPath(master, "m/44'/145'/0'/0");
  const defiNode = deriveHdPath(master, "m/44'/145'/0'/7");
  if (typeof receiveNode === 'string' || typeof defiNode === 'string') {
    throw new Error('HD derivation failed');
  }
  const receiveXpub = encodeHdPublicKey({
    network: 'mainnet',
    node: deriveHdPublicNode(receiveNode),
  }).hdPublicKey;
  const defiXpub = encodeHdPublicKey({
    network: 'mainnet',
    node: deriveHdPublicNode(defiNode),
  }).hdPublicKey;

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
    receiveAddr: (i: number, tokenAware = false) =>
      pkhToCashAddress(derivePayoutPkhFromXpub(receiveXpub, i), { tokenAware }),
  };
}

const seller = makeWallet('service-test-seller');
const buyer = makeWallet('service-test-buyer');
const arbiterSk = sha256.hash(utf8ToBin('service-test-arbiter'));
const oracleSk = sha256.hash(utf8ToBin('service-test-oracle'));
const ADMIN_TOKEN = 'service-test-admin-token';
const ADMIN = { authorization: `Bearer ${ADMIN_TOKEN}` };

function setupTestContext(initialNow = 1_794_900_000, extra: { offerCategory?: string } = {}) {
  let currentNow = initialNow;
  const provider = new MockNetworkProvider();
  provider.network = Network.MAINNET;

  const feed = new StaticPriceFeed({
    'BCH/ARS': '500000.00',
    'BCH/USD': '450.00',
    'PUSD/ARS': '1100.00',
    'PUSD/USD': '1.00',
  });
  const oracle = new OracleService({
    privateKey: oracleSk,
    feed,
    nowSeconds: () => currentNow,
  });
  const storage = new MemoryStorage();
  const service = new CampfireService({
    storage,
    provider,
    oracle,
    arbiterPrivateKey: arbiterSk,
    nowSeconds: () => currentNow,
    offerCategory: extra.offerCategory,
  });
  const api = createApiHandler({ service, oracle, adminToken: ADMIN_TOKEN });

  const jsonReq = async <T = any>(
    method: string,
    path: string,
    body?: unknown,
    extraHeaders?: Record<string, string>,
  ): Promise<{ status: number; data: T }> => {
    const headers: Record<string, string> = { ...sessionHeaders(path, body), ...extraHeaders };
    if (body) headers['content-type'] = 'application/json';
    const res = await api(
      new Request(`http://localhost${path}`, {
        method,
        headers,
        body: body ? JSON.stringify(body) : undefined,
      }),
    );
    const data = (await res.json()) as T;
    return { status: res.status, data };
  };

  return {
    provider,
    storage,
    oracle,
    service,
    api,
    jsonReq,
    advanceTime: (seconds: number) => {
      currentNow += seconds;
    },
    getNow: () => currentNow,
  };
}

describe('LivePriceFeed (CoinGecko + Yadio with caching and fallback)', () => {
  it('combines CoinGecko BCH/USD with Yadio USD/ARS, caches for 60s and falls back to CoinGecko ARS', async () => {
    let calls = 0;
    const mockFetch: typeof fetch = async (input) => {
      calls += 1;
      const url = String(input);
      if (url.includes('coingecko')) {
        return new Response(JSON.stringify({ 'bitcoin-cash': { usd: 400, ars: 440_000 } }), {
          status: 200,
        });
      }
      if (url.includes('yadio')) {
        return new Response(JSON.stringify({ ARS: { USD: 1150 } }), { status: 200 });
      }
      return new Response('not found', { status: 404 });
    };

    const feed = new LivePriceFeed({ ttlMs: 60_000, fetchFn: mockFetch });
    const bchArs = await feed.getPrice('BCH/ARS');
    expect(bchArs).toBe('460000.00'); // 400 * 1150
    const callsAfterFirst = calls;
    expect(await feed.getPrice('BCH/ARS')).toBe('460000.00');
    expect(calls).toBe(callsAfterFirst); // served from cache

    expect(await feed.getPrice('PUSD/USD')).toBe('1.00');
    expect(await feed.getPrice('PUSD/ARS')).toBe('1150.00');
  });
});

describe('PostgresStorage SQL adapter', () => {
  it('initializes tables and executes parameterized queries', async () => {
    const queries: string[] = [];
    const tableRows = new Map<string, Record<string, unknown>>();
    const pg = new PostgresStorage(async (sql, params) => {
      queries.push(sql.trim().split('\n')[0]);
      if (sql.includes('INSERT INTO campfire_identities') && params) {
        tableRows.set(String(params[0]), { data: JSON.parse(String(params[1])) });
      }
      if (sql.includes('SELECT data FROM campfire_identities') && params) {
        const row = tableRows.get(String(params[0]));
        return { rows: row ? [row] : [] };
      }
      return { rows: [] };
    });

    await pg.saveIdentity({
      identity: 'ab'.repeat(32),
      defiXpub: seller.defiXpub,
      receiveXpub: seller.receiveXpub,
      createdAt: 100,
      updatedAt: 100,
    });
    const loaded = await pg.getIdentity('ab'.repeat(32));
    expect(loaded?.defiXpub).toBe(seller.defiXpub);
    expect(queries.some((q) => q.includes('CREATE TABLE IF NOT EXISTS'))).toBe(true);
  });
});

describe('CampfireService & HTTP API end-to-end lifecycle', () => {
  it('completes the happy path: offer -> take -> accept -> fund -> reveal payment -> paid -> release -> reputation -> close offer', async () => {
    const ctx = setupTestContext();

    // 1. Register seller and buyer identities.
    const sellerReg = await registerSignedIn(ctx.jsonReq, seller);
    expect(sellerReg.status).toBe(201);
    const sellerId: string = sellerReg.data.identity;

    const buyerReg = await registerSignedIn(ctx.jsonReq, buyer);
    expect(buyerReg.status).toBe(201);
    const buyerId: string = buyerReg.data.identity;

    // 2. Seller publishes a floating-price BCH offer on-chain.
    const cfg = await ctx.jsonReq('GET', '/api/config');
    const offerDoc: OfferDocument = {
      v: 1,
      side: 'sell',
      asset: BCH_ASSET,
      assetDecimals: BCH_DECIMALS,
      fiat: 'ARS',
      price: { type: 'floating', pair: 'BCH/ARS', marginBps: 200 },
      min: '100000',
      max: '1000000',
      paymentMethods: ['bank-transfer'],
      paymentWindowSec: 3600,
      terms: 'CBU immediate transfer',
      expiresAt: ctx.getNow() + 86_400,
      arbiter: cfg.data.arbiterPk,
      oracle: cfg.data.oraclePk,
    };

    const sellerAddrMap = deriveWalletAddressMap({ receiveXpub: seller.receiveXpub, count: 5 });
    const rawUtxo = ctx.provider.addUtxo(seller.receiveAddr(0), randomUtxo({ satoshis: 600_000n }));
    const taggedUtxos = tagWalletUtxos([rawUtxo], sellerAddrMap).map((u) => ({
      ...u,
      signer: new SignatureTemplate(seller.receivePriv(u.keyIndex)),
    }));

    const pubTx = buildPublishOfferTransaction({
      provider: ctx.provider,
      document: offerDoc,
      utxos: taggedUtxos,
      markerAddress: seller.receiveAddr(1),
      changeAddress: seller.receiveAddr(0),
    });

    const pubRes = await ctx.jsonReq<{ offer: StoredOffer }>('POST', '/api/offers', {
      sellerIdentity: sellerId,
      offerJson: pubTx.offerJson,
      offerTxHex: pubTx.hex,
      markerReceiveIndex: 1,
    });
    expect(pubRes.status).toBe(201);
    const offerTxid = pubRes.data.offer.offerTxid;

    // Verify the service serves the exact offer JSON by its SHA-256 digest (section 3.2).
    const docRes = await ctx.api(
      new Request(`http://localhost/api/offers/doc/${pubRes.data.offer.contentHash}`),
    );
    expect(docRes.status).toBe(200);
    expect(await docRes.text()).toBe(pubTx.offerJson);

    // 3. Buyer requests a trade; service rejects wrong key index and accepts matching derived key.
    const buyerSession = generateSessionKeyPair();
    const badReq = await ctx.jsonReq('POST', '/api/trades', {
      offerTxid,
      buyerIdentity: buyerId,
      amount: '200000',
      buyerPk: buyer.defiPkHex(0),
      buyerDefiIndex: 1, // mismatch!
      buyerPayoutPkh: buyer.receivePkhHex(0),
      buyerReceiveIndex: 0,
      buyerSessionPk: buyerSession.publicKey,
    });
    expect(badReq.status).toBe(400);
    expect(badReq.data.error).toMatch(/buyerPk does not match/);

    const takeRes = await ctx.jsonReq<{ trade: StoredTrade }>('POST', '/api/trades', {
      offerTxid,
      buyerIdentity: buyerId,
      amount: '200000', // 0.002 BCH at 500,000 ARS/BCH + 2% = 1,020.00 ARS
      buyerPk: buyer.defiPkHex(0),
      buyerDefiIndex: 0,
      buyerPayoutPkh: buyer.receivePkhHex(0),
      buyerReceiveIndex: 0,
      buyerSessionPk: buyerSession.publicKey,
    });
    expect(takeRes.status).toBe(201);
    expect(takeRes.data.trade.status).toBe('Requested');
    expect(takeRes.data.trade.fiatAmount).toBe('1020.00');
    const tradeRecordId = takeRes.data.trade.id;

    // 4. Seller accepts and uploads encrypted payment details.
    const sellerSession = generateSessionKeyPair();
    const encryptedDetails = await encryptPaymentDetails(
      sellerSession.privateKey,
      buyerSession.publicKey,
      JSON.stringify({ cbu: '0000003100012345678901', alias: 'campfire.vendedor' }),
    );

    const acceptRes = await ctx.jsonReq<{ trade: StoredTrade }>(
      'POST',
      `/api/trades/${tradeRecordId}/accept`,
      {
        sellerIdentity: sellerId,
        sellerPk: seller.defiPkHex(0),
        sellerDefiIndex: 0,
        sellerPayoutPkh: seller.receivePkhHex(0),
        sellerReceiveIndex: 0,
        sellerSessionPk: sellerSession.publicKey,
        encryptedPaymentDetails: encryptedDetails,
      },
    );
    expect(acceptRes.status).toBe(200);
    expect(acceptRes.data.trade.status).toBe('Accepted');
    expect(acceptRes.data.trade.tradeId).toMatch(/^[0-9a-f]{64}$/);
    // Payment details must remain hidden before funding!
    expect(acceptRes.data.trade.encryptedPaymentDetails).toBeUndefined();

    const acceptedTrade = acceptRes.data.trade;
    const contract = createEscrowContract(
      acceptedTrade.terms!,
      acceptedTrade.tradeId!,
      ctx.provider,
    );

    // 5. Seller funds the escrow on-chain and notifies the service.
    const sellerUtxosAfterOffer = tagWalletUtxos(
      await ctx.provider.getUtxos(seller.receiveAddr(0)),
      sellerAddrMap,
    ).map((u) => ({
      ...u,
      signer: new SignatureTemplate(seller.receivePriv(u.keyIndex)),
    }));

    const fundTx = buildFundEscrowTransaction({
      contract,
      terms: acceptedTrade.terms!,
      utxos: sellerUtxosAfterOffer,
      changeAddress: seller.receiveAddr(0),
    });

    const fundRes = await ctx.jsonReq<{ trade: StoredTrade }>(
      'POST',
      `/api/trades/${acceptedTrade.tradeId}/funding`,
      { fundingTxHex: fundTx.hex, confirmations: 1 },
    );
    expect(fundRes.status).toBe(200);
    expect(fundRes.data.trade.status).toBe('Funded');
    // Now payment details are revealed to the buyer!
    expect(fundRes.data.trade.encryptedPaymentDetails).toBe(encryptedDetails);
    const decryptedByBuyer = await decryptPaymentDetails(
      buyerSession.privateKey,
      sellerSession.publicKey,
      fundRes.data.trade.encryptedPaymentDetails!,
    );
    expect(JSON.parse(decryptedByBuyer).alias).toBe('campfire.vendedor');

    // 6. Buyer marks fiat as paid and sends an encrypted chat message.
    const sharedKey = deriveSharedTradeKey(buyerSession.privateKey, sellerSession.publicKey);
    const sent = await encryptChatMessage(sharedKey, 'Sent 1020.00 ARS via bank transfer');
    const chatRes = await ctx.jsonReq('POST', `/api/trades/${acceptedTrade.tradeId}/chat`, {
      senderIdentity: buyerId,
      ciphertext: sent,
      signature: signChatMessage(buyerSession.privateKey, acceptedTrade.tradeId!, sent),
    });
    expect(chatRes.status).toBe(201);
    expect(chatRes.data.message.senderRole).toBe('buyer');

    // Both parties hold the chat key, but neither can write in the other's name: the signature decides.
    const fake = await encryptChatMessage(sharedKey, 'Payment received, thanks');
    const asSeller = await ctx.jsonReq('POST', `/api/trades/${acceptedTrade.tradeId}/chat`, {
      senderIdentity: sellerId,
      ciphertext: fake,
      signature: signChatMessage(buyerSession.privateKey, acceptedTrade.tradeId!, fake),
    });
    expect(asSeller.status).toBe(400);
    expect(asSeller.data.error).toMatch(/signed with the sender's session key/);
    const unsigned = await ctx.jsonReq('POST', `/api/trades/${acceptedTrade.tradeId}/chat`, { senderIdentity: buyerId, ciphertext: fake });
    expect(unsigned.status).toBe(400);
    // A message read by anyone cannot be posted again later.
    const replay = await ctx.jsonReq('POST', `/api/trades/${acceptedTrade.tradeId}/chat`, {
      senderIdentity: buyerId,
      ciphertext: sent,
      signature: signChatMessage(buyerSession.privateKey, acceptedTrade.tradeId!, sent),
    });
    expect(replay.status).toBe(400);
    expect(replay.data.error).toMatch(/already posted/);
    // The service sees only ciphertext, so it caps its length (the larger of a text and a receipt image): above it, refused.
    const tooLong = await encryptChatMessage(sharedKey, 'x'.repeat(MAX_CHAT_IMAGE_PLAINTEXT_CHARS + 1));
    const oversize = await ctx.jsonReq('POST', `/api/trades/${acceptedTrade.tradeId}/chat`, {
      senderIdentity: buyerId,
      ciphertext: tooLong,
      signature: signChatMessage(buyerSession.privateKey, acceptedTrade.tradeId!, tooLong),
    });
    expect(oversize.status).toBe(400);
    expect(oversize.data.error).toMatch(/at most 2000 characters/);
    // The longest message the interface allows, in characters that take 3 bytes each, still fits.
    const longest = await encryptChatMessage(sharedKey, '€'.repeat(MAX_CHAT_MESSAGE_CHARS));
    expect(longest.length).toBeLessThanOrEqual(MAX_CHAT_CIPHERTEXT_LENGTH);

    const paidRes = await ctx.jsonReq<{ trade: StoredTrade }>(
      'POST',
      `/api/trades/${acceptedTrade.tradeId}/paid`,
      { buyerIdentity: buyerId },
    );
    expect(paidRes.status).toBe(200);
    expect(paidRes.data.trade.status).toBe('Paid');

    // 7. Seller signs and broadcasts `release`.
    const escrowUtxos = await contract.getUtxos();
    const releaseReq = buildReleaseRequest({
      contract,
      utxo: escrowUtxos[0],
      buyerPayoutPkh: acceptedTrade.terms!.buyerPayoutPkh,
      sellerDefiIndex: 0,
    });
    const sellerDefiSigner = new SignatureTemplate(seller.defiPriv(0));
    const signedReleaseHex = new TransactionBuilder({ provider: ctx.provider })
      .addInput(escrowUtxos[0], contract.unlock.release(sellerDefiSigner))
      .addOutput({
        to: pkhToLockingBytecode(acceptedTrade.terms!.buyerPayoutPkh),
        amount: escrowUtxos[0].satoshis - releaseReq.fee,
      })
      .build();

    const settleRes = await ctx.jsonReq<{ trade: StoredTrade }>(
      'POST',
      `/api/trades/${acceptedTrade.tradeId}/settle`,
      { path: 'release', signedTxHex: signedReleaseHex },
    );
    expect(settleRes.status).toBe(200);
    expect(settleRes.data.trade.status).toBe('Released');
    expect(settleRes.data.trade.settlementTxid).toMatch(/^[0-9a-f]{64}$/);

    // A polling client asks only for what is new: from the second of its newest message (that one comes again, and
    // the client drops it by id), and nothing once it is behind.
    const sentAt: number = chatRes.data.message.createdAt;
    const chatSince = (since: string) => ctx.jsonReq('GET', `/api/trades/${acceptedTrade.tradeId}/chat?since=${since}`);
    expect((await chatSince(String(sentAt))).data.messages).toHaveLength(1);
    expect((await chatSince(String(sentAt + 1))).data.messages).toHaveLength(0);
    expect((await chatSince('abc')).status).toBe(400);
    expect((await chatSince('-5')).status).toBe(400);

    // A finished trade keeps its chat open for seven days, then read-only.
    const postLate = async (plaintext: string) => {
      const late = await encryptChatMessage(sharedKey, plaintext);
      return ctx.jsonReq('POST', `/api/trades/${acceptedTrade.tradeId}/chat`, {
        senderIdentity: buyerId,
        ciphertext: late,
        signature: signChatMessage(buyerSession.privateKey, acceptedTrade.tradeId!, late),
      });
    };
    const endedAt: number = settleRes.data.trade.completedAt!;
    ctx.advanceTime(endedAt + CHAT_OPEN_AFTER_END_SECONDS - 1 - ctx.getNow());
    expect((await postLate('Thanks!')).status).toBe(201);
    ctx.advanceTime(1);
    const afterWeek = await postLate('One more thing');
    expect(afterWeek.status).toBe(400);
    expect(afterWeek.data.error).toMatch(/chat closed seven days after the trade ended/);
    const history = await ctx.jsonReq('GET', `/api/trades/${acceptedTrade.tradeId}/chat`);
    expect(history.data.messages).toHaveLength(2);

    // 8. Check reputation counters for both seller and buyer.
    const sellerRep = await ctx.jsonReq('GET', `/api/identities/${sellerId}/reputation`);
    expect(sellerRep.data.completedAsSeller).toBe(1);
    expect(sellerRep.data.completedAsBuyer).toBe(0);
    expect(sellerRep.data.notice).toContain('cannot be recomputed from the chain');

    const buyerRep = await ctx.jsonReq('GET', `/api/identities/${buyerId}/reputation`);
    expect(buyerRep.data.completedAsSeller).toBe(0);
    expect(buyerRep.data.completedAsBuyer).toBe(1);

    // 9. Seller closes the offer by spending the 1,000-sat marker output.
    const markerUtxos = tagWalletUtxos(
      await ctx.provider.getUtxos(seller.receiveAddr(1)),
      sellerAddrMap,
    ).map((u) => ({
      ...u,
      signer: new SignatureTemplate(seller.receivePriv(u.keyIndex)),
    }));
    const closeTx = buildCloseOfferTransaction({
      provider: ctx.provider,
      markerUtxo: markerUtxos[0],
      destinationAddress: seller.receiveAddr(0),
    });
    const closeRes = await ctx.jsonReq<{ offer: StoredOffer }>(
      'POST',
      `/api/offers/${offerTxid}/close`,
      { sellerIdentity: sellerId, closeTxHex: closeTx.hex },
    );
    expect(closeRes.status).toBe(200);
    expect(closeRes.data.offer.status).toBe('Closed');
    expect(closeRes.data.offer.closeTxid).toBe(hashTransaction(hexToBin(closeTx.hex)));
  });

  it('handles PUSD dispute with chat decryption for arbiter and automatic payment-window expiry', async () => {
    const ctx = setupTestContext();

    const { data: sellerReg } = await registerSignedIn(ctx.jsonReq, seller);
    const { data: buyerReg } = await registerSignedIn(ctx.jsonReq, buyer);
    const sellerId = sellerReg.identity;
    const buyerId = buyerReg.identity;

    const cfg = await ctx.jsonReq('GET', '/api/config');
    const pusdOfferDoc: OfferDocument = {
      v: 1,
      side: 'sell',
      asset: PUSD_CATEGORY,
      assetDecimals: PUSD_DECIMALS,
      fiat: 'ARS',
      price: { type: 'fixed', value: '1100.00' },
      min: '500',
      max: '10000',
      paymentMethods: ['bank-transfer'],
      paymentWindowSec: 300, // 5 minutes
      expiresAt: ctx.getNow() + 86_400,
      arbiter: cfg.data.arbiterPk,
    };

    const sellerAddrMap = deriveWalletAddressMap({ receiveXpub: seller.receiveXpub, count: 5 });
    const rawGas = ctx.provider.addUtxo(seller.receiveAddr(0), randomUtxo({ satoshis: 100_000n }));
    const rawPusd = ctx.provider.addUtxo(
      seller.receiveAddr(0, true),
      randomUtxo({ satoshis: 1000n, token: { category: PUSD_CATEGORY, amount: 5000n } }),
    );
    const tagged = tagWalletUtxos([rawGas, rawPusd], sellerAddrMap).map((u) => ({
      ...u,
      signer: new SignatureTemplate(seller.receivePriv(u.keyIndex)),
    }));

    const pubTx = buildPublishOfferTransaction({
      provider: ctx.provider,
      document: pusdOfferDoc,
      utxos: tagged,
      markerAddress: seller.receiveAddr(1),
      changeAddress: seller.receiveAddr(0),
    });
    const { data: pubData } = await ctx.jsonReq('POST', '/api/offers', {
      sellerIdentity: sellerId,
      offerJson: pubTx.offerJson,
      offerTxHex: pubTx.hex,
      markerReceiveIndex: 1,
    });
    const offerTxid = pubData.offer.offerTxid;

    // Trade 1: Dispute resolved in favour of buyer (`0x01`) after buyer hands over chat key.
    const buyerSession = generateSessionKeyPair();
    const sellerSession = generateSessionKeyPair();
    const { data: req1 } = await ctx.jsonReq('POST', '/api/trades', {
      offerTxid,
      buyerIdentity: buyerId,
      amount: '1000', // 10.00 PUSD
      buyerPk: buyer.defiPkHex(0),
      buyerDefiIndex: 0,
      buyerPayoutPkh: buyer.receivePkhHex(0),
      buyerReceiveIndex: 0,
      buyerSessionPk: buyerSession.publicKey,
    });
    const { data: acc1 } = await ctx.jsonReq('POST', `/api/trades/${req1.trade.id}/accept`, {
      sellerIdentity: sellerId,
      sellerPk: seller.defiPkHex(0),
      sellerDefiIndex: 0,
      sellerPayoutPkh: seller.receivePkhHex(0),
      sellerReceiveIndex: 0,
      sellerSessionPk: sellerSession.publicKey,
      encryptedPaymentDetails: 'deadbeef:00112233445566778899aabbccddeeff00112233',
    });

    const contract1 = createEscrowContract(acc1.trade.terms, acc1.trade.tradeId, ctx.provider);
    const currentUtxos = tagWalletUtxos(
      [
        ...(await ctx.provider.getUtxos(seller.receiveAddr(0))),
        ...(await ctx.provider.getUtxos(seller.receiveAddr(0, true))),
      ],
      sellerAddrMap,
    ).map((u) => ({
      ...u,
      signer: new SignatureTemplate(seller.receivePriv(u.keyIndex)),
    }));
    const fund1 = buildFundEscrowTransaction({
      contract: contract1,
      terms: acc1.trade.terms,
      utxos: currentUtxos,
      changeAddress: seller.receiveAddr(0),
      tokenChangeAddress: seller.receiveAddr(0, true),
    });
    await ctx.jsonReq('POST', `/api/trades/${acc1.trade.tradeId}/funding`, {
      fundingTxHex: fund1.hex,
    });

    const tradeKey = deriveSharedTradeKey(buyerSession.privateKey, sellerSession.publicKey);
    const receipt = await encryptChatMessage(tradeKey, 'Receipt #777 attached');
    await ctx.jsonReq('POST', `/api/trades/${acc1.trade.tradeId}/chat`, {
      senderIdentity: buyerId,
      ciphertext: receipt,
      signature: signChatMessage(buyerSession.privateKey, acc1.trade.tradeId, receipt),
    });
    await ctx.jsonReq('POST', `/api/trades/${acc1.trade.tradeId}/paid`, {
      buyerIdentity: buyerId,
    });

    // Buyer opens a dispute and hands `sharedTradeKeyHex` to the arbiter.
    const dispRes = await ctx.jsonReq('POST', `/api/trades/${acc1.trade.tradeId}/dispute`, {
      callerIdentity: buyerId,
      reason: 'Seller has not released after 2 hours',
      sharedTradeKeyHex: binToHex(tradeKey),
    });
    expect(dispRes.data.trade.status).toBe('Disputed');

    // The arbiter views and verdicts are closed to anyone without the admin token.
    const anonChat = await ctx.jsonReq('GET', `/api/trades/${acc1.trade.tradeId}/chat?arbiter=true`);
    expect(anonChat.status).toBe(403);
    const anonView = await ctx.jsonReq('GET', `/api/trades/${acc1.trade.tradeId}?arbiter=true`);
    expect(anonView.status).toBe(403);
    const anonVerdict = await ctx.jsonReq(
      'POST',
      `/api/trades/${acc1.trade.tradeId}/verdict`,
      { verdict: VERDICT_BUYER },
      { authorization: 'Bearer wrong-token' },
    );
    expect(anonVerdict.status).toBe(403);

    // Arbiter reads decrypted chat.
    const arbChat = await ctx.jsonReq(
      'GET',
      `/api/trades/${acc1.trade.tradeId}/chat?arbiter=true`,
      undefined,
      ADMIN,
    );
    expect(arbChat.data.decrypted[0]).toMatchObject({ plaintext: 'Receipt #777 attached', senderRole: 'buyer', verified: true });
    // The arbiter's view takes the same cursor: only newer messages are decrypted and returned.
    const newerThan = (at: number) =>
      ctx.jsonReq('GET', `/api/trades/${acc1.trade.tradeId}/chat?arbiter=true&since=${at}`, undefined, ADMIN);
    expect((await newerThan(arbChat.data.decrypted[0].createdAt)).data.decrypted).toHaveLength(1);
    expect((await newerThan(arbChat.data.decrypted[0].createdAt + 1)).data.decrypted).toEqual([]);

    // A party posts a message that is validly signed but encrypted with another key. It used to make the whole chat
    // undecryptable for the arbiter; now only that message is unreadable, and its author is still shown.
    const wrongKey = deriveSharedTradeKey(buyerSession.privateKey, generateSessionKeyPair().publicKey);
    const junk = await encryptChatMessage(wrongKey, 'unreadable for the arbiter');
    const junkRes = await ctx.jsonReq('POST', `/api/trades/${acc1.trade.tradeId}/chat`, {
      senderIdentity: buyerId,
      ciphertext: junk,
      signature: signChatMessage(buyerSession.privateKey, acc1.trade.tradeId, junk),
    });
    expect(junkRes.status).toBe(201);
    const withJunk = await ctx.jsonReq('GET', `/api/trades/${acc1.trade.tradeId}/chat?arbiter=true`, undefined, ADMIN);
    expect(withJunk.data.decrypted).toHaveLength(2);
    expect(withJunk.data.decrypted[0].plaintext).toBe('Receipt #777 attached');
    expect(withJunk.data.decrypted[1]).toMatchObject({ plaintext: null, senderRole: 'buyer', verified: true });

    // Arbiter issues verdict `0x01` (buyer wins), which automatically broadcasts `arbitrate`.
    const verdictRes = await ctx.jsonReq(
      'POST',
      `/api/trades/${acc1.trade.tradeId}/verdict`,
      { verdict: VERDICT_BUYER, reason: 'Verified receipt #777' },
      ADMIN,
    );
    expect(verdictRes.data.trade.status).toBe('ResolvedBuyer');
    expect(verdictRes.data.trade.settlementTxid).toMatch(/^[0-9a-f]{64}$/);

    // Trade 2: Payment window expires without buyer marking as paid -> automatic arbiter verdict `0x02` for seller.
    const { data: req2 } = await ctx.jsonReq('POST', '/api/trades', {
      offerTxid,
      buyerIdentity: buyerId,
      amount: '1000',
      buyerPk: buyer.defiPkHex(1),
      buyerDefiIndex: 1,
      buyerPayoutPkh: buyer.receivePkhHex(1),
      buyerReceiveIndex: 1,
      buyerSessionPk: buyerSession.publicKey,
    });
    const { data: acc2 } = await ctx.jsonReq('POST', `/api/trades/${req2.trade.id}/accept`, {
      sellerIdentity: sellerId,
      sellerPk: seller.defiPkHex(1),
      sellerDefiIndex: 1,
      sellerPayoutPkh: seller.receivePkhHex(1),
      sellerReceiveIndex: 1,
      sellerSessionPk: sellerSession.publicKey,
      encryptedPaymentDetails: 'deadbeef:00112233445566778899aabbccddeeff00112233',
    });
    const contract2 = createEscrowContract(acc2.trade.terms, acc2.trade.tradeId, ctx.provider);
    const remainingUtxos = tagWalletUtxos(
      [
        ...(await ctx.provider.getUtxos(seller.receiveAddr(0))),
        ...(await ctx.provider.getUtxos(seller.receiveAddr(0, true))),
      ],
      sellerAddrMap,
    ).map((u) => ({
      ...u,
      signer: new SignatureTemplate(seller.receivePriv(u.keyIndex)),
    }));
    const fund2 = buildFundEscrowTransaction({
      contract: contract2,
      terms: acc2.trade.terms,
      utxos: remainingUtxos,
      changeAddress: seller.receiveAddr(0),
      tokenChangeAddress: seller.receiveAddr(0, true),
    });
    await ctx.jsonReq('POST', `/api/trades/${acc2.trade.tradeId}/funding`, {
      fundingTxHex: fund2.hex,
    });

    // Advance past the 300-second payment window without buyer marking as paid.
    ctx.advanceTime(301);
    const expiredCheck = await ctx.jsonReq('GET', `/api/trades/${acc2.trade.tradeId}`);
    expect(expiredCheck.data.trade.status).toBe('ResolvedSeller');
    expect(expiredCheck.data.trade.verdict).toBe(VERDICT_SELLER);
    expect(expiredCheck.data.trade.settlementTxid).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe('Identity registration', () => {
  it('stores only the defi and receive keys, even when an old client also sends the change key', async () => {
    const ctx = setupTestContext();
    const reg = await registerSignedIn(ctx.jsonReq, seller, { changeXpub: buyer.receiveXpub });
    expect(reg.status).toBe(201);
    expect(reg.data.record).not.toHaveProperty('changeXpub');
    const stored = await ctx.storage.getIdentity(reg.data.identity);
    expect(stored).not.toBeNull();
    expect(Object.keys(stored!).sort()).toEqual(['createdAt', 'defiXpub', 'identity', 'receiveXpub', 'updatedAt']);
  });

  it('signs in with a challenge, then resumes with the session token and nothing else', async () => {
    const ctx = setupTestContext();
    const keys = { defiXpub: buyer.defiXpub, receiveXpub: buyer.receiveXpub };

    const unsigned = await ctx.jsonReq('POST', '/api/identities', keys);
    expect(unsigned.status).toBe(401);
    expect(await ctx.storage.getIdentity(identityFromDefiXpub(buyer.defiXpub))).toBeNull();

    const signed = await registerSignedIn(ctx.jsonReq, buyer);
    expect(signed.status).toBe(201);
    expect(signed.data.session).toMatch(/^[0-9a-f]{64}\.[0-9]+\.[0-9a-f]{64}$/);

    // Knowing the keys is not enough once registered: whoever presents them without a token must sign.
    const keysOnly = await ctx.jsonReq('POST', '/api/identities', keys);
    expect(keysOnly.status).toBe(401);

    // The same browser resumes with its token, and gets a fresh one.
    const resumed = await ctx.jsonReq('POST', '/api/identities', keys, { 'x-campfire-session': signed.data.session });
    expect(resumed.status).toBe(201);
    expect(resumed.data.identity).toBe(signed.data.identity);
    expect(resumed.data.session).toMatch(/^[0-9a-f]{64}\./);

    // A token does not carry over to other keys, and expires after 30 days.
    const sellerKeys = { defiXpub: seller.defiXpub, receiveXpub: seller.receiveXpub };
    expect((await ctx.jsonReq('POST', '/api/identities', sellerKeys, { 'x-campfire-session': signed.data.session })).status).toBe(401);
    ctx.advanceTime(30 * 86_400 + 1);
    expect((await ctx.jsonReq('POST', '/api/identities', keys, { 'x-campfire-session': signed.data.session })).status).toBe(401);
  });

  it('acts for an identity only with its own session token', async () => {
    const ctx = setupTestContext();
    const buyerId: string = (await registerSignedIn(ctx.jsonReq, buyer)).data.identity;
    const sellerReg = await registerSignedIn(ctx.jsonReq, seller);
    const sellerId: string = sellerReg.data.identity;
    const listPath = `/api/trades?identity=${buyerId}`;

    // The test helper sends the named identity's token; these calls set the header by hand to override it.
    expect((await ctx.jsonReq('GET', listPath)).status).toBe(200);
    expect((await ctx.jsonReq('GET', listPath, undefined, { 'x-campfire-session': '' })).status).toBe(401);
    expect((await ctx.jsonReq('GET', listPath, undefined, { 'x-campfire-session': sellerReg.data.session })).status).toBe(403);
    const forged = `${buyerId}.${ctx.getNow() + 3600}.${'0'.repeat(64)}`;
    expect((await ctx.jsonReq('GET', listPath, undefined, { 'x-campfire-session': forged })).status).toBe(401);

    // Acting for someone else is refused before the service looks at the request.
    const tradeId = 'ab'.repeat(16);
    const paid = await ctx.jsonReq('POST', `/api/trades/${tradeId}/paid`, { buyerIdentity: buyerId }, { 'x-campfire-session': sellerReg.data.session });
    expect(paid.status).toBe(403);
    const decline = await ctx.jsonReq('POST', `/api/trades/${tradeId}/decline`, { identity: sellerId }, { 'x-campfire-session': '' });
    expect(decline.status).toBe(401);
  });

  it('refuses an expired, foreign or garbled sign-in', async () => {
    const ctx = setupTestContext();
    const keys = { defiXpub: buyer.defiXpub, receiveXpub: buyer.receiveXpub };

    const expired = await signInProof(ctx.jsonReq, buyer);
    ctx.advanceTime(301);
    const late = await ctx.jsonReq('POST', '/api/identities', { ...keys, proof: expired });
    expect(late.status).toBe(401);
    expect(late.data.error).toMatch(/expired/);

    // The proof of one wallet does not register another wallet's keys.
    const sellerProof = await signInProof(ctx.jsonReq, seller);
    const foreign = await ctx.jsonReq('POST', '/api/identities', { ...keys, proof: sellerProof });
    expect(foreign.status).toBe(401);

    // A salt or expiry the service did not issue changes the nonce, so the signature no longer answers it.
    const proof = await signInProof(ctx.jsonReq, buyer);
    const forged = await ctx.jsonReq('POST', '/api/identities', { ...keys, proof: { ...proof, expiresAt: proof.expiresAt + 600 } });
    expect(forged.status).toBe(401);
    const garbled = await ctx.jsonReq('POST', '/api/identities', { ...keys, proof: { ...proof, signedTransaction: 'zz' } });
    expect(garbled.status).toBe(401);

    expect(await ctx.storage.getIdentity((await registerSignedIn(ctx.jsonReq, buyer)).data.identity)).not.toBeNull();
  });

  // Every dapp the wallet connects to receives the same extended public keys, so knowing them proves nothing.
  // Swapping the receive key would let such a dapp take offers in the victim's name, with payouts to its wallet.
  it('lets only the owner of the defi key replace the receive key of an identity', async () => {
    const ctx = setupTestContext();
    const attacker = makeWallet('service-test-attacker');

    const victimReg = await registerSignedIn(ctx.jsonReq, buyer);
    expect(victimReg.status).toBe(201);
    const victimId: string = victimReg.data.identity;
    const hijackKeys = { defiXpub: buyer.defiXpub, receiveXpub: attacker.receiveXpub };

    const unsigned = await ctx.jsonReq('POST', '/api/identities', hijackKeys);
    expect(unsigned.status).toBe(401);

    // The attacker can ask for a challenge with the victim's defi key, but can only sign it with its own key.
    const attackerSigned = await signInProof(ctx.jsonReq, { ...buyer, receiveXpub: attacker.receiveXpub }, attacker.defiPriv(0));
    const hijack = await ctx.jsonReq('POST', '/api/identities', { ...hijackKeys, proof: attackerSigned });
    expect(hijack.status).toBe(401);
    expect(hijack.data.error).toMatch(/does not match this wallet/);

    // Nor can it reuse the victim's own sign-in: that challenge was issued for the victim's receive key.
    const victimProof = await signInProof(ctx.jsonReq, buyer);
    const replay = await ctx.jsonReq('POST', '/api/identities', { ...hijackKeys, proof: victimProof });
    expect(replay.status).toBe(401);
    expect((await ctx.storage.getIdentity(victimId))!.receiveXpub).toBe(buyer.receiveXpub);

    // The owner can: this undoes a receive key someone registered first without the wallet.
    const owner = { ...buyer, receiveXpub: seller.receiveXpub };
    expect((await registerSignedIn(ctx.jsonReq, owner)).status).toBe(201);
    expect((await ctx.storage.getIdentity(victimId))!.receiveXpub).toBe(seller.receiveXpub);
    expect((await registerSignedIn(ctx.jsonReq, buyer)).status).toBe(201);

    // So a take under the victim's identity cannot pay out to the attacker.
    const sellerReg = await registerSignedIn(ctx.jsonReq, seller);
    const cfg = await ctx.jsonReq('GET', '/api/config');
    const offerDoc: OfferDocument = {
      v: 1,
      side: 'sell',
      asset: BCH_ASSET,
      assetDecimals: BCH_DECIMALS,
      fiat: 'ARS',
      price: { type: 'fixed', value: '500000' },
      min: '100000',
      max: '1000000',
      paymentMethods: ['bank-transfer'],
      paymentWindowSec: 3600,
      terms: 'CBU immediate transfer',
      expiresAt: ctx.getNow() + 86_400,
      arbiter: cfg.data.arbiterPk,
    };
    const sellerAddrMap = deriveWalletAddressMap({ receiveXpub: seller.receiveXpub, count: 5 });
    const rawUtxo = ctx.provider.addUtxo(seller.receiveAddr(0), randomUtxo({ satoshis: 600_000n }));
    const pubTx = buildPublishOfferTransaction({
      provider: ctx.provider,
      document: offerDoc,
      utxos: tagWalletUtxos([rawUtxo], sellerAddrMap).map((u) => ({
        ...u,
        signer: new SignatureTemplate(seller.receivePriv(u.keyIndex)),
      })),
      markerAddress: seller.receiveAddr(1),
      changeAddress: seller.receiveAddr(0),
    });
    const pubRes = await ctx.jsonReq<{ offer: StoredOffer }>('POST', '/api/offers', {
      sellerIdentity: sellerReg.data.identity,
      offerJson: pubTx.offerJson,
      offerTxHex: pubTx.hex,
      markerReceiveIndex: 1,
    });
    expect(pubRes.status).toBe(201);

    const take = await ctx.jsonReq('POST', '/api/trades', {
      offerTxid: pubRes.data.offer.offerTxid,
      buyerIdentity: victimId,
      amount: '200000',
      buyerPk: buyer.defiPkHex(0),
      buyerDefiIndex: 0,
      buyerPayoutPkh: attacker.receivePkhHex(0),
      buyerReceiveIndex: 0,
      buyerSessionPk: generateSessionKeyPair().publicKey,
    });
    expect(take.status).toBe(400);
    expect(take.data.error).toMatch(/buyerPayoutPkh does not match/);
  });
});

describe('Service fees (protocol section 5.1)', () => {
  // Publishes a floating BCH offer, takes 0.01 BCH of it and accepts, so the terms carry the fees.
  async function acceptedFloatingTrade(ctx: ReturnType<typeof setupTestContext>) {
    const sellerId = (await registerSignedIn(ctx.jsonReq, seller)).data.identity;
    const buyerId = (await registerSignedIn(ctx.jsonReq, buyer)).data.identity;
    const cfg = await ctx.jsonReq('GET', '/api/config');
    const offerDoc: OfferDocument = {
      v: 1,
      side: 'sell',
      asset: BCH_ASSET,
      assetDecimals: BCH_DECIMALS,
      fiat: 'ARS',
      price: { type: 'floating', pair: 'BCH/ARS', marginBps: 0 },
      min: '100000',
      max: '5000000',
      paymentMethods: ['bank-transfer'],
      paymentWindowSec: 3600,
      terms: 'Bank transfer',
      expiresAt: ctx.getNow() + 86_400,
      arbiter: cfg.data.arbiterPk,
      oracle: cfg.data.oraclePk,
    };
    const addrMap = deriveWalletAddressMap({ receiveXpub: seller.receiveXpub, count: 5 });
    const sign = (utxos: Awaited<ReturnType<typeof ctx.provider.getUtxos>>) =>
      tagWalletUtxos(utxos, addrMap).map((u) => ({ ...u, signer: new SignatureTemplate(seller.receivePriv(u.keyIndex)) }));
    ctx.provider.addUtxo(seller.receiveAddr(0), randomUtxo({ satoshis: 3_000_000n }));
    const pubTx = buildPublishOfferTransaction({
      provider: ctx.provider,
      document: offerDoc,
      utxos: sign(await ctx.provider.getUtxos(seller.receiveAddr(0))),
      markerAddress: seller.receiveAddr(1),
      changeAddress: seller.receiveAddr(0),
    });
    const offerTxid = (
      await ctx.jsonReq('POST', '/api/offers', { sellerIdentity: sellerId, offerJson: pubTx.offerJson, offerTxHex: pubTx.hex, markerReceiveIndex: 1 })
    ).data.offer.offerTxid;

    const buyerSession = generateSessionKeyPair();
    const take = await ctx.jsonReq<{ trade: StoredTrade }>('POST', '/api/trades', {
      offerTxid,
      buyerIdentity: buyerId,
      amount: '1000000',
      buyerPk: buyer.defiPkHex(0),
      buyerDefiIndex: 0,
      buyerPayoutPkh: buyer.receivePkhHex(0),
      buyerReceiveIndex: 0,
      buyerSessionPk: buyerSession.publicKey,
    });
    const sellerSession = generateSessionKeyPair();
    const accept = await ctx.jsonReq<{ trade: StoredTrade }>('POST', `/api/trades/${take.data.trade.id}/accept`, {
      sellerIdentity: sellerId,
      sellerPk: seller.defiPkHex(0),
      sellerDefiIndex: 0,
      sellerPayoutPkh: seller.receivePkhHex(0),
      sellerReceiveIndex: 0,
      sellerSessionPk: sellerSession.publicKey,
      encryptedPaymentDetails: await encryptPaymentDetails(sellerSession.privateKey, buyerSession.publicKey, 'alias: campfire'),
    });
    expect(accept.status).toBe(200);
    const trade = accept.data.trade;
    const contract = createEscrowContract(trade.terms!, trade.tradeId!, ctx.provider);
    const coins = sign(await ctx.provider.getUtxos(seller.receiveAddr(0)));
    return { take: take.data.trade, trade, contract, coins, cfg: cfg.data };
  }

  it('lets only the admin change the rates and refuses rates above the cap', async () => {
    const ctx = setupTestContext();
    expect((await ctx.jsonReq('GET', '/api/fees')).data).toMatchObject({ arbiterBps: 25, oracleBps: 25, maxBps: 500, dustLimitSats: 546 });

    const anonymous = await ctx.jsonReq('POST', '/api/admin/fees', { arbiterBps: 100, oracleBps: 0 });
    expect(anonymous.status).toBe(403);
    const tooHigh = await ctx.jsonReq('POST', '/api/admin/fees', { arbiterBps: 501, oracleBps: 0 }, ADMIN);
    expect(tooHigh.status).toBe(400);
    const fractional = await ctx.jsonReq('POST', '/api/admin/fees', { arbiterBps: 12.5, oracleBps: 0 }, ADMIN);
    expect(fractional.status).toBe(400);

    const saved = await ctx.jsonReq('POST', '/api/admin/fees', { arbiterBps: 100, oracleBps: 0 }, ADMIN);
    expect(saved.status).toBe(200);
    expect((await ctx.jsonReq('GET', '/api/fees')).data).toMatchObject({ arbiterBps: 100, oracleBps: 0 });
  });

  it('commits the fees in the terms and counts the trade as funded only when the deposit pays them', async () => {
    const ctx = setupTestContext();
    const { take, trade, contract, coins, cfg } = await acceptedFloatingTrade(ctx);

    // 0.25% of 1,000,000 sats to each of the arbiter and the oracle, shown with the request and fixed in the terms.
    const expected = [
      { role: 'arbiter', pkh: feePkh(cfg.arbiterPk), satoshis: '2500' },
      { role: 'oracle', pkh: feePkh(cfg.oraclePk), satoshis: '2500' },
    ];
    expect(take.fees).toEqual(expected);
    expect(trade.terms!.fees).toEqual(expected);

    // Changing the rates afterwards does not touch a trade that was already requested.
    await ctx.jsonReq('POST', '/api/admin/fees', { arbiterBps: 500, oracleBps: 500 }, ADMIN);
    expect((await ctx.service.getTrade(trade.id))!.terms!.fees).toEqual(expected);

    // A deposit with the right escrow output but without the fees is not accepted.
    const withoutFees = buildFundEscrowTransaction({
      contract,
      terms: { ...trade.terms!, fees: undefined },
      utxos: coins,
      changeAddress: seller.receiveAddr(0),
    });
    const refused = await ctx.jsonReq('POST', `/api/trades/${trade.tradeId}/funding`, { fundingTxHex: withoutFees.hex });
    expect(refused.status).toBe(400);
    expect(refused.data.error).toMatch(/does not pay the arbiter fee\. Nothing was broadcast/);
    expect((await ctx.service.getTrade(trade.id))!.status).toBe('Accepted');
    expect(await contract.getUtxos()).toEqual([]);

    // The same deposit made outside Campfire is on-chain, but it still does not count as funded.
    await ctx.provider.sendRawTransaction(withoutFees.hex);
    const outside = await ctx.jsonReq('POST', `/api/trades/${trade.tradeId}/funding`, {});
    expect(outside.status).toBe(400);
    expect(outside.data.error).toMatch(/does not pay the arbiter fee\. The trade is not counted as funded/);
  });

  it('records a deposit that pays the fees in the same transaction', async () => {
    const ctx = setupTestContext();
    const { trade, contract, coins } = await acceptedFloatingTrade(ctx);
    const fundTx = buildFundEscrowTransaction({ contract, terms: trade.terms!, utxos: coins, changeAddress: seller.receiveAddr(0) });
    expect(missingFundingFees(fundTx.hex, trade.terms!.fees)).toBeNull();
    const funded = await ctx.jsonReq<{ trade: StoredTrade }>('POST', `/api/trades/${trade.tradeId}/funding`, { fundingTxHex: fundTx.hex });
    expect(funded.status).toBe(200);
    expect(funded.data.trade.status).toBe('Funded');
  });
});

describe('Fee computation', () => {
  const arbiterPk = binToHex(secp256k1.derivePublicKeyCompressed(arbiterSk) as Uint8Array);
  const oraclePk = binToHex(secp256k1.derivePublicKeyCompressed(oracleSk) as Uint8Array);
  const rates = { arbiterBps: 25, oracleBps: 25 };

  it('pays the oracle only when there is one, and leaves out fees below the dust limit', () => {
    expect(computeTradeFees({ valueSats: 1_000_000n, rates, arbiterPk })).toEqual([
      { role: 'arbiter', pkh: feePkh(arbiterPk), satoshis: '2500' },
    ]);
    // 0.25% of 200,000 sats is 500 sats, below 546: no fee at all.
    expect(computeTradeFees({ valueSats: 200_000n, rates, arbiterPk, oraclePk })).toEqual([]);
    expect(computeTradeFees({ valueSats: null, rates, arbiterPk, oraclePk })).toEqual([]);
  });

  it('values PUSD in BCH at the BCH/USD price and other tokens at nothing', () => {
    // 100.00 PUSD at 450 USD/BCH is 0.22222222 BCH.
    expect(tradeValueSats({ asset: PUSD_CATEGORY, amount: '10000', assetDecimals: PUSD_DECIMALS, bchUsd: '450.00' })).toBe(22_222_222n);
    expect(tradeValueSats({ asset: BCH_ASSET, amount: '123', assetDecimals: BCH_DECIMALS })).toBe(123n);
    expect(tradeValueSats({ asset: 'ab'.repeat(32), amount: '10000', assetDecimals: 2 })).toBeNull();
    expect(() => tradeValueSats({ asset: PUSD_CATEGORY, amount: '10000', assetDecimals: PUSD_DECIMALS })).toThrow(/BCH\/USD/);
  });

  it('refuses terms whose fee pays another key or is above the cap', () => {
    const base = { asset: BCH_ASSET, amount: '1000000', arbiterPk, oraclePk };
    expect(() => validateTradeFees({ ...base, fees: [{ role: 'arbiter', pkh: feePkh(arbiterPk), satoshis: '2500' }] })).not.toThrow();
    expect(() => validateTradeFees({ ...base, fees: [{ role: 'arbiter', pkh: feePkh(oraclePk), satoshis: '2500' }] })).toThrow(/does not pay/);
    expect(() => validateTradeFees({ ...base, fees: [{ role: 'arbiter', pkh: feePkh(arbiterPk), satoshis: '50001' }] })).toThrow(/above 5%/);
    expect(() => validateTradeFees({ ...base, fees: [{ role: 'arbiter', pkh: feePkh(arbiterPk), satoshis: '500' }] })).toThrow(/dust/);
    expect(() => validateTradeFees({ ...base, oraclePk: undefined, fees: [{ role: 'oracle', pkh: feePkh(oraclePk), satoshis: '2500' }] })).toThrow(/oracle/);
  });
});

describe('format-2 offers with an NFT marker (section 3.4)', () => {
  const CATEGORY = binToHex(sha256.hash(utf8ToBin('campfire-offer-category-test')));
  const minting = (category: string) => ({ category, amount: 0n, nft: { capability: 'minting' as const, commitment: '' } });

  async function publishNft(ctx: ReturnType<typeof setupTestContext>, category = CATEGORY, index = 0) {
    const { data: reg } = await registerSignedIn(ctx.jsonReq, seller);
    const cfg = await ctx.jsonReq('GET', '/api/config');
    const offerDoc: OfferDocument = {
      v: 1, side: 'sell', asset: BCH_ASSET, assetDecimals: BCH_DECIMALS, fiat: 'ARS',
      price: { type: 'floating', pair: 'BCH/ARS', marginBps: 200 },
      min: '100000', max: '1000000', paymentMethods: ['bank-transfer'], paymentWindowSec: 3600,
      expiresAt: ctx.getNow() + 86_400, arbiter: cfg.data.arbiterPk, oracle: cfg.data.oraclePk,
    };
    const minterUtxo = ctx.provider.addUtxo(offerMinter(ctx.provider).tokenAddress, randomUtxo({ satoshis: 1000n, token: minting(category) }));
    const addrMap = deriveWalletAddressMap({ receiveXpub: seller.receiveXpub, count: 5 });
    const raw = ctx.provider.addUtxo(seller.receiveAddr(0), randomUtxo({ satoshis: 100_000n }));
    const utxos = tagWalletUtxos([raw], addrMap).map((u) => ({ ...u, signer: new SignatureTemplate(seller.receivePriv(u.keyIndex)) }));
    const markerAddress = pkhToCashAddress(derivePayoutPkhFromXpub(seller.receiveXpub, index), { tokenAware: true });
    const pubTx = buildPublishNftOfferTransaction({
      provider: ctx.provider, document: offerDoc, utxos, minterUtxo, markerAddress, changeAddress: seller.receiveAddr(0),
    });
    const res = await ctx.jsonReq<{ offer: StoredOffer }>('POST', '/api/offers', {
      sellerIdentity: reg.identity, offerJson: pubTx.offerJson, offerTxHex: pubTx.hex, markerReceiveIndex: index,
    });
    return { res, sellerId: reg.identity as string, markerAddress, addrMap, cfg };
  }

  it('lists an offer whose marker NFT belongs to the configured category, and closes it when the NFT is burned', async () => {
    const ctx = setupTestContext(undefined, { offerCategory: CATEGORY });
    const { res, sellerId, markerAddress, addrMap, cfg } = await publishNft(ctx);
    expect(cfg.data.offerCategory).toBe(CATEGORY);
    expect(res.status).toBe(201);
    expect(res.data.offer.onChain.version).toBe(2);
    expect(res.data.offer.markerCategory).toBe(CATEGORY);
    expect(res.data.offer.markerAddress).toBe(markerAddress);

    const early = await ctx.jsonReq('POST', `/api/offers/${res.data.offer.offerTxid}/close`, { sellerIdentity: sellerId });
    expect(early.status).toBe(400);
    expect(early.data.error).toMatch(/still unspent/);

    const [held] = (await ctx.provider.getUtxos(markerAddress)).filter((u) => u.token);
    const [marker] = tagWalletUtxos([held], addrMap).map((u) => ({ ...u, signer: new SignatureTemplate(seller.receivePriv(u.keyIndex)) }));
    const closeTx = buildCloseNftOfferTransaction({ provider: ctx.provider, markerUtxo: marker, destinationAddress: seller.receiveAddr(0), category: CATEGORY });
    const closed = await ctx.jsonReq<{ offer: StoredOffer }>('POST', `/api/offers/${res.data.offer.offerTxid}/close`, { sellerIdentity: sellerId, closeTxHex: closeTx.hex });
    expect(closed.status).toBe(200);
    expect(closed.data.offer.status).toBe('Closed');
  });

  it('refuses a marker of another category', async () => {
    const ctx = setupTestContext(undefined, { offerCategory: CATEGORY });
    const { res } = await publishNft(ctx, '22'.repeat(32));
    expect(res.status).toBe(400);
    expect((res.data as any).error).toMatch(/Campfire offer category/);
  });

  it('refuses a marker that does not go to the identity address (receive/0)', async () => {
    const ctx = setupTestContext(undefined, { offerCategory: CATEGORY });
    const { res } = await publishNft(ctx, CATEGORY, 1);
    expect(res.status).toBe(400);
    expect((res.data as any).error).toMatch(/identity address/);
  });

  it('refuses format-2 offers while no category is configured', async () => {
    const ctx = setupTestContext();
    const { res, cfg } = await publishNft(ctx);
    expect(cfg.data.offerCategory).toBeNull();
    expect(res.status).toBe(400);
    expect((res.data as any).error).toMatch(/does not accept NFT-marker offers/);
  });
});
