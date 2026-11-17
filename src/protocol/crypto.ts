// Browser session keys, secp256k1 ECDH and AES-256-GCM encryption for payment details and chat (protocol section 6).

import {
  binToHex,
  binToUtf8,
  secp256k1,
  sha256,
  utf8ToBin,
} from '@bitauth/libauth';
import { toBytes } from './keys.js';

const TRADE_KEY_DOMAIN = 'CMPF-TRADE-KEY-v1';
const PAYMENT_KEY_DOMAIN = 'CMPF-PAYMENT-DETAILS-v1';
const PAYMENT_SIG_DOMAIN = 'CMPF-PAYMENT-DETAILS-SIG-v1';
const IV_BYTES = 12;

export interface SessionKeyPair {
  privateKey: string;
  publicKey: string;
}

export function generateSessionKeyPair(): SessionKeyPair {
  const privateKey = new Uint8Array(32);
  do {
    globalThis.crypto.getRandomValues(privateKey);
  } while (!secp256k1.validatePrivateKey(privateKey));

  const publicKey = secp256k1.derivePublicKeyCompressed(privateKey);
  if (typeof publicKey === 'string') {
    throw new Error(`Failed to derive session public key: ${publicKey}`);
  }
  return {
    privateKey: binToHex(privateKey),
    publicKey: binToHex(publicKey),
  };
}

function computeEcdhPoint(
  mySessionPrivateKey: Uint8Array | string,
  peerSessionPublicKey: Uint8Array | string,
): Uint8Array {
  const sk = toBytes(mySessionPrivateKey, 'sessionPrivateKey');
  const pk = toBytes(peerSessionPublicKey, 'sessionPublicKey');
  if (!secp256k1.validatePrivateKey(sk)) {
    throw new Error('Invalid session private key');
  }
  if (pk.length !== 33 || !secp256k1.validatePublicKey(pk)) {
    throw new Error('Invalid peer session public key');
  }
  const point = secp256k1.mulTweakPublicKeyCompressed(pk, sk);
  if (typeof point === 'string') {
    throw new Error(`ECDH key agreement failed: ${point}`);
  }
  return point;
}

// Derives the 32-byte symmetric trade key shared by buyer and seller for chat encryption.
// When a dispute is opened, either party can hand this 32-byte key to the arbiter.
export function deriveSharedTradeKey(
  mySessionPrivateKey: Uint8Array | string,
  peerSessionPublicKey: Uint8Array | string,
): Uint8Array {
  const sharedPoint = computeEcdhPoint(mySessionPrivateKey, peerSessionPublicKey);
  return sha256.hash(Uint8Array.from([...utf8ToBin(TRADE_KEY_DOMAIN), ...sharedPoint]));
}

// Derives a domain-separated 32-byte key for encrypting seller payment details to the buyer.
export function derivePaymentDetailsKey(
  mySessionPrivateKey: Uint8Array | string,
  peerSessionPublicKey: Uint8Array | string,
): Uint8Array {
  const sharedPoint = computeEcdhPoint(mySessionPrivateKey, peerSessionPublicKey);
  return sha256.hash(Uint8Array.from([...utf8ToBin(PAYMENT_KEY_DOMAIN), ...sharedPoint]));
}

async function importAesKey(rawKey: Uint8Array, usage: 'encrypt' | 'decrypt'): Promise<CryptoKey> {
  if (rawKey.length !== 32) {
    throw new Error(`Expected 32-byte AES-256 key, got ${rawKey.length} bytes`);
  }
  const keyBuffer = rawKey.buffer.slice(rawKey.byteOffset, rawKey.byteOffset + rawKey.byteLength) as ArrayBuffer;
  return globalThis.crypto.subtle.importKey('raw', keyBuffer, { name: 'AES-GCM' }, false, [usage]);
}

// Encrypts UTF-8 text with a 32-byte key using AES-256-GCM; returns `<12-byte iv hex>:<ciphertext+tag hex>`.
export async function encryptWithKey(key: Uint8Array | string, plaintext: string): Promise<string> {
  const rawKey = toBytes(key, 'aesKey');
  const cryptoKey = await importAesKey(rawKey, 'encrypt');
  const iv = new Uint8Array(IV_BYTES);
  globalThis.crypto.getRandomValues(iv);
  const data = utf8ToBin(plaintext);
  const plainBuffer = data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer;
  const cipherBuffer = await globalThis.crypto.subtle.encrypt({ name: 'AES-GCM', iv }, cryptoKey, plainBuffer);
  return `${binToHex(iv)}:${binToHex(new Uint8Array(cipherBuffer))}`;
}

// Decrypts an `<iv hex>:<ciphertext+tag hex>` payload produced by `encryptWithKey`.
export async function decryptWithKey(key: Uint8Array | string, payload: string): Promise<string> {
  const rawKey = toBytes(key, 'aesKey');
  const parts = payload.split(':');
  if (parts.length !== 2) {
    throw new Error('Invalid encrypted payload format');
  }
  const iv = toBytes(parts[0], 'iv');
  const ciphertext = toBytes(parts[1], 'ciphertext');
  if (iv.length !== IV_BYTES || ciphertext.length < 16) {
    throw new Error('Invalid IV or ciphertext length');
  }
  const cryptoKey = await importAesKey(rawKey, 'decrypt');
  const ivBuffer = iv.buffer.slice(iv.byteOffset, iv.byteOffset + iv.byteLength) as ArrayBuffer;
  const cipherBuffer = ciphertext.buffer.slice(
    ciphertext.byteOffset,
    ciphertext.byteOffset + ciphertext.byteLength,
  ) as ArrayBuffer;
  const plainBuffer = await globalThis.crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: ivBuffer },
    cryptoKey,
    cipherBuffer,
  );
  return binToUtf8(new Uint8Array(plainBuffer));
}

export async function encryptChatMessage(
  tradeKey: Uint8Array | string,
  message: string,
): Promise<string> {
  return encryptWithKey(tradeKey, message);
}

export async function decryptChatMessage(
  tradeKey: Uint8Array | string,
  payload: string,
): Promise<string> {
  return decryptWithKey(tradeKey, payload);
}

export async function encryptPaymentDetails(
  sellerSessionPrivateKey: Uint8Array | string,
  buyerSessionPublicKey: Uint8Array | string,
  details: string,
): Promise<string> {
  const key = derivePaymentDetailsKey(sellerSessionPrivateKey, buyerSessionPublicKey);
  return encryptWithKey(key, details);
}

export async function decryptPaymentDetails(
  buyerSessionPrivateKey: Uint8Array | string,
  sellerSessionPublicKey: Uint8Array | string,
  payload: string,
): Promise<string> {
  const key = derivePaymentDetailsKey(buyerSessionPrivateKey, sellerSessionPublicKey);
  return decryptWithKey(key, payload);
}

// The buyer can compute the same ECDH key as the seller, so encryption alone does not show who wrote the payment
// details. The seller therefore also signs the ciphertext with their session key, which is committed in the trade
// terms: the service, the buyer and an arbiter can all check that the details came from the seller.
function paymentDetailsMessageHash(tradeId: Uint8Array | string, ciphertext: string): Uint8Array {
  const id = toBytes(tradeId, 'tradeId');
  if (id.length !== 32) {
    throw new Error(`Expected 32-byte tradeId, got ${id.length} bytes`);
  }
  return sha256.hash(utf8ToBin(`${PAYMENT_SIG_DOMAIN}:${binToHex(id)}:${ciphertext}`));
}

export function signPaymentDetails(
  sellerSessionPrivateKey: Uint8Array | string,
  tradeId: Uint8Array | string,
  ciphertext: string,
): string {
  const sig = secp256k1.signMessageHashSchnorr(
    toBytes(sellerSessionPrivateKey, 'sellerSessionPrivateKey'),
    paymentDetailsMessageHash(tradeId, ciphertext),
  );
  if (typeof sig === 'string') {
    throw new Error(`Failed to sign payment details: ${sig}`);
  }
  return binToHex(sig);
}

export function verifyPaymentDetailsSignature(
  sellerSessionPublicKey: Uint8Array | string,
  tradeId: Uint8Array | string,
  ciphertext: string,
  signature: Uint8Array | string,
): boolean {
  try {
    const sig = toBytes(signature, 'paymentDetailsSignature');
    const pk = toBytes(sellerSessionPublicKey, 'sellerSessionPublicKey');
    if (sig.length !== 64 || pk.length !== 33 || !secp256k1.validatePublicKey(pk)) return false;
    return secp256k1.verifySignatureSchnorr(sig, pk, paymentDetailsMessageHash(tradeId, ciphertext));
  } catch {
    return false;
  }
}
