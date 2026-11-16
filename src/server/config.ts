// Builds the Campfire API from environment variables. Fails closed: without real service keys
// (and, on Vercel, without a database) the service refuses to start instead of using defaults.

import { secp256k1 } from '@bitauth/libauth';
import { ElectrumNetworkProvider, type NetworkProvider } from 'cashscript';
import { toBytes } from '../protocol/index.js';
import { DemoSeller, deriveDemoSellerWallet } from './demo.js';
import { createApiHandler } from './http.js';
import { LivePriceFeed, OracleService, type PriceFeedProvider } from './oracle.js';
import { createPgStorage } from './postgres.js';
import { CampfireService } from './service.js';
import { MemoryStorage, type StorageAdapter } from './storage.js';

export class ConfigError extends Error {}

export const MIN_ADMIN_TOKEN_LENGTH = 32;

export type CampfireEnv = Record<string, string | undefined>;

export interface CampfireApp {
  handler: (req: Request) => Promise<Response>;
  service: CampfireService;
  storage: StorageAdapter;
  demo?: DemoSeller;
}

// Error messages name the variable, never its value.
function readPrivateKey(env: CampfireEnv, name: string, errors: string[]): Uint8Array | undefined {
  const raw = env[name]?.trim();
  if (!raw) {
    errors.push(`${name} is not set`);
    return undefined;
  }
  if (!/^[0-9a-f]{64}$/i.test(raw)) {
    errors.push(`${name} must be 64 hexadecimal characters (32 bytes)`);
    return undefined;
  }
  const key = toBytes(raw, name);
  if (!secp256k1.validatePrivateKey(key)) {
    errors.push(`${name} is not a valid secp256k1 private key`);
    return undefined;
  }
  return key;
}

export async function createAppFromEnv(
  env: CampfireEnv,
  deps: {
    provider?: NetworkProvider;
    priceFeed?: PriceFeedProvider;
    createStorage?: (databaseUrl: string) => StorageAdapter;
  } = {},
): Promise<CampfireApp> {
  const errors: string[] = [];

  // There are no default keys: a default would be computable by anyone reading this public repository.
  const arbiterKey = readPrivateKey(env, 'ARBITER_PRIVATE_KEY', errors);
  const oracleKey = readPrivateKey(env, 'ORACLE_PRIVATE_KEY', errors);
  if (arbiterKey && oracleKey && arbiterKey.every((b, i) => b === oracleKey[i])) {
    errors.push('ARBITER_PRIVATE_KEY and ORACLE_PRIVATE_KEY must be different keys');
  }

  // The Neon integration on Vercel may name the connection string either way.
  const databaseUrl = env.DATABASE_URL?.trim() || env.POSTGRES_URL?.trim() || undefined;
  if (!databaseUrl && env.VERCEL) {
    errors.push('DATABASE_URL is required on Vercel: in-memory storage is lost between function instances');
  }

  const adminToken = env.ADMIN_TOKEN?.trim() || undefined;
  if (adminToken && adminToken.length < MIN_ADMIN_TOKEN_LENGTH) {
    errors.push(`ADMIN_TOKEN must be at least ${MIN_ADMIN_TOKEN_LENGTH} characters`);
  }

  let demoWallet: ReturnType<typeof deriveDemoSellerWallet> | undefined;
  const demoSeed = env.DEMO_SELLER_SEED?.trim();
  if (demoSeed) {
    if (!/^[0-9a-f]{32,128}$/i.test(demoSeed) || demoSeed.length % 2 !== 0) {
      errors.push('DEMO_SELLER_SEED must be 16 to 64 bytes in hexadecimal');
    } else {
      demoWallet = deriveDemoSellerWallet(demoSeed);
    }
  }

  if (errors.length > 0 || !arbiterKey || !oracleKey) {
    throw new ConfigError(`Campfire is not configured: ${errors.join('; ')}`);
  }

  const storage: StorageAdapter = databaseUrl
    ? (deps.createStorage ?? ((url) => createPgStorage(url).storage))(databaseUrl)
    : new MemoryStorage({ filePath: env.CAMPFIRE_STORAGE_FILE });
  const provider = deps.provider ?? new ElectrumNetworkProvider('mainnet');
  const oracle = new OracleService({ privateKey: oracleKey, feed: deps.priceFeed ?? new LivePriceFeed() });
  const service = new CampfireService({
    storage,
    provider,
    oracle,
    arbiterPrivateKey: arbiterKey,
    demoSellerIdentity: demoWallet?.identity,
  });

  let demo: DemoSeller | undefined;
  if (demoWallet) {
    demo = new DemoSeller({
      service,
      provider,
      wallet: demoWallet,
      withLock: storage.withLock ? (name, fn) => storage.withLock!(name, fn) : undefined,
    });
    await demo.init();
  }

  return {
    handler: createApiHandler({ service, oracle, demo, adminToken }),
    service,
    storage,
    demo,
  };
}
