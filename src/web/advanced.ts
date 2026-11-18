// "Show technical details": one switch for the whole app. Off by default, so a newcomer sees words and ticks;
// on, every fold with transactions, keys and addresses starts open and the progress shows its transactions.
// It stays in this browser (localStorage, same pattern as prefs.ts); without storage it is simply off.

import { useSyncExternalStore } from 'react';

export const ADVANCED_KEY = 'campfire.advanced';

const listeners = new Set<() => void>();
// Kept in memory too, so the switch still works for this visit when the browser refuses storage.
let current: boolean | null = null;

/** The stored value: only "1" turns it on; anything else, or no storage at all, is off. */
export function parseAdvanced(raw: string | null): boolean {
  return raw === '1';
}

export function readAdvanced(): boolean {
  if (current !== null) return current;
  try {
    current = parseAdvanced(localStorage.getItem(ADVANCED_KEY));
  } catch {
    current = false;
  }
  return current;
}

export function setAdvanced(on: boolean): void {
  current = on;
  try {
    if (on) localStorage.setItem(ADVANCED_KEY, '1');
    else localStorage.removeItem(ADVANCED_KEY);
  } catch {
    // Without storage the choice lasts until the page is closed.
  }
  listeners.forEach((l) => l());
}

export function useAdvanced(): boolean {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
    readAdvanced,
    () => false,
  );
}
