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
  decodeTransactionUnsafe,
  deriveHdPath,
  deriveHdPrivateNodeChild,
  deriveHdPrivateNodeFromSeed,
  deriveHdPublicNode,
  encodeHdPublicKey,
  hexToBin,
  sha256,
  utf8ToBin,
} from '@bitauth/libauth';
import {
  BCH_ASSET,
  BCH_DECIMALS,
  PUSD_CATEGORY,
  VERDICT_BUYER,
  buildCancelRequest,
  buildPublishOfferTransaction,
  createEscrowContract,
  decryptChatMessage,
  decryptPaymentDetails,
  deriveSharedTradeKey,
  derivePayoutPkhFromXpub,
  derivePubkeyFromXpub,
  deriveWalletAddressMap,
  generateSessionKeyPair,
  offerMinter,
  pkhToCashAddress,
  pkhToLockingBytecode,
  tagWalletUtxos,
  verifyChatMessageSignature,
  type OfferDocument,
} from '../src/protocol/index.js';
import {
  CampfireService,
  DEMO_GREETING,
  DEMO_TRADE_INDEX_BASE,
  DemoSeller,
  MemoryStorage,
  OracleService,
  StaticPriceFeed,
  createApiHandler,
  deriveDemoSellerWallet,
  feeAddress,
  type DemoSellerLimits,
  type StoredOffer,
  type StoredTrade,
} from '../src/server/index.js';
import { registerSignedIn, sessionHeaders, sessionOf } from './signin-helper.js';

function makeWallet(label: string) {
  const seed = new Uint8Array(64);
  seed.set(sha256.hash(utf8ToBin(label)), 0);
  const master = deriveHdPrivateNodeFromSeed(seed);
  const receiveNode = deriveHdPath(master, "m/44'/145'/0'/0");
  const defiNode = deriveHdPath(master, "m/44'/145'/0'/7");
  if (typeof receiveNode === 'string' || typeof defiNode === 'string') {
    throw new Error('HD derivation failed');
  }
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
    receiveAddr: (i: number, tokenAware = false) =>
      pkhToCashAddress(derivePayoutPkhFromXpub(receiveXpub, i), { tokenAware }),
  };
}

const buyer = makeWallet('demo-test-buyer');
const otherSeller = makeWallet('demo-test-other-seller');
const botWallet = deriveDemoSellerWallet(sha256.hash(utf8ToBin('demo-test-bot-seed')));
const ADMIN_TOKEN = 'demo-test-admin-token';
const ADMIN = { authorization: `Bearer ${ADMIN_TOKEN}` };

// Signature hash type byte appended to every signature: ALL | UTXOS | FORKID.
const SIGHASH_0X61 = 0x61;

async function setupDemo(options?: {
  limits?: Partial<DemoSellerLimits>;
  botSats?: bigint;
  botPusd?: bigint;
  // After each broadcast, this many lookups of the bot's main address return the coins as they were
  // before it, like an Electrum server that has not processed the transaction yet.
  indexerLagLookups?: number;
}) {
  let currentNow = 1_794_900_000;
  const nowSeconds = () => currentNow;
  const provider = new MockNetworkProvider();
  provider.network = Network.MAINNET;

  // Record every broadcast so tests can inspect the signatures the bot produced.
  const broadcasts: string[] = [];
  let failNextBroadcasts = 0;
  let failAfterSendCount = 0;
  const originalSend = provider.sendRawTransaction.bind(provider);
  const realGetUtxos = provider.getUtxos.bind(provider);
  const botMainAddress = botWallet.receiveAddress(0);
  let staleSnapshot: Awaited<ReturnType<typeof realGetUtxos>> | undefined;
  let staleLookupsLeft = 0;
  provider.getUtxos = async (address: string) => {
    if (address === botMainAddress && staleLookupsLeft > 0 && staleSnapshot) {
      staleLookupsLeft -= 1;
      return staleSnapshot;
    }
    return realGetUtxos(address);
  };
  provider.sendRawTransaction = async (hex: string) => {
    if (options?.indexerLagLookups) {
      staleSnapshot = await realGetUtxos(botMainAddress);
      staleLookupsLeft = options.indexerLagLookups;
    }
    if (failNextBroadcasts > 0) {
      failNextBroadcasts -= 1;
      throw new Error('simulated network error');
    }
    const txid = await originalSend(hex);
    broadcasts.push(hex);
    if (failAfterSendCount > 0) {
      // The transaction reached the network but the caller sees an error (e.g. a timeout).
      failAfterSendCount -= 1;
      throw new Error('simulated timeout after broadcast');
    }
    return txid;
  };

  const oracle = new OracleService({
    privateKey: sha256.hash(utf8ToBin('demo-test-oracle')),
    feed: new StaticPriceFeed({ 'BCH/USD': '450.00', 'PUSD/USD': '1.00' }),
    nowSeconds,
  });
  const service = new CampfireService({
    storage: new MemoryStorage(),
    provider,
    oracle,
    arbiterPrivateKey: sha256.hash(utf8ToBin('demo-test-arbiter')),
    nowSeconds,
    demoSellerIdentity: botWallet.identity,
    fundingLookupDelayMs: 0,
  });
  const demo = new DemoSeller({
    service,
    provider,
    wallet: botWallet,
    limits: options?.limits,
    nowSeconds,
    indexPollMs: 0,
  });
  await demo.init();
  const api = createApiHandler({ service, oracle, demo, adminToken: ADMIN_TOKEN });

  provider.addUtxo(botWallet.receiveAddress(0), randomUtxo({ satoshis: options?.botSats ?? 500_000n }));
  if (options?.botPusd !== 0n) {
    provider.addUtxo(
      botWallet.receiveAddress(0, true),
      randomUtxo({ satoshis: 1000n, token: { category: PUSD_CATEGORY, amount: options?.botPusd ?? 1000n } }),
    );
  }

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
    return { status: res.status, data: (await res.json()) as T };
  };

  const { data: reg } = await registerSignedIn(jsonReq, buyer);
  const buyerId: string = reg.identity;

  const { data: published } = await jsonReq<{ offers: StoredOffer[] }>(
    'POST',
    '/api/demo/offers',
    {},
    ADMIN,
  );
  const bchOffer = published.offers.find((o) => o.document.asset === BCH_ASSET)!;
  const pusdOffer = published.offers.find((o) => o.document.asset === PUSD_CATEGORY)!;

  // Takes a demo offer with a fresh buyer key index and session key.
  let nextBuyerIndex = 0;
  const take = async (offerTxid: string, amount: string) => {
    const index = nextBuyerIndex++;
    const session = generateSessionKeyPair();
    const res = await jsonReq<{ trade: StoredTrade; error?: string }>('POST', '/api/trades', {
      offerTxid,
      buyerIdentity: buyerId,
      amount,
      buyerPk: buyer.defiPkHex(index),
      buyerDefiIndex: index,
      buyerPayoutPkh: buyer.receivePkhHex(index),
      buyerReceiveIndex: index,
      buyerSessionPk: session.publicKey,
    });
    return { ...res, index, session };
  };

  return {
    provider,
    service,
    demo,
    jsonReq,
    buyerId,
    bchOffer,
    pusdOffer,
    take,
    broadcasts,
    failBroadcasts: (n: number) => {
      failNextBroadcasts = n;
    },
    failAfterSend: (n: number) => {
      failAfterSendCount = n;
    },
    advanceTime: (seconds: number) => {
      currentNow += seconds;
    },
    getNow: () => currentNow,
  };
}

function inputSighashBytes(txHex: string): number[] {
  const tx = decodeTransactionUnsafe(hexToBin(txHex));
  return tx.inputs.map((input) => {
    // Every input here starts with a 65-byte Schnorr signature push (0x41) that ends in the sighash byte.
    expect(input.unlockingBytecode[0]).toBe(0x41);
    return input.unlockingBytecode[65];
  });
}

describe('Demo seller bot (protocol section 8)', () => {
  it('publishes one BCH and one PUSD demo offer, only with the admin token', async () => {
    const ctx = await setupDemo();
    expect(ctx.bchOffer.isDemo).toBe(true);
    expect(ctx.bchOffer.document.price).toEqual({ type: 'floating', pair: 'BCH/USD', marginBps: 0 });
    expect(ctx.bchOffer.document.fiat).toBe('USD');
    expect(ctx.bchOffer.document.max).toBe('20000');
    expect(ctx.bchOffer.document.paymentWindowSec).toBe(300);
    expect(ctx.bchOffer.document.paymentMethods).toEqual(['simulated']);
    expect(ctx.pusdOffer.document.price).toEqual({ type: 'floating', pair: 'PUSD/USD', marginBps: 0 });
    expect(ctx.pusdOffer.document.max).toBe('10');
    // Offer markers use their own addresses, distinct from the main balance and from each other.
    expect(ctx.bchOffer.markerAddress).not.toBe(ctx.pusdOffer.markerAddress);
    expect(ctx.bchOffer.markerAddress).not.toBe(botWallet.receiveAddress(0));

    const anon = await ctx.jsonReq('POST', '/api/demo/offers', {});
    expect(anon.status).toBe(403);

    // Publishing again does not spend anything: both offers are still open.
    const before = ctx.broadcasts.length;
    const again = await ctx.jsonReq('POST', '/api/demo/offers', {}, ADMIN);
    expect(again.status).toBe(201);
    expect(ctx.broadcasts.length).toBe(before);

    const info = await ctx.jsonReq('GET', '/api/demo');
    expect(info.data.enabled).toBe(true);
    expect(info.data.identity).toBe(botWallet.identity);
    expect(info.data.offers).toHaveLength(2);
    expect(info.data.limits.maxBchSats).toBe('20000');
  });

  it('completes a real BCH trade: take -> bot funds -> simulated details -> paid -> bot releases', async () => {
    const ctx = await setupDemo();
    const taken = await ctx.take(ctx.bchOffer.offerTxid, '20000');
    expect(taken.status).toBe(201);
    const trade = taken.data.trade;
    expect(trade.status).toBe('Funded');
    expect(trade.isDemo).toBe(true);
    expect(trade.fiatAmount).toBe('0.09'); // 0.0002 BCH at 450.00 USD
    expect(trade.sellerReceiveIndex).toBe(DEMO_TRADE_INDEX_BASE);

    // The funding transaction is signed with sighash 0x61 like a wallet would.
    const fundingHex = await ctx.provider.getRawTransaction(trade.fundingTxid!);
    expect(new Set(inputSighashBytes(fundingHex))).toEqual(new Set([SIGHASH_0X61]));

    // Payment details are revealed on funding and labelled as simulated.
    const details = JSON.parse(
      await decryptPaymentDetails(
        taken.session.privateKey,
        trade.sellerSessionPk!,
        trade.encryptedPaymentDetails!,
      ),
    );
    expect(details.simulated).toBe(true);
    expect(details.notice).toMatch(/SIMULATED/);

    // The bot writes one automatic message once the escrow is funded, signed with its session key and readable
    // with the key the buyer shares with it. Reading the trade again does not repeat it.
    await ctx.jsonReq('GET', `/api/trades/${trade.id}`);
    const chat = await ctx.jsonReq<{ messages: { senderIdentity: string; senderRole?: string; ciphertext: string; signature: string }[] }>(
      'GET',
      `/api/trades/${trade.id}/chat`,
      undefined,
      sessionOf(ctx.buyerId),
    );
    expect(chat.data.messages).toHaveLength(1);
    const [greeting] = chat.data.messages;
    expect(greeting.senderIdentity).toBe(botWallet.identity);
    expect(greeting.senderRole).toBe('seller');
    expect(verifyChatMessageSignature(trade.sellerSessionPk!, trade.tradeId!, greeting.ciphertext, greeting.signature)).toBe(true);
    const chatKey = deriveSharedTradeKey(taken.session.privateKey, trade.sellerSessionPk!);
    expect(await decryptChatMessage(chatKey, greeting.ciphertext)).toBe(DEMO_GREETING);
    expect(DEMO_GREETING).toMatch(/^Automatic message/);

    const paid = await ctx.jsonReq<{ trade: StoredTrade }>('POST', `/api/trades/${trade.id}/paid`, {
      buyerIdentity: ctx.buyerId,
    });
    expect(paid.status).toBe(200);
    expect(paid.data.trade.status).toBe('Released');

    // The release spends the escrow with a 0x61 Schnorr signature and pays the buyer's address.
    const releaseHex = await ctx.provider.getRawTransaction(paid.data.trade.settlementTxid!);
    expect(inputSighashBytes(releaseHex)).toEqual([SIGHASH_0X61]);
    const received = await ctx.provider.getUtxos(buyer.receiveAddr(taken.index));
    expect(received).toHaveLength(1);
    expect(received[0].satoshis).toBeGreaterThanOrEqual(20_000n);

    const rep = await ctx.jsonReq('GET', `/api/identities/${botWallet.identity}/reputation`);
    expect(rep.data.completedAsSeller).toBe(1);
  });

  it('completes a real PUSD trade and gives the buyer the tokens plus at least 6,000 sats', async () => {
    const ctx = await setupDemo();
    const taken = await ctx.take(ctx.pusdOffer.offerTxid, '10');
    expect(taken.data.trade.status).toBe('Funded');
    expect(taken.data.trade.fiatAmount).toBe('0.10');

    const paid = await ctx.jsonReq<{ trade: StoredTrade }>(
      'POST',
      `/api/trades/${taken.data.trade.id}/paid`,
      { buyerIdentity: ctx.buyerId },
    );
    expect(paid.data.trade.status).toBe('Released');
    const received = await ctx.provider.getUtxos(buyer.receiveAddr(taken.index, true));
    expect(received).toHaveLength(1);
    expect(received[0].token?.category).toBe(PUSD_CATEGORY);
    expect(received[0].token?.amount).toBe(10n);
    expect(received[0].satoshis).toBeGreaterThanOrEqual(6000n);
  });

  it('waits for a lagging indexer so back-to-back transactions never reuse a spent coin', async () => {
    // Publishing both offers in a row failed on mainnet with "txn-mempool-conflict" before this wait.
    const ctx = await setupDemo({ indexerLagLookups: 3 });
    expect(ctx.bchOffer).toBeDefined();
    expect(ctx.pusdOffer).toBeDefined();

    // Two takes in quick succession: the second funding must use the first one's change.
    const first = await ctx.take(ctx.bchOffer.offerTxid, '20000');
    const second = await ctx.take(ctx.bchOffer.offerTxid, '20000');
    expect(first.data.trade.status).toBe('Funded');
    expect(second.data.trade.status).toBe('Funded');
  });

  it('rejects amounts above the demo cap', async () => {
    const ctx = await setupDemo();
    const tooBig = await ctx.take(ctx.bchOffer.offerTxid, '20001');
    expect(tooBig.status).toBe(400);
    expect(tooBig.data.error).toMatch(/outside offer range/);
  });

  it('lets the buyer cancel; the funds return to a payout address the bot later spends', async () => {
    const ctx = await setupDemo({ botSats: 30_000n });
    const taken = await ctx.take(ctx.bchOffer.offerTxid, '20000');
    const trade = taken.data.trade;
    expect(trade.status).toBe('Funded');

    // With the rest of its balance the bot cannot fund a second trade of this size yet.
    const busy = await ctx.demo.spendableUtxos();
    expect(busy.reduce((sum, u) => sum + u.satoshis, 0n)).toBeLessThan(20_000n);

    const contract = createEscrowContract(trade.terms!, trade.tradeId!, ctx.provider);
    const [escrowUtxo] = await contract.getUtxos();
    const { fee } = buildCancelRequest({
      contract,
      utxo: escrowUtxo,
      sellerPayoutPkh: trade.terms!.sellerPayoutPkh,
      buyerDefiIndex: taken.index,
    });
    const signedTxHex = new TransactionBuilder({ provider: ctx.provider })
      .addInput(escrowUtxo, contract.unlock.cancel(new SignatureTemplate(buyer.defiPriv(taken.index))))
      .addOutput({ to: pkhToLockingBytecode(trade.terms!.sellerPayoutPkh), amount: escrowUtxo.satoshis - fee })
      .build();
    const cancelled = await ctx.jsonReq<{ trade: StoredTrade }>('POST', `/api/trades/${trade.id}/settle`, {
      path: 'cancel',
      signedTxHex,
    });
    expect(cancelled.data.trade.status).toBe('Cancelled');

    // The next take needs the returned coins: the bot finds them at the trade's payout address.
    const second = await ctx.take(ctx.bchOffer.offerTxid, '20000');
    expect(second.status).toBe(201);
    expect(second.data.trade.status).toBe('Funded');
  });

  it('never funds an escrow twice when a broadcast times out after reaching the network', async () => {
    const ctx = await setupDemo();
    ctx.failAfterSend(1);
    const taken = await ctx.take(ctx.bchOffer.offerTxid, '20000');
    expect(taken.status).toBe(400);
    expect(taken.data.error).toMatch(/could not confirm the escrow funding/);

    const [trade] = await ctx.service.listTrades({ identity: ctx.buyerId });
    expect(trade.status).toBe('Accepted');
    const contract = createEscrowContract(trade.terms!, trade.tradeId!, ctx.provider);
    expect(await contract.getUtxos()).toHaveLength(1);

    // The next read records the funding that did happen, without paying again.
    const read = await ctx.jsonReq<{ trade: StoredTrade }>('GET', `/api/trades/${trade.id}`);
    expect(read.data.trade.status).toBe('Funded');
    expect(await contract.getUtxos()).toHaveLength(1);
  });

  it('never funds twice from another server instance while the indexer lags', async () => {
    const ctx = await setupDemo();
    ctx.failAfterSend(1);
    const taken = await ctx.take(ctx.bchOffer.offerTxid, '20000');
    expect(taken.status).toBe(400);
    const [trade] = await ctx.service.listTrades({ identity: ctx.buyerId });
    const contract = createEscrowContract(trade.terms!, trade.tradeId!, ctx.provider);

    // A second instance has none of the first one's memory, and its indexer does not list the escrow yet.
    const otherInstance = new DemoSeller({
      service: ctx.service,
      provider: ctx.provider,
      wallet: botWallet,
      nowSeconds: ctx.getNow,
    });
    const realGetUtxos = ctx.provider.getUtxos.bind(ctx.provider);
    ctx.provider.getUtxos = async (address: string) =>
      address === contract.address ? [] : realGetUtxos(address);
    await otherInstance.reconcile(trade.id);
    ctx.provider.getUtxos = realGetUtxos;

    // It only rebroadcast the stored transaction, so the escrow still holds a single UTXO.
    expect(await contract.getUtxos()).toHaveLength(1);
    await otherInstance.reconcile(trade.id);
    const after = await ctx.service.getTrade(trade.id);
    expect(after?.status).toBe('Funded');
    expect(after?.pendingFundingTxHex).toBeUndefined(); // not exposed outside the arbiter view
    expect(await contract.getUtxos()).toHaveLength(1);
  });

  it('declines a take it cannot pay for instead of holding an active slot', async () => {
    // After publishing its two offers the bot keeps about 7,000 sats and no PUSD.
    const ctx = await setupDemo({ botSats: 10_000n, botPusd: 0n });
    const noBch = await ctx.take(ctx.bchOffer.offerTxid, '20000');
    expect(noBch.status).toBe(429);
    expect(noBch.data.error).toMatch(/run out of funds/);
    const noPusd = await ctx.take(ctx.pusdOffer.offerTxid, '10');
    expect(noPusd.status).toBe(429);
    // Declined trades are Dropped, so they hold no active slot.
    const trades = await ctx.service.listTrades({ identity: ctx.buyerId });
    expect(trades.map((t) => t.status)).toEqual(['Dropped', 'Dropped']);
  });

  it('returns the funds to the bot by arbiter verdict when the 5-minute payment window ends', async () => {
    const ctx = await setupDemo();
    const taken = await ctx.take(ctx.bchOffer.offerTxid, '15000');
    ctx.advanceTime(301);
    const expired = await ctx.jsonReq<{ trade: StoredTrade }>('GET', `/api/trades/${taken.data.trade.id}`);
    expect(expired.data.trade.status).toBe('ResolvedSeller');
    expect(expired.data.trade.settlementTxid).toMatch(/^[0-9a-f]{64}$/);
    const back = await ctx.provider.getUtxos(botWallet.receiveAddress(DEMO_TRADE_INDEX_BASE));
    expect(back[0].satoshis).toBeGreaterThanOrEqual(15_000n);
  });

  it('retries a failed arbitrate broadcast on the next read instead of stranding the escrow', async () => {
    const ctx = await setupDemo();
    const taken = await ctx.take(ctx.bchOffer.offerTxid, '15000');
    ctx.advanceTime(301);

    // One GET reads the trade twice (demo reconcile, then the response), so fail both attempts.
    ctx.failBroadcasts(2);
    const first = await ctx.jsonReq<{ trade: StoredTrade }>('GET', `/api/trades/${taken.data.trade.id}?viewer=${ctx.buyerId}`);
    expect(first.data.trade.status).toBe('ResolvedSeller');
    expect(first.data.trade.verdictSignature).toBeDefined();
    expect(first.data.trade.settlementTxid).toBeUndefined();

    const second = await ctx.jsonReq<{ trade: StoredTrade }>('GET', `/api/trades/${taken.data.trade.id}`);
    expect(second.data.trade.settlementTxid).toMatch(/^[0-9a-f]{64}$/);
  });

  it('runs the demo arbiter console only on disputed trades against the bot', async () => {
    const ctx = await setupDemo();
    const taken = await ctx.take(ctx.bchOffer.offerTxid, '20000');
    const id = taken.data.trade.id;

    const early = await ctx.jsonReq('POST', `/api/demo/trades/${id}/verdict`, { verdict: VERDICT_BUYER });
    expect(early.status).toBe(400);
    // Before the dispute a visitor reads the public view only: no names, no fiat terms.
    const earlyView = await ctx.jsonReq('GET', `/api/trades/${id}?arbiter=true`);
    expect(earlyView.status).toBe(200);
    expect(earlyView.data.trade.public).toBe(true);
    expect(earlyView.data.trade.buyerIdentity).toBeUndefined();
    expect(earlyView.data.trade.fiatAmount).toBeUndefined();

    const disputed = await ctx.jsonReq<{ trade: StoredTrade }>('POST', `/api/trades/${id}/dispute`, {
      callerIdentity: ctx.buyerId,
      reason: 'Testing the demo arbiter console',
    });
    expect(disputed.data.trade.status).toBe('Disputed');

    // Any visitor can open the arbiter view of a disputed demo trade: the whole record, without the chat key.
    const view = await ctx.jsonReq('GET', `/api/trades/${id}?arbiter=true`);
    expect(view.status).toBe(200);
    expect(view.data.trade.public).toBeUndefined();
    expect(view.data.trade.disputeReason).toBe('Testing the demo arbiter console');
    expect(view.data.trade.sharedTradeKeyHex).toBeUndefined();

    const decided = await ctx.jsonReq<{ trade: StoredTrade; simulatedArbiter: boolean }>(
      'POST',
      `/api/demo/trades/${id}/verdict`,
      { verdict: VERDICT_BUYER },
    );
    expect(decided.status).toBe(200);
    expect(decided.data.simulatedArbiter).toBe(true);
    expect(decided.data.trade.status).toBe('ResolvedBuyer');
    expect((await ctx.provider.getUtxos(buyer.receiveAddr(taken.index)))[0].satoshis).toBeGreaterThanOrEqual(
      20_000n,
    );

    const unknown = await ctx.jsonReq('POST', `/api/demo/trades/${'ab'.repeat(16)}/verdict`, {
      verdict: VERDICT_BUYER,
    });
    expect(unknown.status).toBe(403);
  });

  it('ignores a client-supplied isDemo flag and keeps the console closed for other sellers', async () => {
    const ctx = await setupDemo();
    const { data: reg } = await registerSignedIn(ctx.jsonReq, otherSeller);
    const cfg = await ctx.jsonReq('GET', '/api/config');
    expect(cfg.data.demoSellerIdentity).toBe(botWallet.identity);
    const doc: OfferDocument = {
      v: 1,
      side: 'sell',
      asset: BCH_ASSET,
      assetDecimals: BCH_DECIMALS,
      fiat: 'USD',
      price: { type: 'fixed', value: '450.00' },
      min: '10000',
      max: '50000',
      paymentMethods: ['bank-transfer'],
      paymentWindowSec: 3600,
      expiresAt: ctx.getNow() + 86_400,
      arbiter: cfg.data.arbiterPk,
    };
    const addrMap = deriveWalletAddressMap({ receiveXpub: otherSeller.receiveXpub, count: 3 });
    const raw = ctx.provider.addUtxo(otherSeller.receiveAddr(0), randomUtxo({ satoshis: 100_000n }));
    const utxos = tagWalletUtxos([raw], addrMap).map((u) => ({
      ...u,
      signer: new SignatureTemplate(otherSeller.receivePriv(u.keyIndex)),
    }));
    const tx = buildPublishOfferTransaction({
      provider: ctx.provider,
      document: doc,
      utxos,
      markerAddress: otherSeller.receiveAddr(1),
      changeAddress: otherSeller.receiveAddr(0),
    });
    const posted = await ctx.jsonReq<{ offer: StoredOffer }>('POST', '/api/offers', {
      sellerIdentity: reg.identity,
      offerJson: tx.offerJson,
      offerTxHex: tx.hex,
      markerReceiveIndex: 1,
      isDemo: true,
    });
    expect(posted.status).toBe(201);
    expect(posted.data.offer.isDemo).toBe(false);

    // A take on this offer is an ordinary trade: the bot does not touch it.
    const taken = await ctx.take(posted.data.offer.offerTxid, '10000');
    expect(taken.data.trade.status).toBe('Requested');
    expect(taken.data.trade.isDemo).toBe(false);
  });

  it('serialises simultaneous takes so they never spend the same coin, and caps active trades', async () => {
    const ctx = await setupDemo({ limits: { maxActiveTrades: 2 } });
    const [a, b] = await Promise.all([
      ctx.take(ctx.bchOffer.offerTxid, '20000'),
      ctx.take(ctx.bchOffer.offerTxid, '20000'),
    ]);
    expect(a.data.trade.status).toBe('Funded');
    expect(b.data.trade.status).toBe('Funded');
    expect(a.data.trade.fundingTxid).not.toBe(b.data.trade.fundingTxid);
    // Each trade has its own signing key and payout address.
    expect(a.data.trade.sellerPk).not.toBe(b.data.trade.sellerPk);
    expect(a.data.trade.sellerPayoutPkh).not.toBe(b.data.trade.sellerPayoutPkh);

    const third = await ctx.take(ctx.bchOffer.offerTxid, '20000');
    expect(third.status).toBe(429);
    expect(third.data.error).toMatch(/busy/);
  });

  it('caps the trades the bot funds per day across all visitors', async () => {
    const ctx = await setupDemo({ limits: { maxDailyFundings: 2, maxActiveTrades: 10 } });
    expect((await ctx.take(ctx.bchOffer.offerTxid, '10000')).status).toBe(201);
    expect((await ctx.take(ctx.bchOffer.offerTxid, '10000')).status).toBe(201);
    const third = await ctx.take(ctx.bchOffer.offerTxid, '10000');
    expect(third.status).toBe(429);
    expect(third.data.error).toMatch(/daily limit/);

    ctx.advanceTime(86_401);
    const nextDay = await ctx.take(ctx.bchOffer.offerTxid, '10000');
    expect(nextDay.status).toBe(201);
    expect(nextDay.data.trade.status).toBe('Funded');
  });

  describe('administration panel: GET /api/admin/accounts', () => {
    it('shows the bot balance and the fee addresses only to the admin, and the fees a trade paid', async () => {
      const ctx = await setupDemo();
      // 5% each, so a 0.0002 BCH trade pays fees above the dust limit.
      await ctx.service.setFeeRates({ arbiterBps: 500, oracleBps: 500 });

      const anon = await ctx.jsonReq('GET', '/api/admin/accounts');
      expect(anon.status).toBe(403);

      const before = await ctx.jsonReq('GET', '/api/admin/accounts', undefined, ADMIN);
      expect(before.status).toBe(200);
      expect(before.data.bchUsd).toBe('450.00');
      expect(before.data.bot.address).toBe(botWallet.receiveAddress(0));
      expect(before.data.bot.tokenAddress).toBe(botWallet.receiveAddress(0, true));
      expect(before.data.bot.pusdUnits).toBe('1000');
      expect(before.data.bot.addressCount).toBe(1);
      expect(before.data.bot.canFundMax).toEqual({ BCH: true, PUSD: true });
      expect(before.data.bot.maxBchSats).toBe('20000');
      // The same coins the bot decides with: the panel and spendableUtxos never disagree.
      const coins = await ctx.demo.spendableUtxos();
      expect(before.data.bot.bchSats).toBe(coins.reduce((sum, u) => sum + u.satoshis, 0n).toString());
      expect(before.data.oracle.address).toBe(feeAddress(ctx.service.oraclePublicKeyHex));
      expect(before.data.arbiter.address).toBe(feeAddress(ctx.service.arbiterPublicKeyHex));
      expect(before.data.oracle.bchSats).toBe('0');
      expect(before.data.arbiter.bchSats).toBe('0');

      const taken = await ctx.take(ctx.bchOffer.offerTxid, '20000');
      expect(taken.data.trade.status).toBe('Funded');
      const after = await ctx.jsonReq('GET', '/api/admin/accounts', undefined, ADMIN);
      expect(after.data.oracle.bchSats).toBe('1000');
      expect(after.data.arbiter.bchSats).toBe('1000');
    });

    it('warns when the bot cannot fund a trade at its maximum', async () => {
      const ctx = await setupDemo({ botSats: 10_000n, botPusd: 0n });
      const { data } = await ctx.jsonReq('GET', '/api/admin/accounts', undefined, ADMIN);
      expect(data.bot.pusdUnits).toBe('0');
      expect(data.bot.canFundMax).toEqual({ BCH: false, PUSD: false });
    });

    it('counts the coins a trade returned to the bot at its payout address', async () => {
      const ctx = await setupDemo();
      const taken = await ctx.take(ctx.bchOffer.offerTxid, '15000');
      ctx.advanceTime(301);
      const expired = await ctx.jsonReq<{ trade: StoredTrade }>('GET', `/api/trades/${taken.data.trade.id}`);
      expect(expired.data.trade.status).toBe('ResolvedSeller');
      const { data } = await ctx.jsonReq('GET', '/api/admin/accounts', undefined, ADMIN);
      expect(data.bot.addressCount).toBe(2);
      const back = await ctx.provider.getUtxos(botWallet.receiveAddress(DEMO_TRADE_INDEX_BASE));
      const main = await ctx.provider.getUtxos(botWallet.receiveAddress(0));
      const total = [...back, ...main].reduce((sum, u) => sum + u.satoshis, 0n);
      expect(data.bot.bchSats).toBe(total.toString());
    });
  });
});

describe('Demo offers through the minter lanes', () => {
  it('builds the offer again on another lane when the network refuses the first one', async () => {
    const category = binToHex(sha256.hash(utf8ToBin('demo-lane-category')));
    const provider = new MockNetworkProvider();
    provider.network = Network.MAINNET;
    const minting = { category, amount: 0n, nft: { capability: 'minting' as const, commitment: '' } };
    const minter = offerMinter(provider).tokenAddress;
    provider.addUtxo(minter, randomUtxo({ satoshis: 1000n, token: minting }));
    provider.addUtxo(minter, randomUtxo({ satoshis: 1000n, token: minting }));

    // The first broadcast is refused, as when someone else just spent the same lane.
    const lanesTried: string[] = [];
    const send = provider.sendRawTransaction.bind(provider);
    provider.sendRawTransaction = async (hex: string) => {
      const input = decodeTransactionUnsafe(hexToBin(hex)).inputs[0];
      lanesTried.push(`${binToHex(input.outpointTransactionHash)}:${input.outpointIndex}`);
      if (lanesTried.length === 1) throw new Error('txn-mempool-conflict');
      return send(hex);
    };

    const nowSeconds = () => 1_794_900_000;
    const oracle = new OracleService({ privateKey: sha256.hash(utf8ToBin('lane-oracle')), feed: new StaticPriceFeed({ 'BCH/USD': '450.00' }), nowSeconds });
    const service = new CampfireService({
      storage: new MemoryStorage(),
      provider,
      oracle,
      arbiterPrivateKey: sha256.hash(utf8ToBin('lane-arbiter')),
      nowSeconds,
      demoSellerIdentity: botWallet.identity,
      offerCategory: category,
    });
    const demo = new DemoSeller({ service, provider, wallet: botWallet, nowSeconds, indexPollMs: 0 });
    await demo.init();
    provider.addUtxo(botWallet.receiveAddress(0), randomUtxo({ satoshis: 500_000n }));

    const [offer] = await demo.publishOffers(['BCH']);
    expect(offer.onChain.version).toBe(2);
    expect(lanesTried).toHaveLength(2);
    expect(new Set(lanesTried).size).toBe(2);
  });
});
