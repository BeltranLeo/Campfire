// Framework-agnostic HTTP JSON handler (Web Request -> Response) used by Vercel API routes, Vite dev middleware and tests.

import { timingSafeEqual } from 'node:crypto';
import {
  BCH_DECIMALS,
  PUSD_CATEGORY,
  PUSD_DECIMALS,
  VERDICT_BUYER,
  VERDICT_SELLER,
  type VerdictHex,
} from '../protocol/index.js';
import { DemoLimitError, type DemoAsset, type DemoSeller } from './demo.js';
import type { OracleService } from './oracle.js';
import { SponsorshipLimitError, type CampfireService } from './service.js';
import type { StoredTrade } from './storage.js';

class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

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

export function createApiHandler(deps: {
  service: CampfireService;
  oracle: OracleService;
  // Demo seller bot (protocol section 8); demo routes are disabled without it.
  demo?: DemoSeller;
  // Bearer token for arbiter and demo-administration routes; those routes are disabled without it.
  adminToken?: string;
}) {
  const { service, oracle, demo, adminToken } = deps;

  const isAdmin = (req: Request): boolean => {
    if (!adminToken) return false;
    const header = req.headers.get('authorization') ?? '';
    const expected = Buffer.from(`Bearer ${adminToken}`);
    const given = Buffer.from(header);
    return given.length === expected.length && timingSafeEqual(given, expected);
  };

  const requireAdmin = (req: Request): void => {
    if (!isAdmin(req)) {
      throw new HttpError(403, 'Arbiter and administration routes require the admin token');
    }
  };

  // The service key is the default arbiter of every offer, so its views and verdicts are restricted:
  // the admin may use them on any trade; any visitor may use them only on a disputed demo trade (section 8).
  const canActAsArbiter = (req: Request, trade: StoredTrade): boolean =>
    isAdmin(req) || (service.isDemoTrade(trade) && trade.status === 'Disputed');

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
          demoSellerIdentity: service.demoSellerIdentity ?? null,
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
          }>(req);
          // Fields are copied one by one: whether an offer is a demo offer is decided by the service, never the client.
          const offer = await service.publishOffer({
            sellerIdentity: body.sellerIdentity,
            offerJson: body.offerJson,
            offerTxHex: body.offerTxHex,
            markerReceiveIndex: body.markerReceiveIndex,
            broadcast: body.broadcast,
          });
          return jsonResponse({ offer }, 201);
        }
      }

      // GET /api/offers/sponsored?identity=: how much of the paid-publication allowance is left.
      if (method === 'GET' && path === '/api/offers/sponsored') {
        if (!demo) {
          return jsonResponse({ enabled: false });
        }
        const identity = url.searchParams.get('identity') ?? undefined;
        return jsonResponse({ enabled: true, ...(await service.sponsorshipStatus(identity)) });
      }

      // POST /api/offers/sponsored: Campfire builds, pays for and publishes a buy offer for the buyer. No signature.
      if (method === 'POST' && path === '/api/offers/sponsored') {
        if (!demo) {
          throw new HttpError(404, 'Paid publication of buy offers is not enabled');
        }
        const body = await readJson<{ buyerIdentity: string; offerJson: string; markerReceiveIndex: number }>(req);
        const result = await demo.publishSponsored({
          buyerIdentity: body.buyerIdentity,
          offerJson: body.offerJson,
          markerReceiveIndex: body.markerReceiveIndex,
        });
        return jsonResponse(result, 201);
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
            amount: string;
            buyerIdentity: string;
            buyerPk: string;
            buyerDefiIndex: number;
            buyerPayoutPkh: string;
            buyerReceiveIndex: number;
            buyerSessionPk: string;
            sellerIdentity: string;
            sellerPk: string;
            sellerDefiIndex: number;
            sellerPayoutPkh: string;
            sellerReceiveIndex: number;
            sellerSessionPk: string;
          }>(req);
          const offer = await service.getOffer(body.offerTxid);
          let trade: StoredTrade;
          if (offer?.document.side === 'buy') {
            if (!body.sellerIdentity && body.buyerIdentity) {
              throw new HttpError(400, 'This is a buy offer: a seller takes it, not a buyer');
            }
            // A seller takes a buy offer. The fields are copied one by one: the record id is the demo seller's alone.
            trade = await service.requestBuyOfferTrade({
              offerTxid: body.offerTxid,
              amount: body.amount,
              sellerIdentity: body.sellerIdentity,
              sellerPk: body.sellerPk,
              sellerDefiIndex: body.sellerDefiIndex,
              sellerPayoutPkh: body.sellerPayoutPkh,
              sellerReceiveIndex: body.sellerReceiveIndex,
              sellerSessionPk: body.sellerSessionPk,
            });
          } else {
            const isDemoOffer = demo !== undefined && offer?.sellerIdentity === demo.identity;
            if (isDemoOffer) {
              await demo.assertCanTake();
            }
            trade = await service.requestTrade({
              offerTxid: body.offerTxid,
              amount: body.amount,
              buyerIdentity: body.buyerIdentity,
              buyerPk: body.buyerPk,
              buyerDefiIndex: body.buyerDefiIndex,
              buyerPayoutPkh: body.buyerPayoutPkh,
              buyerReceiveIndex: body.buyerReceiveIndex,
              buyerSessionPk: body.buyerSessionPk,
            });
            if (isDemoOffer) {
              // The bot accepts and funds a real escrow within this request.
              trade = await demo.acceptAndFund(trade.id);
            }
          }
          return jsonResponse({ trade }, 201);
        }
      }

      // GET /api/trades/:id
      const tradeMatch = path.match(/^\/api\/trades\/([0-9a-f]+)$/i);
      if (method === 'GET' && tradeMatch) {
        const viewer = url.searchParams.get('viewer') ?? undefined;
        const asArbiter = url.searchParams.get('arbiter') === 'true';
        if (demo) {
          await demo.reconcile(tradeMatch[1]);
        }
        let trade = await service.getTrade(tradeMatch[1], viewer);
        if (!trade) {
          return jsonResponse({ error: 'Trade not found' }, 404);
        }
        if (asArbiter) {
          if (!canActAsArbiter(req, trade)) {
            throw new HttpError(403, 'The arbiter view is only available to the arbiter');
          }
          trade = await service.getTrade(tradeMatch[1], viewer, true);
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
            const trade = await service.getTrade(id);
            if (!trade || !canActAsArbiter(req, trade)) {
              throw new HttpError(403, 'The decrypted chat is only available to the arbiter');
            }
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
            const existing = await service.getTrade(id);
            if (existing?.side === 'buy') {
              // The buyer who published a buy offer accepts with their own keys.
              const body = await readJson<{
                buyerIdentity: string;
                buyerPk: string;
                buyerDefiIndex: number;
                buyerPayoutPkh: string;
                buyerReceiveIndex: number;
                buyerSessionPk: string;
                refundTime?: number;
                nonce?: string;
              }>(req);
              let trade = await service.acceptBuyOfferTrade({ ...body, tradeRecordId: id });
              if (demo && service.isDemoTrade(trade)) {
                // The demo seller deposits within this request. If that fails, the next read of the trade retries.
                try {
                  trade = await demo.acceptAndFund(trade.id);
                } catch {
                  // The accepted trade is still returned.
                }
              }
              return jsonResponse({ trade });
            }
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
            const trade = await service.acceptTrade({ ...body, tradeRecordId: id });
            return jsonResponse({ trade });
          }
          if (action === 'decline') {
            // The one who published the offer declines: the seller of a sell offer, the buyer of a buy offer.
            const body = await readJson<{ identity?: string; sellerIdentity?: string; buyerIdentity?: string }>(req);
            const trade = await service.declineTrade({
              tradeRecordId: id,
              identity: body.identity ?? body.sellerIdentity ?? body.buyerIdentity ?? '',
            });
            return jsonResponse({ trade });
          }
          if (action === 'funding') {
            const body = await readJson<{
              fundingTxHex?: string;
              confirmations?: number;
              encryptedPaymentDetails?: string;
              paymentDetailsSignature?: string;
            }>(req);
            const trade = await service.confirmFunding({ ...body, idOrTradeId: id });
            return jsonResponse({ trade });
          }
          if (action === 'paid') {
            const body = await readJson<{ buyerIdentity: string }>(req);
            let trade = await service.markPaid({
              idOrTradeId: id,
              buyerIdentity: body.buyerIdentity,
            });
            if (demo && service.isDemoTrade(trade)) {
              // The bot releases as soon as the visitor marks the simulated payment as sent.
              trade = await demo.release(trade.id);
            }
            return jsonResponse({ trade });
          }
          if (action === 'dispute') {
            const body = await readJson<{
              callerIdentity: string;
              reason?: string;
              sharedTradeKeyHex?: string;
            }>(req);
            const trade = await service.openDispute({ ...body, idOrTradeId: id });
            return jsonResponse({ trade });
          }
          if (action === 'verdict') {
            requireAdmin(req);
            const body = await readJson<{
              verdict: VerdictHex;
              reason?: string;
              broadcastOnChain?: boolean;
            }>(req);
            const trade = await service.issueArbiterVerdict({ ...body, idOrTradeId: id });
            return jsonResponse({ trade });
          }
          if (action === 'settle') {
            const body = await readJson<{
              path: 'release' | 'cancel' | 'arbitrate' | 'refund';
              signedTxHex?: string;
            }>(req);
            const trade = await service.settleEscrow({ ...body, idOrTradeId: id });
            return jsonResponse({ trade });
          }
          if (action === 'chat') {
            const body = await readJson<{ senderIdentity: string; ciphertext: string; signature?: string }>(req);
            const message = await service.postChatMessage({ ...body, idOrTradeId: id });
            return jsonResponse({ message }, 201);
          }
        }
      }

      // GET /api/demo: public description of the demo seller and its limits.
      if (method === 'GET' && path === '/api/demo') {
        if (!demo) {
          return jsonResponse({ enabled: false });
        }
        const offers = (await service.listOffers({ onlyOpen: true })).filter(
          (o) => o.sellerIdentity === demo.identity,
        );
        return jsonResponse({
          enabled: true,
          identity: demo.identity,
          address: demo.mainAddress,
          tokenAddress: demo.mainTokenAddress,
          limits: Object.fromEntries(
            Object.entries(demo.limits).map(([k, v]) => [k, typeof v === 'bigint' ? v.toString() : v]),
          ),
          offers,
        });
      }

      // POST /api/demo/offers (admin): publishes the bot's offers on-chain. Spends real sats.
      if (method === 'POST' && path === '/api/demo/offers') {
        requireAdmin(req);
        if (!demo) {
          throw new HttpError(404, 'Demo mode is not enabled');
        }
        const body = await readJson<{ assets?: DemoAsset[] }>(req);
        const offers = await demo.publishOffers(body.assets);
        return jsonResponse({ offers }, 201);
      }

      // POST /api/demo/trades/:id/verdict: the demo arbiter console. Any visitor may decide a
      // disputed trade against the bot; the verdict is signed with the service arbiter key.
      const demoVerdictMatch = path.match(/^\/api\/demo\/trades\/([0-9a-f]+)\/verdict$/i);
      if (method === 'POST' && demoVerdictMatch) {
        if (!demo) {
          throw new HttpError(404, 'Demo mode is not enabled');
        }
        const trade = await service.getTrade(demoVerdictMatch[1]);
        if (!trade || !service.isDemoTrade(trade)) {
          throw new HttpError(403, 'The demo arbiter console only decides trades against the demo seller');
        }
        if (trade.status !== 'Disputed') {
          throw new HttpError(400, `The demo arbiter can only decide a disputed trade (state: "${trade.status}")`);
        }
        const body = await readJson<{ verdict: VerdictHex }>(req);
        if (body.verdict !== VERDICT_BUYER && body.verdict !== VERDICT_SELLER) {
          throw new HttpError(400, 'Verdict must be "01" (buyer) or "02" (seller)');
        }
        const decided = await service.issueArbiterVerdict({
          idOrTradeId: trade.id,
          verdict: body.verdict,
          reason: 'Demo arbiter console: decision taken by the visitor, signed with the service arbiter key',
        });
        return jsonResponse({ trade: decided, simulatedArbiter: true });
      }

      return jsonResponse({ error: `Route not found: ${method} ${path}` }, 404);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (err instanceof HttpError) {
        return jsonResponse({ error: message }, err.status);
      }
      if (err instanceof DemoLimitError || err instanceof SponsorshipLimitError) {
        return jsonResponse({ error: message }, 429);
      }
      return jsonResponse({ error: message }, 400);
    }
  };
}
