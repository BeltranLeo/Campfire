// The admin token that lets a person act as the arbiter of trades the demo does not cover. It is only held
// in this module's memory: not in localStorage, not in the URL, gone on reload. Anything that can read the
// page can read it, so it stays out of every place that outlives the tab.

import { useSyncExternalStore } from 'react';

let token: string | null = null;
const listeners = new Set<() => void>();

export function setArbiterToken(value: string | null): void {
  token = value?.trim() || null;
  for (const listener of listeners) listener();
}

export const getArbiterToken = () => token;

export function useArbiterToken(): string | null {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => token,
  );
}
