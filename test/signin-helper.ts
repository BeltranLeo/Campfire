// Test helper: registers an identity the way the web client does, answering the sign-in challenge
// with a local key in place of the wallet (protocol section 1).

import { MockNetworkProvider, Network, SignatureTemplate, TransactionBuilder } from 'cashscript';
import { binToHex, hash160, secp256k1 } from '@bitauth/libauth';
import {
  SIGNIN_COIN_SATS,
  SIGNIN_FEE_SATS,
  SIGNIN_TAG,
  pkhToCashAddress,
  pkhToLockingBytecode,
  signInCoinTxid,
} from '../src/protocol/index.js';

type Req = (method: string, path: string, body?: unknown) => Promise<{ status: number; data: any }>;

interface SignInWallet {
  defiXpub: string;
  receiveXpub: string;
  defiPriv: (index: number) => Uint8Array;
}

/** Signs a sign-in challenge as a wallet would: the same transaction, with its input signed by defi/0. */
export function signSignInLocally(nonce: string, defiPrivateKey: Uint8Array): string {
  const provider = new MockNetworkProvider();
  provider.network = Network.MAINNET;
  const pubkey = secp256k1.derivePublicKeyCompressed(defiPrivateKey);
  if (typeof pubkey === 'string') throw new Error(pubkey);
  const pkh = hash160(pubkey);
  const coin = {
    txid: signInCoinTxid(nonce),
    vout: 0,
    satoshis: SIGNIN_COIN_SATS,
    lockingBytecode: binToHex(pkhToLockingBytecode(pkh)),
  };
  return new TransactionBuilder({ provider })
    .addInput(coin, new SignatureTemplate(defiPrivateKey).unlockP2PKH())
    .addOpReturnOutput([SIGNIN_TAG, `0x${nonce}`])
    .addOutput({ to: pkhToCashAddress(pkh), amount: SIGNIN_COIN_SATS - SIGNIN_FEE_SATS })
    .build();
}

/** Asks for a challenge and signs it; `signer` defaults to the wallet's own defi/0 key. */
export async function signInProof(req: Req, wallet: SignInWallet, signer = wallet.defiPriv(0)) {
  const { data } = await req('POST', '/api/identities/challenge', { defiXpub: wallet.defiXpub, receiveXpub: wallet.receiveXpub });
  const { nonce, expiresAt, salt } = data.challenge;
  return { expiresAt, salt, signedTransaction: signSignInLocally(nonce, signer) };
}

/** Registers the wallet's keys with a signed challenge, as the web client does on first connection. */
export async function registerSignedIn(req: Req, wallet: SignInWallet, extra: Record<string, unknown> = {}) {
  const proof = await signInProof(req, wallet);
  return req('POST', '/api/identities', { defiXpub: wallet.defiXpub, receiveXpub: wallet.receiveXpub, proof, ...extra });
}
