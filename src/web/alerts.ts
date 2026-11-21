// Sound and system notifications for the moments a trade waits for this person: an offer was taken, the payment
// was marked as sent, the coins were locked, a dispute was opened. Polling finds them (components/Notifications.tsx);
// this file only makes them heard and seen while the tab is open, even in the background. With the tab closed
// nothing arrives: that would need Web Push and a service worker.
//
// On by default for the sound. System notifications need the browser's permission, which is asked for only when the
// person clicks the bell in the footer, because browsers ignore or penalise a prompt nobody asked for.

import symbol from './logos/symbol-64.png';

const KEY = 'alerts';

export function alertsOn(): boolean {
  try {
    return localStorage.getItem(KEY) !== 'off';
  } catch {
    return true;
  }
}

const listeners = new Set<(on: boolean) => void>();

/** Follows the footer switch, so the poll can speed up or slow down without a reload. */
export function onAlertsChange(listener: (on: boolean) => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Turning alerts on is a click, so it may ask for the notification permission and play the sound once. */
export async function setAlertsOn(on: boolean): Promise<void> {
  try {
    if (on) localStorage.removeItem(KEY);
    else localStorage.setItem(KEY, 'off');
  } catch {
    // Storage can be blocked (private mode); the choice still applies to this page view.
  }
  listeners.forEach((l) => l(on));
  if (on) await askToNotify();
}

/** The browser has not been asked yet whether this page may show system notifications. */
export const canAskToNotify = () => typeof Notification !== 'undefined' && Notification.permission === 'default';

/** Plays the sound as a sample and, the first time, asks for the notification permission. Call it from a click. */
export async function askToNotify(): Promise<void> {
  unlockAudio();
  ping();
  if (canAskToNotify()) await Notification.requestPermission().catch(() => 'denied');
}

export const canNotify = () => typeof Notification !== 'undefined' && Notification.permission === 'granted';

// Browsers keep a page silent until the person has clicked or typed in it. The first such gesture opens the audio
// context, so a later ping, which comes from a timer, can play.
let audio: AudioContext | null = null;
function unlockAudio() {
  try {
    audio ??= new AudioContext();
    void audio.resume();
  } catch {
    // No Web Audio: the alerts stay silent.
  }
}
if (typeof window !== 'undefined') {
  window.addEventListener('pointerdown', unlockAudio, { once: true, capture: true });
  window.addEventListener('keydown', unlockAudio, { once: true, capture: true });
}

/** Two short, soft rising tones. Made in the browser, so there is no sound file to load. */
export function ping(): void {
  if (!audio || audio.state !== 'running') return;
  const start = audio.currentTime;
  [880, 1320].forEach((frequency, i) => {
    const osc = audio!.createOscillator();
    const gain = audio!.createGain();
    const at = start + i * 0.14;
    osc.type = 'sine';
    osc.frequency.value = frequency;
    gain.gain.setValueAtTime(0.0001, at);
    gain.gain.exponentialRampToValueAtTime(0.18, at + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, at + 0.25);
    osc.connect(gain).connect(audio!.destination);
    osc.start(at);
    osc.stop(at + 0.3);
  });
}

/**
 * A system notification while the tab is in the background; a visible tab already shows the toast. One per trade:
 * a newer one replaces the older (`tag`). Clicking it brings the tab forward and opens the trade.
 */
export function notifySystem(params: { tag: string; title: string; body: string; onClick: () => void }): void {
  if (!canNotify() || !document.hidden) return;
  try {
    const n = new Notification(params.title, { body: params.body, tag: params.tag, icon: symbol });
    n.onclick = () => {
      window.focus();
      params.onClick();
      n.close();
    };
  } catch {
    // Some phones only allow notifications from a service worker; the sound and the toast still work there.
  }
}
