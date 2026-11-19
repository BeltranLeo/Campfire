import { MockNetworkProvider, Network, randomUtxo } from 'cashscript';
import { binToHex, decodeTransactionUnsafe, hexToBin, deriveHdPath, deriveHdPrivateNodeFromSeed, deriveHdPublicNode, encodeHdPublicKey, secp256k1, sha256, utf8ToBin } from '@bitauth/libauth';
import { describe, expect, it } from 'vitest';
import { decryptPaymentDetails } from '../src/protocol/crypto.js';
import { createEscrowContract, matchesEscrowFunding, missingFundingFees } from '../src/protocol/escrow.js';
import { feePkh } from '../src/protocol/fees.js';
import { PUSD_CATEGORY } from '../src/protocol/offers.js';
import { derivePayoutPkhFromXpub, derivePubkeyFromXpub, pkhToCashAddress, pkhToLockingBytecode, type WalletSpendableUtxo } from '../src/protocol/keys.js';
import { computeFiatAmount, computeTradeId, signPriceQuote, type TradeTerms } from '../src/protocol/trades.js';
import type { Trade } from '../src/web/api.js';
import {
  assertCanDeposit,
  buildAcceptBody,
  buildDeposit,
  buildSellerRelease,
  checkAcceptedTrade,
  checkDeposit,
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
  });

  it('pays exactly the escrow value to the escrow address and sends the change back to the wallet', () => {
    const checked = check(trade);
    const changeAddress = pkhToCashAddress(derivePayoutPkhFromXpub(sellerReceive, 11));
    const tx = buildDeposit({ trade, checked, coins: [coin(400_000n)], changeAddress, tokenChangeAddress: 'unused' });
    const outputs = (tx.builder as unknown as { outputs: { to: Uint8Array | string; amount: bigint }[] }).outputs;
    expect(outputs[0]).toMatchObject({ to: trade.escrowAddress, amount: 251_000n });
    expect(outputs[1].to).toBe(changeAddress);
    // The wallet is told which key signs the input.
    expect(tx.inputPaths).toEqual([[0, 'receive', 2]]);
  });

  it('refuses to build one the wallet cannot pay', () => {
    expect(() => buildDeposit({ trade, checked: check(trade), coins: [coin(1_000n)], changeAddress: 'x', tokenChangeAddress: 'x' })).toThrow(TradeActionError);
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

describe('a PUSD deposit', () => {
  // 0.10 PUSD at 1,450 ARS per dollar, with an arbiter fee of 1% of its value at 500 USD per BCH (200 sats).
  const pusdQuote = signPriceQuote(oracleSk, { pair: 'PUSD/ARS', price: '1450.00', timestamp: NOW - 60 });
  const pusdOffer = { arbiter: arbiterPk, oracle: oraclePk, price: { type: 'floating' as const, pair: 'PUSD/ARS', marginBps: 0 } };
  const fees = [{ role: 'arbiter' as const, pkh: feePkh(arbiterPk), satoshis: '600' }];
  const pusdTerms = {
    asset: PUSD_CATEGORY,
    amount: '10',
    quote: pusdQuote,
    marginBps: 0,
    fiatAmount: computeFiatAmount({ amount: '10', assetDecimals: 2, unitPrice: pusdQuote.price, marginBps: 0 }),
    fees,
  };
  const trade = accepted(pusdTerms, { asset: PUSD_CATEGORY, assetDecimals: 2, amount: '10', quote: pusdQuote, marginBps: 0, fiatAmount: pusdTerms.fiatAmount, fees });
  const coin = (satoshis: bigint, token?: { amount: bigint; category: string }, keyIndex = 2): WalletSpendableUtxo => {
    const u = randomUtxo({ satoshis, ...(token ? { token } : {}) });
    const pkh = derivePayoutPkhFromXpub(sellerReceive, keyIndex);
    return { ...u, lockingBytecode: binToHex(pkhToLockingBytecode(pkh)), pathName: 'receive', keyIndex, address: pkhToCashAddress(pkh) } as WalletSpendableUtxo;
  };
  const pusd = (amount: bigint, satoshis = 1_000n) => coin(satoshis, { amount, category: PUSD_CATEGORY }, 3);
  const pusdCheck = (over: Partial<Parameters<typeof checkAcceptedTrade>[1]> = {}) => check(trade, { offer: pusdOffer, bchUsd: '500.00', ...over });

  it('needs the tokens and the BCH that travel with them, counting the BCH already on the token coins', () => {
    // 7,000 for the escrow + 600 of fees + 2,000 for the deposit fee and the token change = 9,600 sats.
    expect(checkDeposit(trade, [pusd(10n), coin(8_600n)])).toEqual({
      bch: { need: 8_600n, have: 8_600n },
      token: { category: PUSD_CATEGORY, need: 10n, have: 10n },
    });
    expect(() => assertCanDeposit(trade, [pusd(10n), coin(8_600n)])).not.toThrow();
    expect(() => assertCanDeposit(trade, [pusd(10n), coin(8_599n)])).toThrow(/Send some BCH/);
    expect(() => assertCanDeposit(trade, [pusd(9n), coin(900_000n)])).toThrow(/needs 0.10 PUSD and Campfire can see 0.09.*Send some PUSD/);
    // Another token is not PUSD.
    expect(() => assertCanDeposit(trade, [coin(1_000n, { amount: 10n, category: 'd'.repeat(64) }), coin(900_000n)])).toThrow(/Send some PUSD/);
  });

  it('locks the exact tokens at the escrow, pays the fees in BCH and returns the token change to a token address', () => {
    const checked = pusdCheck();
    const changePkh = derivePayoutPkhFromXpub(sellerReceive, 11);
    const tokenChangeAddress = pkhToCashAddress(changePkh, { tokenAware: true });
    const tx = buildDeposit({
      trade,
      checked,
      coins: [pusd(25n), coin(20_000n)],
      changeAddress: pkhToCashAddress(changePkh),
      tokenChangeAddress,
    });
    const decoded = decodeTransactionUnsafe(hexToBin(tx.hex));
    const escrowOut = decoded.outputs[0];
    expect(matchesEscrowFunding({ txid: '0'.repeat(64), vout: 0, lockingBytecode: binToHex(escrowOut.lockingBytecode), satoshis: escrowOut.valueSatoshis, token: { category: binToHex(escrowOut.token!.category), amount: escrowOut.token!.amount } }, checked.terms)).toBe(true);
    expect(missingFundingFees(tx.hex, fees)).toBeNull();
    const tokenChange = decoded.outputs.find((o, i) => i > 0 && o.token);
    expect(tokenChange?.token?.amount).toBe(15n);
    expect(binToHex(tokenChange!.lockingBytecode)).toBe(binToHex(pkhToLockingBytecode(changePkh)));
    // The wallet signs over each input's source output, so the token on the PUSD input must reach it.
    const sources = (tx.request as { sourceOutputs: { token?: { category: unknown; amount: unknown } }[] }).sourceOutputs;
    // WizardConnect sends bigints as tagged strings.
    expect(sources.map((o) => (o.token ? String(o.token.amount) : null))).toEqual(['<bigint: 25n>', null]);
    expect(tx.inputPaths).toEqual([[0, 'receive', 3], [1, 'receive', 2]]);
  });

  it('caps the fees of a PUSD trade with a fresh BCH price', () => {
    expect(() => pusdCheck()).not.toThrow();
    expect(() => pusdCheck({ bchUsd: null })).toThrow(/could not get a BCH price/);
    // At 1,000 USD per BCH the 0.10 PUSD are worth 10,000 sats: 5% is 500, 600 with the slack, so 600 passes...
    expect(() => pusdCheck({ bchUsd: '1000' })).not.toThrow();
    // ...and at 2,000 USD per BCH the cap is 300 sats.
    expect(() => pusdCheck({ bchUsd: '2000' })).toThrow(/above the most/);
  });

  it('releases the tokens to the buyer', async () => {
    const p = new MockNetworkProvider();
    p.network = Network.MAINNET;
    const contract = createEscrowContract(JSON.parse(trade.termsJson!), trade.tradeId!, p);
    const utxo = p.addUtxo(contract.tokenAddress, randomUtxo({ satoshis: 7_000n, token: { category: PUSD_CATEGORY, amount: 10n } }));
    const built = await buildSellerRelease({ ...trade, status: 'Paid', fundingTxid: utxo.txid, fundingVout: utxo.vout }, p, sellerDefi);
    const out = decodeTransactionUnsafe(hexToBin(built.unsignedHex)).outputs[0];
    expect(out.token?.amount).toBe(10n);
    expect(binToHex(out.lockingBytecode)).toBe(binToHex(pkhToLockingBytecode(trade.buyerPayoutPkh!)));
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
      'current:You accept and lock the BCH',
      'todo:Buyer sends the payment and marks it as paid',
      'todo:You confirm the payment and release',
    ]);
    expect(titles(trade)).toEqual([
      'done:Buyer took your offer',
      'done:You accepted',
      'current:You lock the BCH',
      'todo:Buyer sends the payment and marks it as paid',
      'todo:You confirm the payment and release',
    ]);
    const paid = { ...trade, status: 'Paid' as const, fundingTxid: 'f'.repeat(64), paidAt: NOW };
    expect(titles(paid)).toEqual([
      'done:Buyer took your offer',
      'done:You locked the BCH',
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
    expect(titles({ ...base, status: 'Cancelled' }).at(-1)).toBe('done:Buyer cancelled: 250,000 sats went back to you');
  });

  it('derives the dispute key from the OTHER side session key', () => {
    // The seller must use the buyer's session key; using their own would give a key the arbiter cannot match.
    const mine = disputeKeyHex(sellerSession.privateKey, buyerSession.publicKey);
    const theirs = disputeKeyHex(buyerSession.privateKey, sellerSession.publicKey);
    expect(mine).toBe(theirs);
    expect(disputeKeyHex(sellerSession.privateKey, sellerSession.publicKey)).not.toBe(mine);
  });
});

describe('payment details typed in fields', () => {
  const fields = { account: ' leo.campfire.mp ', holder: 'Leo B', note: '' };

  it('sends them as labelled fields the buyer page already shows', async () => {
    const { composePaymentDetails } = await import('../src/web/seller.js');
    const { readPaymentDetails } = await import('../src/web/trade.js');
    const text = composePaymentDetails(fields, 'ARS');
    expect(readPaymentDetails(text)).toEqual({ kind: 'fields', fields: { 'Alias, CBU or CVU': 'leo.campfire.mp', 'Account holder': 'Leo B' } });
    expect(JSON.parse(composePaymentDetails({ ...fields, note: 'Ref 12' }, 'USD'))).toEqual({
      'Account number or alias': 'leo.campfire.mp',
      'Account holder': 'Leo B',
      Note: 'Ref 12',
    });
  });

  it('is empty until something is typed, and ready only with the account and the holder', async () => {
    const { EMPTY_PAYMENT_FIELDS, composePaymentDetails, paymentFieldsReady } = await import('../src/web/seller.js');
    expect(composePaymentDetails(EMPTY_PAYMENT_FIELDS, 'ARS')).toBe('');
    expect(paymentFieldsReady({ ...fields, holder: ' ' }, 'ARS')).toBe(false);
    expect(paymentFieldsReady(fields, 'ARS')).toBe(true);
    expect(paymentFieldsReady({ ...fields, note: 'x'.repeat(500) }, 'ARS')).toBe(false);
  });
});
