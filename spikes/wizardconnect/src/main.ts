// Throwaway spike for risks R1, R8 and R9 (see docs/protocol.md, section 4.4).
// R1: does the wallet fill a placeholder signature inside a contract input?
// R8: does the wallet share the same xpubs on every new pairing?
// R9: does the wallet share the same xpubs with different dapps?

import { DappConnectionManager, loadSession } from '@wizardconnect/dapp';
import { initiateDappRelay, childIndexOfPathName, type DappRelayResult } from '@wizardconnect/core';
import { Contract, ElectrumNetworkProvider, type SpendableUtxo } from 'cashscript';
import { binToHex, hash160, sha256, utf8ToBin, encodeCashAddress } from '@bitauth/libauth';
import QRCode from 'qrcode';
import artifact from './Spike.json';
import { buildSpend, diagnose } from './spend';

// --- Dapp identity (R9): ?dapp=B makes the page present itself as another dapp ---
const label = new URLSearchParams(location.search).get('dapp') === 'B' ? 'B' : 'A';
const dappName = `Campfire spike ${label}`;
const sessionKey = `wc-session-${label}`; // separate stored session per dapp name
const HISTORY_KEY = 'campfire-spike-history';

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
$('dapp-label').textContent = `(dapp ${label})`;
($('other-dapp') as HTMLAnchorElement).href = `?dapp=${label === 'A' ? 'B' : 'A'}`;

const dapp = new DappConnectionManager(dappName, undefined, { session: { key: sessionKey } });
const provider = new ElectrumNetworkProvider('mainnet');
let relay: DappRelayResult | null = null;
let connected = false;
let freshPairing = false;

const PATHS = ['receive', 'change', 'defi'] as const;
const fingerprint = (xpub: string) => binToHex(sha256.hash(utf8ToBin(xpub)).slice(0, 8));
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => `&${({ '&': 'amp', '<': 'lt', '>': 'gt', '"': 'quot' } as const)[c as '&']};`);

// --- Connection ---

function startRelay(existing?: { privateKey: string; secret: string; walletPublicKey: string }) {
  relay = initiateDappRelay((p) => {
    dapp.updateConnection(p.client, p.status);
    setStatus(connected ? String(p.status.status) : `relay ${p.status.status}, waiting for wallet`);
  }, existing ? { existingCredentials: existing } : {});
  dapp.attachRelay(relay);
}

function setStatus(text: string) {
  const name = dapp.walletName ? `${dapp.walletName} · ` : '';
  $('wallet-status').textContent = connected ? `${name}${text}` : text;
}

$('connect').addEventListener('click', async () => {
  if (connected || relay) {
    // Disconnect and forget the pairing, so the next connection is a new one (needed for R8).
    try { await dapp.sendDisconnect('Spike: user disconnected'); } catch { /* wallet may be gone */ }
    dapp.clearStoredSession();
    relay?.cleanup();
    location.reload();
    return;
  }
  freshPairing = true;
  startRelay();
  $('connect').textContent = 'Disconnect';
  ($('qr-img') as HTMLImageElement).src = await QRCode.toDataURL(relay!.qrUri, { margin: 1, width: 320 });
  $('qr-uri').textContent = relay!.uri;
  ($('qr-dialog') as HTMLDialogElement).showModal();
});
$('copy-uri').addEventListener('click', () => navigator.clipboard.writeText(relay?.uri ?? ''));
$('close-qr').addEventListener('click', () => ($('qr-dialog') as HTMLDialogElement).close());

dapp.on('walletready', () => {
  connected = true;
  ($('qr-dialog') as HTMLDialogElement).close();
  setStatus('connected');
  // Some wallets send a first wallet_ready with no paths and a second one with the keys;
  // only messages that carry keys are recorded, and the pairing label waits for them.
  if (dapp.getSessionPaths().length) {
    recordHistory(freshPairing ? 'new pairing' : 'reconnect');
    freshPairing = false;
  }
  showWallet();
});
dapp.on('disconnect', (reason) => { connected = false; setStatus(`disconnected (${reason})`); });

// Resume a stored pairing, if any. Keys restored from storage are shown but not recorded,
// because they did not come from the wallet in this session.
const stored = loadSession(sessionKey);
if (stored?.walletPublicKey) {
  startRelay({ privateKey: stored.privateKey, secret: stored.secret, walletPublicKey: stored.walletPublicKey });
  connected = true;
  $('connect').textContent = 'Disconnect';
  setStatus('reconnecting…');
  showWallet();
}

// --- R8 / R9: xpubs and history ---

type HistoryEntry = { time: string; dapp: string; wallet: string; kind: string; fp: Record<string, string> };

const readHistory = (): HistoryEntry[] => {
  try { return JSON.parse(localStorage.getItem(HISTORY_KEY) ?? '[]'); } catch { return []; }
};

function recordHistory(kind: string) {
  const fp: Record<string, string> = {};
  for (const p of dapp.getSessionPaths()) fp[p.name] = fingerprint(p.xpub);
  const entry = { time: new Date().toISOString(), dapp: dappName, wallet: dapp.walletName ?? '?', kind, fp };
  try { localStorage.setItem(HISTORY_KEY, JSON.stringify([...readHistory(), entry])); } catch { /* ignore */ }
  renderHistory();
}

function renderHistory() {
  const h = readHistory().filter((e) => Object.keys(e.fp).length); // drop key-less entries
  if (!h.length) { $('history').innerHTML = '<p class="muted">Empty.</p>'; return; }
  const rows = h.map((e, i) => {
    // Compare with the previous entry of the same wallet: same dapp → R8, other dapp → R9.
    const prev = h.slice(0, i).reverse().find((x) => x.wallet === e.wallet);
    let cmp = '<span class="muted">first</span>';
    if (prev) {
      const same = PATHS.every((p) => prev.fp[p] === e.fp[p]);
      const risk = prev.dapp === e.dapp ? 'R8' : 'R9';
      cmp = `${risk}: ${same ? '<span class="ok">same</span>' : '<span class="bad">DIFFERENT</span>'}`;
    }
    return `<tr><td>${esc(e.time.slice(0, 19).replace('T', ' '))}</td><td>${esc(e.wallet)}</td><td>${esc(e.dapp)}</td>
      <td>${esc(e.kind)}</td><td class="mono">${PATHS.map((p) => `${p}: ${esc(e.fp[p] ?? '—')}`).join('<br>')}</td><td>${cmp}</td></tr>`;
  });
  $('history').innerHTML = `<table><tr><th>Time (UTC)</th><th>Wallet</th><th>Dapp</th><th>Kind</th><th>Fingerprints</th><th>vs previous</th></tr>${rows.join('')}</table>`;
}
$('clear-history').addEventListener('click', () => { localStorage.removeItem(HISTORY_KEY); renderHistory(); });
renderHistory();

// --- R1: trivial contract ---

let contract: Contract | null = null;
let payoutAddress = '';
let signedHex = '';

const p2pkhAddress = (pubkey: Uint8Array) => {
  const r = encodeCashAddress({ prefix: 'bitcoincash', type: 'p2pkh', payload: hash160(pubkey) });
  return typeof r === 'string' ? r : r.address;
};

function showWallet() {
  const paths = dapp.getSessionPaths();
  $('xpubs').innerHTML = paths.length
    ? `<table>${paths.map((p) => `<tr><td>${esc(p.name)}</td><td class="mono">${esc(p.xpub)}<br><span class="muted">fingerprint ${fingerprint(p.xpub)}</span></td></tr>`).join('')}</table>`
    : '<p class="muted">No xpubs yet.</p>';

  const pk = dapp.getPubkey(childIndexOfPathName('defi')!, 0n);
  const receive0 = dapp.getPubkey(childIndexOfPathName('receive')!, 0n);
  if (!pk || !receive0) { $('contract').textContent = 'Wallet did not share defi and receive paths.'; return; }
  contract = new Contract(artifact as any, [pk], { provider, contractType: 'p2sh32' });
  payoutAddress = p2pkhAddress(receive0);
  $('contract').innerHTML = `
    <p>pk (defi/0): <code>${binToHex(pk)}</code></p>
    <p>Contract address: <code>${contract.address}</code></p>
    <p>Payout (receive/0): <code>${payoutAddress}</code></p>
    <p class="warn">Send at least 2,000 sats to the contract address. Run the R8 checks <em>before</em> funding: if the wallet rotates xpubs, a later session cannot reach this key and the funds stay locked.</p>
    <p id="balance" class="muted">Balance: …</p>`;
  ($('refresh') as HTMLButtonElement).disabled = false;
  refreshBalance();
}

// Funded contracts are remembered, so they stay visible even if a new pairing rotates the keys.
const FUNDED_KEY = 'campfire-spike-funded';
type Funded = { time: string; dapp: string; wallet: string; pk: string; address: string };
const readFunded = (): Funded[] => {
  try { return JSON.parse(localStorage.getItem(FUNDED_KEY) ?? '[]'); } catch { return []; }
};
function renderFunded() {
  const f = readFunded();
  $('funded').innerHTML = f.length
    ? `<p>Contracts funded from this browser:</p><table>${f.map((x) => `<tr><td>${esc(x.time.slice(0, 19).replace('T', ' '))}</td><td>${esc(x.wallet)} · ${esc(x.dapp)}</td><td class="mono">${esc(x.address)}<br>pk ${esc(x.pk)}</td></tr>`).join('')}</table>`
    : '';
}
renderFunded();

let utxos: SpendableUtxo[] = [];
async function refreshBalance() {
  if (!contract) return;
  try {
    utxos = (await contract.getUtxos()).filter((u) => !u.token);
    const total = utxos.reduce((s, u) => s + u.satoshis, 0n);
    $('balance').textContent = `Balance: ${total} sats in ${utxos.length} UTXO(s)`;
    ($('sign') as HTMLButtonElement).disabled = total < 2000n;
    if (total > 0n && !readFunded().some((x) => x.address === contract!.address)) {
      const pk = binToHex(dapp.getPubkey(childIndexOfPathName('defi')!, 0n)!);
      const entry = { time: new Date().toISOString(), dapp: dappName, wallet: dapp.walletName ?? '?', pk, address: contract.address };
      try { localStorage.setItem(FUNDED_KEY, JSON.stringify([...readFunded(), entry])); } catch { /* ignore */ }
      renderFunded();
    }
  } catch (e) {
    $('balance').textContent = `Balance error: ${(e as Error).message}`;
  }
}
$('refresh').addEventListener('click', refreshBalance);

// Checks the Electrum connection from the browser before anything is funded.
provider.getBlockHeight()
  .then((h) => { $('chain').textContent = `mainnet block ${h}`; })
  .catch((e) => { $('chain').textContent = `Electrum error: ${(e as Error).message}`; });

let abort: AbortController | null = null;
$('cancel').addEventListener('click', () => abort?.abort('Cancelled by the user'));

$('sign').addEventListener('click', async () => {
  if (!contract || !utxos.length) return;
  const out = $('result');
  signedHex = '';
  ($('broadcast') as HTMLButtonElement).disabled = true;
  try {
    const { unsignedHex, request, sourceOutputs } = buildSpend(contract, provider, utxos, payoutAddress);
    const inputPaths = utxos.map((_, i) => [i, 'defi', 0] as [number, 'defi', number]);
    out.innerHTML = `<p class="muted">Sent to wallet (${utxos.length} input(s), inputPaths ${JSON.stringify(inputPaths)}). Waiting…</p>`;

    abort = new AbortController();
    ($('cancel') as HTMLButtonElement).disabled = false;
    const res = await dapp.signTransaction({ transaction: request, inputPaths }, { signal: abort.signal });
    if (res.error || !res.signedTransaction) {
      out.innerHTML = `<p class="bad">Wallet returned an error: ${esc(res.error ?? 'no signed transaction')}</p>`;
      return;
    }
    signedHex = res.signedTransaction;
    const { inputs, verdict } = diagnose(unsignedHex, signedHex, contract.bytecode, sourceOutputs);
    const yesNo = (b: boolean) => (b ? '<span class="ok">yes</span>' : '<span class="bad">no</span>');
    const rows = inputs.map((d, i) => `<tr><td>${i}</td><td>${yesNo(d.replaced)}</td><td>${yesNo(d.keptScript)}</td>
      <td>${d.sigLength} bytes (${d.sigLength === 65 ? 'Schnorr' : 'ECDSA?'})</td><td><code>0x${d.sighash}</code></td></tr>`);
    out.innerHTML = `
      <table><tr><th>Input</th><th>Placeholder replaced</th><th>Redeem script kept</th><th>Signature</th><th>Sighash (expect 0x61)</th></tr>${rows.join('')}</table>
      <p>Local VM verification: ${verdict === true ? '<span class="ok">valid</span>' : `<span class="bad">${esc(String(verdict))}</span>`}</p>
      <details><summary>Signed transaction hex</summary><pre>${signedHex}</pre></details>`;
    ($('broadcast') as HTMLButtonElement).disabled = verdict !== true;
  } catch (e) {
    out.innerHTML = `<p class="bad">Error: ${esc((e as Error).message ?? String(e))}</p>`;
  } finally {
    ($('cancel') as HTMLButtonElement).disabled = true;
  }
});

$('broadcast').addEventListener('click', async () => {
  try {
    const txid = await provider.sendRawTransaction(signedHex);
    $('result').insertAdjacentHTML('beforeend',
      `<p class="ok">Broadcast: <a href="https://blockchair.com/bitcoin-cash/transaction/${txid}" target="_blank" rel="noopener">${txid}</a></p>`);
    ($('broadcast') as HTMLButtonElement).disabled = true;
    refreshBalance();
  } catch (e) {
    // If the wallet broadcast it despite broadcast: false, the node reports it as already known.
    $('result').insertAdjacentHTML('beforeend', `<p class="bad">Broadcast failed: ${esc((e as Error).message)}</p>`);
  }
});
