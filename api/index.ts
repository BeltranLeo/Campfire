// Vercel Serverless entry point forwarding `/api/*` requests to the Campfire API handler.

import { sha256, utf8ToBin } from '@bitauth/libauth';
import { ElectrumNetworkProvider } from 'cashscript';
import {
  CampfireService,
  LivePriceFeed,
  MemoryStorage,
  OracleService,
  createApiHandler,
} from '../src/server/index.js';

let handlerPromise: Promise<(req: Request) => Promise<Response>> | null = null;

async function getHandler(): Promise<(req: Request) => Promise<Response>> {
  if (!handlerPromise) {
    handlerPromise = (async () => {
      const arbiterPrivateKey =
        process.env.ARBITER_PRIVATE_KEY ?? sha256.hash(utf8ToBin('campfire-dev-arbiter-key'));
      const oraclePrivateKey =
        process.env.ORACLE_PRIVATE_KEY ?? sha256.hash(utf8ToBin('campfire-dev-oracle-key'));

      const storage = new MemoryStorage({
        filePath: process.env.CAMPFIRE_STORAGE_FILE,
      });
      const provider = new ElectrumNetworkProvider('mainnet');
      const oracle = new OracleService({
        privateKey: oraclePrivateKey,
        feed: new LivePriceFeed(),
      });
      const service = new CampfireService({
        storage,
        provider,
        oracle,
        arbiterPrivateKey,
      });
      return createApiHandler({ service, oracle });
    })();
  }
  return handlerPromise;
}

export default async function handler(req: Request): Promise<Response> {
  const fn = await getHandler();
  return fn(req);
}
