import { MockNetworkProvider, randomUtxo } from 'cashscript';
import { binToHex, deriveHdPath, deriveHdPrivateNodeFromSeed, deriveHdPublicNode, encodeHdPublicKey, secp256k1, sha256, utf8ToBin } from '@bitauth/libauth';
import { describe, expect, it } from 'vitest';
import { deriveSharedTradeKey } from '../src/protocol/crypto.js';
import { createEscrowContract } from '../src/protocol/escrow.js';
import { derivePayoutPkhFromXpub, derivePubkeyFromXpub } from '../src/protocol/keys.js';
import { computeTradeId, signPriceQuote, type TradeTerms } from '../src/protocol/trades.js';
import type { Trade } from '../src/web/api.js';
import { generateSessionKeyPair } from '../src/web/take.js';
import {
  TradeActionError,
  actionProgress,
  buildBuyerCancel,
  checkForArbiter,
  disputeKeyHex,
  lockedCoins,
  newerTrade,
  readPaymentDetails,
  releaseReady,
  roleOf,
  timeline,
  tradeTitle,
  type ReleaseCheck,
} from '../src/web/trade.js';

const base: Trade = {
  id: 'rec',
  status: 'Funded',
  offerTxid: 'o',
  buyerIdentity: 'buyer',
  sellerIdentity: 'seller',
  asset: 'BCH',
  assetDecimals: 8,
  amount: '15000',
  fiat: 'USD',
  fiatAmount: '0.07',
  buyerPk: '02',
  buyerPayoutPkh: '00',
  arbiterPk: '02',
  isDemo: true,
  createdAt: 1000,
  updatedAt: 1100,
  fundingTxid: 'f'.repeat(64),
  fundingConfirmations: 0,
  fundedAt: 1050,
  paymentDeadline: 1350,
};
const titles = (t: Trade, role: 'buyer' | 'visitor' = 'buyer') =>
  timeline(t, role, '15,000 sats').map((s) => `${s.state}:${s.title}`);

describe('trade page model (web)', () => {
  it('tells the roles apart', () => {
    expect(roleOf(base, 'buyer')).toBe('buyer');
    expect(roleOf(base, 'seller')).toBe('seller');
    expect(roleOf(base, 'someone')).toBe('visitor');
    expect(roleOf(base, null)).toBe('visitor');
  });

  it('never steps back to an older copy of the trade', () => {
    const paid = { ...base, status: 'Released' as const, updatedAt: 1200 };
    const stalePoll = { ...base, updatedAt: 1100 };
    expect(newerTrade(paid, stalePoll)).toBe(paid);
    expect(newerTrade(stalePoll, paid)).toBe(paid);
    expect(newerTrade(undefined, stalePoll)).toBe(stalePoll);
    // Another trade always replaces the one shown.
    const other = { ...base, id: 'other', updatedAt: 1 };
    expect(newerTrade(paid, other)).toBe(other);
  });

  it('writes the title for each viewer', () => {
    expect(tradeTitle('Funded', 'buyer', '15,000 sats', '0.07 USD')).toBe('Buy 15,000 sats for 0.07 USD');
    expect(tradeTitle('Released', 'buyer', '15,000 sats', '0.07 USD')).toBe('Bought 15,000 sats for 0.07 USD');
    expect(tradeTitle('Released', 'visitor', '15,000 sats', '0.07 USD')).toBe('15,000 sats for 0.07 USD');
  });

  it('follows the happy path', () => {
    expect(titles({ ...base, status: 'Requested', fundingTxid: undefined })).toEqual([
      'done:You took the offer',
      'current:Seller accepts and locks the BCH',
      'todo:You send the payment and mark it as paid',
      'todo:Seller releases 15,000 sats to your wallet',
    ]);
    expect(titles(base)).toEqual([
      'done:You took the offer',
      'done:Seller locked the BCH',
      'current:You send the payment and mark it as paid',
      'todo:Seller releases 15,000 sats to your wallet',
    ]);
    const released = { ...base, status: 'Released' as const, paidAt: 1100, completedAt: 1110, settlementTxid: 'a'.repeat(64) };
    expect(titles(released)).toEqual([
      'done:You took the offer',
      'done:Seller locked the BCH',
      'done:You marked the payment as sent',
      'done:Seller released 15,000 sats to your wallet',
    ]);
    expect(timeline(released, 'buyer', '15,000 sats')[2].simulated).toBe(true);
    expect(titles(released, 'visitor')[3]).toBe('done:Seller released 15,000 sats to the buyer');
  });

  it('replaces the remaining steps when the payment window ends', () => {
    const expired = { ...base, status: 'ResolvedSeller' as const, verdictIssuedAt: 1360, settlementTxid: 'e'.repeat(64) };
    expect(titles(expired)).toEqual([
      'done:You took the offer',
      'done:Seller locked the BCH',
      'failed:Payment window ended without a payment',
      'done:Arbiter returned 15,000 sats to the seller',
    ]);
    const dropped = { ...base, status: 'Dropped' as const, fundingTxid: undefined };
    expect(titles(dropped)).toEqual(['done:You took the offer', 'failed:The seller did not accept and lock the BCH in time']);
  });
});

describe('a dispute in the progress steps', () => {
  const paid = { ...base, status: 'Paid' as const, paidAt: 1100 };
  const disputed = { ...paid, status: 'Disputed' as const, disputedBy: 'buyer' as const, disputedAt: 1200 };

  it('pauses at the arbiter while the dispute is open', () => {
    expect(titles(disputed)).toEqual([
      'done:You took the offer',
      'done:Seller locked the BCH',
      'done:You marked the payment as sent',
      'current:Dispute opened by you',
      'todo:Arbiter decides: funds go to buyer or seller',
    ]);
    expect(timeline(disputed, 'buyer', '15,000 sats')[3].note).toBe('Waiting for the arbiter');
    expect(titles(disputed, 'visitor')[3]).toBe('current:Dispute opened by the buyer');
    expect(titles({ ...disputed, disputedBy: 'seller' })[3]).toBe('current:Dispute opened by the seller');
  });

  it('says the payment was not marked when the dispute comes before it', () => {
    expect(titles({ ...disputed, paidAt: undefined })).toEqual([
      'done:You took the offer',
      'done:Seller locked the BCH',
      'failed:You had not marked the payment as sent',
      'current:Dispute opened by you',
      'todo:Arbiter decides: funds go to buyer or seller',
    ]);
  });

  it('says it from the seller and the visitor side too, and not when there was no dispute', () => {
    const early = { ...disputed, paidAt: undefined };
    expect(titles(early, 'visitor')[2]).toBe('failed:Buyer had not marked the payment as sent');
    expect(timeline(early, 'seller', '15,000 sats').map((s) => s.title)).toContain('Buyer had not marked the payment as sent');
    expect(titles({ ...base, status: 'Funded' }).join()).not.toMatch(/had not marked/);
  });

  it('keeps the dispute in the story once it is decided or cancelled', () => {
    const txid = 'b'.repeat(64);
    expect(titles({ ...disputed, status: 'ResolvedBuyer', settlementTxid: txid }).slice(3)).toEqual([
      'done:Dispute opened by you',
      'done:Arbiter released 15,000 sats to your wallet',
    ]);
    expect(titles({ ...disputed, status: 'ResolvedSeller', settlementTxid: txid }).slice(3)).toEqual([
      'done:Dispute opened by you',
      'done:Arbiter returned 15,000 sats to the seller',
    ]);
    expect(titles({ ...disputed, status: 'Cancelled', settlementTxid: txid }).slice(3)).toEqual([
      'done:Dispute opened by you',
      'done:You cancelled: 15,000 sats went back to the seller',
    ]);
  });

  it('shows a plain cancel without a dispute step', () => {
    expect(titles({ ...paid, status: 'Cancelled' as const })).toEqual([
      'done:You took the offer',
      'done:Seller locked the BCH',
      'done:You marked the payment as sent',
      'done:You cancelled: 15,000 sats went back to the seller',
    ]);
  });
});

describe('the dispute key', () => {
  it('is the key both parties derive, so the arbiter can read the chat', () => {
    const buyer = generateSessionKeyPair();
    const seller = generateSessionKeyPair();
    const mine = disputeKeyHex(buyer.privateKey, seller.publicKey);
    expect(mine).toBe(binToHex(deriveSharedTradeKey(seller.privateKey, buyer.publicKey)));
    expect(mine).toHaveLength(64);
  });

  it('is left out when this browser lacks a key', () => {
    const seller = generateSessionKeyPair();
    expect(disputeKeyHex(null, seller.publicKey)).toBeUndefined();
    expect(disputeKeyHex(generateSessionKeyPair().privateKey, undefined)).toBeUndefined();
    expect(disputeKeyHex('not a key', seller.publicKey)).toBeUndefined();
  });
});

function xpub(label: string, branch: number): string {
  const seed = new Uint8Array(64);
  seed.set(sha256.hash(utf8ToBin(label)), 0);
  const node = deriveHdPath(deriveHdPrivateNodeFromSeed(seed), `m/44'/145'/0'/${branch}`);
  if (typeof node === 'string') throw new Error(node);
  return encodeHdPublicKey({ network: 'mainnet', node: deriveHdPublicNode(node) }).hdPublicKey;
}

describe('cancelling as the buyer', () => {
  const buyerDefi = xpub('buyer', 2);
  const buyerReceive = xpub('buyer', 0);
  const sellerDefi = xpub('seller', 2);
  const sellerReceive = xpub('seller', 0);
  const arbiter = xpub('arbiter', 2);
  const terms: TradeTerms = {
    v: 1,
    offerTxid: 'a'.repeat(64),
    asset: 'BCH',
    amount: '15000',
    fiat: 'USD',
    fiatAmount: '0.07',
    sellerPk: binToHex(derivePubkeyFromXpub(sellerDefi, 0)),
    buyerPk: binToHex(derivePubkeyFromXpub(buyerDefi, 3)),
    arbiterPk: binToHex(derivePubkeyFromXpub(arbiter, 0)),
    sellerPayoutPkh: binToHex(derivePayoutPkhFromXpub(sellerReceive, 4)),
    buyerPayoutPkh: binToHex(derivePayoutPkhFromXpub(buyerReceive, 5)),
    sellerSessionPk: binToHex(derivePubkeyFromXpub(sellerDefi, 1)),
    buyerSessionPk: binToHex(derivePubkeyFromXpub(buyerDefi, 1)),
    refundTime: 1_900_000_000,
    nonce: 'n1',
  };
  const termsJson = JSON.stringify(terms);
  const tradeId = binToHex(computeTradeId(termsJson));

  function setup(satoshis = 16_000n) {
    const provider = new MockNetworkProvider();
    const contract = createEscrowContract(terms, tradeId, provider);
    const coin = provider.addUtxo(contract.address, randomUtxo({ satoshis }));
    const trade: Trade = {
      ...base,
      status: 'Paid',
      termsJson,
      tradeId,
      escrowAddress: contract.address,
      buyerDefiIndex: 3,
      fundingTxid: coin.txid,
      fundingVout: coin.vout,
    };
    return { provider, trade, coin };
  }

  it('builds the transaction the wallet signs with the buyer key at the stored index', async () => {
    const { provider, trade } = setup();
    const built = await buildBuyerCancel(trade, provider, buyerDefi);
    expect(built.inputPaths).toEqual([[0, 'defi', 3]]);
    expect(built.request.transaction).toBe(built.unsignedHex);
    expect(built.sourceOutputs).toHaveLength(1);
    // The coin goes back to the seller's payout, minus the fee budget's share.
    expect(built.fee).toBeLessThanOrEqual(1000n);
  });

  it('refuses a wallet whose key is not the buyer key of the trade', async () => {
    const { provider, trade } = setup();
    await expect(buildBuyerCancel(trade, provider, xpub('someone else', 2))).rejects.toThrow(TradeActionError);
    await expect(buildBuyerCancel({ ...trade, buyerDefiIndex: 4 }, provider, buyerDefi)).rejects.toThrow(/not the one/);
  });

  it('waits for a deposit the chain does not show yet, or one with the wrong amount', async () => {
    const empty = setup();
    await expect(buildBuyerCancel({ ...empty.trade, fundingTxid: 'c'.repeat(64) }, empty.provider, buyerDefi)).rejects.toThrow(/not visible/);
    const wrong = setup(15_000n);
    await expect(buildBuyerCancel(wrong.trade, wrong.provider, buyerDefi)).rejects.toThrow(/not visible/);
    await expect(buildBuyerCancel({ ...base, status: 'Requested', fundingTxid: undefined }, new MockNetworkProvider(), buyerDefi)).rejects.toThrow(
      /no deposit/,
    );
  });
});

describe('what the demo arbiter checks', () => {
  const oracleSk = sha256.hash(utf8ToBin('oracle'));
  const oraclePk = binToHex(secp256k1.derivePublicKeyCompressed(oracleSk) as Uint8Array);
  const quote = signPriceQuote(oracleSk, { pair: 'BCH/USD', price: '465.12', timestamp: 1_790_000_000 });
  const floating: Trade = { ...base, assetDecimals: 8, amount: '15000', fiatAmount: '0.07', quote, oraclePk, marginBps: 0 };
  const offer = { price: { type: 'floating' as const, pair: 'BCH/USD', marginBps: 0 }, oracle: oraclePk };

  it('accepts a quote signed by the oracle the offer names, with the right fiat amount', () => {
    expect(checkForArbiter(floating, offer)).toEqual({ quote: 'valid', fiat: { price: '465.12', expected: '0.07', ok: true } });
  });

  it('does not say which oracle the offer names when the offer was not read', () => {
    expect(checkForArbiter(floating, undefined).quote).toBe('signature-only');
  });

  it('trusts the signed terms, not the copy of them the service keeps on the trade', () => {
    const terms = { quote, oraclePk, marginBps: 0, amount: '15000', fiatAmount: '0.07' };
    // The record claims another price and amount; the terms (hashed into the trade id) say otherwise.
    const record: Trade = { ...base, assetDecimals: 8, amount: '99999', fiatAmount: '9.99', marginBps: 500, termsJson: JSON.stringify(terms) };
    expect(checkForArbiter(record, offer)).toEqual({ quote: 'valid', fiat: { price: '465.12', expected: '0.07', ok: true } });
    // And a record that looks right does not rescue terms that are wrong.
    const wrong: Trade = { ...floating, termsJson: JSON.stringify({ ...terms, fiatAmount: '0.08' }) };
    expect(checkForArbiter(wrong, offer).fiat?.ok).toBe(false);
  });

  it('rejects a tampered price, another oracle and a wrong fiat amount', () => {
    expect(checkForArbiter({ ...floating, quote: { ...quote, price: '500.00' } }, offer).quote).toBe('wrong-signature');
    const other = binToHex(secp256k1.derivePublicKeyCompressed(sha256.hash(utf8ToBin('other'))) as Uint8Array);
    expect(checkForArbiter(floating, { ...offer, oracle: other }).quote).toBe('other-oracle');
    expect(checkForArbiter({ ...floating, fiatAmount: '0.08' }, offer).fiat).toEqual({ price: '465.12', expected: '0.07', ok: false });
  });

  it('checks a fixed-price offer against the offer price and has no quote', () => {
    const fixed: Trade = { ...base, assetDecimals: 8, amount: '15000', fiatAmount: '0.07' };
    expect(checkForArbiter(fixed, { price: { type: 'fixed', value: '465.12' } })).toEqual({
      quote: 'none',
      fiat: { price: '465.12', expected: '0.07', ok: true },
    });
    expect(checkForArbiter(fixed, undefined)).toEqual({ quote: 'none', fiat: null });
  });
});

describe('reading the seller payment details', () => {
  it('reads the demo seller JSON as labelled fields', () => {
    expect(readPaymentDetails('{"method":"simulated","reference":"CF-1","simulated":true}')).toEqual({
      kind: 'fields',
      fields: { method: 'simulated', reference: 'CF-1', simulated: true },
    });
  });

  it('keeps what a real seller typed as plain text, line breaks included', () => {
    const typed = 'Banco Nación · CBU 0110599520000001234567\nAlias campo.fuego.sur · Reference CF-250';
    expect(readPaymentDetails(typed)).toEqual({ kind: 'text', text: typed });
  });

  it('treats text that happens to be valid JSON but not an object as text', () => {
    // An account number alone is a JSON number; a list or null is not a set of labelled fields.
    for (const typed of ['0110599520', '[1,2]', 'null', '"alias"', 'true']) {
      expect(readPaymentDetails(typed)).toEqual({ kind: 'text', text: typed });
    }
  });
});

describe('named steps above the action card', () => {
  const at = (status: Trade['status'], role: 'buyer' | 'seller', side: 'sell' | 'buy' = 'sell') => {
    const progress = actionProgress(status, role, side);
    return progress ? progress.labels[progress.current] : null;
  };

  it('names the four steps for each side', () => {
    expect(actionProgress('Funded', 'buyer')?.labels).toEqual(['Confirm', 'Lock', 'Pay', 'Receive']);
    expect(actionProgress('Funded', 'seller')?.labels).toEqual(['Accept', 'Lock', 'Paid', 'Release']);
  });

  it('keeps the buyer of a sell offer on Lock while the seller accepts and locks', () => {
    expect(at('Requested', 'buyer')).toBe('Lock');
    expect(at('Accepted', 'buyer')).toBe('Lock');
    expect(at('Funded', 'buyer')).toBe('Pay');
    expect(at('Paid', 'buyer')).toBe('Receive');
  });

  it('starts the seller on Accept and ends on Release', () => {
    expect(at('Requested', 'seller')).toBe('Accept');
    expect(at('Accepted', 'seller')).toBe('Lock');
    expect(at('Funded', 'seller')).toBe('Paid');
    expect(at('Paid', 'seller')).toBe('Release');
  });

  it('asks the buyer of a buy offer to confirm the request first', () => {
    expect(at('Requested', 'buyer', 'buy')).toBe('Confirm');
    expect(at('Accepted', 'buyer', 'buy')).toBe('Lock');
    expect(at('Requested', 'seller', 'buy')).toBe('Accept');
    expect(at('Accepted', 'seller', 'buy')).toBe('Lock');
  });

  it('shows no step during a dispute or after the end', () => {
    for (const status of ['Disputed', 'Released', 'Cancelled', 'Refunded', 'ResolvedBuyer', 'ResolvedSeller', 'Dropped'] as const) {
      expect(actionProgress(status, 'buyer')).toBeNull();
      expect(actionProgress(status, 'seller')).toBeNull();
    }
  });
});

describe('the checks before a release', () => {
  it('needs both checks', () => {
    const ticked = (...checks: ReleaseCheck[]) => new Set<ReleaseCheck>(checks);
    expect(releaseReady(ticked())).toBe(false);
    expect(releaseReady(ticked('bankApp'))).toBe(false);
    expect(releaseReady(ticked('exactAmount'))).toBe(false);
    expect(releaseReady(ticked('bankApp', 'exactAmount'))).toBe(true);
  });

  it('names what is locked by the coin', () => {
    expect(lockedCoins('BCH')).toBe('the BCH');
    expect(lockedCoins('ab'.repeat(32))).toBe('the coins');
  });
});
