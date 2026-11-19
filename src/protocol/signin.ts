// Proof of possession at sign-in (protocol section 1). WizardConnect has no message signing, so the wallet
// signs a transaction that spends a made-up coin locked to its defi/0 key. The coin does not exist, so
// the transaction can never be broadcast, and the signature covers the coin, so it answers one challenge only.

import { TransactionBuilder, placeholderP2PKHUnlocker, type NetworkProvider } from 'cashscript';
import {
  binToHex,
  decodeTransactionUnsafe,
  createVirtualMachineBch2026,
  hash160,
  hexToBin,
  hmacSha256,
  sha256,
  stringify,
  utf8ToBin,
} from '@bitauth/libauth';
import { pkhToCashAddress, pkhToLockingBytecode } from './keys.js';

export const SIGNIN_TAG = 'CMPF-SIGNIN-v1';
// Value of the made-up coin, sent back to defi/0 minus the fee, so the wallet shows a payment to itself.
export const SIGNIN_COIN_SATS = 10_000n;
export const SIGNIN_FEE_SATS = 500n;
export const SIGNIN_LIFETIME_SEC = 300;
export const SIGNIN_PROMPT = 'Campfire sign-in. This spends a coin that does not exist, so it can never be broadcast.';

/** What the service hands out; the client sends `expiresAt` and `salt` back with the signed transaction. */
export interface SignInChallenge {
  nonce: string;
  expiresAt: number;
  salt: string;
}

// The nonce is a MAC over the identity, the receive key and the expiry, so the service keeps no state and a
// signed challenge cannot register another receive key.
export function signInNonce(
  secret: Uint8Array,
  params: { identity: string; receiveXpub: string; expiresAt: number; salt: string },
): string {
  const message = utf8ToBin(
    `${SIGNIN_TAG}|${params.identity}|${binToHex(sha256.hash(utf8ToBin(params.receiveXpub.trim())))}|${params.expiresAt}|${params.salt}`,
  );
  return binToHex(hmacSha256(secret, message));
}

/** The made-up outpoint depends on the nonce, so every challenge spends a different coin. */
export function signInCoinTxid(nonce: string): string {
  return binToHex(sha256.hash(utf8ToBin(`${SIGNIN_TAG}:${nonce}`)));
}

const signInOpReturn = (nonce: string) =>
  Uint8Array.from([0x6a, SIGNIN_TAG.length, ...utf8ToBin(SIGNIN_TAG), 0x20, ...hexToBin(nonce)]);

/** Builds the request the wallet signs with `defi/0`; nothing in it is ever broadcast. */
export function buildSignInRequest(provider: NetworkProvider, params: { nonce: string; defiPubkey: Uint8Array }) {
  if (!/^[0-9a-f]{64}$/.test(params.nonce)) throw new Error('Invalid sign-in nonce');
  const pkh = hash160(params.defiPubkey);
  const prefix = provider.network === 'mainnet' ? 'bitcoincash' : 'bchtest';
  const address = pkhToCashAddress(pkh, { prefix });
  const coin = {
    txid: signInCoinTxid(params.nonce),
    vout: 0,
    satoshis: SIGNIN_COIN_SATS,
    lockingBytecode: binToHex(pkhToLockingBytecode(pkh)),
  };
  const builder = new TransactionBuilder({ provider })
    .addInput(coin, placeholderP2PKHUnlocker(address))
    .addOpReturnOutput([SIGNIN_TAG, `0x${params.nonce}`])
    .addOutput({ to: address, amount: SIGNIN_COIN_SATS - SIGNIN_FEE_SATS });
  const hex = builder.build();
  const wc = builder.generateWcTransactionObject({ broadcast: false, userPrompt: SIGNIN_PROMPT });
  // Same encoding as the other wallet requests: plain JSON, and the transaction as hex (Selene rejects the object).
  const request = JSON.parse(stringify(wc)) as Record<string, unknown>;
  request.transaction = hex;
  return { hex, request, inputPaths: [[0, 'defi', 0]] as [number, 'defi', number][] };
}

/**
 * Checks a signed sign-in transaction: it spends the coin of this nonce, carries the nonce, and its signature
 * verifies against defi/0. The coin is rebuilt here, so the client cannot pick another key or value.
 */
export function verifySignInTransaction(signedHex: string, params: { nonce: string; defiPubkey: Uint8Array }): true | string {
  let tx;
  try {
    tx = decodeTransactionUnsafe(hexToBin(signedHex));
  } catch {
    return 'The signed sign-in transaction cannot be read';
  }
  if (tx.inputs.length !== 1) return 'The sign-in transaction must have one input';
  const input = tx.inputs[0];
  if (binToHex(input.outpointTransactionHash) !== signInCoinTxid(params.nonce) || input.outpointIndex !== 0) {
    return 'The sign-in transaction does not answer this challenge';
  }
  if (!tx.outputs[0] || binToHex(tx.outputs[0].lockingBytecode) !== binToHex(signInOpReturn(params.nonce))) {
    return 'The sign-in transaction does not carry this challenge';
  }
  const sourceOutputs = [{ lockingBytecode: pkhToLockingBytecode(hash160(params.defiPubkey)), valueSatoshis: SIGNIN_COIN_SATS }];
  const verdict = createVirtualMachineBch2026().verify({ transaction: tx, sourceOutputs });
  return verdict === true ? true : 'The sign-in signature does not match this wallet';
}
