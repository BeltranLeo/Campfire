import { MockNetworkProvider, Network, randomUtxo } from 'cashscript';
import { binToHex, deriveHdPath, deriveHdPrivateNodeFromSeed, deriveHdPublicNode, encodeHdPublicKey, secp256k1, sha256, utf8ToBin } from '@bitauth/libauth';
import { describe, expect, it } from 'vitest';
import { decryptPaymentDetails } from '../src/protocol/crypto.js';
import { createEscrowContract } from '../src/protocol/escrow.js';
import { derivePayoutPkhFromXpub, derivePubkeyFromXpub, pkhToCashAddress, pkhToLockingBytecode, type WalletSpendableUtxo } from '../src/protocol/keys.js';
import { computeFiatAmount, computeTradeId, signPriceQuote, type TradeTerms } from '../src/protocol/trades.js';
import type { Trade } from '../src/web/api.js';
import {
  assertCanDeposit,
  buildAcceptBody,
  buildDeposit,
  buildSellerRelease,
  checkAcceptedTrade,
  clearSavedDeposit,
  depositNeeds,
  findDeposit,
  loadSavedDeposit,
  saveDeposit,
} from '../src/web/seller.js';
import { generateSessionKeyPair } from '../src/web/take.js';
import { TradeActionError, disputeKeyHex, timeline, tradeTitle } from '../src/web/trade.js';

function xpub(label: string, branch: number): string {
  const seed = new Uint8Array(64);
  seed.set(sha256.hash(utf8ToBin(label)), 0);
  const node = deriveHdPath(deriveHdPrivateNodeFromSeed(seed), `m/44'/145'/0'/${branch}`);
  if (typeof node === 'string') throw new Error(node);
  return encodeHdPublicKey({ network: 'mainnet', node: deriveHdPublicNode(node) }).hdPublicKey;
}
const pk = (sk: Uint8Array) => binToHex(secp256k1.derivePublicKeyCompressed(sk) as Uint8Array);

const sellerDefi = xpub('seller', 2);
const sellerReceive = xpub('seller', 0);
const buyerDefi = xpub('buyer', 2);
const buyerReceive = xpub('buyer', 0);
const arbiterPk = binToHex(derivePubkeyFromXpub(xpub('arbiter', 2), 0));
const oracleSk = sha256.hash(utf8ToBin('oracle'));
const oraclePk = pk(oracleSk);
const sellerSession = generateSessionKeyPair();
const buyerSession = generateSessionKeyPair();
const NOW = 1_800_000_000;

const quote = signPriceQuote(oracleSk, { pair: 'BCH/ARS', price: '481779.51', timestamp: NOW - 60 });
const fiatAmount = computeFiatAmount({ amount: '250000', assetDecimals: 8, unitPrice: quote.price, marginBps: 150 });
const offerDoc = { arbiter: arbiterPk, oracle: oraclePk, price: { type: 'floating' as const, pair: 'BCH/ARS', marginBps: 150 } };

function termsWith(patch: Partial<TradeTerms> = {}): TradeTerms {
  return {
    v: 1,
    offerTxid: 'a'.repeat(64),
    asset: 'BCH',
    amount: '250000',
    fiat: 'ARS',
    fiatAmount,
    quote,
    marginBps: 150,
    oraclePk,
    sellerPk: binToHex(derivePubkeyFromXpub(sellerDefi, 0)),
    buyerPk: binToHex(derivePubkeyFromXpub(buyerDefi, 3)),
    arbiterPk,
    sellerPayoutPkh: binToHex(derivePayoutPkhFromXpub(sellerReceive, 4)),
    buyerPayoutPkh: binToHex(derivePayoutPkhFromXpub(buyerReceive, 5)),
    sellerSessionPk: sellerSession.publicKey,
    buyerSessionPk: buyerSession.publicKey,
    refundTime: NOW + 14 * 86_400,
    nonce: 'n1',
    ...patch,
  };
}

const provider = new MockNetworkProvider();
provider.network = Network.MAINNET;

/** A trade as the service records it after the seller accepted: the terms, their hash and the escrow address. */
function accepted(patch: Partial<TradeTerms> = {}, record: Partial<Trade> = {}): Trade {
  const terms = termsWith(patch);
  const termsJson = JSON.stringify(terms);
  const tradeId = binToHex(computeTradeId(termsJson));
  return {
    id: 'rec',
    status: 'Accepted',
    offerTxid: terms.offerTxid,
    buyerIdentity: 'buyer',
    sellerIdentity: 'seller',
    asset: 'BCH',
    assetDecimals: 8,
    amount: '250000',
    fiat: 'ARS',
    fiatAmount,
    quote,
    marginBps: 150,
    buyerPk: terms.buyerPk,
    buyerPayoutPkh: terms.buyerPayoutPkh,
    sellerPk: terms.sellerPk,
    sellerDefiIndex: 0,
    sellerReceiveIndex: 4,
    arbiterPk,
    oraclePk,
    termsJson,
    tradeId,
    escrowAddress: createEscrowContract(terms, tradeId, provider).address,
    createdAt: NOW - 100,
    updatedAt: NOW,
    ...record,
  };
}

const check = (trade: Trade, over: Partial<Parameters<typeof checkAcceptedTrade>[1]> = {}) =>
  checkAcceptedTrade(trade, {
    provider,
    defiXpub: sellerDefi,
    receiveXpub: sellerReceive,
    sessionPrivateKey: sellerSession.privateKey,
    offer: offerDoc,
    now: NOW,
    ...over,
  });

describe('accepting a request', () => {
  const params = {
    identity: 'seller',
    defiXpub: sellerDefi,
    receiveXpub: sellerReceive,
    defiIndex: 7,
    receiveIndex: 9,
    session: sellerSession,
    buyerSessionPk: buyerSession.publicKey,
    details: '  Banco Nación · CBU 0110 · Alias campo.fuego  ',
  };

  it('sends the seller keys for this trade and the payment details encrypted for the buyer', async () => {
    const body = await buildAcceptBody(params);
    expect(body).toMatchObject({
      sellerIdentity: 'seller',
      sellerPk: binToHex(derivePubkeyFromXpub(sellerDefi, 7)),
      sellerDefiIndex: 7,
      sellerPayoutPkh: binToHex(derivePayoutPkhFromXpub(sellerReceive, 9)),
      sellerReceiveIndex: 9,
      sellerSessionPk: sellerSession.publicKey,
    });
    // The service only holds ciphertext; the buyer's session key opens it.
    expect(body.encryptedPaymentDetails).not.toContain('Banco');
    expect(await decryptPaymentDetails(buyerSession.privateKey, sellerSession.publicKey, body.encryptedPaymentDetails)).toBe(
      'Banco Nación · CBU 0110 · Alias campo.fuego',
    );
    // Nobody else can read it.
    await expect(decryptPaymentDetails(generateSessionKeyPair().privateKey, sellerSession.publicKey, body.encryptedPaymentDetails)).rejects.toThrow();
  });

  it('asks for payment details before anything is sent', async () => {
    await expect(buildAcceptBody({ ...params, details: '   ' })).rejects.toThrow(TradeActionError);
  });
});

describe('the checks before the deposit', () => {
  it('passes the terms the service built from the seller keys', () => {
    const { terms, contract } = check(accepted());
    expect(terms.amount).toBe('250000');
    expect(contract.address).toBe(accepted().escrowAddress);
  });

  it.each([
    ['a trade id that is not the hash of the terms', accepted({}, { tradeId: 'b'.repeat(64) }), /trade ID/],
    ['an escrow address that is not the contract', accepted({}, { escrowAddress: createEscrowContract(termsWith({ nonce: 'other' }), 'c'.repeat(64), provider).address }), /escrow address/],
    ['a signing key from another wallet', accepted({ sellerPk: binToHex(derivePubkeyFromXpub(xpub('thief', 2), 0)) }), /signing key/],
    ['a refund address from another wallet', accepted({ sellerPayoutPkh: binToHex(derivePayoutPkhFromXpub(xpub('thief', 0), 4)) }), /return the coins/],
    ['another arbiter than the offer', accepted({ arbiterPk: binToHex(derivePubkeyFromXpub(xpub('other arbiter', 2), 0)) }), /different arbiter/],
    ['a refund time far away', accepted({ refundTime: NOW + 400 * 86_400 }), /refund time/],
    ['another chat key than this browser', accepted({ sellerSessionPk: generateSessionKeyPair().publicKey }), /chat key/],
    ['an amount that differs from the request', accepted({}, { amount: '260000' }), /do not match/],
    ['a fiat amount that does not follow the price', accepted({ fiatAmount: '1.00' }), /fiat amount/],
  ])('stops on %s and deposits nothing', (_name, trade, message) => {
    expect(() => check(trade)).toThrow(TradeActionError);
    expect(() => check(trade)).toThrow(message);
    expect(() => check(trade)).toThrow(/Nothing was deposited/);
  });

  it('stops on a quote signed by someone other than the offer oracle', () => {
    const other = pk(sha256.hash(utf8ToBin('other oracle')));
    expect(() => check(accepted(), { offer: { ...offerDoc, oracle: other } })).toThrow(/oracle/);
  });

  it('stops when the terms are not valid JSON terms at all', () => {
    expect(() => check(accepted({}, { termsJson: '{"v":1}' }))).toThrow(TradeActionError);
    expect(() => check({ ...accepted(), termsJson: undefined })).toThrow(/no escrow yet/);
  });

  it('does not need this browser to have the session key to protect the coins', () => {
    expect(() => check(accepted(), { sessionPrivateKey: null })).not.toThrow();
  });
});

describe('the deposit', () => {
  const coin = (satoshis: bigint, extra: Partial<WalletSpendableUtxo> = {}): WalletSpendableUtxo => {
    const u = randomUtxo({ satoshis });
    const pkh = derivePayoutPkhFromXpub(sellerReceive, 2);
    return { ...u, lockingBytecode: binToHex(pkhToLockingBytecode(pkh)), pathName: 'receive', keyIndex: 2, address: pkhToCashAddress(pkh), ...extra } as WalletSpendableUtxo;
  };
  const trade = accepted();

  it('needs the escrow value plus the fee of the deposit itself', () => {
    expect(depositNeeds(trade)).toBe(251_000n + 500n);
    expect(() => assertCanDeposit(trade, [coin(100_000n)])).toThrow(/Send some BCH/);
    expect(() => assertCanDeposit(trade, [coin(251_500n)])).not.toThrow();
    // Token coins are not plain BCH.
    expect(() => assertCanDeposit(trade, [coin(900_000n, { token: { amount: 5n, category: 'd'.repeat(64) } })])).toThrow(/Send some BCH/);
    expect(() => assertCanDeposit({ ...trade, asset: 'e'.repeat(64) }, [coin(900_000n)])).toThrow(/PUSD/);
  });

  it('pays exactly the escrow value to the escrow address and sends the change back to the wallet', () => {
    const checked = check(trade);
    const changeAddress = pkhToCashAddress(derivePayoutPkhFromXpub(sellerReceive, 11));
    const tx = buildDeposit({ trade, checked, coins: [coin(400_000n)], changeAddress });
    const outputs = (tx.builder as unknown as { outputs: { to: Uint8Array | string; amount: bigint }[] }).outputs;
    expect(outputs[0]).toMatchObject({ to: trade.escrowAddress, amount: 251_000n });
    expect(outputs[1].to).toBe(changeAddress);
    // The wallet is told which key signs the input.
    expect(tx.inputPaths).toEqual([[0, 'receive', 2]]);
  });

  it('refuses to build one the wallet cannot pay', () => {
    expect(() => buildDeposit({ trade, checked: check(trade), coins: [coin(1_000n)], changeAddress: 'x' })).toThrow(TradeActionError);
  });

  it('recognises a deposit that already exists, so it is never made twice', async () => {
    const p = new MockNetworkProvider();
    p.network = Network.MAINNET;
    const checked = checkAcceptedTrade(trade, { provider: p, defiXpub: sellerDefi, receiveXpub: sellerReceive, sessionPrivateKey: null, offer: offerDoc, now: NOW });
    expect(await findDeposit(checked.contract, checked.terms)).toBeUndefined();
    p.addUtxo(checked.contract.address, randomUtxo({ satoshis: 250_000n }));
    expect(await findDeposit(checked.contract, checked.terms)).toBeUndefined();
    p.addUtxo(checked.contract.address, randomUtxo({ satoshis: 251_000n }));
    expect(await findDeposit(checked.contract, checked.terms)).toMatchObject({ satoshis: 251_000n });
  });

  it('keeps a signed deposit in this browser until it is recorded', () => {
    const store = new Map<string, string>();
    const s = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v), removeItem: (k: string) => void store.delete(k) };
    expect(loadSavedDeposit(s, 'rec')).toBeNull();
    saveDeposit(s, 'rec', 'deadbeef');
    expect(loadSavedDeposit(s, 'rec')).toBe('deadbeef');
    expect(loadSavedDeposit(s, 'other')).toBeNull();
    clearSavedDeposit(s, 'rec');
    expect(loadSavedDeposit(s, 'rec')).toBeNull();
  });
});

describe('releasing', () => {
  function funded(satoshis = 251_000n) {
    const p = new MockNetworkProvider();
    p.network = Network.MAINNET;
    const trade = accepted();
    const contract = createEscrowContract(termsWith(), trade.tradeId!, p);
    const utxo = p.addUtxo(contract.address, randomUtxo({ satoshis }));
    return { p, trade: { ...trade, status: 'Paid' as const, fundingTxid: utxo.txid, fundingVout: utxo.vout } };
  }

  it('builds the release for the seller key at the stored index, paying the buyer from the signed terms', async () => {
    const { p, trade } = funded();
    const built = await buildSellerRelease(trade, p, sellerDefi);
    expect(built.inputPaths).toEqual([[0, 'defi', 0]]);
    expect(built.request.transaction).toBe(built.unsignedHex);
    expect(built.fee).toBeLessThanOrEqual(1000n);
    // Even if the service's copy of the buyer's payout is changed, the release follows the signed terms.
    const rewritten = { ...trade, buyerPayoutPkh: binToHex(derivePayoutPkhFromXpub(xpub('thief', 0), 0)) };
    const again = await buildSellerRelease(rewritten, p, sellerDefi);
    expect(again.unsignedHex).toBe(built.unsignedHex);
  });

  it('refuses a wallet whose key is not the seller key, and a deposit it cannot see', async () => {
    const { p, trade } = funded();
    await expect(buildSellerRelease(trade, p, xpub('someone else', 2))).rejects.toThrow(/not the one/);
    await expect(buildSellerRelease({ ...trade, sellerDefiIndex: 5 }, p, sellerDefi)).rejects.toThrow(/not the one/);
    await expect(buildSellerRelease({ ...trade, fundingTxid: 'c'.repeat(64) }, p, sellerDefi)).rejects.toThrow(/not visible/);
    const wrong = funded(250_000n);
    await expect(buildSellerRelease(wrong.trade, wrong.p, sellerDefi)).rejects.toThrow(/not visible/);
    await expect(buildSellerRelease({ ...trade, fundingTxid: undefined }, p, sellerDefi)).rejects.toThrow(/no deposit/);
  });
});

describe("the seller's view of the story", () => {
  const trade = accepted();
  const titles = (t: Trade) => timeline(t, 'seller', '250,000 sats').map((s) => `${s.state}:${s.title}`);

  it('words the title for the seller', () => {
    expect(tradeTitle('Paid', 'seller', '250,000 sats', '1,234.56 ARS')).toBe('Sell 250,000 sats for 1,234.56 ARS');
    expect(tradeTitle('Released', 'seller', '250,000 sats', '1,234.56 ARS')).toBe('Sold 250,000 sats for 1,234.56 ARS');
  });

  it('shows the acceptance as its own step until the deposit is made', () => {
    expect(titles({ ...trade, status: 'Requested', termsJson: undefined })).toEqual([
      'done:Buyer took your offer',
      'current:You accept and fund the escrow',
      'todo:Buyer sends the payment and marks it as paid',
      'todo:You confirm the payment and release',
    ]);
    expect(titles(trade)).toEqual([
      'done:Buyer took your offer',
      'done:You accepted',
      'current:You fund the escrow',
      'todo:Buyer sends the payment and marks it as paid',
      'todo:You confirm the payment and release',
    ]);
    const paid = { ...trade, status: 'Paid' as const, fundingTxid: 'f'.repeat(64), paidAt: NOW };
    expect(titles(paid)).toEqual([
      'done:Buyer took your offer',
      'done:You funded the escrow',
      'done:Buyer marked the payment as sent',
      'current:You confirm the payment and release',
    ]);
  });

  it('writes each ending from the seller side', () => {
    const base = { ...trade, fundingTxid: 'f'.repeat(64), paidAt: NOW };
    expect(titles({ ...base, status: 'Released' }).at(-1)).toBe('done:You released 250,000 sats to the buyer');
    expect(titles({ ...base, status: 'ResolvedSeller', disputedAt: NOW, disputedBy: 'seller' }).slice(-2)).toEqual([
      'done:Dispute opened by you',
      'done:Arbiter returned 250,000 sats to you',
    ]);
    expect(titles({ ...base, status: 'Cancelled' }).at(-1)).toBe('done:Buyer cancelled: the escrow returned 250,000 sats to you');
  });

  it('derives the dispute key from the OTHER side session key', () => {
    // The seller must use the buyer's session key; using their own would give a key the arbiter cannot match.
    const mine = disputeKeyHex(sellerSession.privateKey, buyerSession.publicKey);
    const theirs = disputeKeyHex(buyerSession.privateKey, sellerSession.publicKey);
    expect(mine).toBe(theirs);
    expect(disputeKeyHex(sellerSession.privateKey, sellerSession.publicKey)).not.toBe(mine);
  });
});
