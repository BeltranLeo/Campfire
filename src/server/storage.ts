// Storage interface and implementations (in-memory/JSON for local & tests, Postgres for Vercel deployment).

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import type { OfferDocument, OfferOnChainRecord, PriceQuote, TradeFee, TradeTerms, VerdictHex } from '../protocol/index.js';

export type OfferStatus = 'Published' | 'Closed' | 'Expired';

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

export interface UserIdentityRecord {
  identity: string;
  defiXpub: string;
  receiveXpub: string;
  createdAt: number;
  updatedAt: number;
}

export interface StoredOffer {
  offerTxid: string;
  // The identity that published the offer: the seller of a sell offer, the buyer of a buy offer. The name dates
  // from when only sell offers existed; changing it would change the stored records and the public API.
  sellerIdentity: string;
  contentHash: string;
  offerJson: string;
  document: OfferDocument;
  onChain: OfferOnChainRecord;
  markerVout: number;
  markerAddress: string;
  // The receive index of the marker's address, so the publisher's wallet finds it without searching.
  markerReceiveIndex?: number;
  // Format-2 offers only: the token category of the NFT marker (protocol section 3.4). The address is then `z…`.
  markerCategory?: string;
  status: 'Published' | 'Closed';
  closeTxid?: string;
  isDemo?: boolean;
  // Published and paid for by the service (buy offers only); counted against the daily limit.
  sponsored?: boolean;
  createdAt: number;
  updatedAt: number;
}

export interface StoredTrade {
  id: string;
  tradeId?: string;
  offerTxid: string;
  // The side of the offer this trade was taken from; records saved before buy offers existed have none (sell).
  side?: 'sell' | 'buy';
  sellerIdentity: string;
  buyerIdentity: string;
  status: TradeState;
  asset: string;
  assetDecimals: number;
  amount: string;
  fiat: string;
  fiatAmount: string;
  quote?: PriceQuote;
  marginBps?: number;
  quoteExpiresAt?: number;
  // Keys of the party that did not take the offer arrive when it accepts: the seller's on a sell offer (already
  // present on a buy offer's trade) and the buyer's on a buy offer.
  buyerPk?: string;
  buyerDefiIndex?: number;
  buyerPayoutPkh?: string;
  buyerReceiveIndex?: number;
  buyerSessionPk?: string;
  sellerPk?: string;
  sellerDefiIndex?: number;
  sellerPayoutPkh?: string;
  sellerReceiveIndex?: number;
  sellerSessionPk?: string;
  arbiterPk: string;
  oraclePk?: string;
  // Fee outputs fixed when the trade is requested, from the rates in force then, and copied into the terms.
  fees?: TradeFee[];
  refundTime?: number;
  nonce?: string;
  terms?: TradeTerms;
  termsJson?: string;
  escrowAddress?: string;
  escrowTokenAddress?: string;
  encryptedPaymentDetails?: string;
  // Buy offers: the seller's session-key signature over the ciphertext (protocol section 6).
  paymentDetailsSignature?: string;
  // Signed funding transaction already broadcast by the demo seller; retries rebroadcast exactly this one.
  pendingFundingTxHex?: string;
  fundingDeadline?: number;
  fundingTxid?: string;
  fundingVout?: number;
  fundingConfirmations?: number;
  fundedAt?: number;
  paymentDeadline?: number;
  paidAt?: number;
  disputedBy?: 'buyer' | 'seller';
  disputeReason?: string;
  // The first trade key handed to the arbiter, and the one each party handed over (the arbiter tries all of them).
  sharedTradeKeyHex?: string;
  disputeKeys?: { buyer?: string; seller?: string };
  disputedAt?: number;
  verdict?: VerdictHex;
  verdictSignature?: string;
  verdictReason?: string;
  verdictIssuedAt?: number;
  settlementTxid?: string;
  isDemo?: boolean;
  createdAt: number;
  updatedAt: number;
  completedAt?: number;
}

export interface StoredChatMessage {
  id: string;
  tradeRecordId: string;
  senderIdentity: string;
  // Whose session key signed the message (protocol section 6); messages stored before signatures have neither.
  senderRole?: 'buyer' | 'seller';
  signature?: string;
  ciphertext: string;
  createdAt: number;
}

export interface StorageAdapter {
  saveIdentity(record: UserIdentityRecord): Promise<void>;
  getIdentity(identity: string): Promise<UserIdentityRecord | null>;

  saveOffer(offer: StoredOffer): Promise<void>;
  getOffer(offerTxid: string): Promise<StoredOffer | null>;
  getOfferByHash(contentHash: string): Promise<StoredOffer | null>;
  listOffers(): Promise<StoredOffer[]>;

  saveTrade(trade: StoredTrade): Promise<void>;
  getTrade(idOrTradeId: string): Promise<StoredTrade | null>;
  listTrades(filter?: { identity?: string; offerTxid?: string }): Promise<StoredTrade[]>;

  addChatMessage(msg: StoredChatMessage): Promise<void>;
  /** In order of time; with `sinceSeconds`, only messages created at or after it. */
  listChatMessages(tradeRecordId: string, sinceSeconds?: number): Promise<StoredChatMessage[]>;

  /** Service settings the administrator changes at runtime (the fee rates), stored as JSON by key. */
  getSetting<T>(key: string): Promise<T | null>;
  saveSetting(key: string, value: unknown): Promise<void>;

  // Runs `fn` while holding a named lock shared by every server instance using this storage.
  // Optional: storage that lives in one process needs no cross-instance lock.
  withLock?<T>(name: string, fn: () => Promise<T>): Promise<T>;
}

interface MemorySnapshot {
  identities: [string, UserIdentityRecord][];
  offers: [string, StoredOffer][];
  trades: [string, StoredTrade][];
  chat: [string, StoredChatMessage[]][];
  settings?: [string, unknown][];
}

export class MemoryStorage implements StorageAdapter {
  private identities = new Map<string, UserIdentityRecord>();
  private offers = new Map<string, StoredOffer>();
  private trades = new Map<string, StoredTrade>();
  private chat = new Map<string, StoredChatMessage[]>();
  private settings = new Map<string, unknown>();
  private filePath?: string;

  constructor(options?: { filePath?: string }) {
    this.filePath = options?.filePath;
    if (this.filePath && existsSync(this.filePath)) {
      try {
        const raw = JSON.parse(readFileSync(this.filePath, 'utf8')) as MemorySnapshot;
        this.identities = new Map(raw.identities ?? []);
        this.offers = new Map(raw.offers ?? []);
        this.trades = new Map(raw.trades ?? []);
        this.chat = new Map(raw.chat ?? []);
        this.settings = new Map(raw.settings ?? []);
      } catch {
        // Start with an empty store if the snapshot file cannot be parsed.
      }
    }
  }

  private flush(): void {
    if (!this.filePath) return;
    const snapshot: MemorySnapshot = {
      identities: [...this.identities.entries()],
      offers: [...this.offers.entries()],
      trades: [...this.trades.entries()],
      chat: [...this.chat.entries()],
      settings: [...this.settings.entries()],
    };
    writeFileSync(this.filePath, JSON.stringify(snapshot, null, 2), 'utf8');
  }

  async saveIdentity(record: UserIdentityRecord): Promise<void> {
    this.identities.set(record.identity, structuredClone(record));
    this.flush();
  }

  async getIdentity(identity: string): Promise<UserIdentityRecord | null> {
    const found = this.identities.get(identity);
    return found ? structuredClone(found) : null;
  }

  async saveOffer(offer: StoredOffer): Promise<void> {
    this.offers.set(offer.offerTxid, structuredClone(offer));
    this.flush();
  }

  async getOffer(offerTxid: string): Promise<StoredOffer | null> {
    const found = this.offers.get(offerTxid);
    return found ? structuredClone(found) : null;
  }

  async getOfferByHash(contentHash: string): Promise<StoredOffer | null> {
    const target = contentHash.toLowerCase();
    for (const offer of this.offers.values()) {
      if (offer.contentHash.toLowerCase() === target) {
        return structuredClone(offer);
      }
    }
    return null;
  }

  async listOffers(): Promise<StoredOffer[]> {
    return [...this.offers.values()]
      .map((o) => structuredClone(o))
      .sort((a, b) => b.createdAt - a.createdAt);
  }

  async saveTrade(trade: StoredTrade): Promise<void> {
    this.trades.set(trade.id, structuredClone(trade));
    this.flush();
  }

  async getTrade(idOrTradeId: string): Promise<StoredTrade | null> {
    const direct = this.trades.get(idOrTradeId);
    if (direct) return structuredClone(direct);
    const lower = idOrTradeId.toLowerCase();
    for (const trade of this.trades.values()) {
      if (trade.tradeId?.toLowerCase() === lower) {
        return structuredClone(trade);
      }
    }
    return null;
  }

  async listTrades(filter?: { identity?: string; offerTxid?: string }): Promise<StoredTrade[]> {
    let items = [...this.trades.values()];
    if (filter?.identity) {
      items = items.filter(
        (t) => t.sellerIdentity === filter.identity || t.buyerIdentity === filter.identity,
      );
    }
    if (filter?.offerTxid) {
      items = items.filter((t) => t.offerTxid === filter.offerTxid);
    }
    return items.map((t) => structuredClone(t)).sort((a, b) => b.createdAt - a.createdAt);
  }

  async addChatMessage(msg: StoredChatMessage): Promise<void> {
    const list = this.chat.get(msg.tradeRecordId) ?? [];
    list.push(structuredClone(msg));
    this.chat.set(msg.tradeRecordId, list);
    this.flush();
  }

  async listChatMessages(tradeRecordId: string, sinceSeconds = 0): Promise<StoredChatMessage[]> {
    const list = this.chat.get(tradeRecordId) ?? [];
    return list
      .filter((m) => m.createdAt >= sinceSeconds)
      .map((m) => structuredClone(m))
      .sort((a, b) => a.createdAt - b.createdAt);
  }

  async getSetting<T>(key: string): Promise<T | null> {
    return this.settings.has(key) ? (structuredClone(this.settings.get(key)) as T) : null;
  }

  async saveSetting(key: string, value: unknown): Promise<void> {
    this.settings.set(key, structuredClone(value));
    this.flush();
  }
}

export type SqlQueryExecutor = (
  sql: string,
  params?: unknown[],
) => Promise<{ rows: Record<string, unknown>[] }>;

export interface SqlLockClient {
  query: SqlQueryExecutor;
  release(): void;
}

// Postgres-backed storage adapter for Vercel deployments (e.g. Neon serverless or standard pg Pool).
export class PostgresStorage implements StorageAdapter {
  private initialized = false;

  constructor(
    private readonly query: SqlQueryExecutor,
    private readonly options?: {
      // Dedicated connection for session-level advisory locks (a pooled query may run on any connection).
      connect?: () => Promise<SqlLockClient>;
      lockTimeoutMs?: number;
      lockPollMs?: number;
    },
  ) {}

  // Cross-instance mutual exclusion with a Postgres advisory lock held on one dedicated connection.
  async withLock<T>(name: string, fn: () => Promise<T>): Promise<T> {
    if (!this.options?.connect) {
      return fn();
    }
    const client = await this.options.connect();
    const timeoutMs = this.options.lockTimeoutMs ?? 25_000;
    const pollMs = this.options.lockPollMs ?? 200;
    const deadline = Date.now() + timeoutMs;
    try {
      for (;;) {
        const { rows } = await client.query('SELECT pg_try_advisory_lock(hashtext($1)) AS locked', [name]);
        if (rows[0]?.locked === true) break;
        if (Date.now() >= deadline) {
          throw new Error(`Timed out waiting for lock "${name}"`);
        }
        await new Promise((resolve) => setTimeout(resolve, pollMs));
      }
      try {
        return await fn();
      } finally {
        await client.query('SELECT pg_advisory_unlock(hashtext($1))', [name]);
      }
    } finally {
      client.release();
    }
  }

  private async ensureSchema(): Promise<void> {
    if (this.initialized) return;
    await this.query(`
      CREATE TABLE IF NOT EXISTS campfire_identities (
        identity TEXT PRIMARY KEY,
        data JSONB NOT NULL,
        updated_at BIGINT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS campfire_offers (
        offer_txid TEXT PRIMARY KEY,
        content_hash TEXT NOT NULL,
        data JSONB NOT NULL,
        created_at BIGINT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS campfire_trades (
        id TEXT PRIMARY KEY,
        trade_id TEXT,
        offer_txid TEXT NOT NULL,
        seller_identity TEXT NOT NULL,
        buyer_identity TEXT NOT NULL,
        data JSONB NOT NULL,
        created_at BIGINT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS campfire_chat (
        id TEXT PRIMARY KEY,
        trade_record_id TEXT NOT NULL,
        data JSONB NOT NULL,
        created_at BIGINT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS campfire_settings (
        key TEXT PRIMARY KEY,
        data JSONB NOT NULL
      );
    `);
    this.initialized = true;
  }

  async saveIdentity(record: UserIdentityRecord): Promise<void> {
    await this.ensureSchema();
    await this.query(
      `INSERT INTO campfire_identities (identity, data, updated_at)
       VALUES ($1, $2::jsonb, $3)
       ON CONFLICT (identity) DO UPDATE SET data = EXCLUDED.data, updated_at = EXCLUDED.updated_at`,
      [record.identity, JSON.stringify(record), record.updatedAt],
    );
  }

  async getIdentity(identity: string): Promise<UserIdentityRecord | null> {
    await this.ensureSchema();
    const { rows } = await this.query(
      `SELECT data FROM campfire_identities WHERE identity = $1 LIMIT 1`,
      [identity],
    );
    return rows[0] ? (rows[0].data as UserIdentityRecord) : null;
  }

  async saveOffer(offer: StoredOffer): Promise<void> {
    await this.ensureSchema();
    await this.query(
      `INSERT INTO campfire_offers (offer_txid, content_hash, data, created_at)
       VALUES ($1, $2, $3::jsonb, $4)
       ON CONFLICT (offer_txid) DO UPDATE SET content_hash = EXCLUDED.content_hash, data = EXCLUDED.data`,
      [offer.offerTxid, offer.contentHash.toLowerCase(), JSON.stringify(offer), offer.createdAt],
    );
  }

  async getOffer(offerTxid: string): Promise<StoredOffer | null> {
    await this.ensureSchema();
    const { rows } = await this.query(
      `SELECT data FROM campfire_offers WHERE offer_txid = $1 LIMIT 1`,
      [offerTxid],
    );
    return rows[0] ? (rows[0].data as StoredOffer) : null;
  }

  async getOfferByHash(contentHash: string): Promise<StoredOffer | null> {
    await this.ensureSchema();
    const { rows } = await this.query(
      `SELECT data FROM campfire_offers WHERE content_hash = $1 LIMIT 1`,
      [contentHash.toLowerCase()],
    );
    return rows[0] ? (rows[0].data as StoredOffer) : null;
  }

  async listOffers(): Promise<StoredOffer[]> {
    await this.ensureSchema();
    const { rows } = await this.query(
      `SELECT data FROM campfire_offers ORDER BY created_at DESC`,
    );
    return rows.map((r) => r.data as StoredOffer);
  }

  async saveTrade(trade: StoredTrade): Promise<void> {
    await this.ensureSchema();
    await this.query(
      `INSERT INTO campfire_trades (id, trade_id, offer_txid, seller_identity, buyer_identity, data, created_at)
       VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7)
       ON CONFLICT (id) DO UPDATE SET
         trade_id = EXCLUDED.trade_id,
         data = EXCLUDED.data`,
      [
        trade.id,
        trade.tradeId?.toLowerCase() ?? null,
        trade.offerTxid,
        trade.sellerIdentity,
        trade.buyerIdentity,
        JSON.stringify(trade),
        trade.createdAt,
      ],
    );
  }

  async getTrade(idOrTradeId: string): Promise<StoredTrade | null> {
    await this.ensureSchema();
    const { rows } = await this.query(
      `SELECT data FROM campfire_trades WHERE id = $1 OR trade_id = $2 LIMIT 1`,
      [idOrTradeId, idOrTradeId.toLowerCase()],
    );
    return rows[0] ? (rows[0].data as StoredTrade) : null;
  }

  async listTrades(filter?: { identity?: string; offerTxid?: string }): Promise<StoredTrade[]> {
    await this.ensureSchema();
    if (filter?.identity && filter?.offerTxid) {
      const { rows } = await this.query(
        `SELECT data FROM campfire_trades
         WHERE (seller_identity = $1 OR buyer_identity = $1) AND offer_txid = $2
         ORDER BY created_at DESC`,
        [filter.identity, filter.offerTxid],
      );
      return rows.map((r) => r.data as StoredTrade);
    }
    if (filter?.identity) {
      const { rows } = await this.query(
        `SELECT data FROM campfire_trades
         WHERE seller_identity = $1 OR buyer_identity = $1
         ORDER BY created_at DESC`,
        [filter.identity],
      );
      return rows.map((r) => r.data as StoredTrade);
    }
    if (filter?.offerTxid) {
      const { rows } = await this.query(
        `SELECT data FROM campfire_trades WHERE offer_txid = $1 ORDER BY created_at DESC`,
        [filter.offerTxid],
      );
      return rows.map((r) => r.data as StoredTrade);
    }
    const { rows } = await this.query(
      `SELECT data FROM campfire_trades ORDER BY created_at DESC`,
    );
    return rows.map((r) => r.data as StoredTrade);
  }

  async addChatMessage(msg: StoredChatMessage): Promise<void> {
    await this.ensureSchema();
    await this.query(
      `INSERT INTO campfire_chat (id, trade_record_id, data, created_at)
       VALUES ($1, $2, $3::jsonb, $4)
       ON CONFLICT (id) DO NOTHING`,
      [msg.id, msg.tradeRecordId, JSON.stringify(msg), msg.createdAt],
    );
  }

  async listChatMessages(tradeRecordId: string, sinceSeconds = 0): Promise<StoredChatMessage[]> {
    await this.ensureSchema();
    const { rows } = await this.query(
      `SELECT data FROM campfire_chat WHERE trade_record_id = $1 AND created_at >= $2 ORDER BY created_at ASC`,
      [tradeRecordId, sinceSeconds],
    );
    return rows.map((r) => r.data as StoredChatMessage);
  }

  async getSetting<T>(key: string): Promise<T | null> {
    await this.ensureSchema();
    const { rows } = await this.query(`SELECT data FROM campfire_settings WHERE key = $1 LIMIT 1`, [key]);
    return rows[0] ? (rows[0].data as T) : null;
  }

  async saveSetting(key: string, value: unknown): Promise<void> {
    await this.ensureSchema();
    await this.query(
      `INSERT INTO campfire_settings (key, data) VALUES ($1, $2::jsonb)
       ON CONFLICT (key) DO UPDATE SET data = EXCLUDED.data`,
      [key, JSON.stringify(value)],
    );
  }
}
