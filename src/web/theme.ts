// Theme preference. The inline script in index.html applies it before the first paint; this module
// keeps it in sync afterwards. 'system' is stored as the absence of the key.

export type ThemePref = 'system' | 'light' | 'dark';

const KEY = 'theme';
const darkQuery = window.matchMedia('(prefers-color-scheme: dark)');

export function getThemePref(): ThemePref {
  try {
    const stored = localStorage.getItem(KEY);
    return stored === 'light' || stored === 'dark' ? stored : 'system';
  } catch {
    return 'system';
  }
}

function apply(pref: ThemePref): void {
  const dark = pref === 'dark' || (pref === 'system' && darkQuery.matches);
  document.documentElement.setAttribute('data-theme', dark ? 'dark' : 'light');
}

export function setThemePref(pref: ThemePref): void {
  try {
    if (pref === 'system') localStorage.removeItem(KEY);
    else localStorage.setItem(KEY, pref);
  } catch {
    // Storage can be blocked (private mode); the choice still applies to this page view.
  }
  apply(pref);
}

// While the preference is 'system', follow the operating system when it switches.
darkQuery.addEventListener('change', () => {
  if (getThemePref() === 'system') apply('system');
});
