// Campfire protocol service: identity, offers, trade state machine, automatic expiry arbiter, chat and reputation.

import { randomBytes } from 'node:crypto';
import {
  binToHex,
  decodeTransactionUnsafe,
  hexToBin,
  secp256k1,
  sha256,
} from '@bitauth/libauth';
import type { NetworkProvider } from 'cashscript';
import {
  BCH_ASSET,
  MARKER_SATOSHIS,
  VERDICT_BUYER,
  VERDICT_SELLER,
  buildArbitrateSpend,
  buildCancelRequest,
  buildRefundSpend,
  buildReleaseRequest,
  computeFiatAmount,
  computeTradeId,
  createEscrowContract,
  decryptChatMessage,
  identityFromDefiXpub,
  isCompressedPubkeyHex,
  matchesEscrowFunding,
  pkhToCashAddress,
  pkhToLockingBytecode,
  signVerdict,
  toBytes,
  verifyDerivedPayoutPkh,
  verifyDerivedPubkey,
  verifyOfferAgainstOpReturn,
  verifyPriceQuote,
  verifySignedContractSpend,
  type OfferDocument,
  type TradeTerms,
  type VerdictHex,
} from '../protocol/index.js';
import type { OracleService } from './oracle.js';
import type {
  OfferStatus,
  StorageAdapter,
  StoredChatMessage,
  StoredOffer,
  StoredTrade,
  UserIdentityRecord,
} from './storage.js';

export const QUOTE_VALIDITY_SEC = 600; // 10 minutes (protocol section 2.2)
export const FUNDING_WINDOW_SEC = 1800; // 30 minutes (protocol section 2.2)
export const DEFAULT_REFUND_DELAY_SEC = 14 * 86_400; // 14 days (protocol section 2.2)

export const REPUTATION_HONESTY_NOTICE =
  'Computed and attested by the service. It cannot be recomputed from the chain by a third party, and a user can inflate it by trading with a second wallet of their own.';

export interface ReputationSummary {
  identity: string;
  completedAsSeller: number;
  completedAsBuyer: number;
  firstCompletedAt: number | null;
  notice: string;
}

export interface OfferView extends Omit<StoredOffer, 'status'> {
  status: OfferStatus;
}

export class CampfireService {
  readonly arbiterPublicKeyHex: string;
  private readonly arbiterPrivateKey: Uint8Array;
  private readonly nowSeconds: () => number;

  constructor(
    private readonly options: {
      storage: StorageAdapter;
      provider: NetworkProvider;
      oracle: OracleService;
      arbiterPrivateKey: Uint8Array | string;
      nowSeconds?: () => number;
    },
  ) {
    this.arbiterPrivateKey = toBytes(options.arbiterPrivateKey, 'arbiterPrivateKey');
    if (!secp256k1.validatePrivateKey(this.arbiterPrivateKey)) {
      throw new Error('Invalid arbiter private key');
    }
    const pub = secp256k1.derivePublicKeyCompressed(this.arbiterPrivateKey);
    if (typeof pub === 'string') {
      throw new Error(`Failed to derive arbiter public key: ${pub}`);
    }
    this.arbiterPublicKeyHex = binToHex(pub).toLowerCase();
    this.nowSeconds = options.nowSeconds ?? (() => Math.floor(Date.now() / 1000));
  }

  get oraclePublicKeyHex(): string {
    return this.options.oracle.publicKeyHex;
  }

  // --- Identity & Reputation (Section 1) ---

  async registerIdentity(params: {
    defiXpub: string;
    receiveXpub: string;
    changeXpub?: string;
  }): Promise<UserIdentityRecord> {
    const identity = identityFromDefiXpub(params.defiXpub);
    // Validate receiveXpub (and optional changeXpub) by deriving index 0.
    verifyDerivedPayoutPkh(params.receiveXpub, 0, new Uint8Array(20));
    if (params.changeXpub) {
      verifyDerivedPayoutPkh(params.changeXpub, 0, new Uint8Array(20));
    }
    const now = this.nowSeconds();
    const existing = await this.options.storage.getIdentity(identity);
    const record: UserIdentityRecord = {
      identity,
      defiXpub: params.defiXpub.trim(),
      receiveXpub: params.receiveXpub.trim(),
      changeXpub: params.changeXpub?.trim(),
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    };
    await this.options.storage.saveIdentity(record);
    return record;
  }

  async getReputation(identity: string): Promise<ReputationSummary> {
    const trades = await this.options.storage.listTrades({ identity });
    let completedAsSeller = 0;
    let completedAsBuyer = 0;
    let firstCompletedAt: number | null = null;

    const recordCompletion = (timestamp?: number) => {
      if (timestamp !== undefined && (firstCompletedAt === null || timestamp < firstCompletedAt)) {
        firstCompletedAt = timestamp;
      }
    };

    for (const t of trades) {
      // Section 1: "A trade counts when its escrow was spent by release, or by arbitrate in favour of that party."
      if (t.sellerIdentity === identity) {
        if (t.status === 'Released' || t.status === 'ResolvedSeller') {
          completedAsSeller += 1;
          recordCompletion(t.completedAt ?? t.updatedAt);
        }
      }
      if (t.buyerIdentity === identity) {
        if (t.status === 'Released' || t.status === 'ResolvedBuyer') {
          completedAsBuyer += 1;
          recordCompletion(t.completedAt ?? t.updatedAt);
        }
      }
    }

    return {
      identity,
      completedAsSeller,
      completedAsBuyer,
      firstCompletedAt,
      notice: REPUTATION_HONESTY_NOTICE,
    };
  }

  // --- Offers (Section 2.1 & 3) ---

  private toOfferView(offer: StoredOffer): OfferView {
    const now = this.nowSeconds();
    const status: OfferStatus =
      offer.status === 'Closed'
        ? 'Closed'
        : now >= offer.document.expiresAt
          ? 'Expired'
          : 'Published';
    return { ...offer, status };
  }

  async publishOffer(params: {
    sellerIdentity: string;
    offerJson: string;
    offerTxHex: string;
    markerReceiveIndex: number;
    broadcast?: boolean;
    isDemo?: boolean;
  }): Promise<OfferView> {
    const seller = await this.options.storage.getIdentity(params.sellerIdentity);
    if (!seller) {
      throw new Error('Seller identity is not registered');
    }

    const decodedTx = decodeTransactionUnsafe(hexToBin(params.offerTxHex));
    if (decodedTx.outputs.length < 2) {
      throw new Error('Offer transaction must have at least 2 outputs (OP_RETURN and marker)');
    }

    const opReturnOut = decodedTx.outputs[0];
    const markerOut = decodedTx.outputs[1];
    if (opReturnOut.valueSatoshis !== 0n) {
      throw new Error('Offer output 0 (OP_RETURN) must have 0 satoshis');
    }
    if (markerOut.valueSatoshis !== MARKER_SATOSHIS) {
      throw new Error(`Offer marker output 1 must carry ${MARKER_SATOSHIS} satoshis`);
    }

    const verified = verifyOfferAgainstOpReturn(params.offerJson, opReturnOut.lockingBytecode);

    // Check that the marker output pays the seller's receive/<markerReceiveIndex> address.
    const markerLockHex = binToHex(markerOut.lockingBytecode);
    if (!markerLockHex.startsWith('76a914') || !markerLockHex.endsWith('88ac') || markerLockHex.length !== 50) {
      throw new Error('Offer marker output must be P2PKH');
    }
    const markerPkhHex = markerLockHex.slice(6, 46);
    if (!verifyDerivedPayoutPkh(seller.receiveXpub, params.markerReceiveIndex, markerPkhHex)) {
      throw new Error('Offer marker output does not belong to the seller receive path at the stated index');
    }

    let offerTxid: string;
    if (params.broadcast ?? true) {
      offerTxid = await this.options.provider.sendRawTransaction(params.offerTxHex);
    } else {
      // Double SHA-256 reversed txid
      const hash = sha256.hash(sha256.hash(hexToBin(params.offerTxHex)));
      offerTxid = binToHex(Uint8Array.from([...hash].reverse()));
    }

    const now = this.nowSeconds();
    if (now >= verified.document.expiresAt) {
      throw new Error('Offer expiresAt is already in the past');
    }

    const stored: StoredOffer = {
      offerTxid,
      sellerIdentity: params.sellerIdentity,
      contentHash: verified.contentHash,
      offerJson: params.offerJson,
      document: verified.document,
      onChain: verified.onChain,
      markerVout: 1,
      markerAddress: pkhToCashAddress(markerPkhHex),
      status: 'Published',
      isDemo: params.isDemo,
      createdAt: now,
      updatedAt: now,
    };
    await this.options.storage.saveOffer(stored);
    return this.toOfferView(stored);
  }

  async closeOffer(params: {
    sellerIdentity: string;
    offerTxid: string;
    closeTxHex?: string;
  }): Promise<OfferView> {
    const offer = await this.options.storage.getOffer(params.offerTxid);
    if (!offer) {
      throw new Error('Offer not found');
    }
    if (offer.sellerIdentity !== params.sellerIdentity) {
      throw new Error('Only the seller can close this offer');
    }
    if (offer.status === 'Closed') {
      return this.toOfferView(offer);
    }

    let closeTxid: string | undefined;
    if (params.closeTxHex) {
      closeTxid = await this.options.provider.sendRawTransaction(params.closeTxHex);
    }

    // Verify on-chain that the marker UTXO is no longer unspent.
    const utxos = await this.options.provider.getUtxos(offer.markerAddress);

    const markerStillUnspent = utxos.some(
      (u) => u.txid === offer.offerTxid && u.vout === offer.markerVout,
    );
    if (markerStillUnspent) {
      throw new Error('Offer marker output is still unspent on-chain');
    }

    offer.status = 'Closed';
    offer.closeTxid = closeTxid;
    offer.updatedAt = this.nowSeconds();
    await this.options.storage.saveOffer(offer);
    return this.toOfferView(offer);
  }

  async getOffer(offerTxid: string): Promise<OfferView | null> {
    const offer = await this.options.storage.getOffer(offerTxid);
    if (!offer) return null;
    return this.toOfferView(offer);
  }

  async getOfferDocumentByHash(contentHash: string): Promise<string | null> {
    const offer = await this.options.storage.getOfferByHash(contentHash);
    return offer ? offer.offerJson : null;
  }

  async listOffers(options?: { onlyOpen?: boolean }): Promise<OfferView[]> {
    const all = await this.options.storage.listOffers();
    const views = all.map((o) => this.toOfferView(o));
    if (options?.onlyOpen) {
      return views.filter((v) => v.status === 'Published');
    }
    return views;
  }

  // --- Trades (Section 2.2, 3.3, 4, 5, 6 & 7) ---

  private sanitizeTrade(trade: StoredTrade, viewerIdentity?: string, isArbiter = false): StoredTrade {
    const copy = structuredClone(trade);
    const revealedStates = new Set([
      'Funded',
      'Paid',
      'Disputed',
      'Released',
      'Cancelled',
      'ResolvedBuyer',
      'ResolvedSeller',
      'Refunded',
    ]);
    // Payment details are revealed only once the funding transaction is seen (section 6).
    if (!revealedStates.has(copy.status)) {
      delete copy.encryptedPaymentDetails;
    }
    // The shared trade key is only visible to the arbiter in a dispute (section 6).
    if (!isArbiter) {
      delete copy.sharedTradeKeyHex;
    }
    return copy;
  }

  // Evaluates quote expiry, funding-window expiry and payment-window expiry (lazy evaluation on read/action).
  private async evaluateDeadlines(trade: StoredTrade): Promise<StoredTrade> {
    const now = this.nowSeconds();

    if (trade.status === 'Requested' && trade.quoteExpiresAt && now > trade.quoteExpiresAt) {
      trade.status = 'Dropped';
      trade.updatedAt = now;
      await this.options.storage.saveTrade(trade);
      return trade;
    }

    if (trade.status === 'Accepted' && trade.fundingDeadline && now > trade.fundingDeadline) {
      trade.status = 'Dropped';
      trade.updatedAt = now;
      await this.options.storage.saveTrade(trade);
      return trade;
    }

    // Section 2.2 & 7.3: When the payment window ends and the buyer has not marked the trade as paid,
    // the arbiter automatically issues a signed verdict for the seller (`0x02`) and broadcasts `arbitrate`.
    if (trade.status === 'Funded' && trade.paymentDeadline && now > trade.paymentDeadline && trade.tradeId && trade.terms) {
      const sig = signVerdict(this.arbiterPrivateKey, trade.tradeId, VERDICT_SELLER);
      trade.verdict = VERDICT_SELLER;
      trade.verdictSignature = binToHex(sig);
      trade.verdictReason = 'Payment window expired without buyer marking fiat as sent';
      trade.verdictIssuedAt = now;

      // Attempt to broadcast `arbitrate` on-chain if the escrow UTXO is unspent.
      try {
        const contract = createEscrowContract(trade.terms, trade.tradeId, this.options.provider);
        const utxos = await contract.getUtxos();
        const escrowUtxo = utxos.find((u) => matchesEscrowFunding(u, trade.terms!));
        if (escrowUtxo) {
          const arb = buildArbitrateSpend({
            contract,
            utxo: escrowUtxo,
            arbiterSig: sig,
            verdict: VERDICT_SELLER,
            buyerPayoutPkh: trade.terms.buyerPayoutPkh,
            sellerPayoutPkh: trade.terms.sellerPayoutPkh,
            tradeId: trade.tradeId,
            arbiterPk: this.arbiterPublicKeyHex,
          });
          const txDetails = await arb.builder.send();
          trade.settlementTxid = txDetails.txid;
        }
      } catch {
        // If broadcasting fails (e.g. UTXO not yet available), verdictSignature remains stored for anyone to broadcast.
      }

      trade.status = 'ResolvedSeller';
      trade.updatedAt = now;
      trade.completedAt = now;
      await this.options.storage.saveTrade(trade);
    }

    return trade;
  }

  async requestTrade(params: {
    offerTxid: string;
    buyerIdentity: string;
    amount: string;
    buyerPk: string;
    buyerDefiIndex: number;
    buyerPayoutPkh: string;
    buyerReceiveIndex: number;
    buyerSessionPk: string;
  }): Promise<StoredTrade> {
    const offerView = await this.getOffer(params.offerTxid);
    if (!offerView) {
      throw new Error('Offer not found');
    }
    if (offerView.status !== 'Published') {
      throw new Error(`Offer is not open (status: ${offerView.status})`);
    }

    const buyer = await this.options.storage.getIdentity(params.buyerIdentity);
    if (!buyer) {
      throw new Error('Buyer identity is not registered');
    }

    // Verify that buyerPk and buyerPayoutPkh derive from the buyer's registered xpubs.
    if (!verifyDerivedPubkey(buyer.defiXpub, params.buyerDefiIndex, params.buyerPk)) {
      throw new Error('buyerPk does not match buyer defi xpub at buyerDefiIndex');
    }
    if (!verifyDerivedPayoutPkh(buyer.receiveXpub, params.buyerReceiveIndex, params.buyerPayoutPkh)) {
      throw new Error('buyerPayoutPkh does not match buyer receive xpub at buyerReceiveIndex');
    }
    if (!isCompressedPubkeyHex(params.buyerSessionPk)) {
      throw new Error('Invalid buyerSessionPk');
    }

    const amountBig = BigInt(params.amount);
    if (amountBig < BigInt(offerView.document.min) || amountBig > BigInt(offerView.document.max)) {
      throw new Error(`Requested amount ${params.amount} is outside offer range [${offerView.document.min}, ${offerView.document.max}]`);
    }

    const now = this.nowSeconds();
    const doc = offerView.document;
    let quote: StoredTrade['quote'];
    let marginBps: number | undefined;
    let quoteExpiresAt: number | undefined;
    let fiatAmount: string;

    if (doc.price.type === 'floating') {
      quote = await this.options.oracle.createQuote(doc.price.pair);
      marginBps = doc.price.marginBps;
      quoteExpiresAt = now + QUOTE_VALIDITY_SEC;
      fiatAmount = computeFiatAmount({
        amount: params.amount,
        assetDecimals: doc.assetDecimals,
        unitPrice: quote.price,
        marginBps,
      });
    } else {
      fiatAmount = computeFiatAmount({
        amount: params.amount,
        assetDecimals: doc.assetDecimals,
        unitPrice: doc.price.value,
      });
    }

    const trade: StoredTrade = {
      id: binToHex(randomBytes(16)),
      offerTxid: offerView.offerTxid,
      sellerIdentity: offerView.sellerIdentity,
      buyerIdentity: params.buyerIdentity,
      status: 'Requested',
      asset: doc.asset,
      assetDecimals: doc.assetDecimals,
      amount: params.amount,
      fiat: doc.fiat,
      fiatAmount,
      quote,
      marginBps,
      quoteExpiresAt,
      buyerPk: params.buyerPk.toLowerCase(),
      buyerDefiIndex: params.buyerDefiIndex,
      buyerPayoutPkh: params.buyerPayoutPkh.toLowerCase(),
      buyerReceiveIndex: params.buyerReceiveIndex,
      buyerSessionPk: params.buyerSessionPk.toLowerCase(),
      arbiterPk: doc.arbiter.toLowerCase(),
      oraclePk: doc.oracle?.toLowerCase(),
      isDemo: offerView.isDemo,
      createdAt: now,
      updatedAt: now,
    };

    await this.options.storage.saveTrade(trade);
    return this.sanitizeTrade(trade, params.buyerIdentity);
  }

  async acceptTrade(params: {
    tradeRecordId: string;
    sellerIdentity: string;
    sellerPk: string;
    sellerDefiIndex: number;
    sellerPayoutPkh: string;
    sellerReceiveIndex: number;
    sellerSessionPk: string;
    encryptedPaymentDetails: string;
    refundTime?: number;
    nonce?: string;
  }): Promise<StoredTrade> {
    let trade = await this.options.storage.getTrade(params.tradeRecordId);
    if (!trade) {
      throw new Error('Trade not found');
    }
    trade = await this.evaluateDeadlines(trade);
    if (trade.status !== 'Requested') {
      throw new Error(`Trade cannot be accepted in state "${trade.status}"`);
    }
    if (trade.sellerIdentity !== params.sellerIdentity) {
      throw new Error('Only the offer seller can accept this trade');
    }
    if (!params.encryptedPaymentDetails || params.encryptedPaymentDetails.trim().length === 0) {
      throw new Error('Seller must provide encryptedPaymentDetails on acceptance');
    }

    const seller = await this.options.storage.getIdentity(params.sellerIdentity);
    if (!seller) {
      throw new Error('Seller identity is not registered');
    }
    if (!verifyDerivedPubkey(seller.defiXpub, params.sellerDefiIndex, params.sellerPk)) {
      throw new Error('sellerPk does not match seller defi xpub at sellerDefiIndex');
    }
    if (!verifyDerivedPayoutPkh(seller.receiveXpub, params.sellerReceiveIndex, params.sellerPayoutPkh)) {
      throw new Error('sellerPayoutPkh does not match seller receive xpub at sellerReceiveIndex');
    }
    if (!isCompressedPubkeyHex(params.sellerSessionPk)) {
      throw new Error('Invalid sellerSessionPk');
    }

    const now = this.nowSeconds();
    const refundTime = params.refundTime ?? now + DEFAULT_REFUND_DELAY_SEC;
    const nonce = params.nonce ?? binToHex(randomBytes(8));

    const terms: TradeTerms = {
      v: 1,
      offerTxid: trade.offerTxid,
      asset: trade.asset,
      amount: trade.amount,
      fiat: trade.fiat,
      fiatAmount: trade.fiatAmount,
      ...(trade.quote ? { quote: trade.quote, marginBps: trade.marginBps, oraclePk: trade.oraclePk } : {}),
      sellerPk: params.sellerPk.toLowerCase(),
      buyerPk: trade.buyerPk,
      arbiterPk: trade.arbiterPk,
      sellerPayoutPkh: params.sellerPayoutPkh.toLowerCase(),
      buyerPayoutPkh: trade.buyerPayoutPkh,
      sellerSessionPk: params.sellerSessionPk.toLowerCase(),
      buyerSessionPk: trade.buyerSessionPk,
      refundTime,
      nonce,
    };

    const termsJson = JSON.stringify(terms);
    const tradeId = binToHex(computeTradeId(termsJson)).toLowerCase();
    const contract = createEscrowContract(terms, tradeId, this.options.provider);

    trade.tradeId = tradeId;
    trade.status = 'Accepted';
    trade.sellerPk = terms.sellerPk;
    trade.sellerDefiIndex = params.sellerDefiIndex;
    trade.sellerPayoutPkh = terms.sellerPayoutPkh;
    trade.sellerReceiveIndex = params.sellerReceiveIndex;
    trade.sellerSessionPk = terms.sellerSessionPk;
    trade.refundTime = refundTime;
    trade.nonce = nonce;
    trade.terms = terms;
    trade.termsJson = termsJson;
    trade.escrowAddress = contract.address;
    trade.escrowTokenAddress = contract.tokenAddress;
    trade.encryptedPaymentDetails = params.encryptedPaymentDetails;
    trade.fundingDeadline = now + FUNDING_WINDOW_SEC;
    trade.updatedAt = now;

    await this.options.storage.saveTrade(trade);
    return this.sanitizeTrade(trade, params.sellerIdentity);
  }

  async declineTrade(params: {
    tradeRecordId: string;
    sellerIdentity: string;
  }): Promise<StoredTrade> {
    const trade = await this.options.storage.getTrade(params.tradeRecordId);
    if (!trade) {
      throw new Error('Trade not found');
    }
    if (trade.sellerIdentity !== params.sellerIdentity) {
      throw new Error('Only the seller can decline this trade');
    }
    if (trade.status !== 'Requested') {
      throw new Error(`Cannot decline trade in state "${trade.status}"`);
    }
    trade.status = 'Dropped';
    trade.updatedAt = this.nowSeconds();
    await this.options.storage.saveTrade(trade);
    return this.sanitizeTrade(trade, params.sellerIdentity);
  }

  async confirmFunding(params: {
    idOrTradeId: string;
    fundingTxHex?: string;
    confirmations?: number;
  }): Promise<StoredTrade> {
    let trade = await this.options.storage.getTrade(params.idOrTradeId);
    if (!trade) {
      throw new Error('Trade not found');
    }
    trade = await this.evaluateDeadlines(trade);
    if (trade.status !== 'Accepted' && trade.status !== 'Funded') {
      throw new Error(`Cannot record funding for trade in state "${trade.status}"`);
    }
    if (!trade.terms || !trade.tradeId) {
      throw new Error('Trade terms are incomplete');
    }

    if (params.fundingTxHex) {
      await this.options.provider.sendRawTransaction(params.fundingTxHex);
    }

    const contract = createEscrowContract(trade.terms, trade.tradeId, this.options.provider);
    const utxos = await contract.getUtxos();
    const matchingUtxo = utxos.find((u) => matchesEscrowFunding(u, trade.terms!));
    if (!matchingUtxo) {
      throw new Error('No UTXO at the escrow address matches the required value and token terms');
    }

    const offer = await this.options.storage.getOffer(trade.offerTxid);
    const paymentWindowSec = offer?.document.paymentWindowSec ?? 3600;
    const now = this.nowSeconds();

    if (trade.status === 'Accepted') {
      trade.status = 'Funded';
      trade.fundingTxid = matchingUtxo.txid;
      trade.fundingVout = matchingUtxo.vout;
      trade.fundedAt = now;
      trade.paymentDeadline = now + paymentWindowSec;
    }
    trade.fundingConfirmations = params.confirmations ?? trade.fundingConfirmations ?? 0;
    trade.updatedAt = now;

    await this.options.storage.saveTrade(trade);
    return this.sanitizeTrade(trade);
  }

  async markPaid(params: {
    idOrTradeId: string;
    buyerIdentity: string;
  }): Promise<StoredTrade> {
    let trade = await this.options.storage.getTrade(params.idOrTradeId);
    if (!trade) {
      throw new Error('Trade not found');
    }
    trade = await this.evaluateDeadlines(trade);
    if (trade.buyerIdentity !== params.buyerIdentity) {
      throw new Error('Only the buyer can mark the fiat payment as sent');
    }
    if (trade.status !== 'Funded') {
      throw new Error(`Trade cannot be marked as paid in state "${trade.status}"`);
    }
    const now = this.nowSeconds();
    trade.status = 'Paid';
    trade.paidAt = now;
    trade.updatedAt = now;
    await this.options.storage.saveTrade(trade);
    return this.sanitizeTrade(trade, params.buyerIdentity);
  }

  async openDispute(params: {
    idOrTradeId: string;
    callerIdentity: string;
    reason?: string;
    sharedTradeKeyHex?: string;
  }): Promise<StoredTrade> {
    let trade = await this.options.storage.getTrade(params.idOrTradeId);
    if (!trade) {
      throw new Error('Trade not found');
    }
    trade = await this.evaluateDeadlines(trade);
    if (trade.buyerIdentity !== params.callerIdentity && trade.sellerIdentity !== params.callerIdentity) {
      throw new Error('Only the buyer or the seller can open a dispute');
    }
    if (trade.status !== 'Funded' && trade.status !== 'Paid' && trade.status !== 'Disputed') {
      throw new Error(`Cannot open a dispute when trade is in state "${trade.status}"`);
    }
    const now = this.nowSeconds();
    trade.status = 'Disputed';
    trade.disputedBy = trade.buyerIdentity === params.callerIdentity ? 'buyer' : 'seller';
    if (params.reason) {
      trade.disputeReason = params.reason;
    }
    if (params.sharedTradeKeyHex) {
      const keyBytes = toBytes(params.sharedTradeKeyHex, 'sharedTradeKeyHex');
      if (keyBytes.length !== 32) {
        throw new Error('sharedTradeKeyHex must be a 32-byte key in hex');
      }
      trade.sharedTradeKeyHex = binToHex(keyBytes);
    }
    trade.disputedAt = trade.disputedAt ?? now;
    trade.updatedAt = now;
    await this.options.storage.saveTrade(trade);
    return this.sanitizeTrade(trade, params.callerIdentity);
  }

  async issueArbiterVerdict(params: {
    idOrTradeId: string;
    verdict: VerdictHex;
    reason?: string;
    broadcastOnChain?: boolean;
  }): Promise<StoredTrade> {
    const trade = await this.options.storage.getTrade(params.idOrTradeId);
    if (!trade) {
      throw new Error('Trade not found');
    }
    if (trade.status !== 'Disputed' && trade.status !== 'Funded' && trade.status !== 'Paid') {
      throw new Error(`Arbiter cannot issue a verdict for trade in state "${trade.status}"`);
    }
    if (!trade.terms || !trade.tradeId) {
      throw new Error('Trade terms are missing');
    }
    // Section 7.2: Arbiter verifies the oracle quote if floating.
    if (trade.terms.quote && trade.terms.oraclePk) {
      if (!verifyPriceQuote(trade.terms.quote, trade.terms.oraclePk)) {
        throw new Error('Trade quote failed oracle signature verification');
      }
    }

    const sig = signVerdict(this.arbiterPrivateKey, trade.tradeId, params.verdict);
    const now = this.nowSeconds();
    trade.verdict = params.verdict;
    trade.verdictSignature = binToHex(sig);
    trade.verdictReason = params.reason;
    trade.verdictIssuedAt = now;

    if (params.broadcastOnChain ?? true) {
      const contract = createEscrowContract(trade.terms, trade.tradeId, this.options.provider);
      const utxos = await contract.getUtxos();
      const escrowUtxo = utxos.find((u) => matchesEscrowFunding(u, trade.terms!));
      if (!escrowUtxo) {
        throw new Error('Escrow UTXO not found on-chain for arbitrate broadcast');
      }
      const arb = buildArbitrateSpend({
        contract,
        utxo: escrowUtxo,
        arbiterSig: sig,
        verdict: params.verdict,
        buyerPayoutPkh: trade.terms.buyerPayoutPkh,
        sellerPayoutPkh: trade.terms.sellerPayoutPkh,
        tradeId: trade.tradeId,
        arbiterPk: this.arbiterPublicKeyHex,
      });
      const details = await arb.builder.send();
      trade.settlementTxid = details.txid;
    }

    trade.status = params.verdict === VERDICT_BUYER ? 'ResolvedBuyer' : 'ResolvedSeller';
    trade.updatedAt = now;
    trade.completedAt = now;
    await this.options.storage.saveTrade(trade);
    return this.sanitizeTrade(trade, undefined, true);
  }

  // Verifies and broadcasts (or executes) a settlement path: `release`, `cancel`, `arbitrate`, or `refund`.
  async settleEscrow(params: {
    idOrTradeId: string;
    path: 'release' | 'cancel' | 'arbitrate' | 'refund';
    signedTxHex?: string;
  }): Promise<StoredTrade> {
    const trade = await this.options.storage.getTrade(params.idOrTradeId);
    if (!trade || !trade.terms || !trade.tradeId) {
      throw new Error('Trade or trade terms not found');
    }
    if (!['Funded', 'Paid', 'Disputed'].includes(trade.status)) {
      throw new Error(`Cannot settle escrow in state "${trade.status}"`);
    }

    const contract = createEscrowContract(trade.terms, trade.tradeId, this.options.provider);
    const utxos = await contract.getUtxos();
    const escrowUtxo = utxos.find((u) => matchesEscrowFunding(u, trade.terms!));
    if (!escrowUtxo) {
      throw new Error('Escrow UTXO is not available on-chain');
    }

    const now = this.nowSeconds();
    let txid: string;

    if (params.path === 'release') {
      if (!params.signedTxHex) {
        throw new Error('release requires signedTxHex from the seller wallet');
      }
      const expected = buildReleaseRequest({
        contract,
        utxo: escrowUtxo,
        buyerPayoutPkh: trade.terms.buyerPayoutPkh,
        sellerDefiIndex: trade.sellerDefiIndex ?? 0,
      });
      const check = verifySignedContractSpend(params.signedTxHex, expected.sourceOutputs);
      if (!check.valid) {
        throw new Error(`Signed release transaction failed VM verification: ${check.error}`);
      }
      txid = await this.options.provider.sendRawTransaction(params.signedTxHex);
      trade.status = 'Released';
    } else if (params.path === 'cancel') {
      if (!params.signedTxHex) {
        throw new Error('cancel requires signedTxHex from the buyer wallet');
      }
      const expected = buildCancelRequest({
        contract,
        utxo: escrowUtxo,
        sellerPayoutPkh: trade.terms.sellerPayoutPkh,
        buyerDefiIndex: trade.buyerDefiIndex,
      });
      const check = verifySignedContractSpend(params.signedTxHex, expected.sourceOutputs);
      if (!check.valid) {
        throw new Error(`Signed cancel transaction failed VM verification: ${check.error}`);
      }
      txid = await this.options.provider.sendRawTransaction(params.signedTxHex);
      trade.status = 'Cancelled';
    } else if (params.path === 'arbitrate') {
      if (!trade.verdict || !trade.verdictSignature) {
        throw new Error('No signed arbiter verdict available for this trade');
      }
      const arb = buildArbitrateSpend({
        contract,
        utxo: escrowUtxo,
        arbiterSig: trade.verdictSignature,
        verdict: trade.verdict,
        buyerPayoutPkh: trade.terms.buyerPayoutPkh,
        sellerPayoutPkh: trade.terms.sellerPayoutPkh,
        tradeId: trade.tradeId,
        arbiterPk: trade.arbiterPk,
      });
      const details = await arb.builder.send();
      txid = details.txid;
      trade.status = trade.verdict === VERDICT_BUYER ? 'ResolvedBuyer' : 'ResolvedSeller';
    } else if (params.path === 'refund') {
      if (now < trade.terms.refundTime) {
        throw new Error('refundTime has not been reached yet');
      }
      const ref = buildRefundSpend({
        contract,
        utxo: escrowUtxo,
        sellerPayoutPkh: trade.terms.sellerPayoutPkh,
        refundTime: trade.terms.refundTime,
      });
      const details = await ref.builder.send();
      txid = details.txid;
      trade.status = 'Refunded';
    } else {
      throw new Error(`Unknown settlement path "${String(params.path)}"`);
    }

    trade.settlementTxid = txid;
    trade.updatedAt = now;
    trade.completedAt = now;
    await this.options.storage.saveTrade(trade);
    return this.sanitizeTrade(trade);
  }

  async getTrade(idOrTradeId: string, viewerIdentity?: string, isArbiter = false): Promise<StoredTrade | null> {
    const trade = await this.options.storage.getTrade(idOrTradeId);
    if (!trade) return null;
    const evaluated = await this.evaluateDeadlines(trade);
    return this.sanitizeTrade(evaluated, viewerIdentity, isArbiter);
  }

  async listTrades(filter?: { identity?: string; offerTxid?: string }): Promise<StoredTrade[]> {
    const trades = await this.options.storage.listTrades(filter);
    const results: StoredTrade[] = [];
    for (const t of trades) {
      const evaluated = await this.evaluateDeadlines(t);
      results.push(this.sanitizeTrade(evaluated, filter?.identity));
    }
    return results;
  }

  // --- Encrypted Chat (Section 6) ---

  async postChatMessage(params: {
    idOrTradeId: string;
    senderIdentity: string;
    ciphertext: string;
  }): Promise<StoredChatMessage> {
    const trade = await this.options.storage.getTrade(params.idOrTradeId);
    if (!trade) {
      throw new Error('Trade not found');
    }
    if (
      trade.buyerIdentity !== params.senderIdentity &&
      trade.sellerIdentity !== params.senderIdentity
    ) {
      throw new Error('Only trade participants can post chat messages');
    }
    if (!params.ciphertext || !params.ciphertext.includes(':')) {
      throw new Error('Chat message must be an encrypted AES-GCM payload');
    }
    const msg: StoredChatMessage = {
      id: binToHex(randomBytes(12)),
      tradeRecordId: trade.id,
      senderIdentity: params.senderIdentity,
      ciphertext: params.ciphertext,
      createdAt: this.nowSeconds(),
    };
    await this.options.storage.addChatMessage(msg);
    return msg;
  }

  async listChatMessages(idOrTradeId: string): Promise<StoredChatMessage[]> {
    const trade = await this.options.storage.getTrade(idOrTradeId);
    if (!trade) {
      throw new Error('Trade not found');
    }
    return this.options.storage.listChatMessages(trade.id);
  }

  // In a dispute where a party handed over `sharedTradeKeyHex`, the arbiter can decrypt the chat log.
  async decryptDisputedChatForArbiter(
    idOrTradeId: string,
  ): Promise<{ id: string; senderIdentity: string; plaintext: string; createdAt: number }[]> {
    const trade = await this.options.storage.getTrade(idOrTradeId);
    if (!trade) {
      throw new Error('Trade not found');
    }
    if (!trade.sharedTradeKeyHex) {
      throw new Error('No shared trade key has been handed to the arbiter for this trade');
    }
    const messages = await this.options.storage.listChatMessages(trade.id);
    const decrypted: { id: string; senderIdentity: string; plaintext: string; createdAt: number }[] = [];
    for (const m of messages) {
      const plaintext = await decryptChatMessage(trade.sharedTradeKeyHex, m.ciphertext);
      decrypted.push({
        id: m.id,
        senderIdentity: m.senderIdentity,
        plaintext,
        createdAt: m.createdAt,
      });
    }
    return decrypted;
  }
}
