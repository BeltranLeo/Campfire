// "Hide balance": the eye next to the balance swaps the amounts for dots, for when someone can see the screen.
// One choice for the whole app (header, wallet menu, Home), kept in this browser like advanced.ts; without
// storage it lasts until the page is closed. Take and Create offer still show what you can spend: you need it there.

import { useSyncExternalStore } from 'react';

export const HIDE_BALANCE_KEY = 'campfire.hideBalance';

/** What stands in for a hidden amount: always the same length, so it says nothing about the size. */
export const HIDDEN_AMOUNT = '••••';

const listeners = new Set<() => void>();
let current: boolean | null = null;

export function readHideBalance(): boolean {
  if (current !== null) return current;
  try {
    current = localStorage.getItem(HIDE_BALANCE_KEY) === '1';
  } catch {
    current = false;
  }
  return current;
}

export function setHideBalance(hidden: boolean): void {
  current = hidden;
  try {
    if (hidden) localStorage.setItem(HIDE_BALANCE_KEY, '1');
    else localStorage.removeItem(HIDE_BALANCE_KEY);
  } catch {
    // Without storage the choice lasts until the page is closed.
  }
  listeners.forEach((l) => l());
}

export function useHideBalance(): boolean {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
    readHideBalance,
    () => false,
  );
}
