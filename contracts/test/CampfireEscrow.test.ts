// Tests for every spending path of the escrow contract, run on CashScript's
// simulated network. Nothing here touches a real network.

import { afterAll, describe, expect, it } from 'vitest';
import 'cashscript/vitest';
import {
  Contract, MockNetworkProvider, SignatureTemplate, TransactionBuilder,
  randomUtxo, type Artifact, type Output, type SpendableUtxo, type TokenDetails, type Unlocker,
} from 'cashscript';
import { binToHex, hash160, hexToBin, sha256, utf8ToBin } from '@bitauth/libauth';
import artifactJson from '../CampfireEscrow.json' with { type: 'json' };

const artifact = artifactJson as unknown as Artifact;

// Deterministic test keys. SignatureTemplate signs with Schnorr and
// SIGHASH_ALL | SIGHASH_UTXOS (0x61 on chain), the same as WizardConnect wallets.
const key = (label: string) => new SignatureTemplate(sha256.hash(utf8ToBin(`campfire-test-${label}`)));
const seller = key('seller');
const buyer = key('buyer');
const arbiter = key('arbiter');
const sellerPayout = key('seller-payout');
const buyerPayout = key('buyer-payout');
const thief = key('thief');

const p2pkh = (signer: SignatureTemplate) => hexToBin(`76a914${binToHex(hash160(signer.publicKey))}88ac`);
const SELLER_LOCK = p2pkh(sellerPayout);
const BUYER_LOCK = p2pkh(buyerPayout);
const THIEF_LOCK = p2pkh(thief);

const TRADE_ID = sha256.hash(utf8ToBin('trade terms'));
const OTHER_TRADE_ID = sha256.hash(utf8ToBin('other trade terms'));
const REFUND_TIME = 1_796_109_600;
const FEE_BUDGET = 1000n;

const BUYER_WINS = '01';
const SELLER_WINS = '02';

// The arbiter signs SHA-256(tradeId ‖ verdict); this is what checkDataSig verifies.
const signVerdict = (signer: SignatureTemplate, tradeId: Uint8Array, verdict: string) =>
  signer.signMessageHash(sha256.hash(Uint8Array.from([...tradeId, ...hexToBin(verdict)])));

const PUSD = '2469acc5afa4b10cb5b5c04afb89c3a3ffd61c5da9c01e26d00951cae2a02544';
const FUNDING = {
  bch: { satoshis: 250_000n + FEE_BUDGET },
  token: { satoshis: 7000n, token: { category: PUSD, amount: 12_345n } },
  nft: { satoshis: 7000n, token: { category: PUSD, amount: 0n, nft: { capability: 'mutable' as const, commitment: 'c0ffee' } } },
} satisfies Record<string, { satoshis: bigint; token?: TokenDetails }>;
type Asset = keyof typeof FUNDING;

function setup(asset: Asset = 'bch') {
  const provider = new MockNetworkProvider();
  const contract = new Contract(artifact, [
    seller.publicKey, buyer.publicKey, arbiter.publicKey,
    hash160(sellerPayout.publicKey), hash160(buyerPayout.publicKey),
    TRADE_ID, BigInt(REFUND_TIME),
  ], { provider });
  // vout 0 so that the spending transaction is allowed to create a new token
  // category: the contract, not the network, must be what prevents it.
  const utxo = provider.addUtxo(contract.tokenAddress, randomUtxo({ vout: 0, ...FUNDING[asset] }));
  return { provider, contract, utxo };
}

type Escrow = ReturnType<typeof setup>;
type SpendOptions = {
  fee?: bigint;
  token?: TokenDetails | null; // null removes the tokens from the output
  locktime?: number;
  sequence?: number;
  extraInput?: boolean;
  extraOutputs?: Output[];
  amount?: bigint;
};

// Builds a spend of the escrow UTXO that follows the payout rule unless an option says otherwise.
function spend({ provider, utxo }: Escrow, unlocker: Unlocker, to: Uint8Array, options: SpendOptions = {}) {
  const token = options.token === null ? undefined : options.token ?? utxo.token;
  const builder = new TransactionBuilder({ provider, allowImplicitFungibleTokenBurn: true })
    .addInput(utxo, unlocker, options.sequence === undefined ? undefined : { sequence: options.sequence })
    .addOutput({ to, amount: options.amount ?? utxo.satoshis - (options.fee ?? FEE_BUDGET), token });
  if (options.extraInput) {
    const extra = provider.addUtxo(binToHex(THIEF_LOCK), randomUtxo({ satoshis: 10_000n }));
    builder.addInput(extra, thief.unlockP2PKH());
  }
  if (options.extraOutputs) builder.addOutputs(options.extraOutputs);
  if (options.locktime !== undefined) builder.setLocktime(options.locktime);
  return builder;
}

const sizes: Record<string, Record<string, number>> = {};

// Sends a valid spend paying 1 sat/byte and checks that the payout address received everything else.
async function expectPaid(escrow: Escrow, path: string, asset: Asset, unlocker: Unlocker, to: Uint8Array, options: SpendOptions = {}) {
  const size = spend(escrow, unlocker, to, options).getTransactionSize();
  expect(size).toBeLessThanOrEqual(FEE_BUDGET);
  (sizes[path] ??= {})[asset] = Number(size);

  await spend(escrow, unlocker, to, { ...options, fee: size }).send();

  const received = await escrow.provider.getUtxosForLockingBytecode(to);
  expect(received).toHaveLength(1);
  expect(received[0].satoshis).toBe(escrow.utxo.satoshis - size);
  expect(received[0].token).toEqual(escrow.utxo.token);
  expect(await escrow.provider.getUtxos(escrow.contract.tokenAddress)).toHaveLength(0);
}

// Checks that the spend fails the given require statement and that the simulated network rejects it.
async function expectRejected(escrow: Escrow, builder: TransactionBuilder, reason: string) {
  expect(builder).toFailRequireWith(reason);
  await expect(builder.send()).rejects.toThrow();
  expect(await escrow.provider.getUtxos(escrow.contract.tokenAddress)).toHaveLength(1);
}

afterAll(() => {
  console.log('Spending transaction sizes in bytes (fee at 1 sat/byte):');
  console.table(sizes);
});

describe.each(['bch', 'token', 'nft'] as const)('valid spends of a %s escrow', (asset) => {
  it('release: the seller signs and the buyer is paid', async () => {
    const escrow = setup(asset);
    await expectPaid(escrow, 'release', asset, escrow.contract.unlock.release(seller), BUYER_LOCK);
  });

  it('cancel: the buyer signs and the seller is paid', async () => {
    const escrow = setup(asset);
    await expectPaid(escrow, 'cancel', asset, escrow.contract.unlock.cancel(buyer), SELLER_LOCK);
  });

  it('arbitrate: verdict 0x01 pays the buyer', async () => {
    const escrow = setup(asset);
    const unlocker = escrow.contract.unlock.arbitrate(signVerdict(arbiter, TRADE_ID, BUYER_WINS), BUYER_WINS);
    await expectPaid(escrow, 'arbitrate 0x01', asset, unlocker, BUYER_LOCK);
  });

  it('arbitrate: verdict 0x02 pays the seller', async () => {
    const escrow = setup(asset);
    const unlocker = escrow.contract.unlock.arbitrate(signVerdict(arbiter, TRADE_ID, SELLER_WINS), SELLER_WINS);
    await expectPaid(escrow, 'arbitrate 0x02', asset, unlocker, SELLER_LOCK);
  });

  it('refund: pays the seller once the locktime reaches refundTime', async () => {
    const escrow = setup(asset);
    await expectPaid(escrow, 'refund', asset, escrow.contract.unlock.refund(), SELLER_LOCK, { locktime: REFUND_TIME });
  });
});

describe('wrong signer', () => {
  it.each([['buyer', buyer], ['arbiter', arbiter], ['thief', thief]])('release signed by the %s', async (_, signer) => {
    const escrow = setup();
    await expectRejected(escrow, spend(escrow, escrow.contract.unlock.release(signer), BUYER_LOCK), 'invalid seller signature');
  });

  it.each([['seller', seller], ['arbiter', arbiter], ['thief', thief]])('cancel signed by the %s', async (_, signer) => {
    const escrow = setup();
    await expectRejected(escrow, spend(escrow, escrow.contract.unlock.cancel(signer), SELLER_LOCK), 'invalid buyer signature');
  });
});

describe('wrong verdict', () => {
  const arbitrate = (escrow: Escrow, signature: Uint8Array, verdict: string) => escrow.contract.unlock.arbitrate(signature, verdict);

  it('verdict signed for another tradeId', async () => {
    const escrow = setup();
    const unlocker = arbitrate(escrow, signVerdict(arbiter, OTHER_TRADE_ID, BUYER_WINS), BUYER_WINS);
    await expectRejected(escrow, spend(escrow, unlocker, BUYER_LOCK), 'invalid arbiter verdict');
  });

  it.each([['seller', seller], ['buyer', buyer], ['thief', thief]])('verdict signed by the %s', async (_, signer) => {
    const escrow = setup();
    const unlocker = arbitrate(escrow, signVerdict(signer, TRADE_ID, BUYER_WINS), BUYER_WINS);
    await expectRejected(escrow, spend(escrow, unlocker, BUYER_LOCK), 'invalid arbiter verdict');
  });

  it('signature for 0x02 presented as verdict 0x01', async () => {
    const escrow = setup();
    const unlocker = arbitrate(escrow, signVerdict(arbiter, TRADE_ID, SELLER_WINS), BUYER_WINS);
    await expectRejected(escrow, spend(escrow, unlocker, BUYER_LOCK), 'invalid arbiter verdict');
  });

  it.each(['00', '03', 'ff'])('verdict 0x%s signed by the arbiter', async (verdict) => {
    const escrow = setup();
    const unlocker = arbitrate(escrow, signVerdict(arbiter, TRADE_ID, verdict), verdict);
    await expectRejected(escrow, spend(escrow, unlocker, SELLER_LOCK), 'unknown verdict');
  });

  it('verdict for the buyer cannot pay the seller, nor the other way round', async () => {
    const escrow = setup();
    const forBuyer = arbitrate(escrow, signVerdict(arbiter, TRADE_ID, BUYER_WINS), BUYER_WINS);
    await expectRejected(escrow, spend(escrow, forBuyer, SELLER_LOCK), 'wrong payout address');
    const forSeller = arbitrate(escrow, signVerdict(arbiter, TRADE_ID, SELLER_WINS), SELLER_WINS);
    await expectRejected(escrow, spend(escrow, forSeller, BUYER_LOCK), 'wrong payout address');
  });
});

// Every path, with valid authorisation, trying to break the payout rule.
const paths: [string, (escrow: Escrow) => Unlocker, Uint8Array, Uint8Array, SpendOptions][] = [
  ['release', (e) => e.contract.unlock.release(seller), BUYER_LOCK, SELLER_LOCK, {}],
  ['cancel', (e) => e.contract.unlock.cancel(buyer), SELLER_LOCK, BUYER_LOCK, {}],
  ['arbitrate 0x01', (e) => e.contract.unlock.arbitrate(signVerdict(arbiter, TRADE_ID, BUYER_WINS), BUYER_WINS), BUYER_LOCK, SELLER_LOCK, {}],
  ['arbitrate 0x02', (e) => e.contract.unlock.arbitrate(signVerdict(arbiter, TRADE_ID, SELLER_WINS), SELLER_WINS), SELLER_LOCK, BUYER_LOCK, {}],
  ['refund', (e) => e.contract.unlock.refund(), SELLER_LOCK, BUYER_LOCK, { locktime: REFUND_TIME }],
];

describe.each(paths)('payout rule on %s', (_, unlock, payout, counterparty, base) => {
  it('pays a third address', async () => {
    const escrow = setup();
    await expectRejected(escrow, spend(escrow, unlock(escrow), THIEF_LOCK, base), 'wrong payout address');
  });

  it('pays the other party', async () => {
    const escrow = setup();
    await expectRejected(escrow, spend(escrow, unlock(escrow), counterparty, base), 'wrong payout address');
  });

  it('pays a P2SH address built from the payout hash', async () => {
    const escrow = setup();
    const p2sh = Uint8Array.from([0xa9, 0x14, ...payout.slice(3, 23), 0x87]);
    await expectRejected(escrow, spend(escrow, unlock(escrow), p2sh, base), 'wrong payout address');
  });

  it('adds a second input', async () => {
    const escrow = setup();
    await expectRejected(escrow, spend(escrow, unlock(escrow), payout, { ...base, extraInput: true }), 'only one input allowed');
  });

  it('adds a second output', async () => {
    const escrow = setup();
    const options = { ...base, amount: 200_000n, extraOutputs: [{ to: THIEF_LOCK, amount: 50_000n }] };
    await expectRejected(escrow, spend(escrow, unlock(escrow), payout, options), 'only one output allowed');
  });

  it('accepts a fee of exactly 1,000 satoshis and rejects 1,001', async () => {
    const escrow = setup();
    await expectRejected(escrow, spend(escrow, unlock(escrow), payout, { ...base, fee: 1001n }), 'fee above 1000 satoshis');
    await spend(escrow, unlock(escrow), payout, { ...base, fee: 1000n }).send();
  });

  it('burns the tokens', async () => {
    const escrow = setup('token');
    await expectRejected(escrow, spend(escrow, unlock(escrow), payout, { ...base, token: null }), 'token category changed');
  });

  it('burns part of the tokens', async () => {
    const escrow = setup('token');
    const token = { category: PUSD, amount: 12_344n };
    await expectRejected(escrow, spend(escrow, unlock(escrow), payout, { ...base, token }), 'token amount changed');
  });

  it('swaps the tokens for a newly created category', async () => {
    const escrow = setup('token');
    const token = { category: escrow.utxo.txid, amount: 12_345n };
    await expectRejected(escrow, spend(escrow, unlock(escrow), payout, { ...base, token }), 'token category changed');
  });

  it('creates tokens when spending a BCH escrow', async () => {
    const escrow = setup('bch');
    const token = { category: escrow.utxo.txid, amount: 1n };
    await expectRejected(escrow, spend(escrow, unlock(escrow), payout, { ...base, token }), 'token category changed');
  });

  it('changes the NFT commitment', async () => {
    const escrow = setup('nft');
    const token = { category: PUSD, amount: 0n, nft: { capability: 'mutable' as const, commitment: 'decaf0' } };
    await expectRejected(escrow, spend(escrow, unlock(escrow), payout, { ...base, token }), 'NFT commitment changed');
  });

  it('downgrades the NFT capability', async () => {
    const escrow = setup('nft');
    const token = { category: PUSD, amount: 0n, nft: { capability: 'none' as const, commitment: 'c0ffee' } };
    await expectRejected(escrow, spend(escrow, unlock(escrow), payout, { ...base, token }), 'token category changed');
  });
});

describe('refund before refundTime', () => {
  const refund = (escrow: Escrow, options: SpendOptions) => spend(escrow, escrow.contract.unlock.refund(), SELLER_LOCK, options);

  it.each([
    ['one second early', REFUND_TIME - 1],
    ['no locktime', 0],
    ['a block height instead of a timestamp', 499_999_999],
  ])('%s', async (_, locktime) => {
    const escrow = setup();
    await expectRejected(escrow, refund(escrow, { locktime }), 'refund time not reached');
  });

  it('a final sequence number, which disables the locktime', async () => {
    const escrow = setup();
    await expectRejected(escrow, refund(escrow, { locktime: REFUND_TIME, sequence: 0xffffffff }), 'refund time not reached');
  });

  it('accepts a locktime later than refundTime', async () => {
    const escrow = setup();
    await refund(escrow, { locktime: REFUND_TIME + 86_400 }).send();
  });
});

// Protocol section 5: a buyer who holds nothing but the tokens and satoshis
// received from a token escrow must be able to move the tokens on.
describe('moving received tokens', () => {
  it('fits in the satoshis that come with the tokens', async () => {
    const provider = new MockNetworkProvider();
    const received = provider.addUtxo(binToHex(BUYER_LOCK), randomUtxo({ satoshis: 6000n, token: FUNDING.token.token }));
    const transfer = (fee: bigint) => new TransactionBuilder({ provider })
      .addInput(received, buyerPayout.unlockP2PKH())
      .addOutput({ to: THIEF_LOCK, amount: received.satoshis - fee, token: received.token });
    const size = transfer(0n).getTransactionSize();
    sizes['token transfer from P2PKH'] = { token: Number(size) };
    expect(size).toBeLessThan(300n);
    await transfer(size).send();
  });
});
