// Offer OP_RETURN encoding, JSON validation and content-hash verification (protocol section 3).

import {
  binToHex,
  binToUtf8,
  decodeAuthenticationInstructions,
  hexToBin,
  sha256,
  utf8ToBin,
} from '@bitauth/libauth';
import {
  TransactionBuilder,
  gatherBchUtxos,
  type NetworkProvider,
} from 'cashscript';
import {
  formatWalletTransactionRequest,
  isBytes32Hex,
  isCompressedPubkeyHex,
  toBytes,
  toUnlockableWalletUtxo,
  type WalletSpendableUtxo,
  type WalletTransactionRequest,
} from './keys.js';

export const PROTOCOL_IDENTIFIER = 'CMPF';
export const FORMAT_VERSION = 1;
// On-chain format 2: the same offer JSON (still `v: 1`), with an NFT marker instead of a 1,000-sat one (section 3.4).
export const FORMAT_VERSION_NFT = 2;
export type OnChainFormatVersion = typeof FORMAT_VERSION | typeof FORMAT_VERSION_NFT;
export const MESSAGE_TYPE_OFFER = 1;
export const MARKER_SATOSHIS = 1000n;
export const OP_RETURN_MAX_BYTES = 223;

export const BCH_ASSET = 'BCH';
export const BCH_DECIMALS = 8;
export const PUSD_CATEGORY = '2469acc5afa4b10cb5b5c04afb89c3a3ffd61c5da9c01e26d00951cae2a02544';
export const PUSD_DECIMALS = 2;

/** The demo's payment method: the fiat payment is simulated, and only the service's demo seller answers it. */
export const SIMULATED_PAYMENT_METHOD = 'simulated';

/** The offer names the simulated payment, alone or next to real methods. */
export function namesSimulatedPayment(methods: readonly string[]): boolean {
  return methods.includes(SIMULATED_PAYMENT_METHOD);
}

/** The offer can only be paid in simulated fiat: a real counterparty would trade real coins for nothing. */
export function onlySimulatedPayment(methods: readonly string[]): boolean {
  return methods.length > 0 && methods.every((m) => m === SIMULATED_PAYMENT_METHOD);
}

export const ZERO_PUBKEY_HEX = '00'.repeat(33);
export const MIN_UNIX_TIMESTAMP = 500_000_000;

export type OfferPrice =
  | { type: 'fixed'; value: string }
  | { type: 'floating'; pair: string; marginBps: number };

// `sell`: the publisher sells and will lock the coins. `buy`: the publisher buys and a seller takes the offer.
// Whoever sells is always the one who deposits into the escrow, whichever side published (section 2.2).
export type OfferSide = 'sell' | 'buy';

export interface OfferDocument {
  v: 1;
  side: OfferSide;
  asset: string;
  assetDecimals: number;
  fiat: string;
  price: OfferPrice;
  min: string;
  max: string;
  paymentMethods: string[];
  paymentWindowSec: number;
  terms?: string;
  expiresAt: number;
  arbiter: string;
  oracle?: string;
}

export interface OfferOnChainRecord {
  version: OnChainFormatVersion;
  messageType: 1;
  arbiterPk: string;
  oraclePk: string | null;
  contentHash: string;
}

const POSITIVE_INT_RE = /^[1-9][0-9]*$/;
const DECIMAL_RE = /^(?:0|[1-9][0-9]*)(?:\.[0-9]+)?$/;
const FIAT_RE = /^[A-Z]{3}$/;

export function isPositiveDecimalString(value: string): boolean {
  if (!DECIMAL_RE.test(value)) return false;
  return Number(value) > 0;
}

export function validateOfferDocument(doc: OfferDocument): void {
  if (!doc || typeof doc !== 'object') {
    throw new Error('Offer document must be an object');
  }
  if (doc.v !== FORMAT_VERSION) {
    throw new Error(`Unsupported offer format version: ${String(doc.v)}`);
  }
  if (doc.side !== 'sell' && doc.side !== 'buy') {
    throw new Error(`Unsupported offer side: ${String(doc.side)}`);
  }
  if (doc.asset === BCH_ASSET) {
    if (doc.assetDecimals !== BCH_DECIMALS) {
      throw new Error(`BCH offers must use assetDecimals = ${BCH_DECIMALS}`);
    }
  } else if (isBytes32Hex(doc.asset)) {
    if (!Number.isInteger(doc.assetDecimals) || doc.assetDecimals < 0 || doc.assetDecimals > 18) {
      throw new Error(`Invalid token assetDecimals: ${String(doc.assetDecimals)}`);
    }
    if (doc.asset.toLowerCase() === PUSD_CATEGORY && doc.assetDecimals !== PUSD_DECIMALS) {
      throw new Error(`PUSD offers must use assetDecimals = ${PUSD_DECIMALS}`);
    }
  } else {
    throw new Error('Offer asset must be "BCH" or a 64-character hex token category ID');
  }

  if (!FIAT_RE.test(doc.fiat)) {
    throw new Error(`Offer fiat must be a 3-letter ISO 4217 code, got "${String(doc.fiat)}"`);
  }
  if (typeof doc.min !== 'string' || !POSITIVE_INT_RE.test(doc.min)) {
    throw new Error('Offer min must be a positive integer string in base units');
  }
  if (typeof doc.max !== 'string' || !POSITIVE_INT_RE.test(doc.max)) {
    throw new Error('Offer max must be a positive integer string in base units');
  }
  if (BigInt(doc.min) > BigInt(doc.max)) {
    throw new Error('Offer min cannot exceed max');
  }
  if (
    !Array.isArray(doc.paymentMethods) ||
    doc.paymentMethods.length === 0 ||
    doc.paymentMethods.some((m) => typeof m !== 'string' || m.trim().length === 0)
  ) {
    throw new Error('Offer paymentMethods must be a non-empty array of strings');
  }
  if (!Number.isInteger(doc.paymentWindowSec) || doc.paymentWindowSec <= 0) {
    throw new Error('Offer paymentWindowSec must be a positive integer');
  }
  if (doc.terms !== undefined && typeof doc.terms !== 'string') {
    throw new Error('Offer terms must be a string when present');
  }
  if (!Number.isInteger(doc.expiresAt) || doc.expiresAt < MIN_UNIX_TIMESTAMP) {
    throw new Error('Offer expiresAt must be a Unix timestamp (>= 500,000,000)');
  }
  if (!isCompressedPubkeyHex(doc.arbiter)) {
    throw new Error('Offer arbiter must be a compressed 33-byte secp256k1 public key in hex');
  }

  if (!doc.price || typeof doc.price !== 'object') {
    throw new Error('Offer price is required');
  }
  if (doc.price.type === 'fixed') {
    if (!isPositiveDecimalString(doc.price.value)) {
      throw new Error('Fixed-price offer value must be a positive decimal string');
    }
    if (doc.oracle !== undefined) {
      throw new Error('Fixed-price offers must omit the oracle field');
    }
  } else if (doc.price.type === 'floating') {
    if (typeof doc.price.pair !== 'string' || doc.price.pair.trim().length === 0) {
      throw new Error('Floating-price offer must specify a non-empty pair');
    }
    if (!Number.isInteger(doc.price.marginBps) || doc.price.marginBps <= -10_000) {
      throw new Error('Floating-price offer marginBps must be an integer greater than -10000');
    }
    if (!doc.oracle || !isCompressedPubkeyHex(doc.oracle)) {
      throw new Error('Floating-price offers require a valid compressed oracle public key');
    }
  } else {
    throw new Error('Offer price.type must be "fixed" or "floating"');
  }
}

// Computes the SHA-256 of the exact JSON bytes.
export function hashOfferJson(jsonBytesOrString: Uint8Array | string): Uint8Array {
  const bytes = typeof jsonBytesOrString === 'string' ? utf8ToBin(jsonBytesOrString) : jsonBytesOrString;
  return sha256.hash(bytes);
}

// Prepends the 4-byte CIDv1 header (version 1, raw codec 0x55, sha2-256 0x12, 32-byte length 0x20)
// to the 32-byte SHA-256 offer hash so the same digest can be addressed on IPFS without re-hashing.
export function offerHashToCidV1Bytes(contentHash: Uint8Array | string): Uint8Array {
  const digest = toBytes(contentHash, 'contentHash');
  if (digest.length !== 32) {
    throw new Error(`Expected 32-byte SHA-256 digest, got ${digest.length} bytes`);
  }
  return Uint8Array.from([0x01, 0x55, 0x12, 0x20, ...digest]);
}

function directPush(data: Uint8Array): Uint8Array {
  if (data.length < 1 || data.length > 75) {
    throw new Error(`Direct push length out of range: ${data.length}`);
  }
  return Uint8Array.from([data.length, ...data]);
}

// Builds the offer OP_RETURN locking bytecode (protocol section 3.1):
// OP_RETURN <"CMPF"> <0x01> <0x01> <arbiterPk 33B> <oraclePk 33B | 33 zero bytes> <contentHash 32B>
export function encodeOfferOpReturn(params: {
  arbiterPk: Uint8Array | string;
  oraclePk?: Uint8Array | string | null;
  contentHash: Uint8Array | string;
  version?: OnChainFormatVersion;
}): Uint8Array {
  const arbiterHex = binToHex(toBytes(params.arbiterPk, 'arbiterPk'));
  if (!isCompressedPubkeyHex(arbiterHex)) {
    throw new Error('Invalid arbiter public key');
  }
  const arbiterBytes = hexToBin(arbiterHex);

  let oracleBytes: Uint8Array;
  if (!params.oraclePk || params.oraclePk === ZERO_PUBKEY_HEX) {
    oracleBytes = new Uint8Array(33);
  } else {
    const oracleHex = binToHex(toBytes(params.oraclePk, 'oraclePk'));
    if (oracleHex === ZERO_PUBKEY_HEX) {
      oracleBytes = new Uint8Array(33);
    } else if (isCompressedPubkeyHex(oracleHex)) {
      oracleBytes = hexToBin(oracleHex);
    } else {
      throw new Error('Invalid oracle public key');
    }
  }

  const hashBytes = toBytes(params.contentHash, 'contentHash');
  if (hashBytes.length !== 32) {
    throw new Error(`Offer contentHash must be 32 bytes, got ${hashBytes.length}`);
  }

  const pushes = [
    utf8ToBin(PROTOCOL_IDENTIFIER),
    Uint8Array.from([params.version ?? FORMAT_VERSION]),
    Uint8Array.from([MESSAGE_TYPE_OFFER]),
    arbiterBytes,
    oracleBytes,
    hashBytes,
  ];
  const encodedPushes = pushes.flatMap((chunk) => [...directPush(chunk)]);
  const script = Uint8Array.from([0x6a, ...encodedPushes]);
  if (script.length > OP_RETURN_MAX_BYTES) {
    throw new Error(`OP_RETURN exceeds ${OP_RETURN_MAX_BYTES} bytes`);
  }
  return script;
}

function extractPushBytes(instruction: { opcode: number; data?: Uint8Array }): Uint8Array {
  if (instruction.data instanceof Uint8Array) {
    return instruction.data;
  }
  // Support minimal-push opcodes OP_1..OP_16 (0x51..0x60) for 1-byte integers.
  if (instruction.opcode >= 0x51 && instruction.opcode <= 0x60) {
    return Uint8Array.from([instruction.opcode - 0x50]);
  }
  throw new Error(`Unexpected non-push opcode 0x${instruction.opcode.toString(16)} in OP_RETURN`);
}

// Parses and validates the six data pushes of an offer OP_RETURN locking bytecode.
export function decodeOfferOpReturn(bytecode: Uint8Array | string): OfferOnChainRecord {
  const bytes = toBytes(bytecode, 'opReturnBytecode');
  if (bytes.length > OP_RETURN_MAX_BYTES) {
    throw new Error(`OP_RETURN bytecode exceeds ${OP_RETURN_MAX_BYTES}-byte standardness limit`);
  }
  const instructions = decodeAuthenticationInstructions(bytes);
  if (instructions.length !== 7 || instructions[0].opcode !== 0x6a) {
    throw new Error('Expected OP_RETURN followed by 6 data pushes');
  }
  const [, idInst, verInst, typeInst, arbiterInst, oracleInst, hashInst] = instructions as {
    opcode: number;
    data?: Uint8Array;
  }[];

  const protocolId = binToUtf8(extractPushBytes(idInst));
  if (protocolId !== PROTOCOL_IDENTIFIER) {
    throw new Error(`Unexpected protocol identifier: "${protocolId}"`);
  }
  const versionBytes = extractPushBytes(verInst);
  if (versionBytes.length !== 1 || (versionBytes[0] !== FORMAT_VERSION && versionBytes[0] !== FORMAT_VERSION_NFT)) {
    throw new Error(`Unsupported on-chain format version`);
  }
  const typeBytes = extractPushBytes(typeInst);
  if (typeBytes.length !== 1 || typeBytes[0] !== MESSAGE_TYPE_OFFER) {
    throw new Error(`Unsupported on-chain message type`);
  }

  const arbiterHex = binToHex(extractPushBytes(arbiterInst)).toLowerCase();
  if (!isCompressedPubkeyHex(arbiterHex)) {
    throw new Error('Invalid on-chain arbiter public key');
  }

  const oracleHex = binToHex(extractPushBytes(oracleInst)).toLowerCase();
  let oraclePk: string | null;
  if (oracleHex === ZERO_PUBKEY_HEX) {
    oraclePk = null;
  } else if (isCompressedPubkeyHex(oracleHex)) {
    oraclePk = oracleHex;
  } else {
    throw new Error('Invalid on-chain oracle public key');
  }

  const contentHash = binToHex(extractPushBytes(hashInst)).toLowerCase();
  if (!isBytes32Hex(contentHash)) {
    throw new Error('Invalid on-chain offer content hash');
  }

  return {
    version: versionBytes[0] as OnChainFormatVersion,
    messageType: MESSAGE_TYPE_OFFER,
    arbiterPk: arbiterHex,
    oraclePk,
    contentHash,
  };
}

// Verifies that the raw offer JSON bytes match the OP_RETURN hash, version, arbiter and oracle keys.
export function verifyOfferAgainstOpReturn(
  jsonBytesOrString: Uint8Array | string,
  opReturnBytecode: Uint8Array | string,
): { document: OfferDocument; onChain: OfferOnChainRecord; contentHash: string } {
  const bytes = typeof jsonBytesOrString === 'string' ? utf8ToBin(jsonBytesOrString) : jsonBytesOrString;
  const contentHash = binToHex(hashOfferJson(bytes)).toLowerCase();
  const onChain = decodeOfferOpReturn(opReturnBytecode);

  if (contentHash !== onChain.contentHash) {
    throw new Error('Offer JSON SHA-256 does not match the on-chain OP_RETURN hash');
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(binToUtf8(bytes));
  } catch {
    throw new Error('Offer document is not valid UTF-8 JSON');
  }
  const document = parsed as OfferDocument;
  validateOfferDocument(document);

  // Both on-chain formats carry the version-1 JSON; format 2 changes only the marker.
  if (document.v !== FORMAT_VERSION) {
    throw new Error('Offer JSON version does not match on-chain version');
  }
  if (document.arbiter.toLowerCase() !== onChain.arbiterPk) {
    throw new Error('Offer JSON arbiter key does not match on-chain arbiter key');
  }
  const docOracle = document.oracle ? document.oracle.toLowerCase() : null;
  if (docOracle !== onChain.oraclePk) {
    throw new Error('Offer JSON oracle key does not match on-chain oracle key');
  }

  return { document, onChain, contentHash };
}

export interface PublishOfferTransactionResult extends WalletTransactionRequest {
  offerJson: string;
  contentHash: string;
  opReturnBytecode: Uint8Array;
}

// Builds an offer publication transaction (protocol section 3.1):
// output 0 = OP_RETURN, output 1 = 1,000-sat marker output, output 2 = optional BCH change.
export function buildPublishOfferTransaction(params: {
  provider: NetworkProvider;
  document: OfferDocument;
  offerJson?: string;
  utxos: WalletSpendableUtxo[];
  markerAddress: string;
  changeAddress: string;
  feeRate?: number;
  broadcast?: boolean;
}): PublishOfferTransactionResult {
  const offerJson = params.offerJson ?? JSON.stringify(params.document);
  const parsed = JSON.parse(offerJson) as OfferDocument;
  validateOfferDocument(parsed);

  const contentHashBytes = hashOfferJson(offerJson);
  const contentHash = binToHex(contentHashBytes).toLowerCase();
  const opReturnBytecode = encodeOfferOpReturn({
    arbiterPk: parsed.arbiter,
    oraclePk: parsed.oracle,
    contentHash: contentHashBytes,
  });

  const feeRate = params.feeRate ?? 1.0;
  // Estimate 1,000-sat marker + ~500 sats for OP_RETURN, marker, change and input; fall back to MARKER_SATOSHIS + 300n.
  const bchPool = params.utxos.filter((u) => !u.token);
  const totalAvailable = bchPool.reduce((sum, u) => sum + u.satoshis, 0n);
  const target = totalAvailable >= MARKER_SATOSHIS + 1000n ? MARKER_SATOSHIS + 1000n : MARKER_SATOSHIS + 300n;
  const { utxos: selected } = gatherBchUtxos(bchPool, target);

  const builder = new TransactionBuilder({ provider: params.provider })
    .addInputs(selected.map(toUnlockableWalletUtxo))
    .addOutput({ to: opReturnBytecode, amount: 0n })
    .addOutput({ to: params.markerAddress, amount: MARKER_SATOSHIS })
    .addBchChangeOutputIfNeeded({ to: params.changeAddress, feeRate });

  const formatted = formatWalletTransactionRequest(
    builder,
    selected,
    'Campfire: publish offer',
    params.broadcast ?? false,
  );
  return {
    ...formatted,
    offerJson,
    contentHash,
    opReturnBytecode,
  };
}

// Builds a transaction that closes an open offer by spending its 1,000-sat marker output (protocol section 2.1).
// The 1,000-sat marker output covers its own ~192-sat miner fee and leaves ~808 sats (above the 546-sat P2PKH dust limit).
export function buildCloseOfferTransaction(params: {
  provider: NetworkProvider;
  markerUtxo: WalletSpendableUtxo;
  destinationAddress: string;
  feeRate?: number;
  broadcast?: boolean;
}): WalletTransactionRequest {
  if (params.markerUtxo.token) {
    throw new Error('Offer marker UTXO must not carry tokens');
  }
  const feeRate = params.feeRate ?? 1.0;
  const unlockable = toUnlockableWalletUtxo(params.markerUtxo);

  const make = (fee: bigint) =>
    new TransactionBuilder({ provider: params.provider })
      .addInputs([unlockable])
      .addOutput({ to: params.destinationAddress, amount: params.markerUtxo.satoshis - fee });

  const size = make(200n).getTransactionSize();
  const fee = BigInt(Math.ceil(Number(size) * feeRate));
  const builder = make(fee);

  return formatWalletTransactionRequest(
    builder,
    [params.markerUtxo],
    'Campfire: close offer',
    params.broadcast ?? false,
  );
}

