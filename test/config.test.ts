import { afterEach, describe, expect, it } from 'vitest';
import { MockNetworkProvider, Network } from 'cashscript';
import { binToHex, secp256k1, sha256, utf8ToBin } from '@bitauth/libauth';
import {
  ConfigError,
  MemoryStorage,
  PostgresStorage,
  StaticPriceFeed,
  createAppFromEnv,
  deriveDemoSellerWallet,
} from '../src/server/index.js';

const arbiterHex = binToHex(sha256.hash(utf8ToBin('config-test-arbiter')));
const oracleHex = binToHex(sha256.hash(utf8ToBin('config-test-oracle')));
const seedHex = binToHex(sha256.hash(utf8ToBin('config-test-demo-seed')));
const adminToken = 'a'.repeat(64);

function deps() {
  const provider = new MockNetworkProvider();
  provider.network = Network.MAINNET;
  return { provider, priceFeed: new StaticPriceFeed({ 'BCH/USD': '450.00' }) };
}

async function configError(env: Record<string, string | undefined>): Promise<string> {
  try {
    await createAppFromEnv(env, deps());
  } catch (err) {
    expect(err).toBeInstanceOf(ConfigError);
    return (err as Error).message;
  }
  throw new Error('expected a ConfigError');
}

describe('createAppFromEnv (fails closed)', () => {
  it('refuses to start without the arbiter and oracle keys: there are no default keys', async () => {
    const message = await configError({});
    expect(message).toContain('ARBITER_PRIVATE_KEY is not set');
    expect(message).toContain('ORACLE_PRIVATE_KEY is not set');
  });

  it('rejects malformed values without echoing them', async () => {
    const secretLooking = 'not-a-key-but-maybe-a-secret';
    const message = await configError({
      ARBITER_PRIVATE_KEY: secretLooking,
      ORACLE_PRIVATE_KEY: 'ff'.repeat(32), // above the curve order: not a valid private key
      ADMIN_TOKEN: 'short',
      DEMO_SELLER_SEED: 'xyz',
    });
    expect(message).toContain('ARBITER_PRIVATE_KEY must be 64 hexadecimal characters');
    expect(message).toContain('ORACLE_PRIVATE_KEY is not a valid secp256k1 private key');
    expect(message).toContain('ADMIN_TOKEN must be at least 32 characters');
    expect(message).toContain('DEMO_SELLER_SEED must be 16 to 64 bytes');
    expect(message).not.toContain(secretLooking);
    expect(message).not.toContain('short');
  });

  it('requires different keys for the arbiter and the oracle', async () => {
    const message = await configError({ ARBITER_PRIVATE_KEY: arbiterHex, ORACLE_PRIVATE_KEY: arbiterHex });
    expect(message).toContain('must be different keys');
  });

  it('requires a database on Vercel', async () => {
    const message = await configError({
      ARBITER_PRIVATE_KEY: arbiterHex,
      ORACLE_PRIVATE_KEY: oracleHex,
      VERCEL: '1',
    });
    expect(message).toContain('DATABASE_URL is required on Vercel');
  });

  it('starts with valid keys, uses the database when configured and enables the demo seller', async () => {
    const urls: string[] = [];
    const app = await createAppFromEnv(
      {
        ARBITER_PRIVATE_KEY: arbiterHex,
        ORACLE_PRIVATE_KEY: oracleHex,
        ADMIN_TOKEN: adminToken,
        DEMO_SELLER_SEED: seedHex,
        VERCEL: '1',
        DATABASE_URL: 'postgres://example.invalid/campfire',
      },
      {
        ...deps(),
        createStorage: (url) => {
          urls.push(url);
          return new MemoryStorage();
        },
      },
    );
    expect(urls).toEqual(['postgres://example.invalid/campfire']);

    const res = await app.handler(new Request('http://localhost/api/config'));
    const config = (await res.json()) as { arbiterPk: string; oraclePk: string; demoSellerIdentity: string };
    const expectedArbiterPk = secp256k1.derivePublicKeyCompressed(sha256.hash(utf8ToBin('config-test-arbiter')));
    expect(config.arbiterPk).toBe(binToHex(expectedArbiterPk as Uint8Array));
    expect(config.demoSellerIdentity).toBe(deriveDemoSellerWallet(seedHex).identity);

    // The admin routes accept the configured token.
    const offers = await app.handler(
      new Request('http://localhost/api/demo/offers', {
        method: 'POST',
        headers: { authorization: `Bearer ${adminToken}` },
        body: JSON.stringify({ assets: [] }),
      }),
    );
    expect(offers.status).toBe(201);
  });
});

describe('Vercel entry point (api/index.ts)', () => {
  const saved = { ...process.env };
  afterEach(() => {
    process.env = { ...saved };
  });

  it('answers 503 with the missing variable names when the service is not configured', async () => {
    delete process.env.ARBITER_PRIVATE_KEY;
    delete process.env.ORACLE_PRIVATE_KEY;
    const entry = (await import('../api/index.js')).default;
    const res = await entry.fetch(new Request('http://localhost/api/config'));
    expect(res.status).toBe(503);
    const body = (await res.json()) as { error: string };
    expect(body.error).toContain('ARBITER_PRIVATE_KEY is not set');
  });
});

describe('PostgresStorage advisory lock', () => {
  it('waits for the lock, runs the action once and always unlocks and releases', async () => {
    const calls: string[] = [];
    let attempts = 0;
    const storage = new PostgresStorage(async () => ({ rows: [] }), {
      lockPollMs: 1,
      connect: async () => ({
        query: async (sql) => {
          if (sql.includes('pg_try_advisory_lock')) {
            attempts += 1;
            calls.push('try');
            return { rows: [{ locked: attempts >= 3 }] };
          }
          calls.push('unlock');
          return { rows: [] };
        },
        release: () => {
          calls.push('release');
        },
      }),
    });

    const result = await storage.withLock('campfire-demo-seller', async () => {
      calls.push('run');
      return 42;
    });
    expect(result).toBe(42);
    expect(calls).toEqual(['try', 'try', 'try', 'run', 'unlock', 'release']);

    calls.length = 0;
    await expect(
      storage.withLock('campfire-demo-seller', async () => {
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');
    expect(calls).toEqual(['try', 'unlock', 'release']);
  });

  it('gives up after the timeout and still releases the connection', async () => {
    const calls: string[] = [];
    const storage = new PostgresStorage(async () => ({ rows: [] }), {
      lockPollMs: 1,
      lockTimeoutMs: 5,
      connect: async () => ({
        query: async () => ({ rows: [{ locked: false }] }),
        release: () => {
          calls.push('release');
        },
      }),
    });
    await expect(storage.withLock('x', async () => 1)).rejects.toThrow(/Timed out/);
    expect(calls).toEqual(['release']);
  });
});
