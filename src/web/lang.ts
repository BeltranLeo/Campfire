// Interface language. English is the default for everyone, so a judge always lands on English; Spanish is chosen
// in the footer or with ?lang=es in a link, and stays in this browser (localStorage, same pattern as advanced.ts).
// Only interface text changes: offers, the sign-in message and everything written on-chain stay byte for byte the same.

import { useSyncExternalStore } from 'react';
import { langFromUrl, MESSAGES, parseLang, type Lang, type Messages } from './messages';

export const LANG_KEY = 'campfire.lang';

const listeners = new Set<() => void>();
// Kept in memory too, so the switch still works for this visit when the browser refuses storage.
let current: Lang | null = null;

export function readLang(): Lang {
  if (current !== null) return current;
  const linked = langFromUrl(window.location.search, window.location.hash);
  if (linked) {
    setLang(linked);
    return linked;
  }
  try {
    current = parseLang(localStorage.getItem(LANG_KEY)) ?? 'en';
  } catch {
    current = 'en';
  }
  document.documentElement.lang = current;
  return current;
}

export function setLang(lang: Lang): void {
  current = lang;
  try {
    if (lang === 'en') localStorage.removeItem(LANG_KEY);
    else localStorage.setItem(LANG_KEY, lang);
  } catch {
    // Without storage the choice lasts until the page is closed.
  }
  // Screen readers pick their voice from it, and styles/lang.css swaps the few words that live in CSS.
  document.documentElement.lang = lang;
  listeners.forEach((l) => l());
}

export function useLang(): Lang {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
    readLang,
    () => 'en',
  );
}

/** The interface text in the language the person chose. */
export function useMessages(): Messages {
  return MESSAGES[useLang()];
}
