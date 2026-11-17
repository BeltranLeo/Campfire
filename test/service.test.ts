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
  secp256k1,
  sha256,
  utf8ToBin,
} from '@bitauth/libauth';
import {
  BCH_ASSET,
  BCH_DECIMALS,
  PUSD_CATEGORY,
  PUSD_DECIMALS,
  VERDICT_BUYER,
  VERDICT_SELLER,
  buildCancelRequest,
  buildCloseOfferTransaction,
  buildFundEscrowTransaction,
  buildPublishOfferTransaction,
  buildReleaseRequest,
  createEscrowContract,
  decryptPaymentDetails,
  derivePayoutPkhFromXpub,
  derivePubkeyFromXpub,
  deriveSharedTradeKey,
  deriveWalletAddressMap,
  encryptChatMessage,
  signChatMessage,
  encryptPaymentDetails,
  generateSessionKeyPair,
  pkhToCashAddress,
  pkhToLockingBytecode,
  tagWalletUtxos,
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

function setupTestContext(initialNow = 1_794_900_000) {
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
  });
  const api = createApiHandler({ service, oracle, adminToken: ADMIN_TOKEN });

  const jsonReq = async <T = any>(
    method: string,
    path: string,
    body?: unknown,
    extraHeaders?: Record<string, string>,
  ): Promise<{ status: number; data: T }> => {
    const headers: Record<string, string> = { ...extraHeaders };
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
    const sellerReg = await ctx.jsonReq('POST', '/api/identities', {
      defiXpub: seller.defiXpub,
      receiveXpub: seller.receiveXpub,
    });
    expect(sellerReg.status).toBe(201);
    const sellerId: string = sellerReg.data.identity;

    const buyerReg = await ctx.jsonReq('POST', '/api/identities', {
      defiXpub: buyer.defiXpub,
      receiveXpub: buyer.receiveXpub,
    });
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
  });

  it('handles PUSD dispute with chat decryption for arbiter and automatic payment-window expiry', async () => {
    const ctx = setupTestContext();

    const { data: sellerReg } = await ctx.jsonReq('POST', '/api/identities', {
      defiXpub: seller.defiXpub,
      receiveXpub: seller.receiveXpub,
    });
    const { data: buyerReg } = await ctx.jsonReq('POST', '/api/identities', {
      defiXpub: buyer.defiXpub,
      receiveXpub: buyer.receiveXpub,
    });
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
