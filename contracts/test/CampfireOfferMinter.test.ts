// Tests for the offer minter: it mints one marker NFT per published offer and nothing else.
// Run on CashScript's simulated network; nothing here touches a real network.

import { describe, expect, it } from 'vitest';
import 'cashscript/vitest';
import {
  Contract, MockNetworkProvider, SignatureTemplate, TransactionBuilder,
  randomUtxo, type Artifact, type Output, type TokenDetails,
} from 'cashscript';
import { binToHex, hash160, hexToBin, sha256, utf8ToBin } from '@bitauth/libauth';
import artifactJson from '../CampfireOfferMinter.json' with { type: 'json' };

const artifact = artifactJson as unknown as Artifact;

const publisher = new SignatureTemplate(sha256.hash(utf8ToBin('campfire-test-publisher')));
const PUBLISHER_LOCK = hexToBin(`76a914${binToHex(hash160(publisher.publicKey))}88ac`);
const CATEGORY = binToHex(sha256.hash(utf8ToBin('campfire offer category')));
const OTHER_CATEGORY = binToHex(sha256.hash(utf8ToBin('another category')));
const OFFER_HASH = sha256.hash(utf8ToBin('{"v":2}'));
const OTHER_HASH = sha256.hash(utf8ToBin('another offer'));
const ARBITER = hexToBin(`02${'11'.repeat(32)}`);
const ORACLE = hexToBin(`03${'22'.repeat(32)}`);
const SELL = '01';
const MARKER_SATS = 1000n;
const MINTER_SATS = 1000n;

const push = (data: Uint8Array) => [data.length, ...data];
/** The version-2 offer OP_RETURN (protocol section 3.1). */
function offerOpReturn(options: { version?: number; hash?: Uint8Array; oracle?: Uint8Array } = {}) {
  return Uint8Array.from([
    0x6a,
    ...push(utf8ToBin('CMPF')),
    ...push(Uint8Array.of(options.version ?? 2)),
    ...push(Uint8Array.of(1)),
    ...push(ARBITER),
    ...push(options.oracle ?? ORACLE),
    ...push(options.hash ?? OFFER_HASH),
  ]);
}

const marker = (commitment = SELL + binToHex(OFFER_HASH), category = CATEGORY): TokenDetails => ({
  category, amount: 0n, nft: { capability: 'none', commitment },
});
const minting: TokenDetails = { category: CATEGORY, amount: 0n, nft: { capability: 'minting', commitment: '' } };

function setup(minterToken: TokenDetails = minting) {
  const provider = new MockNetworkProvider();
  const contract = new Contract(artifact, [], { provider });
  const minter = provider.addUtxo(contract.tokenAddress, randomUtxo({ satoshis: MINTER_SATS, token: minterToken }));
  const coins = provider.addUtxo(binToHex(PUBLISHER_LOCK), randomUtxo({ satoshis: 100_000n }));
  return { provider, contract, minter, coins };
}
type Setup = ReturnType<typeof setup>;

type Options = {
  opReturn?: Uint8Array;
  marker?: TokenDetails | null;
  minterTo?: Uint8Array | string;
  minterToken?: TokenDetails;
  minterSats?: bigint;
  change?: TokenDetails | null;
  extraOutputs?: Output[];
  minterSecond?: boolean;
};

/** A publication that follows the rules unless an option says otherwise. */
function publish(s: Setup, o: Options = {}) {
  const builder = new TransactionBuilder({ provider: s.provider });
  if (o.minterSecond) builder.addInput(s.coins, publisher.unlockP2PKH()).addInput(s.minter, s.contract.unlock.mint());
  else builder.addInput(s.minter, s.contract.unlock.mint()).addInput(s.coins, publisher.unlockP2PKH());
  builder
    .addOutput({ to: o.opReturn ?? offerOpReturn(), amount: o.opReturn && o.opReturn[0] !== 0x6a ? 1000n : 0n })
    .addOutput({ to: PUBLISHER_LOCK, amount: MARKER_SATS, token: o.marker === null ? undefined : o.marker ?? marker() })
    .addOutput({ to: o.minterTo ?? s.contract.tokenAddress, amount: o.minterSats ?? MINTER_SATS, token: o.minterToken ?? s.minter.token });
  if (o.change !== null) {
    builder.addOutput({ to: PUBLISHER_LOCK, amount: 100_000n - MARKER_SATS - 2000n, token: o.change });
  }
  if (o.extraOutputs) builder.addOutputs(o.extraOutputs);
  return builder;
}

async function expectRejected(s: Setup, builder: TransactionBuilder, reason: string) {
  expect(builder).toFailRequireWith(reason);
  await expect(builder.send()).rejects.toThrow();
  expect(await s.provider.getUtxos(s.contract.tokenAddress)).toEqual([s.minter]);
}

describe('valid publications', () => {
  it.each([['sell', '01'], ['buy', '02']])('mints a %s marker and returns the minter', async (_, side) => {
    const s = setup();
    const builder = publish(s, { marker: marker(side + binToHex(OFFER_HASH)) });
    console.log(`Publication size: ${builder.getTransactionSize()} bytes`);
    await builder.send();
    const [held] = await s.provider.getUtxosForLockingBytecode(PUBLISHER_LOCK).then((u) => u.filter((x) => x.token));
    expect(held.token).toEqual(marker(side + binToHex(OFFER_HASH)));
    const [back] = await s.provider.getUtxos(s.contract.tokenAddress);
    expect(back.token).toEqual(minting);
  });

  it('works without a change output and with a fixed-price offer (zero oracle key)', async () => {
    const s = setup();
    await publish(s, { change: null, opReturn: offerOpReturn({ oracle: new Uint8Array(33) }) }).send();
  });

  it('keeps a numbered minter numbered', async () => {
    const numbered: TokenDetails = { ...minting, nft: { capability: 'minting', commitment: '03' } };
    const s = setup(numbered);
    await publish(s).send();
  });

  it('can publish again from the returned minter', async () => {
    const s = setup();
    await publish(s).send();
    const [back] = await s.provider.getUtxos(s.contract.tokenAddress);
    const coins = s.provider.addUtxo(binToHex(PUBLISHER_LOCK), randomUtxo({ satoshis: 100_000n }));
    await publish({ ...s, minter: back, coins }, { opReturn: offerOpReturn({ hash: OTHER_HASH }), marker: marker(SELL + binToHex(OTHER_HASH)) }).send();
  });
});

describe('the marker must be tied to the offer', () => {
  it('commitment with another hash', async () => {
    const s = setup();
    await expectRejected(s, publish(s, { marker: marker(SELL + binToHex(OTHER_HASH)) }), 'marker is not tied to this offer');
  });

  it.each(['00', '03', 'ff'])('side byte 0x%s', async (side) => {
    const s = setup();
    await expectRejected(s, publish(s, { marker: marker(side + binToHex(OFFER_HASH)) }), 'unknown offer side');
  });

  it('commitment of the wrong length', async () => {
    const s = setup();
    await expectRejected(s, publish(s, { marker: marker(binToHex(OFFER_HASH)) }), 'marker commitment must be 33 bytes');
  });

  it('mutable or minting marker', async () => {
    for (const capability of ['mutable', 'minting'] as const) {
      const s = setup();
      const token = { ...marker(), nft: { capability, commitment: SELL + binToHex(OFFER_HASH) } };
      await expectRejected(s, publish(s, { marker: token }), 'output 1 is not an immutable marker');
    }
  });

  it('no marker at all', async () => {
    const s = setup();
    await expectRejected(s, publish(s, { marker: null }), 'output 1 is not an immutable marker');
  });
});

describe('output 0 must be a version-2 offer', () => {
  it('version 1 OP_RETURN', async () => {
    const s = setup();
    await expectRejected(s, publish(s, { opReturn: offerOpReturn({ version: 1 }) }), 'output 0 is not a version-2 offer');
  });

  it('a plain payment instead of the OP_RETURN', async () => {
    const s = setup();
    await expectRejected(s, publish(s, { opReturn: PUBLISHER_LOCK }), 'output 0 is not an offer OP_RETURN');
  });
});

describe('the minter must come back unchanged', () => {
  it('sent to the publisher', async () => {
    const s = setup();
    await expectRejected(s, publish(s, { minterTo: PUBLISHER_LOCK }), 'minter must return to the contract');
  });

  it('downgraded to an immutable NFT', async () => {
    const s = setup();
    const token = { ...minting, nft: { capability: 'none' as const, commitment: '' } };
    await expectRejected(s, publish(s, { minterToken: token }), 'minter category changed');
  });

  it('with a new commitment', async () => {
    const s = setup();
    const token = { ...minting, nft: { capability: 'minting' as const, commitment: 'ff' } };
    await expectRejected(s, publish(s, { minterToken: token }), 'minter commitment changed');
  });

  it('with less value', async () => {
    const s = setup();
    await expectRejected(s, publish(s, { minterSats: MINTER_SATS - 1n }), 'minter value decreased');
  });
});

describe('nothing else may be minted', () => {
  it('a second marker in the change', async () => {
    const s = setup();
    await expectRejected(s, publish(s, { change: marker() }), 'change carries tokens');
  });

  it('a fifth output', async () => {
    const s = setup();
    await expectRejected(s, publish(s, { extraOutputs: [{ to: PUBLISHER_LOCK, amount: 1000n }] }), 'too many outputs');
  });

  it('the minter as a second input', async () => {
    const s = setup();
    await expectRejected(s, publish(s, { minterSecond: true }), 'minter must be input 0');
  });

  it('a minter that holds an NFT of another category still only mints its own', async () => {
    const s = setup({ ...minting, category: OTHER_CATEGORY });
    await expectRejected(s, publish(s), 'output 1 is not an immutable marker');
  });
});
