// Framework-agnostic HTTP JSON handler (Web Request -> Response) used by Vercel API routes, Vite dev middleware and tests.

import { BCH_DECIMALS, PUSD_CATEGORY, PUSD_DECIMALS, type VerdictHex } from '../protocol/index.js';
import type { OracleService } from './oracle.js';
import type { CampfireService } from './service.js';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  });
}

async function readJson<T = Record<string, unknown>>(req: Request): Promise<T> {
  const text = await req.text();
  if (!text) return {} as T;
  return JSON.parse(text) as T;
}

export function createApiHandler(deps: { service: CampfireService; oracle: OracleService }) {
  const { service, oracle } = deps;

  return async function handleRequest(req: Request): Promise<Response> {
    const url = new URL(req.url, 'http://localhost');
    const path = url.pathname.replace(/\/+$/, '') || '/';
    const method = req.method.toUpperCase();

    try {
      // GET /api/config
      if (method === 'GET' && path === '/api/config') {
        return jsonResponse({
          arbiterPk: service.arbiterPublicKeyHex,
          oraclePk: service.oraclePublicKeyHex,
          pusdCategory: PUSD_CATEGORY,
          bchDecimals: BCH_DECIMALS,
          pusdDecimals: PUSD_DECIMALS,
        });
      }

      // POST /api/identities
      if (method === 'POST' && path === '/api/identities') {
        const body = await readJson<{
          defiXpub: string;
          receiveXpub: string;
          changeXpub?: string;
        }>(req);
        const record = await service.registerIdentity(body);
        const reputation = await service.getReputation(record.identity);
        return jsonResponse({ identity: record.identity, record, reputation }, 201);
      }

      // GET /api/identities/:identity/reputation
      const repMatch = path.match(/^\/api\/identities\/([0-9a-f]{64})\/reputation$/i);
      if (method === 'GET' && repMatch) {
        const reputation = await service.getReputation(repMatch[1].toLowerCase());
        return jsonResponse(reputation);
      }

      // GET /api/oracle/quote?pair=BCH/ARS
      if (method === 'GET' && path === '/api/oracle/quote') {
        const pair = url.searchParams.get('pair');
        if (!pair) {
          return jsonResponse({ error: 'Missing query parameter "pair"' }, 400);
        }
        const quote = await oracle.createQuote(pair);
        return jsonResponse({ quote, oraclePk: service.oraclePublicKeyHex });
      }

      // GET /api/offers/doc/:contentHash (serves raw JSON document by its SHA-256 digest)
      const docMatch = path.match(/^\/api\/offers\/doc\/([0-9a-f]{64})$/i);
      if (method === 'GET' && docMatch) {
        const rawJson = await service.getOfferDocumentByHash(docMatch[1]);
        if (!rawJson) {
          return jsonResponse({ error: 'Offer document not found' }, 404);
        }
        return new Response(rawJson, {
          status: 200,
          headers: { 'content-type': 'application/json; charset=utf-8' },
        });
      }

      // GET /api/offers & POST /api/offers
      if (path === '/api/offers') {
        if (method === 'GET') {
          const onlyOpen = url.searchParams.get('onlyOpen') === 'true';
          const offers = await service.listOffers({ onlyOpen });
          return jsonResponse({ offers });
        }
        if (method === 'POST') {
          const body = await readJson<{
            sellerIdentity: string;
            offerJson: string;
            offerTxHex: string;
            markerReceiveIndex: number;
            broadcast?: boolean;
            isDemo?: boolean;
          }>(req);
          const offer = await service.publishOffer(body);
          return jsonResponse({ offer }, 201);
        }
      }

      // GET /api/offers/:offerTxid
      const offerMatch = path.match(/^\/api\/offers\/([0-9a-f]{64})$/i);
      if (method === 'GET' && offerMatch) {
        const offer = await service.getOffer(offerMatch[1].toLowerCase());
        if (!offer) {
          return jsonResponse({ error: 'Offer not found' }, 404);
        }
        return jsonResponse({ offer });
      }

      // POST /api/offers/:offerTxid/close
      const closeOfferMatch = path.match(/^\/api\/offers\/([0-9a-f]{64})\/close$/i);
      if (method === 'POST' && closeOfferMatch) {
        const body = await readJson<{ sellerIdentity: string; closeTxHex?: string }>(req);
        const offer = await service.closeOffer({
          offerTxid: closeOfferMatch[1].toLowerCase(),
          sellerIdentity: body.sellerIdentity,
          closeTxHex: body.closeTxHex,
        });
        return jsonResponse({ offer });
      }

      // GET /api/trades & POST /api/trades
      if (path === '/api/trades') {
        if (method === 'GET') {
          const identity = url.searchParams.get('identity') ?? undefined;
          const offerTxid = url.searchParams.get('offerTxid') ?? undefined;
          const trades = await service.listTrades({ identity, offerTxid });
          return jsonResponse({ trades });
        }
        if (method === 'POST') {
          const body = await readJson<{
            offerTxid: string;
            buyerIdentity: string;
            amount: string;
            buyerPk: string;
            buyerDefiIndex: number;
            buyerPayoutPkh: string;
            buyerReceiveIndex: number;
            buyerSessionPk: string;
          }>(req);
          const trade = await service.requestTrade(body);
          return jsonResponse({ trade }, 201);
        }
      }

      // GET /api/trades/:id
      const tradeMatch = path.match(/^\/api\/trades\/([0-9a-f]+)$/i);
      if (method === 'GET' && tradeMatch) {
        const viewer = url.searchParams.get('viewer') ?? undefined;
        const isArbiter = url.searchParams.get('arbiter') === 'true';
        const trade = await service.getTrade(tradeMatch[1], viewer, isArbiter);
        if (!trade) {
          return jsonResponse({ error: 'Trade not found' }, 404);
        }
        return jsonResponse({ trade });
      }

      // POST /api/trades/:id/:action
      const actionMatch = path.match(
        /^\/api\/trades\/([0-9a-f]+)\/(accept|decline|funding|paid|dispute|verdict|settle|chat)$/i,
      );
      if (actionMatch) {
        const id = actionMatch[1];
        const action = actionMatch[2].toLowerCase();

        if (action === 'chat' && method === 'GET') {
          const messages = await service.listChatMessages(id);
          const asArbiter = url.searchParams.get('arbiter') === 'true';
          let decrypted: unknown;
          if (asArbiter) {
            try {
              decrypted = await service.decryptDisputedChatForArbiter(id);
            } catch {
              decrypted = undefined;
            }
          }
          return jsonResponse({ messages, ...(decrypted ? { decrypted } : {}) });
        }

        if (method === 'POST') {
          if (action === 'accept') {
            const body = await readJson<{
              sellerIdentity: string;
              sellerPk: string;
              sellerDefiIndex: number;
              sellerPayoutPkh: string;
              sellerReceiveIndex: number;
              sellerSessionPk: string;
              encryptedPaymentDetails: string;
              refundTime?: number;
              nonce?: string;
            }>(req);
            const trade = await service.acceptTrade({ tradeRecordId: id, ...body });
            return jsonResponse({ trade });
          }
          if (action === 'decline') {
            const body = await readJson<{ sellerIdentity: string }>(req);
            const trade = await service.declineTrade({
              tradeRecordId: id,
              sellerIdentity: body.sellerIdentity,
            });
            return jsonResponse({ trade });
          }
          if (action === 'funding') {
            const body = await readJson<{ fundingTxHex?: string; confirmations?: number }>(req);
            const trade = await service.confirmFunding({ idOrTradeId: id, ...body });
            return jsonResponse({ trade });
          }
          if (action === 'paid') {
            const body = await readJson<{ buyerIdentity: string }>(req);
            const trade = await service.markPaid({
              idOrTradeId: id,
              buyerIdentity: body.buyerIdentity,
            });
            return jsonResponse({ trade });
          }
          if (action === 'dispute') {
            const body = await readJson<{
              callerIdentity: string;
              reason?: string;
              sharedTradeKeyHex?: string;
            }>(req);
            const trade = await service.openDispute({ idOrTradeId: id, ...body });
            return jsonResponse({ trade });
          }
          if (action === 'verdict') {
            const body = await readJson<{
              verdict: VerdictHex;
              reason?: string;
              broadcastOnChain?: boolean;
            }>(req);
            const trade = await service.issueArbiterVerdict({ idOrTradeId: id, ...body });
            return jsonResponse({ trade });
          }
          if (action === 'settle') {
            const body = await readJson<{
              path: 'release' | 'cancel' | 'arbitrate' | 'refund';
              signedTxHex?: string;
            }>(req);
            const trade = await service.settleEscrow({ idOrTradeId: id, ...body });
            return jsonResponse({ trade });
          }
          if (action === 'chat') {
            const body = await readJson<{ senderIdentity: string; ciphertext: string }>(req);
            const message = await service.postChatMessage({ idOrTradeId: id, ...body });
            return jsonResponse({ message }, 201);
          }
        }
      }

      return jsonResponse({ error: `Route not found: ${method} ${path}` }, 404);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return jsonResponse({ error: message }, 400);
    }
  };
}
