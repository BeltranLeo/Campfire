// Wallet connection through WizardConnect. Connecting is the only sign-in (docs/protocol.md, section 1):
// the wallet shares three extended public keys and the service derives the identity from `defi`.
//
// One controller lives outside React so StrictMode's double effects never open two relays.
// Components read it with useWallet(); every change replaces the state object.

import { useSyncExternalStore } from 'react';
import { DappConnectionManager, clearSession, loadSession } from '@wizardconnect/dapp';
import { initiateDappRelay, type DappRelayResult, type SignTransactionRequest } from '@wizardconnect/core';
import { ApiError, apiGet, apiPost, isFinalState, type RegisteredIdentity, type Reputation, type TradeSummary } from './api';

const SESSION_KEY = 'campfire.wallet';
const DAPP_NAME = 'Campfire';
const PAIRING_TIMEOUT_MS = 2 * 60 * 1000;
// A closed wallet app never answers; without a limit the button would say "Waiting for wallet…" forever.
const SIGN_TIMEOUT_MS = 2 * 60 * 1000;

/** The wallet refused, failed or did not answer. Nothing was sent; the caller shows one sentence for all three. */
export class WalletDeclined extends Error {
  constructor() {
    super('The wallet did not sign the transaction');
    this.name = 'WalletDeclined';
  }
}

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
  error: { title: string; message: string } | null;
}

const INITIAL: WalletState = {
  status: 'disconnected',
  pairing: null,
  walletName: null,
  identity: null,
  xpubs: null,
  reputation: null,
  activeTrades: null,
  error: null,
};

class WalletController {
  private state: WalletState = INITIAL;
  private listeners = new Set<() => void>();
  private manager: DappConnectionManager | null = null;
  private relay: DappRelayResult | null = null;
  private pairingTimer: ReturnType<typeof setTimeout> | undefined;
  /** The defi key registered with the service for the current manager, if any. */
  private registeredDefi: string | null = null;
  private registering = false;

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
    this.pairingTimer = setTimeout(() => {
      this.disconnect();
      this.set({
        error: {
          title: 'The wallet did not answer',
          message: 'Pairing timed out after 2 minutes. Open the wallet and try again.',
        },
      });
    }, PAIRING_TIMEOUT_MS);
  }

  /** Ends the pairing on both sides and forgets it. Also cancels a pairing in progress. */
  disconnect() {
    // Tell the wallet only if it is paired; a pairing in progress has nobody to tell.
    this.close(this.state.status !== 'pairing');
    clearSession(SESSION_KEY);
    this.set(INITIAL);
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
  async sign(request: Record<string, unknown>, inputPaths: [number, 'defi', number][]): Promise<string> {
    const manager = this.manager;
    if (!manager || this.state.status !== 'connected') throw new WalletDeclined();
    try {
      const response = await manager.signTransaction(
        { transaction: request as unknown as SignTransactionRequest['transaction'], inputPaths },
        { signal: AbortSignal.timeout(SIGN_TIMEOUT_MS) },
      );
      if (response.error || !response.signedTransaction) throw new WalletDeclined();
      return response.signedTransaction;
    } catch {
      throw new WalletDeclined();
    }
  }

  private open(existing?: { privateKey: string; secret: string; walletPublicKey: string }): DappRelayResult {
    const manager = new DappConnectionManager(DAPP_NAME, undefined, { session: { key: SESSION_KEY } });
    this.manager = manager;
    this.registeredDefi = null;
    const relay = initiateDappRelay(
      (payload) => {
        if (this.manager !== manager) return;
        manager.updateConnection(payload.client, payload.status);
        if (payload.status.status === 'session_deleted') this.endedByWallet();
      },
      existing ? { existingCredentials: existing } : {},
    );
    this.relay = relay;
    manager.attachRelay(relay);
    manager.on('walletready', () => {
      if (this.manager !== manager) return;
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
      const result = await apiPost<RegisteredIdentity>('/api/identities', {
        defiXpub: xpubs.defi,
        receiveXpub: xpubs.receive,
        changeXpub: xpubs.change,
      });
      if (this.manager !== manager) return;
      this.registeredDefi = defi;
      this.set({
        status: 'connected',
        identity: result.identity,
        xpubs,
        reputation: result.reputation,
        walletName: manager.walletName,
        error: null,
      });
      void this.refreshActiveTrades();
    } catch (err) {
      if (this.manager !== manager) return;
      // The pairing stays stored, so reloading the page tries again without a new QR code.
      this.close();
      this.set({
        ...INITIAL,
        error: {
          title: 'Campfire could not load your wallet',
          message: err instanceof ApiError ? err.message : 'Something went wrong. Reload the page to try again.',
        },
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
  refreshActiveTrades: () => controller.refreshActiveTrades(),
  sign: (request: Record<string, unknown>, inputPaths: [number, 'defi', number][]) => controller.sign(request, inputPaths),
};

export function useWallet() {
  const state = useSyncExternalStore(controller.subscribe, controller.getSnapshot);
  return { ...state, ...actions };
}

