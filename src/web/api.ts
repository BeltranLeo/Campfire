// Typed access to the Campfire API on the same origin. Errors arrive as { error } with a message
// that is already written for display, so ApiError carries it unchanged.

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

// A request that never answers would leave a page loading forever. Writes get longer: taking a demo
// offer waits for the demo seller's on-chain deposit.
const TIMEOUT_MS = { GET: 20_000, POST: 60_000 };

async function request<T>(method: 'GET' | 'POST', path: string, body?: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, {
      method,
      headers: body === undefined ? undefined : { 'content-type': 'application/json' },
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

export const apiGet = <T>(path: string) => request<T>('GET', path);
export const apiPost = <T>(path: string, body: unknown) => request<T>('POST', path, body);

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
}

export interface ApiConfig {
  arbiterPk: string;
  oraclePk: string;
  pusdCategory: string;
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
  createdAt: number;
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
  buyerIdentity: string;
  sellerIdentity: string;
  buyerSessionPk?: string;
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
  buyerPk: string;
  buyerPayoutPkh: string;
  sellerPk?: string;
  sellerPayoutPkh?: string;
  sellerSessionPk?: string;
  arbiterPk: string;
  oraclePk?: string;
  refundTime?: number;
  termsJson?: string;
  escrowAddress?: string;
  escrowTokenAddress?: string;
  encryptedPaymentDetails?: string;
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

/** GET /api/trades/:id/chat?arbiter=true: the messages as the arbiter reads them after a party handed over the key. */
export interface ArbiterChat {
  messages: unknown[];
  /** Present only when a party handed the shared key to the arbiter. */
  decrypted?: { id: string; senderIdentity: string; plaintext: string; createdAt: number }[];
}

export interface DemoInfo {
  enabled: boolean;
  identity: string;
  limits: { maxActiveTrades: number; maxDailyFundings: number };
}
