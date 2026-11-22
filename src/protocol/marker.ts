// Version-2 offer markers: an immutable NFT of the Campfire offer category, minted by the minter covenant
// (contracts/CampfireOfferMinter.cash) in the transaction that publishes the offer (protocol section 3.4).

import { binToHex, cashAddressToLockingBytecode } from '@bitauth/libauth';
import { Contract, TransactionBuilder, gatherBchUtxos, type Artifact, type NetworkProvider, type Utxo } from 'cashscript';
import artifactJson from '../../contracts/CampfireOfferMinter.json' with { type: 'json' };
import {
  formatWalletTransactionRequest,
  isBytes32Hex,
  toUnlockableWalletUtxo,
  type WalletSpendableUtxo,
  type WalletTransactionRequest,
} from './keys.js';
import {
  FORMAT_VERSION_NFT,
  MARKER_SATOSHIS,
  encodeOfferOpReturn,
  hashOfferJson,
  validateOfferDocument,
  type OfferDocument,
  type OfferSide,
  type PublishOfferTransactionResult,
} from './offers.js';

export const minterArtifact = artifactJson as unknown as Artifact;

/**
 * The receive index of a publisher's identity address: every NFT marker of the wallet goes there, so its offers are
 * linked to one address (a public history of offers), while trades keep using fresh keys and addresses.
 */
export const IDENTITY_RECEIVE_INDEX = 0;

/** The first byte of a marker's commitment. */
export const SIDE_BYTE: Record<OfferSide, number> = { sell: 0x01, buy: 0x02 };

/** The minter covenant. It takes no parameters, so there is one minter address per network. */
export function offerMinter(provider: NetworkProvider): Contract {
  return new Contract(minterArtifact, [], { provider });
}

/** `<side byte> <offer content hash>`, 33 bytes as hex. */
export function markerCommitment(side: OfferSide, contentHash: string): string {
  if (!isBytes32Hex(contentHash)) throw new Error('Offer content hash must be 32 bytes of hex');
  return `0${SIDE_BYTE[side]}${contentHash.toLowerCase()}`;
}

export function parseMarkerCommitment(commitment: string): { side: OfferSide; contentHash: string } | null {
  const hex = commitment.toLowerCase();
  if (!/^0[12][0-9a-f]{64}$/.test(hex)) return null;
  return { side: hex.startsWith('01') ? 'sell' : 'buy', contentHash: hex.slice(2) };
}

/** True for a UTXO that holds a marker NFT of the category (immutable, any commitment). */
export function isMarkerUtxo(utxo: Pick<Utxo, 'token'>, category: string): boolean {
  return utxo.token?.category.toLowerCase() === category.toLowerCase() && utxo.token.nft?.capability === 'none';
}

/** The minter UTXOs of a category at the covenant, in random order so that publishers rarely pick the same one. */
export async function findMinterUtxos(provider: NetworkProvider, category: string): Promise<Utxo[]> {
  const utxos = await provider.getUtxos(offerMinter(provider).tokenAddress);
  return utxos
    .filter((u) => u.token?.category.toLowerCase() === category.toLowerCase() && u.token.nft?.capability === 'minting' && u.token.amount === 0n)
    .map((u) => ({ u, r: Math.random() }))
    .sort((a, b) => a.r - b.r)
    .map(({ u }) => u);
}

/**
 * The version-2 offer transaction (protocol section 3.4):
 * input 0 = a minter UTXO, inputs 1… = the publisher's BCH coins;
 * output 0 = OP_RETURN (format 2), output 1 = the marker NFT, output 2 = the minter, output 3 = optional change.
 */
export function buildPublishNftOfferTransaction(params: {
  provider: NetworkProvider;
  document: OfferDocument;
  offerJson?: string;
  utxos: WalletSpendableUtxo[];
  minterUtxo: Utxo;
  /** A token-aware (`z…`) address of the publisher. */
  markerAddress: string;
  changeAddress: string;
  feeRate?: number;
  broadcast?: boolean;
}): PublishOfferTransactionResult {
  const offerJson = params.offerJson ?? JSON.stringify(params.document);
  const parsed = JSON.parse(offerJson) as OfferDocument;
  validateOfferDocument(parsed);
  const minter = params.minterUtxo;
  if (!minter.token?.nft || minter.token.nft.capability !== 'minting') throw new Error('Minter UTXO holds no minting NFT');

  const contentHashBytes = hashOfferJson(offerJson);
  const contentHash = binToHex(contentHashBytes);
  const opReturnBytecode = encodeOfferOpReturn({
    arbiterPk: parsed.arbiter,
    oraclePk: parsed.oracle,
    contentHash: contentHashBytes,
    version: FORMAT_VERSION_NFT,
  });

  // The marker, the minter's ~150-byte unlocking script and the rest of the transaction, at 1 sat/byte with room.
  const bchPool = params.utxos.filter((u) => !u.token);
  const { utxos: selected } = gatherBchUtxos(bchPool, MARKER_SATOSHIS + 1500n);
  const contract = offerMinter(params.provider);

  const minterLock = cashAddressToLockingBytecode(contract.tokenAddress);
  if (typeof minterLock === 'string') throw new Error(minterLock);
  const builder = new TransactionBuilder({ provider: params.provider })
    .addInput({ ...minter, lockingBytecode: binToHex(minterLock.bytecode) }, contract.unlock.mint())
    .addInputs(selected.map(toUnlockableWalletUtxo))
    .addOutput({ to: opReturnBytecode, amount: 0n })
    .addOutput({
      to: params.markerAddress,
      amount: MARKER_SATOSHIS,
      token: { category: minter.token.category, amount: 0n, nft: { capability: 'none', commitment: markerCommitment(parsed.side, contentHash) } },
    })
    .addOutput({ to: contract.tokenAddress, amount: minter.satoshis, token: minter.token })
    .addBchChangeOutputIfNeeded({ to: params.changeAddress, feeRate: params.feeRate ?? 1.0 });

  const formatted = formatWalletTransactionRequest(builder, selected, 'Campfire: publish offer', params.broadcast ?? false, 1);
  return { ...formatted, offerJson, contentHash, opReturnBytecode };
}

/** Closes a version-2 offer: spends the marker NFT without passing it on (burns it) and keeps the BCH. */
export function buildCloseNftOfferTransaction(params: {
  provider: NetworkProvider;
  markerUtxo: WalletSpendableUtxo;
  destinationAddress: string;
  category: string;
  feeRate?: number;
  broadcast?: boolean;
}): WalletTransactionRequest {
  if (!isMarkerUtxo(params.markerUtxo, params.category)) throw new Error('UTXO is not an offer marker NFT');
  const unlockable = toUnlockableWalletUtxo(params.markerUtxo);
  const make = (fee: bigint) =>
    new TransactionBuilder({ provider: params.provider })
      .addInputs([unlockable])
      .addOutput({ to: params.destinationAddress, amount: params.markerUtxo.satoshis - fee });
  const size = make(200n).getTransactionSize();
  const builder = make(BigInt(Math.ceil(Number(size) * (params.feeRate ?? 1.0))));
  return formatWalletTransactionRequest(builder, [params.markerUtxo], 'Campfire: close offer', params.broadcast ?? false);
}

