// The offer category's metadata registry and genesis transaction (protocol section 3.5).

import { describe, expect, it } from 'vitest';
import { MockNetworkProvider, Network, SignatureTemplate, randomUtxo } from 'cashscript';
import {
  binToHex,
  createVirtualMachineBch2026,
  decodeAuthenticationInstructions,
  decodeTransactionUnsafe,
  hash160,
  hexToBin,
  importMetadataRegistry,
  sha256,
  utf8ToBin,
} from '@bitauth/libauth';
import {
  MARKER_PARSE_BYTECODE,
  REGISTRY_DOMAIN,
  buildOfferGenesisTransaction,
  buildOfferRegistry,
  buildPublishNftOfferTransaction,
  encodeBcmrPublication,
  findMinterUtxos,
  markerCommitment,
  offerMinter,
  pkhToCashAddress,
  registryBytes,
  type OfferDocument,
} from '../src/protocol/index.js';

const key = new SignatureTemplate(sha256.hash(utf8ToBin('campfire-genesis-test')));
const pkh = hash160(key.publicKey);
const address = pkhToCashAddress(pkh);
const CATEGORY = 'ab'.repeat(32);
const REVISION = '2026-11-21T00:00:00.000Z';

/** Runs the parse bytecode the way a BCMR client does and returns the altstack, bottom first. */
function parseNft(commitment: string, bytecode = MARKER_PARSE_BYTECODE): string[] {
  const vm = createVirtualMachineBch2026();
  const zero = new Uint8Array(32);
  const transaction = {
    version: 2,
    locktime: 0,
    inputs: [
      { outpointTransactionHash: sha256.hash(zero), outpointIndex: 0, sequenceNumber: 0, unlockingBytecode: new Uint8Array() },
      { outpointTransactionHash: zero, outpointIndex: 0, sequenceNumber: 0, unlockingBytecode: Uint8Array.of(0x51) },
    ],
    outputs: [{ lockingBytecode: Uint8Array.of(0x6a), valueSatoshis: 0n }],
  };
  const sourceOutputs = [
    {
      lockingBytecode: hexToBin(`76a914${binToHex(pkh)}88ac`),
      valueSatoshis: 1000n,
      token: { category: hexToBin(CATEGORY), amount: 0n, nft: { capability: 'none' as const, commitment: hexToBin(commitment) } },
    },
    { lockingBytecode: hexToBin(bytecode), valueSatoshis: 0n },
  ];
  const state = vm.evaluate({ inputIndex: 1, sourceOutputs, transaction });
  if (state.error || state.stack.length !== 1) throw new Error(state.error ?? 'Parsing left more than one stack item');
  return state.alternateStack.map((item) => binToHex(item));
}

describe('offer registry', () => {
  it('is a valid BCMR whose texts are in English and whose NFT types match the side byte', () => {
    const registry = buildOfferRegistry({ category: CATEGORY, revision: REVISION });
    const imported = importMetadataRegistry(JSON.parse(new TextDecoder().decode(registryBytes(registry))));
    expect(typeof imported).not.toBe('string');
    const snapshot = registry.identities![CATEGORY][REVISION];
    expect(snapshot.name).toBe('Campfire offer');
    const types = snapshot.token!.nfts!.parse.types;
    expect(Object.keys(types)).toEqual(['01', '02']);
    expect(types['01'].name).toBe('Sell offer');
    expect(types['02'].name).toBe('Buy offer');
  });

  it('parses a marker into its type and the offer hash, as a wallet would', () => {
    const hash = binToHex(sha256.hash(utf8ToBin('{"v":1}')));
    expect(parseNft(markerCommitment('sell', hash))).toEqual(['01', hash]);
    expect(parseNft(markerCommitment('buy', hash))).toEqual(['02', hash]);
    // The example bytecode in libauth's BCMR types (0xd2 = OP_OUTPUTTOKENCOMMITMENT, one OP_TOALTSTACK) cannot parse it.
    expect(() => parseNft(markerCommitment('sell', hash), '00d2517f7c6b')).toThrow();
  });

  it('encodes the publication output with the registry hash in OP_SHA256 order and the bare domain', () => {
    const bytes = registryBytes(buildOfferRegistry({ category: CATEGORY, revision: REVISION }));
    const out = encodeBcmrPublication(bytes);
    expect(binToHex(out).startsWith('6a0442434d5220')).toBe(true);
    const pushes = decodeAuthenticationInstructions(out).slice(1) as { data: Uint8Array }[];
    expect(binToHex(pushes[1].data)).toBe(binToHex(sha256.hash(bytes)));
    expect(new TextDecoder().decode(pushes[2].data)).toBe(REGISTRY_DOMAIN);
  });
});

describe('offer category genesis', () => {
  it('creates the minters at the covenant, publishes the registry, and the minters then publish offers', async () => {
    const provider = new MockNetworkProvider();
    provider.network = Network.MAINNET;
    const authbase = provider.addUtxo(address, randomUtxo({ satoshis: 20_000n, vout: 0 }));
    const signer = { ...authbase, pathName: 'receive' as const, keyIndex: 0, address, signer: key };
    const registry = registryBytes(buildOfferRegistry({ category: authbase.txid, revision: REVISION }));
    const genesis = buildOfferGenesisTransaction({
      provider, authbase: signer, identityAddress: address, changeAddress: address, registry, minters: 3,
    });
    expect(genesis.category).toBe(authbase.txid);
    const tx = decodeTransactionUnsafe(hexToBin(genesis.hex));
    expect(tx.outputs[0].token).toBeUndefined();
    expect(tx.outputs.slice(1, 4).map((o) => o.token?.nft?.capability)).toEqual(['minting', 'minting', 'minting']);
    expect(binToHex(tx.outputs[4].lockingBytecode)).toBe(binToHex(encodeBcmrPublication(registry)));
    await genesis.builder.send();

    const minters = await findMinterUtxos(provider, genesis.category);
    expect(minters).toHaveLength(3);

    const doc: OfferDocument = {
      v: 1, side: 'buy', asset: 'BCH', assetDecimals: 8, fiat: 'USD',
      price: { type: 'fixed', value: '450' }, min: '100000', max: '200000', paymentMethods: ['cash'],
      paymentWindowSec: 3600, expiresAt: 1_795_000_000, arbiter: binToHex(key.publicKey),
    };
    const coins = provider.addUtxo(address, randomUtxo({ satoshis: 50_000n }));
    const pub = buildPublishNftOfferTransaction({
      provider, document: doc, minterUtxo: minters[0], markerAddress: pkhToCashAddress(pkh, { tokenAware: true }), changeAddress: address,
      utxos: [{ ...coins, pathName: 'receive', keyIndex: 0, address, signer: key }],
    });
    await pub.builder.send();
    expect(await findMinterUtxos(provider, genesis.category)).toHaveLength(3);
    expect(offerMinter(provider).tokenAddress).toMatch(/^bitcoincash:r/);
  });
});
