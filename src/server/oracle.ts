// Price oracle service: fetches BCH and ARS rates (CoinGecko + Yadio with 60s cache) and signs quotes.

import { binToHex, secp256k1 } from '@bitauth/libauth';
import { signPriceQuote, toBytes, type PriceQuote } from '../protocol/index.js';

export interface PriceFeedProvider {
  getPrice(pair: string): Promise<string>;
}

interface CacheEntry {
  price: string;
  expiresAtMs: number;
}

// Live price feed using CoinGecko (BCH/USD, BCH/ARS) and Yadio (crypto USD/ARS) with a 60-second cache.
export class LivePriceFeed implements PriceFeedProvider {
  private cache = new Map<string, CacheEntry>();
  private readonly ttlMs: number;
  private readonly fetchFn: typeof fetch;
  private readonly timeoutMs: number;

  // A price source that does not answer must not hold a trade request until the serverless function is killed:
  // each request gives up after `timeoutMs` (5 s by default) and the quote fails with a clear error instead.
  constructor(options?: { ttlMs?: number; fetchFn?: typeof fetch; timeoutMs?: number }) {
    this.ttlMs = options?.ttlMs ?? 60_000;
    this.timeoutMs = options?.timeoutMs ?? 5_000;
    this.fetchFn = options?.fetchFn ?? globalThis.fetch.bind(globalThis);
  }

  async getPrice(rawPair: string): Promise<string> {
    const pair = rawPair.trim().toUpperCase();
    const now = Date.now();
    const cached = this.cache.get(pair);
    if (cached && cached.expiresAtMs > now) {
      return cached.price;
    }

    const [base, quote] = pair.split('/');
    if (!base || !quote) {
      throw new Error(`Invalid currency pair "${rawPair}"`);
    }

    let numericPrice: number;
    if (base === 'PUSD' && quote === 'USD') {
      numericPrice = 1;
    } else if (base === 'PUSD' && quote === 'ARS') {
      numericPrice = await this.fetchUsdArs();
    } else if (base === 'BCH' && quote === 'USD') {
      const cg = await this.fetchCoinGeckoBch();
      numericPrice = cg.usd;
    } else if (base === 'BCH' && quote === 'ARS') {
      const cg = await this.fetchCoinGeckoBch();
      try {
        const usdArs = await this.fetchUsdArs();
        numericPrice = cg.usd * usdArs;
      } catch {
        if (!cg.ars) throw new Error('Unable to fetch BCH/ARS rate');
        numericPrice = cg.ars;
      }
    } else {
      throw new Error(`Unsupported oracle pair "${pair}"`);
    }

    if (!Number.isFinite(numericPrice) || numericPrice <= 0) {
      throw new Error(`Invalid rate obtained for "${pair}"`);
    }

    const formatted = numericPrice.toFixed(2);
    this.cache.set(pair, { price: formatted, expiresAtMs: now + this.ttlMs });
    return formatted;
  }

  private async fetchCoinGeckoBch(): Promise<{ usd: number; ars?: number }> {
    const url =
      'https://api.coingecko.com/api/v3/simple/price?ids=bitcoin-cash&vs_currencies=usd,ars';
    const res = await this.fetchFn(url, {
      headers: { accept: 'application/json' },
      signal: AbortSignal.timeout(this.timeoutMs),
    });
    if (!res.ok) {
      throw new Error(`CoinGecko request failed with status ${res.status}`);
    }
    const data = (await res.json()) as { 'bitcoin-cash'?: { usd?: number; ars?: number } };
    const usd = data['bitcoin-cash']?.usd;
    if (typeof usd !== 'number' || usd <= 0) {
      throw new Error('CoinGecko response missing bitcoin-cash.usd');
    }
    return { usd, ars: data['bitcoin-cash']?.ars };
  }

  private async fetchUsdArs(): Promise<number> {
    const res = await this.fetchFn('https://api.yadio.io/exrates/ARS', {
      headers: { accept: 'application/json' },
      signal: AbortSignal.timeout(this.timeoutMs),
    });
    if (!res.ok) {
      throw new Error(`Yadio request failed with status ${res.status}`);
    }
    const data = (await res.json()) as { BTC?: number; USD?: { ARS?: number }; ARS?: { USD?: number } };
    // Yadio `/exrates/ARS` returns `{ ARS: { USD: <ars_per_usd>, ... } }` (how many ARS per 1 unit, or inverse).
    const arsMap = data.ARS as Record<string, number> | undefined;
    if (arsMap && typeof arsMap.USD === 'number' && arsMap.USD > 0) {
      // If ARS.USD < 1 it is USD per 1 ARS; invert it. If > 1 it is ARS per 1 USD.
      return arsMap.USD < 1 ? 1 / arsMap.USD : arsMap.USD;
    }
    throw new Error('Yadio response missing ARS/USD rate');
  }
}

export class StaticPriceFeed implements PriceFeedProvider {
  private rates = new Map<string, string>();

  constructor(initialRates: Record<string, string> = {}) {
    for (const [pair, price] of Object.entries(initialRates)) {
      this.rates.set(pair.toUpperCase(), price);
    }
  }

  setRate(pair: string, price: string): void {
    this.rates.set(pair.toUpperCase(), price);
  }

  async getPrice(pair: string): Promise<string> {
    const found = this.rates.get(pair.toUpperCase());
    if (!found) {
      throw new Error(`No static price configured for pair "${pair}"`);
    }
    return found;
  }
}

export class OracleService {
  readonly publicKeyHex: string;
  private readonly privateKey: Uint8Array;
  private readonly feed: PriceFeedProvider;
  private readonly nowSeconds: () => number;

  constructor(options: {
    privateKey: Uint8Array | string;
    feed?: PriceFeedProvider;
    nowSeconds?: () => number;
  }) {
    this.privateKey = toBytes(options.privateKey, 'oraclePrivateKey');
    if (!secp256k1.validatePrivateKey(this.privateKey)) {
      throw new Error('Invalid oracle private key');
    }
    const pub = secp256k1.derivePublicKeyCompressed(this.privateKey);
    if (typeof pub === 'string') {
      throw new Error(`Failed to derive oracle public key: ${pub}`);
    }
    this.publicKeyHex = binToHex(pub).toLowerCase();
    this.feed = options.feed ?? new LivePriceFeed();
    this.nowSeconds = options.nowSeconds ?? (() => Math.floor(Date.now() / 1000));
  }

  async createQuote(pair: string): Promise<PriceQuote> {
    const normalizedPair = pair.trim().toUpperCase();
    const price = await this.feed.getPrice(normalizedPair);
    const timestamp = this.nowSeconds();
    return signPriceQuote(this.privateKey, {
      pair: normalizedPair,
      price,
      timestamp,
    });
  }
}
