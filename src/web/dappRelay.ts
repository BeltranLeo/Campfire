// Starts the dapp side of a WizardConnect relay, like `initiateDappRelay` from @wizardconnect/core,
// except that the relay stays connected while the page is hidden.
//
// Adapted from @wizardconnect/core 0.2.10, dist/dapp-relay.js
// (Copyright (C) 2026 Whiterun LLC, GNU LGPL v3.0 or later, https://gitlab.com/riftenlabs/lib/wizardconnect).
//
// Why: the library closes the relay as soon as the page is hidden. On a phone, "Open in wallet" hides
// the browser, so the page is offline exactly while the wallet waits for its dapp_ready, and Selene
// stays on "Connecting…". The upstream function does not forward `enableVisibilityHandling`.
// The browser may still pause a hidden page; then the pairing finishes when the user comes back,
// because the relay keeps the wallet's messages.

import {
  DEFAULT_RELAY_URLS,
  RelayMsgAction,
  binToHex,
  encodeKeyExchangeURI,
  generateKeyExchangeCredentials,
  hexToBin,
  initiateRelay,
  type DappRelayResult,
  type RelayClient,
  type RelayStatusCallback,
} from '@wizardconnect/core';
import { secp256k1 } from '@bitauth/libauth';
import { EventEmitter } from 'eventemitter3';

export interface ExistingCredentials {
  privateKey: string;
  secret: string;
  walletPublicKey: string;
}

/** The x-only public key that identifies a private key on Nostr, in hex. */
function nostrPublicKey(privateKey: Uint8Array): string {
  const compressed = secp256k1.derivePublicKeyCompressed(privateKey);
  if (typeof compressed === 'string') throw new Error(compressed);
  return binToHex(compressed.slice(1));
}

export function initiateDappRelay(statusCallback: RelayStatusCallback, existing?: ExistingCredentials): DappRelayResult {
  const events: DappRelayResult['events'] = new EventEmitter();
  let credentials: DappRelayResult['credentials'];
  if (existing) {
    if (!/^[0-9a-fA-F]{64}$/.test(existing.privateKey)) throw new Error('Private key must be 64 hex characters');
    if (!/^[0-9a-fA-F]{64}$/.test(existing.walletPublicKey) || /^0{64}$/.test(existing.walletPublicKey)) {
      throw new Error('Wallet public key must be 64 non-zero hex characters');
    }
    credentials = {
      privateKey: existing.privateKey,
      publicKey: nostrPublicKey(hexToBin(existing.privateKey)),
      secret: existing.secret,
    };
  } else {
    credentials = generateKeyExchangeCredentials();
  }
  const { uri, qrUri } = encodeKeyExchangeURI(credentials.publicKey, credentials.secret);

  let relayClient: RelayClient | null = null;
  let walletPublicKey: Uint8Array | null = existing ? hexToBin(existing.walletPublicKey) : null;
  let keyExchanged = existing !== undefined;
  let relayConnected = false;

  const completeKeyExchange = () => {
    if (relayConnected && walletPublicKey && !keyExchanged) {
      keyExchanged = true;
      events.emit('keyexchangecomplete', walletPublicKey);
    }
  };

  const cleanup = initiateRelay(
    (payload) => {
      relayConnected = false;
      // Restore the paired wallet's replay cutoff on reconnect.
      if (payload.status.status === 'connected' && walletPublicKey) relayClient?.setPairedPublicKey(walletPublicKey);
      statusCallback(payload);
      relayConnected = payload.status.status === 'connected';
      completeKeyExchange();
    },
    hexToBin(credentials.privateKey),
    walletPublicKey ?? new Uint8Array(33),
    {
      explicitRelayUrls: [...DEFAULT_RELAY_URLS],
      pairingSecret: credentials.secret,
      enableVisibilityHandling: false,
      onClient: (client) => {
        relayClient = client;
        client.on('message', (message) => {
          if (message.action === RelayMsgAction.WalletReady && !keyExchanged && 'public_key' in message) {
            walletPublicKey = hexToBin(message.public_key);
            completeKeyExchange();
          }
        });
      },
    },
  );

  // initiateRelay calls onClient before it returns.
  return { client: relayClient!, uri, qrUri, credentials, events, cleanup };
}
