// What the person said they want in the two onboarding questions. It stays in this browser (localStorage), is
// never sent anywhere, and only sorts the offers on Home and preselects the filters on Offers: nothing is hidden.

import { useSyncExternalStore } from 'react';
import type { Offer } from './api';

export type Intent = 'buy' | 'sell' | 'both';

export interface Prefs {
  intent: Intent;
  /** Currency codes, such as "ARS". Empty means any. */
  fiat: string[];
  /** Coin symbols, "BCH" or "PUSD". Empty means any. */
  assets: string[];
}

export const PREFS_KEY = 'campfire.prefs';

/** What "Skip" stores: the questions were seen, and nothing is preferred. */
export const NO_PREFS: Prefs = { intent: 'both', fiat: [], assets: [] };

/** The stored preferences, or null before the person has answered or skipped (a damaged value counts as none). */
export function parsePrefs(raw: string | null): Prefs | null {
  if (!raw) return null;
  try {
    const value = JSON.parse(raw) as Partial<Prefs> | null;
    if (!value || typeof value !== 'object') return null;
    const intent = value.intent === 'buy' || value.intent === 'sell' || value.intent === 'both' ? value.intent : null;
    const list = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []);
    return intent ? { intent, fiat: list(value.fiat), assets: list(value.assets) } : null;
  } catch {
    return null;
  }
}

const listeners = new Set<() => void>();
// useSyncExternalStore needs the same object back until the value changes, so the parsed copy is kept by its text.
let cached: { raw: string | null; prefs: Prefs | null } = { raw: undefined as unknown as null, prefs: null };

function read(): string | null {
  try {
    return localStorage.getItem(PREFS_KEY);
  } catch {
    return null;
  }
}

export function loadPrefs(): Prefs | null {
  const raw = read();
  if (cached.raw !== raw) cached = { raw, prefs: parsePrefs(raw) };
  return cached.prefs;
}

export function savePrefs(prefs: Prefs): void {
  try {
    localStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
  } catch {
    // Without storage the choice only lasts until the page is closed; there is nothing else to do.
  }
  cached = { raw: JSON.stringify(prefs), prefs };
  listeners.forEach((l) => l());
}

export function usePrefs(): Prefs | null {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
    loadPrefs,
  );
}

/** "Buying BCH with Argentine pesos": the line under "For you". Null when nothing is preferred. */
export function describePrefs(prefs: Prefs | null): string | null {
  if (!prefs) return null;
  const verb = prefs.intent === 'buy' ? 'Buying' : prefs.intent === 'sell' ? 'Selling' : 'Buying or selling';
  const names: Record<string, string> = { ARS: 'Argentine pesos', USD: 'US dollars' };
  const coins = prefs.assets.length > 0 ? prefs.assets.join(' and ') : 'any coin';
  const money = prefs.fiat.map((f) => names[f] ?? f).join(' and ');
  if (prefs.intent === 'both' && prefs.fiat.length === 0 && prefs.assets.length === 0) return null;
  return `${verb} ${coins}${money ? ` with ${money}` : ''}`;
}

/**
 * The offers ordered by how well they fit: the side the person wants (a buyer sees sell offers), then the
 * currency, then the coin, with the demo offers ahead on a tie (the way in for a first visit). The sort is
 * stable, so offers that fit equally keep the service's order. Nothing is removed.
 */
export function rankOffers(
  offers: Offer[],
  prefs: Prefs | null,
  symbolOf: (offer: Offer) => string,
): Offer[] {
  const score = (offer: Offer) => {
    let s = 0;
    if (prefs) {
      const wantedSide = prefs.intent === 'buy' ? 'sell' : prefs.intent === 'sell' ? 'buy' : null;
      if (wantedSide && offer.document.side === wantedSide) s += 4;
      if (prefs.fiat.includes(offer.document.fiat)) s += 2;
      if (prefs.assets.includes(symbolOf(offer))) s += 1;
    }
    return s;
  };
  return offers
    .map((offer, index) => ({ offer, index, score: score(offer) }))
    .sort((a, b) => b.score - a.score || Number(b.offer.isDemo) - Number(a.offer.isDemo) || a.index - b.index)
    .map((x) => x.offer);
}
