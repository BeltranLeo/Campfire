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
  PUSD_CATEGORY,
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
  MAX_CHAT_CIPHERTEXT_LENGTH,
  MAX_CHAT_IMAGE_BYTES,
  MAX_CHAT_MESSAGE_CHARS,
  matchesEscrowFunding,
  pkhToCashAddress,
  pkhToLockingBytecode,
  signVerdict,
  toBytes,
  verifyDerivedPayoutPkh,
  verifyDerivedPubkey,
  verifyOfferAgainstOpReturn,
  verifyChatMessageSignature,
  verifyPaymentDetailsSignature,
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
  TradeState,
  UserIdentityRecord,
} from './storage.js';

export const QUOTE_VALIDITY_SEC = 600; // 10 minutes (protocol section 2.2)
export const FUNDING_WINDOW_SEC = 1800; // 30 minutes (protocol section 2.2)
export const DEFAULT_REFUND_DELAY_SEC = 14 * 86_400; // 14 days (protocol section 2.2)
export const MIN_REFUND_DELAY_SEC = 7 * 86_400;
export const MAX_REFUND_DELAY_SEC = 30 * 86_400;

// What the service pays for when it publishes a buy offer on the buyer's behalf (section 2.2). Identities are
// hashes of a presented key with no proof of possession, so the limit per identity is easy to get around with a
// fresh wallet; the daily limit across everyone is the one that bounds what the service can spend.
export interface SponsorshipLimits {
  /** Paid publications in any 24 hours, across all identities. */
  dailyOffers: number;
  /** Paid offers one identity may have open at once. */
  openOffersPerIdentity: number;
  /** The longest an offer paid for by the service may stay open, in seconds. */
  maxExpirySec: number;
}
export const DEFAULT_SPONSORSHIP_LIMITS: SponsorshipLimits = {
  dailyOffers: 100,
  openOffersPerIdentity: 3,
  maxExpirySec: 7 * 86_400,
};

/** A limit on paid publications was reached; the HTTP layer answers 429. */
export class SponsorshipLimitError extends Error {}

export interface SponsorshipStatus extends SponsorshipLimits {
  usedToday: number;
  remainingToday: number;
  /** Unix seconds when the next daily slot frees up; null while there is room. */
  nextSlotAt: number | null;
  /** Paid offers the given identity has open now (0 when no identity was asked about). */
  openNow: number;
}

// States in which the trade is over, so its chat no longer takes messages.
const CHAT_CLOSED_STATES: ReadonlySet<TradeState> = new Set(['Released', 'ResolvedBuyer', 'ResolvedSeller', 'Cancelled', 'Refunded', 'Dropped']);

export interface DecryptedChatMessage {
  id: string;
  senderIdentity: string;
  /** Present only when the message carries a valid signature by that role's session key. */
  senderRole?: 'buyer' | 'seller';
  verified: boolean;
  /** Null when the message does not decrypt with the key the party handed over; the rest of the chat still does. */
  plaintext: string | null;
  createdAt: number;
}

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
  readonly sponsorshipLimits: SponsorshipLimits;
  private readonly arbiterPrivateKey: Uint8Array;
  private readonly nowSeconds: () => number;

  constructor(
    private readonly options: {
      storage: StorageAdapter;
      provider: NetworkProvider;
      oracle: OracleService;
      arbiterPrivateKey: Uint8Array | string;
      nowSeconds?: () => number;
      // Identity of the demo seller bot (protocol section 8). Only its offers and trades are marked as demo.
      demoSellerIdentity?: string;
      // Delay between escrow lookups after broadcasting a funding transaction (the indexer may lag the mempool).
      fundingLookupDelayMs?: number;
      sponsorshipLimits?: Partial<SponsorshipLimits>;
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
    this.sponsorshipLimits = { ...DEFAULT_SPONSORSHIP_LIMITS, ...options.sponsorshipLimits };
  }

  get oraclePublicKeyHex(): string {
    return this.options.oracle.publicKeyHex;
  }

  get demoSellerIdentity(): string | undefined {
    return this.options.demoSellerIdentity;
  }

  // A trade is a demo trade only when the demo seller bot is its seller; clients cannot claim it.
  isDemoTrade(trade: Pick<StoredTrade, 'sellerIdentity'>): boolean {
    return this.options.demoSellerIdentity !== undefined && trade.sellerIdentity === this.options.demoSellerIdentity;
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

  async getIdentityRecord(identity: string): Promise<UserIdentityRecord | null> {
    return this.options.storage.getIdentity(identity);
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
    // Set only by the service's own paid publication of a buy offer, never from a request.
    sponsored?: boolean;
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
    // Buy offers are built and paid for by the service, which applies the limits (see publishSponsoredOffer).
    if (verified.document.side === 'buy' && !params.sponsored) {
      throw new Error('Buy offers are published through the sponsored route, which Campfire pays for');
    }

    // Check that the marker output pays the seller's receive/<markerReceiveIndex> address.
    const markerLockHex = binToHex(markerOut.lockingBytecode);
    if (!markerLockHex.startsWith('76a914') || !markerLockHex.endsWith('88ac') || markerLockHex.length !== 50) {
      throw new Error('Offer marker output must be P2PKH');
    }
    const markerPkhHex = markerLockHex.slice(6, 46);
    if (!verifyDerivedPayoutPkh(seller.receiveXpub, params.markerReceiveIndex, markerPkhHex)) {
      throw new Error('Offer marker output does not belong to the seller receive path at the stated index');
    }

    // Checked before broadcasting, so the publisher never pays for an offer the service then refuses to list.
    if (this.nowSeconds() >= verified.document.expiresAt) {
      throw new Error('Offer expiresAt is already in the past');
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
    const stored: StoredOffer = {
      offerTxid,
      sellerIdentity: params.sellerIdentity,
      contentHash: verified.contentHash,
      offerJson: params.offerJson,
      document: verified.document,
      onChain: verified.onChain,
      markerVout: 1,
      markerAddress: pkhToCashAddress(markerPkhHex),
      markerReceiveIndex: params.markerReceiveIndex,
      status: 'Published',
      isDemo: this.isDemoTrade({ sellerIdentity: params.sellerIdentity }),
      ...(params.sponsored ? { sponsored: true } : {}),
      createdAt: now,
      updatedAt: now,
    };
    await this.options.storage.saveOffer(stored);
    return this.toOfferView(stored);
  }

  // How much of the paid-publication allowance is used, for the screen that offers it and for the check itself.
  async sponsorshipStatus(identity?: string): Promise<SponsorshipStatus> {
    const now = this.nowSeconds();
    const sponsored = (await this.options.storage.listOffers()).filter((o) => o.sponsored);
    const recent = sponsored.filter((o) => o.createdAt > now - 86_400).sort((a, b) => a.createdAt - b.createdAt);
    const limits = this.sponsorshipLimits;
    const full = recent.length >= limits.dailyOffers;
    return {
      ...limits,
      usedToday: recent.length,
      remainingToday: Math.max(0, limits.dailyOffers - recent.length),
      // The slot that frees up first belongs to the oldest publication still inside the 24 hours.
      nextSlotAt: full ? recent[recent.length - limits.dailyOffers].createdAt + 86_400 : null,
      openNow: identity
        ? sponsored.filter((o) => o.sellerIdentity === identity && this.toOfferView(o).status === 'Published').length
        : 0,
    };
  }

  // Throws SponsorshipLimitError, or a plain Error for an offer that cannot be paid for, before anything is spent.
  // The caller holds the lock that serialises paid publications, so two requests cannot both take the last slot.
  async assertCanSponsor(identity: string, document: OfferDocument): Promise<void> {
    if (document.side !== 'buy') {
      throw new Error('Campfire only pays for buy offers');
    }
    const now = this.nowSeconds();
    if (document.expiresAt <= now) {
      throw new Error('Offer expiresAt is already in the past');
    }
    // The service pays only for offers it can serve: its own arbiter (which also issues the verdict when a payment
    // window ends) and, for a market price, its own oracle and a pair it signs. Any other choice would leave a
    // paid offer that cannot be taken or whose disputes cannot be settled.
    if (document.arbiter.toLowerCase() !== this.arbiterPublicKeyHex) {
      throw new Error('Offers that Campfire pays for use the Campfire arbiter');
    }
    if (document.price.type === 'floating') {
      if (document.oracle?.toLowerCase() !== this.oraclePublicKeyHex.toLowerCase()) {
        throw new Error('Offers that Campfire pays for use the Campfire price oracle');
      }
      const coin = document.asset === BCH_ASSET ? 'BCH' : document.asset.toLowerCase() === PUSD_CATEGORY ? 'PUSD' : null;
      if (!coin || document.price.pair !== `${coin}/${document.fiat}`) {
        throw new Error(`A market price for this offer must use the pair ${coin ?? 'BCH or PUSD'}/${document.fiat}`);
      }
      // Throws if the oracle does not sign this pair.
      await this.options.oracle.createQuote(document.price.pair);
    }
    const maxExpirySec = this.sponsorshipLimits.maxExpirySec;
    if (document.expiresAt - now > maxExpirySec) {
      throw new Error(`Offers that Campfire pays for stay open ${Math.round(maxExpirySec / 86_400)} days at most`);
    }
    const status = await this.sponsorshipStatus(identity);
    if (status.remainingToday <= 0) {
      throw new SponsorshipLimitError(
        `Today's free offers are used up. Campfire pays the network fee for ${status.dailyOffers} buy offers per day across all users. Please try again later.`,
      );
    }
    if (status.openNow >= status.openOffersPerIdentity) {
      throw new SponsorshipLimitError(
        `You already have ${status.openOffersPerIdentity} open offers paid for by Campfire. Close one to publish another.`,
      );
    }
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
      delete copy.pendingFundingTxHex;
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
      trade.settlementTxid = await this.tryBroadcastArbitrate(trade);
      trade.status = 'ResolvedSeller';
      trade.updatedAt = now;
      trade.completedAt = now;
      await this.options.storage.saveTrade(trade);
      return trade;
    }

    // A verdict whose `arbitrate` broadcast failed earlier is retried on every read, so the escrow
    // never stays locked until `refundTime` because of a transient network error.
    if (
      (trade.status === 'ResolvedSeller' || trade.status === 'ResolvedBuyer') &&
      trade.verdict &&
      trade.verdictSignature &&
      !trade.settlementTxid
    ) {
      const txid = await this.tryBroadcastArbitrate(trade);
      if (txid) {
        trade.settlementTxid = txid;
        trade.updatedAt = now;
        await this.options.storage.saveTrade(trade);
      }
    }

    return trade;
  }

  // Broadcasts `arbitrate` with the stored verdict if the escrow UTXO is unspent; returns undefined on any failure.
  private async tryBroadcastArbitrate(trade: StoredTrade): Promise<string | undefined> {
    if (!trade.terms || !trade.tradeId || !trade.verdict || !trade.verdictSignature) {
      return undefined;
    }
    try {
      const contract = createEscrowContract(trade.terms, trade.tradeId, this.options.provider);
      const utxos = await contract.getUtxos();
      const escrowUtxo = utxos.find((u) => matchesEscrowFunding(u, trade.terms!));
      if (!escrowUtxo) {
        return undefined;
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
      return details.txid;
    } catch {
      // The signed verdict stays stored, so the next read (or anyone else) can broadcast it.
      return undefined;
    }
  }

  // Checks that a party's keys derive from the xpubs it registered, so nobody can name keys it does not control.
  private async verifyParty(
    role: 'buyer' | 'seller',
    keys: { identity: string; pk: string; defiIndex: number; payoutPkh: string; receiveIndex: number; sessionPk: string },
  ): Promise<void> {
    const Role = role === 'buyer' ? 'Buyer' : 'Seller';
    const record = await this.options.storage.getIdentity(keys.identity);
    if (!record) {
      throw new Error(`${Role} identity is not registered`);
    }
    if (!verifyDerivedPubkey(record.defiXpub, keys.defiIndex, keys.pk)) {
      throw new Error(`${role}Pk does not match ${role} defi xpub at ${role}DefiIndex`);
    }
    if (!verifyDerivedPayoutPkh(record.receiveXpub, keys.receiveIndex, keys.payoutPkh)) {
      throw new Error(`${role}PayoutPkh does not match ${role} receive xpub at ${role}ReceiveIndex`);
    }
    if (!isCompressedPubkeyHex(keys.sessionPk)) {
      throw new Error(`Invalid ${role}SessionPk`);
    }
  }

  // The open offer a trade is requested from, with the amount checked against its range.
  private async offerToTake(offerTxid: string, side: 'sell' | 'buy', amount: string): Promise<OfferView> {
    const offerView = await this.getOffer(offerTxid);
    if (!offerView) {
      throw new Error('Offer not found');
    }
    if (offerView.status !== 'Published') {
      throw new Error(`Offer is not open (status: ${offerView.status})`);
    }
    if (offerView.document.side !== side) {
      throw new Error(
        side === 'sell'
          ? 'This is a buy offer: a seller takes it, not a buyer'
          : 'This is a sell offer: a buyer takes it, not a seller',
      );
    }
    const amountBig = BigInt(amount);
    if (amountBig < BigInt(offerView.document.min) || amountBig > BigInt(offerView.document.max)) {
      throw new Error(`Requested amount ${amount} is outside offer range [${offerView.document.min}, ${offerView.document.max}]`);
    }
    return offerView;
  }

  // The price of the trade: signed quote and margin for a floating offer, the fixed price otherwise.
  private async priceRequest(doc: OfferDocument, amount: string, now: number) {
    if (doc.price.type === 'floating') {
      const quote = await this.options.oracle.createQuote(doc.price.pair);
      const marginBps = doc.price.marginBps;
      return {
        quote,
        marginBps,
        quoteExpiresAt: now + QUOTE_VALIDITY_SEC,
        fiatAmount: computeFiatAmount({ amount, assetDecimals: doc.assetDecimals, unitPrice: quote.price, marginBps }),
      };
    }
    return {
      quote: undefined,
      marginBps: undefined,
      quoteExpiresAt: undefined,
      fiatAmount: computeFiatAmount({ amount, assetDecimals: doc.assetDecimals, unitPrice: doc.price.value }),
    };
  }

  // A buyer takes a sell offer: the trade starts with the buyer's keys and waits for the seller to accept.
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
    const offerView = await this.offerToTake(params.offerTxid, 'sell', params.amount);
    await this.verifyParty('buyer', {
      identity: params.buyerIdentity,
      pk: params.buyerPk,
      defiIndex: params.buyerDefiIndex,
      payoutPkh: params.buyerPayoutPkh,
      receiveIndex: params.buyerReceiveIndex,
      sessionPk: params.buyerSessionPk,
    });

    const now = this.nowSeconds();
    const doc = offerView.document;
    const trade: StoredTrade = {
      id: binToHex(randomBytes(16)),
      offerTxid: offerView.offerTxid,
      side: 'sell',
      sellerIdentity: offerView.sellerIdentity,
      buyerIdentity: params.buyerIdentity,
      status: 'Requested',
      asset: doc.asset,
      assetDecimals: doc.assetDecimals,
      amount: params.amount,
      fiat: doc.fiat,
      ...(await this.priceRequest(doc, params.amount, now)),
      buyerPk: params.buyerPk.toLowerCase(),
      buyerDefiIndex: params.buyerDefiIndex,
      buyerPayoutPkh: params.buyerPayoutPkh.toLowerCase(),
      buyerReceiveIndex: params.buyerReceiveIndex,
      buyerSessionPk: params.buyerSessionPk.toLowerCase(),
      arbiterPk: doc.arbiter.toLowerCase(),
      oraclePk: doc.oracle?.toLowerCase(),
      isDemo: this.isDemoTrade({ sellerIdentity: offerView.sellerIdentity }),
      createdAt: now,
      updatedAt: now,
    };

    await this.options.storage.saveTrade(trade);
    return this.sanitizeTrade(trade, params.buyerIdentity);
  }

  // A seller takes a buy offer and chooses the amount. The trade starts with the seller's keys; the buyer who
  // published the offer accepts with their own, and only then is there an escrow to deposit into.
  async requestBuyOfferTrade(params: {
    offerTxid: string;
    sellerIdentity: string;
    amount: string;
    sellerPk: string;
    sellerDefiIndex: number;
    sellerPayoutPkh: string;
    sellerReceiveIndex: number;
    sellerSessionPk: string;
    // Only for the service's own demo seller, which derives its session key from the record id.
    recordId?: string;
  }): Promise<StoredTrade> {
    const offerView = await this.offerToTake(params.offerTxid, 'buy', params.amount);
    await this.verifyParty('seller', {
      identity: params.sellerIdentity,
      pk: params.sellerPk,
      defiIndex: params.sellerDefiIndex,
      payoutPkh: params.sellerPayoutPkh,
      receiveIndex: params.sellerReceiveIndex,
      sessionPk: params.sellerSessionPk,
    });

    const now = this.nowSeconds();
    const doc = offerView.document;
    const trade: StoredTrade = {
      id: params.recordId ?? binToHex(randomBytes(16)),
      offerTxid: offerView.offerTxid,
      side: 'buy',
      // The publisher of a buy offer is the buyer.
      buyerIdentity: offerView.sellerIdentity,
      sellerIdentity: params.sellerIdentity,
      status: 'Requested',
      asset: doc.asset,
      assetDecimals: doc.assetDecimals,
      amount: params.amount,
      fiat: doc.fiat,
      ...(await this.priceRequest(doc, params.amount, now)),
      sellerPk: params.sellerPk.toLowerCase(),
      sellerDefiIndex: params.sellerDefiIndex,
      sellerPayoutPkh: params.sellerPayoutPkh.toLowerCase(),
      sellerReceiveIndex: params.sellerReceiveIndex,
      sellerSessionPk: params.sellerSessionPk.toLowerCase(),
      arbiterPk: doc.arbiter.toLowerCase(),
      oraclePk: doc.oracle?.toLowerCase(),
      isDemo: this.isDemoTrade({ sellerIdentity: params.sellerIdentity }),
      createdAt: now,
      updatedAt: now,
    };

    await this.options.storage.saveTrade(trade);
    return this.sanitizeTrade(trade, params.sellerIdentity);
  }

  // Fixes the terms once both sets of keys are known, and so the trade id and the escrow address. The same
  // code serves both kinds of offer, so what is hashed cannot drift between them.
  private async settleTerms(
    trade: StoredTrade,
    seller: { pk: string; defiIndex: number; payoutPkh: string; receiveIndex: number; sessionPk: string },
    buyer: { pk: string; defiIndex: number; payoutPkh: string; receiveIndex: number; sessionPk: string },
    options: { refundTime?: number; nonce?: string; encryptedPaymentDetails?: string },
  ): Promise<StoredTrade> {
    const now = this.nowSeconds();
    // The party who accepts may set refundTime. Too soon and `refund` would hand the seller the coins back after the
    // buyer paid; too late and the seller's coins stay locked for years if the arbiter disappears.
    if (
      options.refundTime !== undefined &&
      (!Number.isInteger(options.refundTime) ||
        options.refundTime < now + MIN_REFUND_DELAY_SEC ||
        options.refundTime > now + MAX_REFUND_DELAY_SEC)
    ) {
      throw new Error('refundTime must be between 7 and 30 days after acceptance');
    }
    const refundTime = options.refundTime ?? now + DEFAULT_REFUND_DELAY_SEC;
    const nonce = options.nonce ?? binToHex(randomBytes(8));

    const terms: TradeTerms = {
      v: 1,
      offerTxid: trade.offerTxid,
      asset: trade.asset,
      amount: trade.amount,
      fiat: trade.fiat,
      fiatAmount: trade.fiatAmount,
      ...(trade.quote ? { quote: trade.quote, marginBps: trade.marginBps, oraclePk: trade.oraclePk } : {}),
      sellerPk: seller.pk.toLowerCase(),
      buyerPk: buyer.pk.toLowerCase(),
      arbiterPk: trade.arbiterPk,
      sellerPayoutPkh: seller.payoutPkh.toLowerCase(),
      buyerPayoutPkh: buyer.payoutPkh.toLowerCase(),
      sellerSessionPk: seller.sessionPk.toLowerCase(),
      buyerSessionPk: buyer.sessionPk.toLowerCase(),
      refundTime,
      nonce,
    };

    const termsJson = JSON.stringify(terms);
    const tradeId = binToHex(computeTradeId(termsJson)).toLowerCase();
    const contract = createEscrowContract(terms, tradeId, this.options.provider);

    trade.tradeId = tradeId;
    trade.status = 'Accepted';
    trade.sellerPk = terms.sellerPk;
    trade.sellerDefiIndex = seller.defiIndex;
    trade.sellerPayoutPkh = terms.sellerPayoutPkh;
    trade.sellerReceiveIndex = seller.receiveIndex;
    trade.sellerSessionPk = terms.sellerSessionPk;
    trade.buyerPk = terms.buyerPk;
    trade.buyerDefiIndex = buyer.defiIndex;
    trade.buyerPayoutPkh = terms.buyerPayoutPkh;
    trade.buyerReceiveIndex = buyer.receiveIndex;
    trade.buyerSessionPk = terms.buyerSessionPk;
    trade.refundTime = refundTime;
    trade.nonce = nonce;
    trade.terms = terms;
    trade.termsJson = termsJson;
    trade.escrowAddress = contract.address;
    trade.escrowTokenAddress = contract.tokenAddress;
    if (options.encryptedPaymentDetails) {
      trade.encryptedPaymentDetails = options.encryptedPaymentDetails;
    }
    trade.fundingDeadline = now + FUNDING_WINDOW_SEC;
    trade.updatedAt = now;

    await this.options.storage.saveTrade(trade);
    return trade;
  }

  // The seller of a sell offer accepts a buyer's request, with the payment details for that buyer.
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
    if (trade.side === 'buy') {
      throw new Error('The request on a buy offer is accepted by the buyer who published it');
    }
    if (trade.sellerIdentity !== params.sellerIdentity) {
      throw new Error('Only the offer seller can accept this trade');
    }
    if (!params.encryptedPaymentDetails || params.encryptedPaymentDetails.trim().length === 0) {
      throw new Error('Seller must provide encryptedPaymentDetails on acceptance');
    }
    await this.verifyParty('seller', {
      identity: params.sellerIdentity,
      pk: params.sellerPk,
      defiIndex: params.sellerDefiIndex,
      payoutPkh: params.sellerPayoutPkh,
      receiveIndex: params.sellerReceiveIndex,
      sessionPk: params.sellerSessionPk,
    });
    if (!trade.buyerPk || trade.buyerDefiIndex === undefined || !trade.buyerPayoutPkh || trade.buyerReceiveIndex === undefined || !trade.buyerSessionPk) {
      throw new Error('The buyer keys of this trade are missing');
    }

    const settled = await this.settleTerms(
      trade,
      { pk: params.sellerPk, defiIndex: params.sellerDefiIndex, payoutPkh: params.sellerPayoutPkh, receiveIndex: params.sellerReceiveIndex, sessionPk: params.sellerSessionPk },
      { pk: trade.buyerPk, defiIndex: trade.buyerDefiIndex, payoutPkh: trade.buyerPayoutPkh, receiveIndex: trade.buyerReceiveIndex, sessionPk: trade.buyerSessionPk },
      { refundTime: params.refundTime, nonce: params.nonce, encryptedPaymentDetails: params.encryptedPaymentDetails },
    );
    return this.sanitizeTrade(settled, params.sellerIdentity);
  }

  // The buyer who published a buy offer accepts a seller's request with their own keys. The payment details
  // come later, with the seller's deposit, because only then does the seller know who they are paying.
  async acceptBuyOfferTrade(params: {
    tradeRecordId: string;
    buyerIdentity: string;
    buyerPk: string;
    buyerDefiIndex: number;
    buyerPayoutPkh: string;
    buyerReceiveIndex: number;
    buyerSessionPk: string;
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
    if (trade.side !== 'buy') {
      throw new Error('The request on a sell offer is accepted by the seller who published it');
    }
    if (trade.buyerIdentity !== params.buyerIdentity) {
      throw new Error('Only the buyer who published this offer can accept the request');
    }
    await this.verifyParty('buyer', {
      identity: params.buyerIdentity,
      pk: params.buyerPk,
      defiIndex: params.buyerDefiIndex,
      payoutPkh: params.buyerPayoutPkh,
      receiveIndex: params.buyerReceiveIndex,
      sessionPk: params.buyerSessionPk,
    });
    if (!trade.sellerPk || trade.sellerDefiIndex === undefined || !trade.sellerPayoutPkh || trade.sellerReceiveIndex === undefined || !trade.sellerSessionPk) {
      throw new Error('The seller keys of this trade are missing');
    }

    const settled = await this.settleTerms(
      trade,
      { pk: trade.sellerPk, defiIndex: trade.sellerDefiIndex, payoutPkh: trade.sellerPayoutPkh, receiveIndex: trade.sellerReceiveIndex, sessionPk: trade.sellerSessionPk },
      { pk: params.buyerPk, defiIndex: params.buyerDefiIndex, payoutPkh: params.buyerPayoutPkh, receiveIndex: params.buyerReceiveIndex, sessionPk: params.buyerSessionPk },
      { refundTime: params.refundTime, nonce: params.nonce },
    );
    return this.sanitizeTrade(settled, params.buyerIdentity);
  }

  // The publisher of the offer turns a request down: the seller on a sell offer, the buyer on a buy offer.
  async declineTrade(params: {
    tradeRecordId: string;
    identity: string;
  }): Promise<StoredTrade> {
    const trade = await this.options.storage.getTrade(params.tradeRecordId);
    if (!trade) {
      throw new Error('Trade not found');
    }
    if (trade.side === 'buy') {
      if (trade.buyerIdentity !== params.identity) {
        throw new Error('Only the buyer who published this offer can decline this trade');
      }
    } else if (trade.sellerIdentity !== params.identity) {
      throw new Error('Only the seller can decline this trade');
    }
    if (trade.status !== 'Requested') {
      throw new Error(`Cannot decline trade in state "${trade.status}"`);
    }
    trade.status = 'Dropped';
    trade.updatedAt = this.nowSeconds();
    await this.options.storage.saveTrade(trade);
    return this.sanitizeTrade(trade, params.identity);
  }

  // Stores the signed funding transaction before it is broadcast, so any later attempt (from this
  // or another server instance) rebroadcasts the same transaction instead of funding twice.
  async recordFundingAttempt(tradeRecordId: string, fundingTxHex: string): Promise<void> {
    const trade = await this.options.storage.getTrade(tradeRecordId);
    if (!trade) {
      throw new Error('Trade not found');
    }
    if (trade.status !== 'Accepted') {
      throw new Error(`Cannot record a funding attempt for trade in state "${trade.status}"`);
    }
    trade.pendingFundingTxHex = fundingTxHex;
    trade.updatedAt = this.nowSeconds();
    await this.options.storage.saveTrade(trade);
  }

  async confirmFunding(params: {
    idOrTradeId: string;
    fundingTxHex?: string;
    confirmations?: number;
    // Buy offers: the seller sends the payment details, encrypted for the buyer and signed with the seller's
    // session key, along with the deposit.
    encryptedPaymentDetails?: string;
    paymentDetailsSignature?: string;
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

    // The payment details of a buy offer travel with the deposit. Every check on them comes before anything
    // is broadcast, so a rejected request never leaves a deposit on the network without details to go with it.
    // Identities are not proven (section 1), and the buyer can encrypt with the same key as the seller, so only the
    // signature by the seller's session key, committed in the terms, shows that the seller wrote them. Without it the
    // buyer could swap in an account of their own and show it to an arbiter as the one they paid.
    const details = params.encryptedPaymentDetails?.trim();
    if (details) {
      if (trade.side !== 'buy') {
        throw new Error('The payment details of a sell offer are sent when the seller accepts');
      }
      if (
        !trade.sellerSessionPk ||
        !params.paymentDetailsSignature ||
        !verifyPaymentDetailsSignature(trade.sellerSessionPk, trade.tradeId, details, params.paymentDetailsSignature)
      ) {
        throw new Error("The payment details must be signed with the seller's session key");
      }
    }
    const needsDetails = trade.side === 'buy' && trade.status === 'Accepted' && !trade.encryptedPaymentDetails && !details;
    if (needsDetails && params.fundingTxHex) {
      throw new Error('The seller must send the encrypted payment details with the deposit');
    }

    if (params.fundingTxHex) {
      await this.options.provider.sendRawTransaction(params.fundingTxHex);
    }

    const contract = createEscrowContract(trade.terms, trade.tradeId, this.options.provider);
    // Right after a broadcast the indexer may not list the new UTXO yet, so look a few times.
    const attempts = params.fundingTxHex ? 4 : 1;
    const delayMs = this.options.fundingLookupDelayMs ?? 1000;
    let matchingUtxo: Awaited<ReturnType<typeof contract.getUtxos>>[number] | undefined;
    for (let attempt = 0; attempt < attempts && !matchingUtxo; attempt++) {
      if (attempt > 0 && delayMs > 0) {
        await new Promise((resolve) => setTimeout(resolve, delayMs));
      }
      const utxos = await contract.getUtxos();
      matchingUtxo = utxos.find((u) => matchesEscrowFunding(u, trade.terms!));
    }
    if (!matchingUtxo) {
      throw new Error('No UTXO at the escrow address matches the required value and token terms');
    }
    if (needsDetails) {
      // The deposit is already on the network (it was not sent through this request): the seller sends the
      // details with a second call, and the trade stays Accepted until they arrive.
      throw new Error('The seller must send the encrypted payment details with the deposit');
    }

    const offer = await this.options.storage.getOffer(trade.offerTxid);
    const paymentWindowSec = offer?.document.paymentWindowSec ?? 3600;
    const now = this.nowSeconds();

    if (details) {
      trade.encryptedPaymentDetails = details;
      trade.paymentDetailsSignature = params.paymentDetailsSignature!.toLowerCase();
    }
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
    // A resolved trade whose `arbitrate` was never broadcast can still be settled with its stored verdict.
    const pendingArbitrate =
      params.path === 'arbitrate' &&
      (trade.status === 'ResolvedSeller' || trade.status === 'ResolvedBuyer') &&
      !trade.settlementTxid;
    if (!['Funded', 'Paid', 'Disputed'].includes(trade.status) && !pendingArbitrate) {
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
        buyerDefiIndex: trade.buyerDefiIndex ?? 0,
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
    trade.completedAt = trade.completedAt ?? now;
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

  // A message counts only with a signature by the sender's session key, committed in the trade terms. Identities are
  // not proven (section 1) and both parties share the chat key, so without it one party could post messages in the
  // other's name, such as "payment received", and show them to the arbiter.
  async postChatMessage(params: {
    idOrTradeId: string;
    senderIdentity: string;
    ciphertext: string;
    signature?: string;
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
    if (typeof params.ciphertext !== 'string' || !params.ciphertext.includes(':')) {
      throw new Error('Chat message must be an encrypted AES-GCM payload');
    }
    if (params.ciphertext.length > MAX_CHAT_CIPHERTEXT_LENGTH) {
      throw new Error(`Chat messages can be at most ${MAX_CHAT_MESSAGE_CHARS} characters long, and images at most ${MAX_CHAT_IMAGE_BYTES / 1000} KB`);
    }
    if (!trade.tradeId || !trade.buyerSessionPk || !trade.sellerSessionPk) {
      throw new Error('The chat opens once the trade is accepted');
    }
    // A finished trade keeps its chat as a record; nothing new can be added to it.
    if (CHAT_CLOSED_STATES.has(trade.status)) {
      throw new Error('The chat closed when the trade ended');
    }
    // The role whose session key signed it; a person trading with themselves holds both roles.
    const roles: ('buyer' | 'seller')[] = [];
    if (trade.buyerIdentity === params.senderIdentity) roles.push('buyer');
    if (trade.sellerIdentity === params.senderIdentity) roles.push('seller');
    const senderRole = params.signature
      ? roles.find((role) =>
          verifyChatMessageSignature(
            role === 'buyer' ? trade.buyerSessionPk! : trade.sellerSessionPk!,
            trade.tradeId!,
            params.ciphertext,
            params.signature!,
          ),
        )
      : undefined;
    if (!senderRole) {
      throw new Error("Chat messages must be signed with the sender's session key");
    }
    const signature = params.signature!.toLowerCase();
    // A signed message cannot be posted twice: anyone who reads it could otherwise repeat it later.
    const existing = await this.options.storage.listChatMessages(trade.id);
    if (existing.some((m) => m.signature === signature)) {
      throw new Error('This message was already posted');
    }
    const msg: StoredChatMessage = {
      id: binToHex(randomBytes(12)),
      tradeRecordId: trade.id,
      senderIdentity: params.senderIdentity,
      senderRole,
      signature,
      ciphertext: params.ciphertext,
      createdAt: this.nowSeconds(),
    };
    await this.options.storage.addChatMessage(msg);
    return msg;
  }

  // `sinceSeconds`: only messages created at or after it, so a client that polls asks for what is new.
  async listChatMessages(idOrTradeId: string, sinceSeconds?: number): Promise<StoredChatMessage[]> {
    const trade = await this.options.storage.getTrade(idOrTradeId);
    if (!trade) {
      throw new Error('Trade not found');
    }
    return this.options.storage.listChatMessages(trade.id, sinceSeconds);
  }

  // In a dispute where a party handed over `sharedTradeKeyHex`, the arbiter can decrypt the chat log.
  async decryptDisputedChatForArbiter(
    idOrTradeId: string,
    sinceSeconds?: number,
  ): Promise<DecryptedChatMessage[]> {
    const trade = await this.options.storage.getTrade(idOrTradeId);
    if (!trade) {
      throw new Error('Trade not found');
    }
    if (!trade.sharedTradeKeyHex) {
      throw new Error('No shared trade key has been handed to the arbiter for this trade');
    }
    const messages = await this.options.storage.listChatMessages(trade.id, sinceSeconds);
    const decrypted: DecryptedChatMessage[] = [];
    for (const m of messages) {
      // One message that does not decrypt (a party can post a signed message encrypted with another key) must not
      // hide the rest of the chat from the arbiter: it is returned as unreadable, with its author and signature.
      let plaintext: string | null;
      try {
        plaintext = await decryptChatMessage(trade.sharedTradeKeyHex, m.ciphertext);
      } catch {
        plaintext = null;
      }
      // Checked again here so the arbiter never relies on what was stored: a message counts as written by a role
      // only if that role's session key signed it.
      const sessionPk = m.senderRole === 'buyer' ? trade.buyerSessionPk : m.senderRole === 'seller' ? trade.sellerSessionPk : undefined;
      const verified = Boolean(
        sessionPk && trade.tradeId && m.signature && verifyChatMessageSignature(sessionPk, trade.tradeId, m.ciphertext, m.signature),
      );
      decrypted.push({
        id: m.id,
        senderIdentity: m.senderIdentity,
        ...(verified ? { senderRole: m.senderRole } : {}),
        verified,
        plaintext,
        createdAt: m.createdAt,
      });
    }
    return decrypted;
  }
}
