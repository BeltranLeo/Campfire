import { useState } from 'react';
import { Link } from 'react-router';
import { ApiError, apiGet, type Trade } from '../api';
import { assetInfo } from '../assets';
import { Button } from '../components/Button';
import { CopyButton } from '../components/CopyButton';
import { HashLink, ProvenanceTag, SimBox } from '../components/Provenance';
import { EmptyState, Notice, Skeleton } from '../components/States';
import { StatusPill } from '../components/StatusPill';
import { useConfig } from '../config';
import { formatAmount, formatDate, formatDayMonth, formatHourMinute } from '../format';
import { usePoll } from '../hooks/usePoll';
import { REPO_URL } from '../links';
import { CONTRACT_PATHS } from '../proof';
import { useWallet } from '../wallet';

// Transparency (Transparency-* screens): one real transaction per contract path, what the demo simulates,
// recent trades and the contract's keys. Paths that have not run on mainnet yet say so.

export function Transparency() {
  const config = useConfig();
  const wallet = useWallet();
  const [mine, setMine] = useState(false);
  const identity = wallet.status === 'connected' ? wallet.identity : null;
  const trades = usePoll(
    () => apiGet<{ trades: Trade[] }>(`/api/trades${mine && identity ? `?identity=${identity}` : ''}`).then((r) => r.trades),
    mine && identity ? `mine:${identity}` : 'all',
  );
  const recent = [...(trades.data ?? [])].sort((a, b) => b.updatedAt - a.updatedAt).slice(0, 20);
  const ran = CONTRACT_PATHS.filter((p) => p.txid).length;

  return (
    <main className="s-main">
      <div className="s-pagehead">
        <h1 className="cf-display">Transparency</h1>
        <p className="cf-muted" style={{ maxWidth: 640 }}>
          {ran === CONTRACT_PATHS.length
            ? 'Every path of the escrow contract has run on mainnet.'
            : `${ran} of ${CONTRACT_PATHS.length} paths of the escrow contract have run on mainnet so far; the others say so.`}{' '}
          Each row links to the real transaction. What the demo simulates is listed below, and nothing else is.
        </p>
      </div>

      <section className="cf-card" data-flush>
        <div className="s-sechead">
          <h2 className="cf-heading">Contract paths on mainnet</h2>
          <ProvenanceTag kind="chain" />
        </div>
        <div className="s-tablewrap">
          <table className="cf-table">
            <thead>
              <tr>
                <th>Path</th>
                <th>What it does</th>
                <th>Who authorises it</th>
                <th>Transaction</th>
                <th>Date</th>
              </tr>
            </thead>
            <tbody>
              {CONTRACT_PATHS.map((p) => (
                <tr key={p.path}>
                  <td>
                    <strong className="cf-mono">{p.path}</strong>
                  </td>
                  <td>{p.what}</td>
                  <td>{p.who}</td>
                  <td>{p.txid ? <HashLink value={p.txid} kind="transaction" /> : <span className="cf-muted">Not run on mainnet yet</span>}</td>
                  <td className="cf-muted">{p.at ? formatDate(p.at) : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <SimBox label="What is simulated in the demo" bodyGap={2}>
        <p className="cf-small">
          <strong>Fiat payment.</strong> The demo seller's payment details are placeholders. No money moves when you mark a
          demo trade as paid.
        </p>
        <p className="cf-small">
          <strong>Who the arbiter is.</strong> In the demo console a visitor decides the dispute. The verdict is still signed
          with the real arbiter key and settled on-chain.
        </p>
      </SimBox>

      <section className="cf-card" data-flush>
        <div className="s-sechead">
          <h2 className="cf-heading">Recent trades</h2>
          {identity && (
            <div className="cf-seg" role="group" aria-label="Whose trades">
              <button type="button" aria-pressed={!mine} onClick={() => setMine(false)}>
                All
              </button>
              <button type="button" aria-pressed={mine} onClick={() => setMine(true)}>
                Mine
              </button>
            </div>
          )}
        </div>
        {trades.loading && !trades.data ? (
          <div className="cf-card__section cf-stack" data-gap="2">
            <Skeleton width="80%" />
            <Skeleton width="70%" />
            <Skeleton width="75%" />
          </div>
        ) : trades.error && !trades.data ? (
          <div className="cf-card__section cf-stack">
            <Notice tone="danger" title="We could not load the trades">
              {trades.error instanceof ApiError && trades.error.status < 500 && trades.error.status >= 400
                ? trades.error.message
                : 'The server did not answer. The contract paths above are on-chain and do not depend on it.'}
            </Notice>
            <div className="s-actions">
              <Button variant="primary" onClick={trades.reload}>
                Try again
              </Button>
            </div>
          </div>
        ) : recent.length === 0 ? (
          <EmptyState title="No trades yet" action={<Button to="/offers">Browse offers</Button>}>
            {mine ? 'Trades you take or sell show up here.' : 'Trades show up here as soon as someone takes an offer.'}
          </EmptyState>
        ) : (
          <div className="s-tablewrap">
            <table className="cf-table">
              <thead>
                <tr>
                  <th>Trade</th>
                  <th>Amount</th>
                  <th>State</th>
                  <th>Settlement</th>
                  <th>Fiat</th>
                  <th>Updated</th>
                </tr>
              </thead>
              <tbody>
                {recent.map((t) => (
                  <tr key={t.id}>
                    <td>
                      <Link to={`/trade/${t.id}`} className="cf-mono">
                        {`${t.id.slice(0, 6)}…${t.id.slice(-4)}`}
                      </Link>
                    </td>
                    <td className="cf-mono">{formatAmount(t.amount, assetInfo(t.asset, t.assetDecimals, config))}</td>
                    <td>
                      <StatusPill state={t.status} role="visitor" side={t.side} />
                    </td>
                    <td>
                      {t.settlementTxid ? (
                        <HashLink value={t.settlementTxid} kind="transaction" />
                      ) : t.fundingTxid && t.escrowAddress ? (
                        <>
                          <span className="cf-muted">In escrow</span> <HashLink value={t.escrowAddress} kind="address" />
                        </>
                      ) : (
                        <span className="cf-muted">Nothing on-chain yet</span>
                      )}
                    </td>
                    <td>{t.isDemo && <ProvenanceTag kind="sim">Simulated fiat</ProvenanceTag>}</td>
                    <td className="cf-muted">
                      {formatDayMonth(t.updatedAt)}, {formatHourMinute(new Date(t.updatedAt * 1000))}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="cf-card" data-flush>
        <div className="cf-card__section">
          <div className="cf-row" data-between style={{ marginBottom: 'var(--space-3)' }}>
            <h2 className="cf-heading">The contract</h2>
            <ProvenanceTag kind="chain" />
          </div>
          <dl className="cf-dl">
            <dt>Source</dt>
            <dd>
              <a href={`${REPO_URL}/blob/master/contracts/CampfireEscrow.cash`}>contracts/CampfireEscrow.cash</a>, CashScript 0.14,
              P2SH32
            </dd>
            {config && (
              <>
                <dt>Arbiter key</dt>
                <dd>
                  <HashLink value={config.arbiterPk} kind="plain" /> <CopyButton value={config.arbiterPk} />
                </dd>
                <dt>Oracle key</dt>
                <dd>
                  <HashLink value={config.oraclePk} kind="plain" /> <CopyButton value={config.oraclePk} />
                </dd>
                <dt>PUSD category</dt>
                <dd>
                  <HashLink value={config.pusdCategory} kind="plain" /> <CopyButton value={config.pusdCategory} />
                </dd>
              </>
            )}
          </dl>
        </div>
      </section>
    </main>
  );
}
