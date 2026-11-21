import { useSyncExternalStore } from 'react';

/** Whether a CSS media query matches now; the component draws again when that changes. */
export function useMediaQuery(query: string): boolean {
  return useSyncExternalStore(
    (onChange) => {
      const list = window.matchMedia(query);
      list.addEventListener('change', onChange);
      return () => list.removeEventListener('change', onChange);
    },
    () => window.matchMedia(query).matches,
  );
}

/** Wide enough for two columns of app content; the same width as data-desk in screens.css. */
export const DESK_QUERY = '(min-width: 1100px)';
