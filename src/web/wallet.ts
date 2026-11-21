// Wallet connection through WizardConnect. Connecting is the only sign-in (docs/protocol.md, section 1):
// the wallet shares three extended public keys and the service derives the identity from `defi`.
//
// One controller lives outside React so StrictMode's double effects never open two relays.
// Components read it with useWallet(); every change replaces the state object.

import { useSyncExternalStore } from 'react';
import { DappConnectionManager, clearSession, loadSession } from '@wizardconnect/dapp';
import type { DappRelayResult, SignTransactionRequest } from '@wizardconnect/core';
import { initiateDappRelay } from './dappRelay';
import { ApiError, apiGet, apiPost, isFinalState, setSessionToken, type RegisteredIdentity, type Reputation, type TradeSummary } from './api';
import { derivePubkeyFromXpub } from '../protocol/keys.js';
import { buildSignInRequest, type SignInChallenge } from '../protocol/signin.js';
import { electrum } from './electrum';

const SESSION_KEY = 'campfire.wallet';
// The service's session token, kept so a reload or a later visit on this browser needs no new signature.
const TOKEN_KEY = 'campfire.session-token';

function storedToken(): string | null {
  try {
    return localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

function keepToken(token: string | null) {
  setSessionToken(token);
  try {
    if (token) localStorage.setItem(TOKEN_KEY, token);
    else localStorage.removeItem(TOKEN_KEY);
  } catch {
    // Without storage the token lasts until the page closes; the next visit signs in again.
  }
}
const DAPP_NAME = 'Campfire';
const PAIRING_TIMEOUT_MS = 2 * 60 * 1000;
// A closed wallet app never answers; without a limit the button would say "Waiting for wallet…" forever.
const SIGN_TIMEOUT_MS = 2 * 60 * 1000;
// After a reload that needs a new sign-in, how long to wait for a closed wallet app before offering to ask again or
// cancel. Without it the header said "Connecting…" forever and nothing on the page could stop it.
const WALLET_WAIT_MS = 20 * 1000;

/** The wallet refused, failed or did not answer. Nothing was sent; the caller shows one sentence for all three. */
export class WalletDeclined extends Error {
  constructor() {
    super('The wallet did not sign the transaction');
    this.name = 'WalletDeclined';
  }
}

/** Which key signs which input: the input's position, the wallet path (`defi` for contracts) and the key index. */
/** The wallet refused, failed or did not answer the sign-in request. */
class SignInDeclined extends Error {
  constructor() {
    super('The wallet did not sign the sign-in request');
    this.name = 'SignInDeclined';
  }
}

export type SigningPath = [number, 'receive' | 'change' | 'defi', number];

export type WalletStatus = 'disconnected' | 'pairing' | 'connecting' | 'connected';

export interface WalletXpubs {
  defi: string;
  receive: string;
  change?: string;
}

export interface WalletState {
  status: WalletStatus;
  /** Pairing link while waiting for the wallet: `uri` to copy or open, `qrUri` for the QR code. */
  pairing: { uri: string; qrUri: string } | null;
  walletName: string | null;
  identity: string | null;
  xpubs: WalletXpubs | null;
  reputation: Reputation | null;
  /** Unfinished trades of this identity; null until loaded. */
  activeTrades: number | null;
  /** A signature request is out and the wallet has not answered yet. */
  signing: boolean;
  /** The wallet refused or ignored the sign-in signature; the pairing stays open so it can be asked again. */
  signInFailed: boolean;
  /** Why the last pairing failed; the words are in messages.ts (wallet.timeout*, wallet.load*). */
  error: { kind: 'timeout' } | { kind: 'load'; detail: string | null } | null;
}

const INITIAL: WalletState = {
  status: 'disconnected',
  pairing: null,
  walletName: null,
  identity: null,
  xpubs: null,
  reputation: null,
  activeTrades: null,
  signing: false,
  signInFailed: false,
  error: null,
};

class WalletController {
  private state: WalletState = INITIAL;
  private listeners = new Set<() => void>();
  private manager: DappConnectionManager | null = null;
  private relay: DappRelayResult | null = null;
  private pairingTimer: ReturnType<typeof setTimeout> | undefined;
  private waitTimer: ReturnType<typeof setTimeout> | undefined;
  /** The defi key registered with the service for the current manager, if any. */
  private registeredDefi: string | null = null;
  private registering = false;
  // Whether the current pairing has heard from the wallet in this page; sign requests need it.
  private walletAnswered = false;

  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getSnapshot = () => this.state;

  private set(patch: Partial<WalletState>) {
    this.state = { ...this.state, ...patch };
    for (const listener of this.listeners) listener();
  }

  /** Resumes a pairing stored by an earlier visit. Called once at start-up. */
  restore() {
    const stored = loadSession(SESSION_KEY);
    if (!stored) return;
    // A session is usable only if the wallet finished pairing and shared its keys;
    // anything else is a pairing that was abandoned half-way.
    if (!stored.walletPublicKey || !stored.paths?.some((p) => p.name === 'defi')) {
      clearSession(SESSION_KEY);
      return;
    }
    try {
      this.open({ privateKey: stored.privateKey, secret: stored.secret, walletPublicKey: stored.walletPublicKey });
    } catch {
      // A damaged session must never stop the page from loading: forget it and stay disconnected.
      this.close();
      clearSession(SESSION_KEY);
      return;
    }
    this.set({ status: 'connecting', walletName: stored.walletName ?? null });
    // The manager restores the stored keys, so the identity can be loaded before the wallet answers.
    void this.register();
  }

  /** Starts a new pairing and shows its link. */
  connect() {
    this.close();
    const relay = this.open();
    this.set({ ...INITIAL, status: 'pairing', pairing: { uri: relay.uri, qrUri: relay.qrUri } });
    this.startPairingTimer();
  }

  private startPairingTimer() {
    clearTimeout(this.pairingTimer);
    this.pairingTimer = setTimeout(() => {
      this.disconnect();
      this.set({ error: { kind: 'timeout' } });
    }, PAIRING_TIMEOUT_MS);
  }

  /** Ends the pairing on both sides and forgets it. Also cancels a pairing in progress. */
  disconnect() {
    // Tell the wallet only if it is paired; a pairing in progress has nobody to tell.
    this.close(this.state.status !== 'pairing');
    clearSession(SESSION_KEY);
    keepToken(null);
    this.set(INITIAL);
  }

  /**
   * While a restored pairing waits for the wallet to sign in, shows the sign-in dialog with its "Ask my wallet again"
   * and "Cancel" choices. Called by the header button and by a timer, so a closed wallet app never leaves the page stuck.
   */
  offerSignInChoice() {
    if (this.state.status === 'connecting' && !this.state.signing && !this.state.signInFailed) this.set({ signInFailed: true });
  }

  /** Asks the wallet again for the sign-in signature after it refused or did not answer. */
  retrySignIn() {
    if (!this.manager || !this.state.signInFailed) return;
    // A wallet that has not answered since the reload cannot sign yet: go back to waiting for it (the header says
    // "Connecting…" again and the timer brings the choice back), and ask as soon as it answers.
    if (!this.walletAnswered) this.set({ signInFailed: false });
    void this.register();
  }

  /** Reloads the count of unfinished trades (for the wallet menu and the Trades badge). */
  async refreshActiveTrades() {
    const identity = this.state.identity;
    if (!identity) return;
    try {
      const { trades } = await apiGet<{ trades: TradeSummary[] }>(`/api/trades?identity=${identity}`);
      if (this.state.identity !== identity) return;
      this.set({ activeTrades: trades.filter((t) => !isFinalState(t.status)).length });
    } catch {
      // The count is a convenience; the menu works without it.
    }
  }

  /**
   * Asks the paired wallet to sign a transaction (not to broadcast it) and returns the signed hex.
   * Throws WalletDeclined if the wallet is not connected, refuses, fails or stays silent for two minutes.
   */
  async sign(request: Record<string, unknown>, inputPaths: SigningPath[]): Promise<string> {
    const manager = this.manager;
    if (!manager || this.state.status !== 'connected') throw new WalletDeclined();
    this.set({ signing: true });
    try {
      const response = await manager.signTransaction(
        { transaction: request as unknown as SignTransactionRequest['transaction'], inputPaths },
        { signal: AbortSignal.timeout(SIGN_TIMEOUT_MS) },
      );
      if (response.error || !response.signedTransaction) throw new WalletDeclined();
      return response.signedTransaction;
    } catch {
      throw new WalletDeclined();
    } finally {
      // A disconnect during the request already reset the state; only clear what this call set.
      if (this.state.signing) this.set({ signing: false });
    }
  }

  // Asks the wallet to sign the service's sign-in challenge with defi/0 (docs/protocol.md, section 1). The
  // transaction spends a coin that does not exist, so it is never broadcast and moves nothing.
  private async proveOwnership(manager: DappConnectionManager, xpubs: WalletXpubs) {
    const { challenge } = await apiPost<{ challenge: SignInChallenge }>('/api/identities/challenge', {
      defiXpub: xpubs.defi,
      receiveXpub: xpubs.receive,
    });
    const { request, inputPaths } = buildSignInRequest(electrum(), {
      nonce: challenge.nonce,
      defiPubkey: derivePubkeyFromXpub(xpubs.defi, 0),
    });
    this.set({ signing: true, signInFailed: false });
    try {
      const response = await manager.signTransaction(
        { transaction: request as unknown as SignTransactionRequest['transaction'], inputPaths },
        { signal: AbortSignal.timeout(SIGN_TIMEOUT_MS) },
      );
      if (response.error || !response.signedTransaction) throw new Error(response.error ?? 'No signature');
      return { expiresAt: challenge.expiresAt, salt: challenge.salt, signedTransaction: response.signedTransaction };
    } catch {
      throw new SignInDeclined();
    } finally {
      this.set({ signing: false });
    }
  }

  private open(existing?: { privateKey: string; secret: string; walletPublicKey: string }): DappRelayResult {
    const manager = new DappConnectionManager(DAPP_NAME, undefined, { session: { key: SESSION_KEY } });
    this.manager = manager;
    this.registeredDefi = null;
    this.walletAnswered = false;
    const relay = initiateDappRelay(
      (payload) => {
        if (this.manager !== manager) return;
        manager.updateConnection(payload.client, payload.status);
        if (payload.status.status === 'session_deleted') this.endedByWallet();
      },
      existing,
    );
    this.relay = relay;
    manager.attachRelay(relay);
    manager.on('walletready', () => {
      if (this.manager !== manager) return;
      // The wallet answered. A hidden page may have kept the timer running, so give the
      // rest of the pairing (Selene's second wallet_ready, with the keys) a fresh two minutes.
      if (this.state.status === 'pairing') this.startPairingTimer();
      this.walletAnswered = true;
      this.set({ walletName: manager.walletName });
      void this.register();
    });
    manager.on('disconnect', () => {
      if (this.manager === manager) this.endedByWallet();
    });
    return relay;
  }

  /**
   * Stops the relay of the current pairing, if any, without touching the stored session.
   * With `notifyWallet`, first sends the wallet a courtesy disconnect so it drops the session too.
   */
  private close(notifyWallet = false) {
    clearTimeout(this.pairingTimer);
    clearTimeout(this.waitTimer);
    const manager = this.manager;
    const relay = this.relay;
    // Detach at once so events from this pairing are ignored; the shutdown finishes in the background.
    this.manager = null;
    this.relay = null;
    this.registeredDefi = null;
    void (async () => {
      try {
        // The message must leave before the socket closes, but a silent wallet must not hold anything up.
        if (manager && notifyWallet) await Promise.race([manager.sendDisconnect('Disconnected in Campfire'), wait(1000)]);
      } catch {
        // The wallet may already be gone.
      }
      try {
        await manager?.destroy();
      } catch {
        // Nothing left to stop.
      }
      relay?.cleanup();
    })();
  }

  private endedByWallet() {
    this.close();
    clearSession(SESSION_KEY);
    keepToken(null);
    this.set(INITIAL);
  }

  // Registers the wallet's keys with the service, which answers with the identity and its reputation.
  // wallet_ready can arrive several times (Selene sends one without keys first, and it repeats on
  // every reconnect); only a message with new keys triggers a registration.
  private async register() {
    const manager = this.manager;
    if (!manager || this.registering) return;
    const paths = manager.getSessionPaths();
    const xpub = (name: string) => paths.find((p) => p.name === name)?.xpub;
    const defi = xpub('defi');
    const receive = xpub('receive');
    if (!defi || !receive || defi === this.registeredDefi) return;

    // The keys arrived, so the pairing did not time out (a first wallet_ready without keys does not count).
    clearTimeout(this.pairingTimer);
    const xpubs: WalletXpubs = { defi, receive, change: xpub('change') };
    this.registering = true;
    if (this.state.status !== 'connected') this.set({ status: 'connecting', pairing: null });
    try {
      const keys = { defiXpub: xpubs.defi, receiveXpub: xpubs.receive };
      // A token from an earlier sign-in on this browser resumes it without a new signature.
      setSessionToken(storedToken());
      let result: RegisteredIdentity;
      try {
        result = await apiPost<RegisteredIdentity>('/api/identities', keys);
      } catch (err) {
        // 401: no valid token for these keys, so the wallet must prove it owns them.
        if (!(err instanceof ApiError && err.status === 401)) throw err;
        if (this.manager !== manager) return;
        // After a reload the relay reconnects in the background, and a sign request sent before the wallet
        // answers fails. Stay "connecting": the wallet_ready that follows runs this again and asks then.
        if (!this.walletAnswered) {
          clearTimeout(this.waitTimer);
          this.waitTimer = setTimeout(() => {
            if (this.manager === manager) this.offerSignInChoice();
          }, WALLET_WAIT_MS);
          return;
        }
        clearTimeout(this.waitTimer);
        const proof = await this.proveOwnership(manager, xpubs);
        if (this.manager !== manager) return;
        result = await apiPost<RegisteredIdentity>('/api/identities', { ...keys, proof });
      }
      if (this.manager !== manager) return;
      keepToken(result.session);
      this.registeredDefi = defi;
      this.set({
        status: 'connected',
        signInFailed: false,
        identity: result.identity,
        xpubs,
        reputation: result.reputation,
        walletName: manager.walletName,
        error: null,
      });
      void this.refreshActiveTrades();
    } catch (err) {
      if (this.manager !== manager) return;
      // A refused or unanswered signature keeps the pairing open: the sign-in dialog offers to ask again or cancel.
      if (err instanceof SignInDeclined) {
        this.set({ signInFailed: true });
        return;
      }
      // The pairing stays stored, so reloading the page tries again without a new QR code.
      this.close();
      this.set({
        ...INITIAL,
        // The service's own words when it gave a reason (they are in English), else a general line.
        error: { kind: 'load', detail: err instanceof ApiError ? err.message : null },
      });
    } finally {
      this.registering = false;
    }
  }
}

const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

const controller = new WalletController();

export const startWallet = () => controller.restore();

// Created once, so components can pass these to effects without re-running them on every render.
const actions = {
  connect: () => controller.connect(),
  disconnect: () => controller.disconnect(),
  retrySignIn: () => controller.retrySignIn(),
  offerSignInChoice: () => controller.offerSignInChoice(),
  refreshActiveTrades: () => controller.refreshActiveTrades(),
  sign: (request: Record<string, unknown>, inputPaths: SigningPath[]) => controller.sign(request, inputPaths),
};

export function useWallet() {
  const state = useSyncExternalStore(controller.subscribe, controller.getSnapshot);
  return { ...state, ...actions };
}

