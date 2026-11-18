// Pure rules for the Welcome page, kept apart so they can be tested without a browser.

import type { Intent, Prefs } from './prefs';

export type FiatCode = 'ARS' | 'USD';

/** The preferences to store: one currency, and the coins as before (empty means any, as PUSD is not offered yet). */
export function buildPrefs(intent: Intent, fiat: FiatCode, saved: Prefs | null): Prefs {
  return { intent, fiat: [fiat], assets: saved?.assets ?? [] };
}

/** The offers a finished answer opens: sellers start on the sell side, everyone else on buying. */
export function offersPath(intent: Intent): string {
  return `/offers?side=${intent === 'sell' ? 'sell' : 'buy'}`;
}

/**
 * What "Continue" does on step 1. Someone just looking needs no wallet, so they go straight to the offers;
 * everyone else still has to get and connect a wallet.
 */
export function afterQuestions(intent: Intent): 'looking' | 'wallet' {
  return intent === 'both' ? 'looking' : 'wallet';
}

/** The saved currency if it is one we offer, otherwise pesos. */
export function initialFiat(saved: Prefs | null): FiatCode {
  const first = saved?.fiat[0];
  return first === 'USD' ? 'USD' : 'ARS';
}
