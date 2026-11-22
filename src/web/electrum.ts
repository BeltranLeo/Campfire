// Chain lookups from the browser through an Electrum server (the same provider the protocol code uses).

import { ElectrumNetworkProvider } from 'cashscript';

let provider: ElectrumNetworkProvider | null = null;
/** One shared mainnet connection; it opens on demand and closes when idle. */
export const electrum = () => (provider ??= new ElectrumNetworkProvider('mainnet'));

// Address-history lookups ask many questions in a row. The on-demand provider above reconnects for each
// burst (about 1.5 s), so these use their own connection, opened once and kept for the page's lifetime.
let lookup: Promise<ElectrumNetworkProvider> | null = null;
function lookupProvider(): Promise<ElectrumNetworkProvider> {
  if (!lookup) {
    const p = new ElectrumNetworkProvider('mainnet', { manualConnectionManagement: true });
    lookup = p.connect().then(() => p);
    lookup.catch(() => {
      lookup = null;
    });
  }
  return lookup;
}

/** The connection kept open for the page, for pages that ask many questions in a row (a wallet's coins). */
export const keptElectrum = lookupProvider;

// A phone closes the page's sockets while it is in the background (for example while the visitor is in the wallet
// app), and the kept connection would stay dead for the rest of the visit. A page that comes back drops it so the
// next lookup opens a new one.
function dropKeptConnection() {
  const old = lookup;
  lookup = null;
  void old?.then((p) => p.disconnect()).catch(() => {});
}
// Typed by hand: the tests also load this file, and their compiler settings have no DOM types.
const page = (globalThis as { document?: PageDocument }).document;
interface PageDocument {
  visibilityState: string;
  addEventListener(type: 'visibilitychange', listener: () => void): void;
  removeEventListener(type: 'visibilitychange', listener: () => void): void;
}
const LOST = /connection lost|not connected|disconnected|timed out/i;
page?.addEventListener('visibilitychange', () => {
  if (page.visibilityState !== 'visible' || !lookup) return;
  // A desktop tab keeps its socket, so only a connection that does not answer is dropped.
  const probe = lookup.then((p) => withDeadline(p.performRequest('server.ping'), Date.now() + 3000));
  probe.catch((err) => {
    if (LOST.test(err instanceof Error ? err.message : String(err))) dropKeptConnection();
  });
});

const visible = () =>
  !page || page.visibilityState === 'visible'
    ? Promise.resolve()
    : new Promise<void>((resolve) => {
        const onChange = () => {
          if (page.visibilityState !== 'visible') return;
          page.removeEventListener('visibilitychange', onChange);
          resolve();
        };
        page.addEventListener('visibilitychange', onChange);
      });

/**
 * Runs `work` on the kept connection. If the connection was lost on the way (the page was hidden), waits for the
 * page to be visible again and runs it once more on a new connection. Use it for the reads that come before a
 * signature, so a quick switch to the wallet app cannot abort the request before the wallet has it.
 */
export async function withKeptElectrum<T>(work: (provider: ElectrumNetworkProvider) => Promise<T>): Promise<T> {
  try {
    return await work(await lookupProvider());
  } catch (err) {
    if (!LOST.test(err instanceof Error ? err.message : String(err))) throw err;
    await visible();
    dropKeptConnection();
    return work(await lookupProvider());
  }
}

function withDeadline<T>(promise: Promise<T>, deadline: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Electrum lookup timed out')), Math.max(0, deadline - Date.now()));
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (err) => {
        clearTimeout(timer);
        reject(err);
      },
    );
  });
}
