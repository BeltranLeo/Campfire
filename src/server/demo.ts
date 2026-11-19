// Demo seller bot (protocol section 8): a wallet run by the service that sells small amounts of BCH and PUSD
// on mainnet, so a visitor can complete a real trade without owning funds. Only the fiat payment is simulated.

import { randomBytes } from 'node:crypto';
import {
  binToHex,
  decodeTransactionUnsafe,
  deriveHdPath,
  hexToBin,
  sha256,
  deriveHdPrivateNodeChild,
  deriveHdPrivateNodeFromSeed,
  deriveHdPublicNode,
  encodeHdPublicKey,
  hmacSha256,
  secp256k1,
  utf8ToBin,
  type HdPrivateNodeValid,
} from '@bitauth/libauth';
import {
  SignatureAlgorithm,
  SignatureTemplate,
  SighashType,
  TransactionBuilder,
  type NetworkProvider,
  type Utxo,
} from 'cashscript';
import {
  BCH_ASSET,
  BCH_DECIMALS,
  PUSD_CATEGORY,
  PUSD_DECIMALS,
  buildFundEscrowTransaction,
  buildPublishOfferTransaction,
  buildReleaseRequest,
  createEscrowContract,
  deriveSharedTradeKey,
  derivePayoutPkhFromXpub,
  expectedEscrowFunding,
  derivePubkeyFromXpub,
  encryptChatMessage,
  encryptPaymentDetails,
  identityFromDefiXpub,
  matchesEscrowFunding,
  pkhToCashAddress,
  pkhToLockingBytecode,
  signChatMessage,
  signPaymentDetails,
  toBytes,
  validateOfferDocument,
  type OfferDocument,
  type WalletSpendableUtxo,
} from '../protocol/index.js';
import { FUNDING_WINDOW_SEC, SponsorshipLimitError, type CampfireService, type OfferView } from './service.js';
import type { StoredTrade, TradeState } from './storage.js';

// Same derivation paths as the test wallets; the `defi` branch holds the contract signing keys.
const RECEIVE_PATH = "m/44'/145'/0'/0";
const DEFI_PATH = "m/44'/145'/0'/7";

// receive/0 holds the bot's balance and takes all change. Offer markers use receive/1..99
// and each trade gets its own payout address from receive/100 onward (one address per use).
export const DEMO_MAIN_INDEX = 0;
export const DEMO_MARKER_INDEX_BASE = 1;
export const DEMO_TRADE_INDEX_BASE = 100;

// Every signature the bot makes uses SIGHASH_ALL | SIGHASH_UTXOS (0x61 with FORKID), like the wallets.
const BOT_SIGHASH = SighashType.SIGHASH_ALL | SighashType.SIGHASH_UTXOS;

const ACTIVE_STATES: TradeState[] = ['Requested', 'Accepted', 'Funded', 'Paid', 'Disputed'];
const SELLER_PAYOUT_STATES: TradeState[] = ['Cancelled', 'ResolvedSeller', 'Refunded'];

export const DEMO_PAYMENT_METHOD = 'simulated';
export const DEMO_GREETING =
  'Automatic message from the demo seller: the coins are locked in the escrow. Send the simulated payment and mark it as paid.';
export const DEMO_OFFER_TERMS =
  'DEMO OFFER. The fiat payment is simulated: do not send any money, just mark the trade as paid. ' +
  'The escrow, the release and every other on-chain step are real mainnet transactions.';

export interface DemoSellerLimits {
  minBchSats: bigint;
  maxBchSats: bigint;
  minPusdUnits: bigint;
  maxPusdUnits: bigint;
  // Trades that are not finished yet (requested, accepted, funded, paid or disputed).
  maxActiveTrades: number;
  // Trades the bot accepted (and therefore funds) in the last 24 hours, across all visitors.
  maxDailyFundings: number;
  paymentWindowSec: number;
  offerLifetimeSec: number;
}

// Identity is a hash of a presented xpub with no proof of possession (D29), so per-wallet limits are
// trivially bypassed with a fresh wallet. The limits that bound the bot's losses are global.
export const DEFAULT_DEMO_LIMITS: DemoSellerLimits = {
  minBchSats: 5_000n,
  maxBchSats: 20_000n,
  minPusdUnits: 1n, // 0.01 PUSD
  maxPusdUnits: 10n, // 0.10 PUSD
  maxActiveTrades: 2,
  maxDailyFundings: 10,
  paymentWindowSec: 300, // 5 minutes (protocol section 8)
  offerLifetimeSec: 30 * 86_400,
};

export type DemoAsset = 'BCH' | 'PUSD';

export class DemoLimitError extends Error {}

export interface DemoSellerWallet {
  identity: string;
  defiXpub: string;
  receiveXpub: string;
  defiPubkeyHex(index: number): string;
  defiPrivateKey(index: number): Uint8Array;
  receivePkhHex(index: number): string;
  receivePrivateKey(index: number): Uint8Array;
  receiveAddress(index: number, tokenAware?: boolean): string;
  // Deterministic per-trade session key, so the bot needs no extra storage to read its own chat.
  sessionPrivateKey(tradeRecordId: string): Uint8Array;
}

function privateChild(node: HdPrivateNodeValid, index: number): Uint8Array {
  const child = deriveHdPrivateNodeChild(node, index);
  if (typeof child === 'string') {
    throw new Error(`Demo seller key derivation failed: ${child}`);
  }
  return child.privateKey;
}

// Derives the bot wallet from a secret seed (16 to 64 bytes, kept as a deployment secret).
export function deriveDemoSellerWallet(seedInput: Uint8Array | string): DemoSellerWallet {
  const seed = toBytes(seedInput, 'demoSellerSeed');
  if (seed.length < 16 || seed.length > 64) {
    throw new Error('Demo seller seed must be 16 to 64 bytes');
  }
  const master = deriveHdPrivateNodeFromSeed(seed);
  if (typeof master === 'string') {
    throw new Error(`Invalid demo seller seed: ${master}`);
  }
  const receiveNode = deriveHdPath(master, RECEIVE_PATH);
  const defiNode = deriveHdPath(master, DEFI_PATH);
  if (typeof receiveNode === 'string' || typeof defiNode === 'string') {
    throw new Error('Demo seller HD derivation failed');
  }
  const receiveXpub = encodeHdPublicKey({
    network: 'mainnet',
    node: deriveHdPublicNode(receiveNode),
  }).hdPublicKey;
  const defiXpub = encodeHdPublicKey({
    network: 'mainnet',
    node: deriveHdPublicNode(defiNode),
  }).hdPublicKey;

  return {
    identity: identityFromDefiXpub(defiXpub),
    defiXpub,
    receiveXpub,
    defiPubkeyHex: (i) => binToHex(derivePubkeyFromXpub(defiXpub, i)),
    defiPrivateKey: (i) => privateChild(defiNode, i),
    receivePkhHex: (i) => binToHex(derivePayoutPkhFromXpub(receiveXpub, i)),
    receivePrivateKey: (i) => privateChild(receiveNode, i),
    receiveAddress: (i, tokenAware = false) =>
      pkhToCashAddress(derivePayoutPkhFromXpub(receiveXpub, i), { tokenAware }),
    sessionPrivateKey: (tradeRecordId) => {
      let counter = 0;
      for (;;) {
        const candidate = hmacSha256(
          seed,
          utf8ToBin(`CMPF-DEMO-SESSION-v1:${tradeRecordId}:${counter}`),
        );
        if (secp256k1.validatePrivateKey(candidate)) return candidate;
        counter += 1;
      }
    },
  };
}

function compressedPublicKeyHex(privateKey: Uint8Array): string {
  const pub = secp256k1.derivePublicKeyCompressed(privateKey);
  if (typeof pub === 'string') {
    throw new Error(`Failed to derive public key: ${pub}`);
  }
  return binToHex(pub);
}

export function demoAssetId(asset: DemoAsset): string {
  return asset === 'BCH' ? BCH_ASSET : PUSD_CATEGORY;
}

export class DemoSeller {
  readonly limits: DemoSellerLimits;
  private readonly nowSeconds: () => number;
  // Serialises every action that selects the bot's UTXOs or allocates key indices, so two
  // simultaneous takes on the same instance never spend the same coin twice.
  private queue: Promise<unknown> = Promise.resolve();

  constructor(
    private readonly options: {
      service: CampfireService;
      provider: NetworkProvider;
      wallet: DemoSellerWallet;
      limits?: Partial<DemoSellerLimits>;
      nowSeconds?: () => number;
      // Cross-instance lock (for example a Postgres advisory lock), held around every wallet action.
      withLock?: <T>(name: string, fn: () => Promise<T>) => Promise<T>;
      // How long to wait for the indexer to reflect the bot's own transactions (see waitUntilIndexed).
      indexPollMs?: number;
      indexTimeoutMs?: number;
    },
  ) {
    if (options.service.demoSellerIdentity !== options.wallet.identity) {
      throw new Error('CampfireService must be created with demoSellerIdentity set to the demo wallet identity');
    }
    this.limits = { ...DEFAULT_DEMO_LIMITS, ...options.limits };
    this.nowSeconds = options.nowSeconds ?? (() => Math.floor(Date.now() / 1000));
  }

  get identity(): string {
    return this.options.wallet.identity;
  }

  get mainAddress(): string {
    return this.options.wallet.receiveAddress(DEMO_MAIN_INDEX);
  }

  get mainTokenAddress(): string {
    return this.options.wallet.receiveAddress(DEMO_MAIN_INDEX, true);
  }

  private exclusive<T>(fn: () => Promise<T>): Promise<T> {
    const withLock = this.options.withLock;
    const locked = withLock ? () => withLock('campfire-demo-seller', fn) : fn;
    const run = this.queue.then(locked, locked);
    this.queue = run.catch(() => undefined);
    return run;
  }

  async init(): Promise<void> {
    await this.options.service.registerIdentity({
      defiXpub: this.options.wallet.defiXpub,
      receiveXpub: this.options.wallet.receiveXpub,
    });
  }

  // --- Wallet ---

  private signerFor(index: number): SignatureTemplate {
    return new SignatureTemplate(
      this.options.wallet.receivePrivateKey(index),
      BOT_SIGHASH,
      SignatureAlgorithm.SCHNORR,
    );
  }

  private async botTrades(): Promise<StoredTrade[]> {
    const trades = await this.options.service.listTrades({ identity: this.identity });
    return trades.filter((t) => t.sellerIdentity === this.identity);
  }

  // Spendable coins: the main address plus the payout addresses of trades that paid the bot back
  // (cancel, arbitrate for the seller, refund). Offer markers are never spent here.
  async spendableUtxos(): Promise<WalletSpendableUtxo[]> {
    const indices = new Set<number>([DEMO_MAIN_INDEX]);
    for (const t of await this.botTrades()) {
      if (SELLER_PAYOUT_STATES.includes(t.status) && t.sellerReceiveIndex !== undefined) {
        indices.add(t.sellerReceiveIndex);
      }
    }
    const seen = new Set<string>();
    const result: WalletSpendableUtxo[] = [];
    for (const index of indices) {
      const address = this.options.wallet.receiveAddress(index);
      const utxos: Utxo[] = await this.options.provider.getUtxos(address);
      for (const u of utxos) {
        const key = `${u.txid}:${u.vout}`;
        if (seen.has(key)) continue;
        seen.add(key);
        result.push({
          ...u,
          lockingBytecode: binToHex(pkhToLockingBytecode(this.options.wallet.receivePkhHex(index))),
          pathName: 'receive',
          keyIndex: index,
          address,
          signer: this.signerFor(index),
        } as WalletSpendableUtxo);
      }
    }
    return result;
  }

  // An Electrum server lists a just-broadcast transaction only a moment later. Until then it still
  // reports the spent coins as unspent, and the next transaction built from them is rejected as a
  // mempool conflict (seen on mainnet when publishing two offers in a row). Called while holding the
  // lock, so the next wallet action of any instance starts from an up-to-date coin list.
  private async waitUntilIndexed(txHex: string): Promise<void> {
    const tx = decodeTransactionUnsafe(hexToBin(txHex));
    const txid = binToHex(sha256.hash(sha256.hash(hexToBin(txHex))).reverse());
    const spent = new Set(tx.inputs.map((i) => `${binToHex(i.outpointTransactionHash)}:${i.outpointIndex}`));
    const mainLock = binToHex(pkhToLockingBytecode(this.options.wallet.receivePkhHex(DEMO_MAIN_INDEX)));
    const change = tx.outputs.flatMap((o, vout) =>
      binToHex(o.lockingBytecode) === mainLock ? [`${txid}:${vout}`] : [],
    );

    const pollMs = this.options.indexPollMs ?? 500;
    const deadline = Date.now() + (this.options.indexTimeoutMs ?? 15_000);
    for (;;) {
      const listed = new Set((await this.spendableUtxos()).map((u) => `${u.txid}:${u.vout}`));
      const spentGone = [...spent].every((o) => !listed.has(o));
      const changeShown = change.every((o) => listed.has(o));
      if (spentGone && changeShown) return;
      if (Date.now() >= deadline) {
        console.warn(`Indexer has not reflected transaction ${txid} yet; continuing`);
        return;
      }
      await new Promise((resolve) => setTimeout(resolve, pollMs));
    }
  }

  // --- Offers ---

  // Publishes one open offer per requested asset unless the bot already has one. Spends real sats:
  // it is reached only through an admin-protected route.
  publishOffers(assets: DemoAsset[] = ['BCH', 'PUSD']): Promise<OfferView[]> {
    return this.exclusive(async () => {
      const service = this.options.service;
      const allOffers = await service.listOffers();
      const botOffers = allOffers.filter((o) => o.sellerIdentity === this.identity);
      const published: OfferView[] = [];
      let markerIndex = DEMO_MARKER_INDEX_BASE + botOffers.length;

      for (const asset of assets) {
        const assetId = demoAssetId(asset);
        const existing = botOffers.find(
          (o) => o.status === 'Published' && o.document.asset === assetId,
        );
        if (existing) {
          published.push(existing);
          continue;
        }
        if (markerIndex >= DEMO_TRADE_INDEX_BASE) {
          throw new Error('Demo seller has used all offer marker indices');
        }

        const isBch = asset === 'BCH';
        const document: OfferDocument = {
          v: 1,
          side: 'sell',
          asset: assetId,
          assetDecimals: isBch ? BCH_DECIMALS : PUSD_DECIMALS,
          fiat: 'USD',
          price: { type: 'floating', pair: isBch ? 'BCH/USD' : 'PUSD/USD', marginBps: 0 },
          min: (isBch ? this.limits.minBchSats : this.limits.minPusdUnits).toString(),
          max: (isBch ? this.limits.maxBchSats : this.limits.maxPusdUnits).toString(),
          paymentMethods: [DEMO_PAYMENT_METHOD],
          paymentWindowSec: this.limits.paymentWindowSec,
          terms: DEMO_OFFER_TERMS,
          expiresAt: this.nowSeconds() + this.limits.offerLifetimeSec,
          arbiter: service.arbiterPublicKeyHex,
          oracle: service.oraclePublicKeyHex,
        };

        const tx = buildPublishOfferTransaction({
          provider: this.options.provider,
          document,
          utxos: await this.spendableUtxos(),
          markerAddress: this.options.wallet.receiveAddress(markerIndex),
          changeAddress: this.mainAddress,
        });
        const offer = await service.publishOffer({
          sellerIdentity: this.identity,
          offerJson: tx.offerJson,
          offerTxHex: tx.hex,
          markerReceiveIndex: markerIndex,
          broadcast: true,
        });
        await this.waitUntilIndexed(tx.hex);
        published.push(offer);
        markerIndex += 1;
      }
      return published;
    });
  }

  // --- Limits ---

  private async checkLimits(excludeTradeRecordId?: string): Promise<void> {
    const now = this.nowSeconds();
    const trades = (await this.botTrades()).filter((t) => t.id !== excludeTradeRecordId);
    const active = trades.filter((t) => ACTIVE_STATES.includes(t.status)).length;
    if (active >= this.limits.maxActiveTrades) {
      throw new DemoLimitError(
        'The demo seller is busy with other visitors. Please try again in a few minutes.',
      );
    }
    const acceptedToday = trades.filter(
      (t) => t.fundingDeadline !== undefined && t.fundingDeadline - FUNDING_WINDOW_SEC > now - 86_400,
    ).length;
    if (acceptedToday >= this.limits.maxDailyFundings) {
      throw new DemoLimitError(
        'The demo seller has reached its daily limit of trades. Please try again tomorrow.',
      );
    }
  }

  // Declines before accepting when the bot cannot pay the escrow, so an empty bot does not keep
  // trades stuck in Accepted (holding active slots) until the funding window ends.
  private async checkBalance(trade: Pick<StoredTrade, 'asset' | 'amount'>): Promise<void> {
    const expected = expectedEscrowFunding(trade);
    const utxos = await this.spendableUtxos();
    const sats = utxos.reduce((sum, u) => sum + u.satoshis, 0n);
    const tokens = expected.token
      ? utxos
          .filter((u) => u.token?.category.toLowerCase() === expected.token!.category && !u.token.nft)
          .reduce((sum, u) => sum + u.token!.amount, 0n)
      : 0n;
    // 2,000 sats of margin for the funding fee and the change outputs.
    if (sats < expected.satoshis + 2000n || (expected.token && tokens < expected.token.amount)) {
      throw new DemoLimitError(
        'The demo seller has run out of funds for this offer. Please try again later.',
      );
    }
  }

  // Called before a take on a demo offer is recorded.
  async assertCanTake(): Promise<void> {
    await this.checkLimits();
  }

  // --- Trade actions ---

  // Accepts a requested trade and funds its escrow, both within the request that created the trade.
  acceptAndFund(tradeRecordId: string): Promise<StoredTrade> {
    return this.exclusive(async () => {
      const service = this.options.service;
      const trade = await service.getTrade(tradeRecordId);
      if (!trade || !service.isDemoTrade(trade)) {
        throw new Error('Not a demo trade');
      }
      if (trade.side === 'buy') {
        // A buy offer's request waits for the buyer to accept; the bot only deposits once they have.
        return trade.status === 'Accepted' ? this.fundAccepted(tradeRecordId) : this.view(tradeRecordId);
      }
      if (trade.status === 'Requested') {
        try {
          // Re-checked inside the lock: another take may have been accepted in the meantime.
          await this.checkLimits(trade.id);
          await this.checkBalance(trade);
        } catch (err) {
          await service.declineTrade({ tradeRecordId: trade.id, identity: this.identity });
          throw err;
        }
        await this.accept(trade);
      }
      return this.fundAccepted(tradeRecordId);
    });
  }

  // The payment details the bot gives, encrypted for the buyer's session key.
  private async encryptedDetailsFor(trade: Pick<StoredTrade, 'id' | 'buyerSessionPk'>): Promise<string> {
    if (!trade.buyerSessionPk) {
      throw new Error('The buyer session key of this trade is missing');
    }
    const details = JSON.stringify({
      simulated: true,
      method: DEMO_PAYMENT_METHOD,
      notice:
        'SIMULATED payment details for the Campfire demo. Do not send any money: just mark the trade as paid.',
      reference: `DEMO-${trade.id.slice(0, 8).toUpperCase()}`,
    });
    return encryptPaymentDetails(this.options.wallet.sessionPrivateKey(trade.id), trade.buyerSessionPk, details);
  }

  // The next key positions of the bot: the contract key and the payout address are never reused.
  private async nextIndices(): Promise<{ defiIndex: number; receiveIndex: number }> {
    const used = (await this.botTrades()).filter((t) => t.sellerDefiIndex !== undefined).length;
    return { defiIndex: used, receiveIndex: DEMO_TRADE_INDEX_BASE + used };
  }

  private async accept(trade: StoredTrade): Promise<void> {
    const wallet = this.options.wallet;
    const { defiIndex, receiveIndex } = await this.nextIndices();
    const sessionKey = wallet.sessionPrivateKey(trade.id);
    const encryptedPaymentDetails = await this.encryptedDetailsFor(trade);

    await this.options.service.acceptTrade({
      tradeRecordId: trade.id,
      sellerIdentity: this.identity,
      sellerPk: wallet.defiPubkeyHex(defiIndex),
      sellerDefiIndex: defiIndex,
      sellerPayoutPkh: wallet.receivePkhHex(receiveIndex),
      sellerReceiveIndex: receiveIndex,
      sellerSessionPk: compressedPublicKeyHex(sessionKey),
      encryptedPaymentDetails,
    });
  }

  // Funds the escrow of an accepted trade and, once it is funded, says so in the chat.
  private async fundAccepted(tradeRecordId: string): Promise<StoredTrade> {
    const trade = await this.fundEscrow(tradeRecordId);
    await this.greet(trade);
    return trade;
  }

  // One automatic chat message once the escrow is funded, so a visitor sees the chat working against the bot.
  // The text says it is automatic: the bot is a demo, never presented as a person. Best effort and posted once:
  // a failure here never fails the trade, and a message the bot already wrote is not repeated.
  private async greet(trade: StoredTrade): Promise<void> {
    if (trade.status !== 'Funded' || !trade.tradeId || !trade.buyerSessionPk) return;
    const service = this.options.service;
    try {
      const messages = await service.listChatMessages(trade.id);
      if (messages.some((m) => m.senderIdentity === this.identity)) return;
      const sessionKey = this.options.wallet.sessionPrivateKey(trade.id);
      const ciphertext = await encryptChatMessage(deriveSharedTradeKey(sessionKey, trade.buyerSessionPk), DEMO_GREETING);
      await service.postChatMessage({
        idOrTradeId: trade.id,
        senderIdentity: this.identity,
        ciphertext,
        // The signature covers the contract's trade id, not the record id.
        signature: signChatMessage(sessionKey, trade.tradeId, ciphertext),
      });
    } catch (err) {
      console.warn(`Demo seller could not post its chat message on ${trade.id}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  // Funds the escrow of an accepted trade. Idempotent: if the escrow already holds the exact funding
  // it records it, and if a funding transaction was already signed it only rebroadcasts that one.
  private async fundEscrow(tradeRecordId: string): Promise<StoredTrade> {
    const service = this.options.service;
    const trade = await service.getTrade(tradeRecordId, undefined, true);
    if (!trade || trade.status !== 'Accepted' || !trade.terms || !trade.tradeId) {
      return this.view(tradeRecordId);
    }

    const terms = trade.terms;
    const contract = createEscrowContract(terms, trade.tradeId, this.options.provider);
    // On a buy offer the payment details go with the deposit; on a sell offer they were sent when accepting.
    const withDetails = async () => {
      if (trade.side !== 'buy') return {};
      const encryptedPaymentDetails = await this.encryptedDetailsFor(trade);
      const sessionKey = this.options.wallet.sessionPrivateKey(trade.id);
      return { encryptedPaymentDetails, paymentDetailsSignature: signPaymentDetails(sessionKey, trade.tradeId!, encryptedPaymentDetails) };
    };
    const alreadyFunded = (await contract.getUtxos()).some((u) => matchesEscrowFunding(u, terms));
    if (alreadyFunded) {
      await service.confirmFunding({ idOrTradeId: tradeRecordId, ...(await withDetails()) });
      return this.view(tradeRecordId);
    }

    // Stored in the database, so it survives restarts and is seen by every server instance.
    const previousHex = trade.pendingFundingTxHex;
    if (previousHex) {
      // Same transaction, same txid: rebroadcasting it is harmless if it already reached the network.
      try {
        await this.options.provider.sendRawTransaction(previousHex);
      } catch {
        // Typically "already known"; the lookup below decides.
      }
      await service.confirmFunding({ idOrTradeId: tradeRecordId, ...(await withDetails()) });
      await this.waitUntilIndexed(previousHex);
      return this.view(tradeRecordId);
    }

    // One attempt per request. If it fails, the next read of the trade (reconcile) checks the
    // escrow first and only ever rebroadcasts this same transaction.
    const tx = buildFundEscrowTransaction({
      contract,
      terms,
      utxos: await this.spendableUtxos(),
      changeAddress: this.mainAddress,
      tokenChangeAddress: this.mainTokenAddress,
    });
    await service.recordFundingAttempt(tradeRecordId, tx.hex);
    try {
      await service.confirmFunding({ idOrTradeId: tradeRecordId, fundingTxHex: tx.hex, ...(await withDetails()) });
    } catch (err) {
      throw new Error(
        `Demo seller could not confirm the escrow funding yet: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
    await this.waitUntilIndexed(tx.hex);
    return this.view(tradeRecordId);
  }

  // Signs and broadcasts `release` once the visitor marks the (simulated) fiat payment as sent.
  release(tradeRecordId: string): Promise<StoredTrade> {
    return this.exclusive(async () => {
      const service = this.options.service;
      const trade = await service.getTrade(tradeRecordId, undefined, true);
      if (!trade || !service.isDemoTrade(trade)) {
        throw new Error('Not a demo trade');
      }
      if (trade.status !== 'Paid' || !trade.terms || !trade.tradeId || trade.sellerDefiIndex === undefined) {
        return this.view(tradeRecordId);
      }
      const contract = createEscrowContract(trade.terms, trade.tradeId, this.options.provider);
      const utxo = (await contract.getUtxos()).find((u) => matchesEscrowFunding(u, trade.terms!));
      if (!utxo) {
        throw new Error('Escrow UTXO not found for demo release');
      }
      const { fee } = buildReleaseRequest({
        contract,
        utxo,
        buyerPayoutPkh: trade.terms.buyerPayoutPkh,
        sellerDefiIndex: trade.sellerDefiIndex,
      });
      const signer = new SignatureTemplate(
        this.options.wallet.defiPrivateKey(trade.sellerDefiIndex),
        BOT_SIGHASH,
        SignatureAlgorithm.SCHNORR,
      );
      const signedTxHex = new TransactionBuilder({ provider: this.options.provider })
        .addInput(utxo, contract.unlock.release(signer))
        .addOutput({
          to: pkhToLockingBytecode(trade.terms.buyerPayoutPkh),
          amount: utxo.satoshis - fee,
          token: utxo.token,
        })
        .build();
      // settleEscrow checks the signed transaction in the BCH VM before broadcasting it.
      await service.settleEscrow({ idOrTradeId: tradeRecordId, path: 'release', signedTxHex });
      return this.view(tradeRecordId);
    });
  }

  // --- Buy offers ---

  // Publishes a buy offer on the buyer's behalf: Campfire builds the transaction and pays its fee, and the 1,000-sat
  // marker goes to a fresh address of the buyer, who can close the offer without the service. The limits are
  // checked inside the lock, so two requests cannot both take the last free slot. When the offer names the demo
  // payment method, the bot takes it right away, so a visitor with one wallet can go through the whole path.
  async publishSponsored(params: {
    buyerIdentity: string;
    offerJson: string;
    markerReceiveIndex: number;
  }): Promise<{ offer: OfferView; trade: StoredTrade | null }> {
    const service = this.options.service;
    if (!Number.isInteger(params.markerReceiveIndex) || params.markerReceiveIndex < 0 || params.markerReceiveIndex > 100_000) {
      throw new Error('markerReceiveIndex must be a small non-negative integer');
    }
    const offer = await this.exclusive(async () => {
      const buyer = await service.getIdentityRecord(params.buyerIdentity);
      if (!buyer) {
        throw new Error('Buyer identity is not registered');
      }
      const document = JSON.parse(params.offerJson) as OfferDocument;
      validateOfferDocument(document);
      await service.assertCanSponsor(params.buyerIdentity, document);

      const utxos = await this.spendableUtxos();
      // A publication costs the marker plus a fee of a few hundred sats; the margin covers the change output.
      if (utxos.reduce((sum, u) => sum + u.satoshis, 0n) < 3_000n) {
        throw new SponsorshipLimitError('Campfire cannot pay for new offers right now. Please try again later.');
      }
      const tx = buildPublishOfferTransaction({
        provider: this.options.provider,
        document,
        offerJson: params.offerJson,
        utxos,
        markerAddress: pkhToCashAddress(derivePayoutPkhFromXpub(buyer.receiveXpub, params.markerReceiveIndex)),
        changeAddress: this.mainAddress,
      });
      const published = await service.publishOffer({
        sellerIdentity: params.buyerIdentity,
        offerJson: tx.offerJson,
        offerTxHex: tx.hex,
        markerReceiveIndex: params.markerReceiveIndex,
        broadcast: true,
        sponsored: true,
      });
      await this.waitUntilIndexed(tx.hex);
      return published;
    });
    const trade = offer.document.paymentMethods.includes(DEMO_PAYMENT_METHOD) ? await this.takeBuyOffer(offer) : null;
    return { offer, trade };
  }

  // The bot asks to sell to a buy offer, for the smallest amount it can: the offer's minimum, or the bot's own
  // if that is higher. Returns null when the offer is out of the bot's reach (its coin, its range, its limits).
  // It never fails the publication that triggered it.
  private takeBuyOffer(offer: OfferView): Promise<StoredTrade | null> {
    return this.exclusive(async () => {
      const doc = offer.document;
      const isBch = doc.asset === BCH_ASSET;
      if (!isBch && doc.asset.toLowerCase() !== PUSD_CATEGORY) return null;
      const botMin = isBch ? this.limits.minBchSats : this.limits.minPusdUnits;
      const botMax = isBch ? this.limits.maxBchSats : this.limits.maxPusdUnits;
      const amount = BigInt(doc.min) > botMin ? BigInt(doc.min) : botMin;
      if (amount > BigInt(doc.max) || amount > botMax) return null;
      try {
        await this.checkLimits();
        await this.checkBalance({ asset: doc.asset, amount: amount.toString() });
        const wallet = this.options.wallet;
        const recordId = binToHex(randomBytes(16));
        const { defiIndex, receiveIndex } = await this.nextIndices();
        return await this.options.service.requestBuyOfferTrade({
          offerTxid: offer.offerTxid,
          sellerIdentity: this.identity,
          amount: amount.toString(),
          sellerPk: wallet.defiPubkeyHex(defiIndex),
          sellerDefiIndex: defiIndex,
          sellerPayoutPkh: wallet.receivePkhHex(receiveIndex),
          sellerReceiveIndex: receiveIndex,
          sellerSessionPk: compressedPublicKeyHex(wallet.sessionPrivateKey(recordId)),
          recordId,
        });
      } catch (err) {
        if (err instanceof DemoLimitError) return null;
        // An offer the oracle cannot price (a currency it does not sign) is also out of reach.
        console.warn(`Demo seller did not take buy offer ${offer.offerTxid}: ${err instanceof Error ? err.message : String(err)}`);
        return null;
      }
    });
  }

  // Finishes any step left behind by a failed request (funding or release). Called on trade reads.
  async reconcile(tradeRecordId: string): Promise<void> {
    const trade = await this.options.service.getTrade(tradeRecordId);
    if (!trade || !this.options.service.isDemoTrade(trade)) return;
    try {
      if (trade.status === 'Accepted' || (trade.status === 'Requested' && trade.side !== 'buy')) {
        await this.acceptAndFund(tradeRecordId);
      } else if (trade.status === 'Funded') {
        // A greeting lost to a failed request is posted on a later read. Checked outside the lock first, so the
        // polls of a funded trade do not queue behind the bot's deposits; greet checks again inside it.
        const messages = await this.options.service.listChatMessages(trade.id);
        if (!messages.some((m) => m.senderIdentity === this.identity)) await this.exclusive(() => this.greet(trade));
      } else if (trade.status === 'Paid') {
        await this.release(tradeRecordId);
      }
    } catch {
      // Best effort: the read that triggered this still returns the current state.
    }
  }

  private async view(tradeRecordId: string): Promise<StoredTrade> {
    const trade = await this.options.service.getTrade(tradeRecordId);
    if (!trade) {
      throw new Error('Trade not found');
    }
    return trade;
  }
}
