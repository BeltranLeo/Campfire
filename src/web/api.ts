// Typed access to the Campfire API on the same origin. Errors arrive as { error } with a message
// that is already written for display, so ApiError carries it unchanged.

import type { TradeFee } from '../protocol/fees.js';

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

// Session token from the wallet sign-in (docs/protocol.md, section 1). Requests that act for the identity need
// it; it travels in a header on every request, so pages never pass it around.
let sessionToken: string | null = null;
export const setSessionToken = (token: string | null) => {
  sessionToken = token;
};

// A request that never answers would leave a page loading forever. Writes get longer: taking a demo
// offer waits for the demo seller's on-chain deposit.
const TIMEOUT_MS = { GET: 20_000, POST: 60_000 };

async function request<T>(method: 'GET' | 'POST', path: string, body?: unknown, token?: string): Promise<T> {
  let res: Response;
  // The arbiter's admin token travels only in this header, never in a URL (it would end up in logs and history).
  const headers: Record<string, string> = {};
  if (body !== undefined) headers['content-type'] = 'application/json';
  if (token) headers.authorization = `Bearer ${token}`;
  if (sessionToken) headers['x-campfire-session'] = sessionToken;
  try {
    res = await fetch(path, {
      method,
      headers: Object.keys(headers).length > 0 ? headers : undefined,
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(TIMEOUT_MS[method]),
    });
  } catch (err) {
    if (err instanceof DOMException && err.name === 'TimeoutError') {
      throw new ApiError(0, 'Campfire did not answer in time. Try again.');
    }
    throw new ApiError(0, 'Campfire could not be reached. Check your connection and try again.');
  }
  const data = (await res.json().catch(() => undefined)) as { error?: unknown } | undefined;
  if (!res.ok) {
    const message = typeof data?.error === 'string' ? data.error : `Campfire answered with an error (${res.status}).`;
    throw new ApiError(res.status, message);
  }
  // A 200 that is not JSON means the request reached something other than the API (a misrouted
  // deploy, or the dev server without its proxy); treating it as data would show an empty page.
  if (data === undefined) throw new ApiError(502, `Campfire answered with an error (${res.status}).`);
  return data as T;
}

export const apiGet = <T>(path: string, token?: string) => request<T>('GET', path, undefined, token);
export const apiPost = <T>(path: string, body: unknown, token?: string) => request<T>('POST', path, body, token);

/** The fee rates new trades use, as GET /api/fees returns them. */
export interface FeeRatesInfo {
  arbiterBps: number;
  oracleBps: number;
  maxBps: number;
  dustLimitSats: number;
}

/** One of the service's own accounts, as GET /api/admin/accounts returns it (src/server/accounts.ts). */
export interface AccountBalance {
  address: string;
  tokenAddress: string;
  /** Base units as strings: sats and PUSD cents. */
  bchSats: string;
  pusdUnits: string;
}

/** An account whose lookup failed; the others are still shown. */
export interface AccountError {
  address: string;
  error: string;
}

export interface BotAccount extends AccountBalance {
  addressCount: number;
  canFundMax: { BCH: boolean | null; PUSD: boolean | null };
  maxBchSats: string;
  maxPusdUnits: string;
}

export interface ServiceAccounts {
  bchUsd: string | null;
  bot: BotAccount | AccountError | null;
  oracle: AccountBalance | AccountError;
  arbiter: AccountBalance | AccountError;
}

// --- Shapes used by the web app (see src/server/http.ts and src/server/service.ts) ---

export type TradeState =
  | 'Requested'
  | 'Accepted'
  | 'Dropped'
  | 'Funded'
  | 'Paid'
  | 'Disputed'
  | 'Released'
  | 'Cancelled'
  | 'ResolvedBuyer'
  | 'ResolvedSeller'
  | 'Refunded';

const FINAL_STATES: ReadonlySet<TradeState> = new Set([
  'Released',
  'ResolvedBuyer',
  'Cancelled',
  'ResolvedSeller',
  'Refunded',
  'Dropped',
]);

export const isFinalState = (state: TradeState) => FINAL_STATES.has(state);

export interface Reputation {
  identity: string;
  completedAsSeller: number;
  completedAsBuyer: number;
  /** Unix time in seconds, or null before the first completed trade. */
  firstCompletedAt: number | null;
}

export interface RegisteredIdentity {
  identity: string;
  reputation: Reputation;
  /** Session token for the requests that act for this identity. */
  session: string;
}

export interface ApiConfig {
  arbiterPk: string;
  oraclePk: string;
  pusdCategory: string;
  /** The token category of NFT offer markers (protocol section 3.4); null while offers use the 1,000-sat marker. */
  offerCategory?: string | null;
  bchDecimals: number;
  pusdDecimals: number;
  demoSellerIdentity: string | null;
}

export type OfferPrice = { type: 'fixed'; value: string } | { type: 'floating'; pair: string; marginBps: number };

/** The offer as published on IPFS and indexed by the service (docs/protocol.md, section 2.2). */
export interface OfferDocument {
  v: 1;
  side: 'sell' | 'buy';
  /** "BCH" or a CashToken category id. */
  asset: string;
  assetDecimals: number;
  fiat: string;
  price: OfferPrice;
  /** Smallest and largest trade, in base units (sats, or token base units). */
  min: string;
  max: string;
  paymentMethods: string[];
  paymentWindowSec: number;
  terms?: string;
  expiresAt: number;
  arbiter: string;
  oracle?: string;
}

export interface Offer {
  offerTxid: string;
  sellerIdentity: string;
  status: 'Published' | 'Closed' | 'Expired';
  /** Set by the service for offers of its demo seller; never decided by the client. */
  isDemo: boolean;
  document: OfferDocument;
  /** The 1,000-sat marker output that keeps the offer open; spending it closes the offer. */
  markerAddress?: string;
  markerVout?: number;
  /** The receive index of the marker's address in the publisher's wallet, when the service recorded it. */
  markerReceiveIndex?: number;
  /** Set when the marker is an NFT of this category (format 2): closing burns it. */
  markerCategory?: string;
  closeTxid?: string;
  /** Published and paid for by Campfire (buy offers). */
  sponsored?: boolean;
  createdAt: number;
}

/** GET /api/offers/sponsored: what is left of the buy offers Campfire pays for. */
export interface SponsorshipStatus {
  enabled: boolean;
  dailyOffers?: number;
  openOffersPerIdentity?: number;
  maxExpirySec?: number;
  usedToday?: number;
  remainingToday?: number;
  /** Unix seconds when a daily slot frees up; null while there is room. */
  nextSlotAt?: number | null;
  openNow?: number;
}

export interface PriceQuote {
  pair: string;
  /** Fiat per whole unit of the asset, as a decimal string. */
  price: string;
  timestamp: number;
  signature: string;
}

/** The fields of a trade the app reads so far; more are added as pages need them. */
export interface TradeSummary {
  id: string;
  status: TradeState;
  offerTxid: string;
  /** The side of the offer the trade came from; absent on trades from before buy offers (sell). */
  side?: 'sell' | 'buy';
  buyerIdentity: string;
  sellerIdentity: string;
  buyerSessionPk?: string;
  sellerSessionPk?: string;
  buyerDefiIndex?: number;
  buyerReceiveIndex?: number;
  sellerDefiIndex?: number;
  sellerReceiveIndex?: number;
}

/** A trade as GET /api/trades/:id returns it (src/server/storage.ts, StoredTrade). Times are Unix seconds. */
export interface Trade extends TradeSummary {
  /** The contract's trade id (hash of the terms), set on acceptance; not the record id in the URL. */
  tradeId?: string;
  asset: string;
  assetDecimals: number;
  amount: string;
  fiat: string;
  fiatAmount: string;
  quote?: PriceQuote;
  marginBps?: number;
  quoteExpiresAt?: number;
  /** The buyer's keys: on a buy offer they arrive only when the buyer accepts. */
  buyerPk?: string;
  buyerPayoutPkh?: string;
  sellerPk?: string;
  sellerPayoutPkh?: string;
  arbiterPk: string;
  oraclePk?: string;
  /** Service fees the seller pays in the deposit, fixed when the trade was requested (protocol section 5.1). */
  fees?: TradeFee[];
  refundTime?: number;
  termsJson?: string;
  escrowAddress?: string;
  escrowTokenAddress?: string;
  encryptedPaymentDetails?: string;
  /** Buy offers: the seller's session-key signature over the payment details (protocol section 6). */
  paymentDetailsSignature?: string;
  fundingDeadline?: number;
  fundingTxid?: string;
  fundingVout?: number;
  fundingConfirmations?: number;
  fundedAt?: number;
  paymentDeadline?: number;
  paidAt?: number;
  disputedBy?: 'buyer' | 'seller';
  disputedAt?: number;
  disputeReason?: string;
  verdict?: '01' | '02';
  verdictReason?: string;
  verdictIssuedAt?: number;
  settlementTxid?: string;
  isDemo?: boolean;
  createdAt: number;
  updatedAt: number;
  completedAt?: number;
}

/** A chat message as GET /api/trades/:id/chat returns it (src/server/storage.ts, StoredChatMessage): ciphertext only. */
export interface ChatMessage {
  id: string;
  tradeRecordId: string;
  senderIdentity: string;
  /** The role whose session key signed it, as the service checked; absent on messages from before signatures. */
  senderRole?: 'buyer' | 'seller';
  signature?: string;
  /** `<iv hex>:<AES-GCM ciphertext hex>`, encrypted with the key buyer and seller share. */
  ciphertext: string;
  /** Unix seconds, on the service's clock. */
  createdAt: number;
}

/** GET /api/trades/:id/chat?arbiter=true: the messages as the arbiter reads them after a party handed over the key. */
export interface ArbiterChat {
  messages: unknown[];
  /** Present only when a party handed the shared key to the arbiter. */
  decrypted?: {
    id: string;
    senderIdentity: string;
    /** Who signed the message with their session key; absent when the signature is missing or wrong. */
    senderRole?: 'buyer' | 'seller';
    verified?: boolean;
    /** Null when this one message does not decrypt with the handed-over key. */
    plaintext: string | null;
    createdAt: number;
  }[];
}

export interface DemoInfo {
  enabled: boolean;
  identity: string;
  /** Amounts come as strings in base units (sats, PUSD cents). */
  limits: { maxActiveTrades: number; maxDailyFundings: number; minBchSats?: string; maxBchSats?: string; minPusdUnits?: string; maxPusdUnits?: string };
}
