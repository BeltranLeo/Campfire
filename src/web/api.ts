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

async function request<T>(method: 'GET' | 'POST', path: string, body?: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, {
      method,
      headers: body === undefined ? undefined : { 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new ApiError(0, 'Campfire could not be reached. Check your connection and try again.');
  }
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    const message = typeof data?.error === 'string' ? data.error : `Campfire answered with an error (${res.status}).`;
    throw new ApiError(res.status, message);
  }
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

/** The fields of a trade the app reads so far; more are added as pages need them. */
export interface TradeSummary {
  id: string;
  status: TradeState;
  buyerIdentity: string;
  sellerIdentity: string;
}
