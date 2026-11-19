// Identity, HD public-key derivation and CashAddress helpers (protocol sections 1 and 5).

import {
  binToHex,
  decodeCashAddress,
  decodeHdPublicKey,
  deriveHdPublicNodeChild,
  encodeCashAddress,
  hash160,
  hexToBin,
  secp256k1,
  sha256,
  stringify,
  utf8ToBin,
} from '@bitauth/libauth';
import {
  placeholderP2PKHUnlocker,
  type SignatureTemplate,
  type SpendableUtxo,
  type TransactionBuilder,
  type UnlockableUtxo,
} from 'cashscript';

export const WALLET_PATHS = ['receive', 'change', 'defi'] as const;
export type WalletPathName = (typeof WALLET_PATHS)[number];

const HEX_RE = /^[0-9a-f]+$/i;

export function toBytes(value: Uint8Array | string, label = 'bytes'): Uint8Array {
  if (value instanceof Uint8Array) return value;
  const clean = value.startsWith('0x') ? value.slice(2) : value;
  if (clean.length % 2 !== 0 || (clean.length > 0 && !HEX_RE.test(clean))) {
    throw new Error(`Invalid hex string for ${label}`);
  }
  return hexToBin(clean);
}

export function isCompressedPubkeyHex(hex: string): boolean {
  if (typeof hex !== 'string' || hex.length !== 66 || !HEX_RE.test(hex)) return false;
  return secp256k1.validatePublicKey(hexToBin(hex));
}

export function isBytes20Hex(hex: string): boolean {
  return typeof hex === 'string' && hex.length === 40 && HEX_RE.test(hex);
}

export function isBytes32Hex(hex: string): boolean {
  return typeof hex === 'string' && hex.length === 64 && HEX_RE.test(hex);
}

// A user's identity is the SHA-256 of the `defi` extended public key shared on connection.
export function identityFromDefiXpub(defiXpub: string): string {
  const trimmed = defiXpub.trim();
  const decoded = decodeHdPublicKey(trimmed);
  if (typeof decoded === 'string') {
    throw new Error(`Invalid extended public key: ${decoded}`);
  }
  return binToHex(sha256.hash(utf8ToBin(trimmed)));
}

// Derives a child compressed public key at an unhardened index from an extended public key.
// Decoding an xpub (base58 and its checksum) costs about a third of deriving one address, and a wallet scan
// derives hundreds from the same few xpubs, so the decoded node is kept. A handful of xpubs is all a page uses.
const decodedXpubs = new Map<string, ReturnType<typeof decodeXpubNode>>();
const MAX_DECODED_XPUBS = 16;
function decodeXpubNode(xpub: string) {
  const decoded = decodeHdPublicKey(xpub);
  if (typeof decoded === 'string') {
    throw new Error(`Invalid extended public key: ${decoded}`);
  }
  return decoded.node;
}

export function derivePubkeyFromXpub(xpub: string, index: number): Uint8Array {
  if (!Number.isInteger(index) || index < 0 || index >= 0x80000000) {
    throw new Error(`Invalid derivation index: ${index}`);
  }
  const key = xpub.trim();
  let node = decodedXpubs.get(key);
  if (!node) {
    node = decodeXpubNode(key);
    if (decodedXpubs.size >= MAX_DECODED_XPUBS) decodedXpubs.clear();
    decodedXpubs.set(key, node);
  }
  const child = deriveHdPublicNodeChild(node, index);
  if (typeof child === 'string') {
    throw new Error(`Failed to derive child public key: ${child}`);
  }
  return child.publicKey;
}

// Derives the 20-byte hash160 of a receive key for use as a payout P2PKH parameter.
export function derivePayoutPkhFromXpub(receiveXpub: string, index: number): Uint8Array {
  return hash160(derivePubkeyFromXpub(receiveXpub, index));
}

// Wallets sign without checking that the derived key matches the contract parameter,
// so the service verifies that sellerPk / buyerPk derive from the stated defi index.
export function verifyDerivedPubkey(xpub: string, index: number, pubkey: Uint8Array | string): boolean {
  try {
    const expected = binToHex(derivePubkeyFromXpub(xpub, index));
    const actual = binToHex(toBytes(pubkey, 'pubkey'));
    return expected === actual;
  } catch {
    return false;
  }
}

// Verifies that a payout hash belongs to the wallet's receive extended public key at `index`.
export function verifyDerivedPayoutPkh(receiveXpub: string, index: number, pkh: Uint8Array | string): boolean {
  try {
    const expected = binToHex(derivePayoutPkhFromXpub(receiveXpub, index));
    const actual = binToHex(toBytes(pkh, 'payoutPkh'));
    return expected === actual;
  } catch {
    return false;
  }
}

export type CashAddressPrefix = 'bitcoincash' | 'bchtest' | 'bchreg';

// Converts a 20-byte public-key hash to a P2PKH CashAddress (`q...` or token-aware `z...`).
export function pkhToCashAddress(
  pkh: Uint8Array | string,
  options: { tokenAware?: boolean; prefix?: CashAddressPrefix } = {},
): string {
  const payload = toBytes(pkh, 'payoutPkh');
  if (payload.length !== 20) {
    throw new Error(`Expected 20-byte payout hash, got ${payload.length} bytes`);
  }
  const encoded = encodeCashAddress({
    prefix: options.prefix ?? 'bitcoincash',
    type: options.tokenAware ? 'p2pkhWithTokens' : 'p2pkh',
    payload,
  });
  if (typeof encoded === 'string') {
    throw new Error(`Failed to encode CashAddress: ${encoded}`);
  }
  return encoded.address;
}

// Extracts the 20-byte public-key hash from a P2PKH (`q...` or `z...`) CashAddress.
export function cashAddressToPkh(
  address: string,
  expectedPrefix: CashAddressPrefix = 'bitcoincash',
): Uint8Array {
  const decoded = decodeCashAddress(address);
  if (typeof decoded === 'string') {
    throw new Error(`Invalid CashAddress: ${decoded}`);
  }
  if (decoded.prefix !== expectedPrefix) {
    throw new Error(`Expected network prefix ${expectedPrefix}, got ${decoded.prefix}`);
  }
  if (decoded.type !== 'p2pkh' && decoded.type !== 'p2pkhWithTokens') {
    throw new Error(`Expected P2PKH address, got ${decoded.type}`);
  }
  if (decoded.payload.length !== 20) {
    throw new Error(`Expected 20-byte P2PKH payload, got ${decoded.payload.length} bytes`);
  }
  return decoded.payload;
}

// Builds the 25-byte P2PKH locking bytecode `OP_DUP OP_HASH160 <20-byte pkh> OP_EQUALVERIFY OP_CHECKSIG`.
export function pkhToLockingBytecode(pkh: Uint8Array | string): Uint8Array {
  const payload = toBytes(pkh, 'payoutPkh');
  if (payload.length !== 20) {
    throw new Error(`Expected 20-byte payout hash, got ${payload.length} bytes`);
  }
  return Uint8Array.from([0x76, 0xa9, 0x14, ...payload, 0x88, 0xac]);
}

export interface WalletSpendableUtxo extends SpendableUtxo {
  pathName: WalletPathName;
  keyIndex: number;
  address: string;
  signer?: SignatureTemplate;
}

export interface WalletAddressEntry {
  pathName: WalletPathName;
  keyIndex: number;
  pubkeyHex: string;
  pkhHex: string;
  address: string;
  tokenAddress: string;
  lockingBytecodeHex: string;
}

// Derives a map from P2PKH lockingBytecode (hex) to wallet path/index metadata for `receive` and `change`.
export function deriveWalletAddressMap(params: {
  receiveXpub: string;
  changeXpub?: string;
  count?: number;
  prefix?: CashAddressPrefix;
}): Map<string, WalletAddressEntry> {
  const count = params.count ?? 20;
  const prefix = params.prefix ?? 'bitcoincash';
  const map = new Map<string, WalletAddressEntry>();

  const branches: [WalletPathName, string][] = [['receive', params.receiveXpub]];
  if (params.changeXpub) {
    branches.push(['change', params.changeXpub]);
  }

  for (const [pathName, xpub] of branches) {
    for (let i = 0; i < count; i++) {
      const pubkey = derivePubkeyFromXpub(xpub, i);
      const pkh = hash160(pubkey);
      const lockingBytecodeHex = binToHex(pkhToLockingBytecode(pkh));
      map.set(lockingBytecodeHex, {
        pathName,
        keyIndex: i,
        pubkeyHex: binToHex(pubkey),
        pkhHex: binToHex(pkh),
        address: pkhToCashAddress(pkh, { prefix, tokenAware: false }),
        tokenAddress: pkhToCashAddress(pkh, { prefix, tokenAware: true }),
        lockingBytecodeHex,
      });
    }
  }
  return map;
}

// Tags raw network UTXOs with their wallet derivation path and index using an address map.
export function tagWalletUtxos(
  utxos: SpendableUtxo[],
  addressMap: Map<string, WalletAddressEntry>,
): WalletSpendableUtxo[] {
  const tagged: WalletSpendableUtxo[] = [];
  for (const utxo of utxos) {
    const entry = addressMap.get(utxo.lockingBytecode.toLowerCase());
    if (entry) {
      tagged.push({
        ...utxo,
        pathName: entry.pathName,
        keyIndex: entry.keyIndex,
        address: entry.address,
      });
    }
  }
  return tagged;
}

export function toUnlockableWalletUtxo(utxo: WalletSpendableUtxo): UnlockableUtxo {
  return {
    ...utxo,
    unlocker: utxo.signer ? utxo.signer.unlockP2PKH() : placeholderP2PKHUnlocker(utxo.address),
  };
}

export interface WalletTransactionRequest {
  builder: TransactionBuilder;
  hex: string;
  request: Record<string, unknown>;
  inputPaths: [number, WalletPathName, number][];
}

export function formatWalletTransactionRequest(
  builder: TransactionBuilder,
  inputs: WalletSpendableUtxo[],
  userPrompt: string,
  broadcast = false,
): WalletTransactionRequest {
  const hex = builder.build();
  const wc = builder.generateWcTransactionObject({ broadcast, userPrompt });
  const request = JSON.parse(stringify(wc)) as Record<string, unknown>;
  request.transaction = hex;
  const inputPaths: [number, WalletPathName, number][] = inputs.map((u, idx) => [
    idx,
    u.pathName,
    u.keyIndex,
  ]);
  return { builder, hex, request, inputPaths };
}

