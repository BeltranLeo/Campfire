import { useState } from 'react';
import { Link } from 'react-router';
import { ApiError, apiGet, type PublicTrade, type PublicTradePage, type Trade } from '../api';
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
import { useMessages } from '../lang';

// Transparency (Transparency-* screens): one real transaction per contract path, what the demo simulates,
// recent trades and the contract's keys. Paths that have not run on mainnet yet say so.

export function Transparency() {
  const config = useConfig();
  const wallet = useWallet();
  const [mine, setMine] = useState(false);
  const identity = wallet.status === 'connected' ? wallet.identity : null;
  // Everyone's trades come as the public view, newest first, one page; your own come whole, with your session.
  const trades = usePoll<(PublicTrade | Trade)[]>(
    () =>
      mine && identity
        ? apiGet<{ trades: Trade[] }>(`/api/trades?identity=${identity}`).then((r) => r.trades)
        : apiGet<PublicTradePage>('/api/trades?limit=20').then((r) => r.trades),
    mine && identity ? `mine:${identity}` : 'all',
  );
  const recent = [...(trades.data ?? [])].sort((a, b) => b.updatedAt - a.updatedAt).slice(0, 20);
  const ran = CONTRACT_PATHS.filter((p) => p.txid).length;
  const messages = useMessages();
  const t = messages.transparency;

  return (
    <main className="s-main" data-site>
      <div className="s-pagehead">
        <h1 className="cf-display">{t.title}</h1>
        <p className="cf-muted" style={{ maxWidth: 640 }}>
          {ran === CONTRACT_PATHS.length ? t.allRan : t.someRan(ran, CONTRACT_PATHS.length)} {t.leadAfter}
        </p>
      </div>

      <section className="cf-card" data-flush>
        <div className="s-sechead">
          <h2 className="cf-heading">{t.pathsTitle}</h2>
          <ProvenanceTag kind="chain" />
        </div>
        <div className="s-tablewrap">
          <table className="cf-table s-stacktable">
            <thead>
              <tr>
                <th>{t.path}</th>
                <th>{t.whatItDoes}</th>
                <th>{t.whoAuthorises}</th>
                <th>{t.transaction}</th>
                <th>{t.date}</th>
              </tr>
            </thead>
            <tbody>
              {CONTRACT_PATHS.map((p) => (
                <tr key={p.path}>
                  <td data-label={t.path}>
                    <strong className="cf-mono">{p.path}</strong>
                  </td>
                  <td data-label={t.whatItDoes}>{t.what[p.path] ?? p.what}</td>
                  <td data-label={t.whoAuthorises}>{t.who[p.path] ?? p.who}</td>
                  <td data-label={t.transaction}>
                    {p.txid ? <HashLink value={p.txid} kind="transaction" /> : <span className="cf-muted">{t.notRun}</span>}
                  </td>
                  <td data-label={t.date} className="cf-muted">{p.at ? formatDate(p.at) : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <SimBox label={t.simulatedTitle} bodyGap={2}>
        <p className="cf-small">
          <strong>{t.simFiat}</strong>
          {t.simFiatBody}
        </p>
        <p className="cf-small">
          <strong>{t.simArbiter}</strong>
          {t.simArbiterBody}
        </p>
      </SimBox>

      <section className="cf-card" data-flush>
        <div className="s-sechead">
          <h2 className="cf-heading">{t.recent}</h2>
          {identity && (
            <div className="cf-seg" role="group" aria-label={t.whose}>
              <button type="button" aria-pressed={!mine} onClick={() => setMine(false)}>
                {t.all}
              </button>
              <button type="button" aria-pressed={mine} onClick={() => setMine(true)}>
                {t.mine}
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
            <Notice tone="danger" title={t.loadError}>
              {trades.error instanceof ApiError && trades.error.status < 500 && trades.error.status >= 400
                ? trades.error.message
                : t.loadErrorBody}
            </Notice>
            <div className="s-actions">
              <Button variant="primary" onClick={trades.reload}>
                {messages.common.tryAgain}
              </Button>
            </div>
          </div>
        ) : recent.length === 0 ? (
          <EmptyState title={t.noTrades} action={<Button to="/offers">{t.browseOffers}</Button>}>
            {mine ? t.noTradesMine : t.noTradesAll}
          </EmptyState>
        ) : (
          <div className="s-tablewrap">
            <table className="cf-table s-stacktable">
              <thead>
                <tr>
                  <th>{t.trade}</th>
                  <th>{t.amount}</th>
                  <th>{t.state}</th>
                  <th>{t.settlement}</th>
                  <th>{t.fiat}</th>
                  <th>{t.updated}</th>
                </tr>
              </thead>
              <tbody>
                {recent.map((row) => (
                  <tr key={row.id}>
                    <td data-label={t.trade}>
                      <Link to={`/trade/${row.id}`} className="cf-mono">
                        {`${row.id.slice(0, 6)}…${row.id.slice(-4)}`}
                      </Link>
                    </td>
                    <td data-label={t.amount} className="cf-mono">
                      {formatAmount(row.amount, assetInfo(row.asset, row.assetDecimals, config))}
                    </td>
                    <td data-label={t.state}>
                      <StatusPill state={row.status} role="visitor" side={row.side} />
                    </td>
                    <td data-label={t.settlement}>
                      {row.settlementTxid ? (
                        <HashLink value={row.settlementTxid} kind="transaction" />
                      ) : row.fundingTxid && row.escrowAddress ? (
                        <>
                          <span className="cf-muted">{t.lockedAt}</span> <HashLink value={row.escrowAddress} kind="address" />
                        </>
                      ) : (
                        <span className="cf-muted">{t.nothingOnChain}</span>
                      )}
                    </td>
                    <td data-label={t.fiat}>{row.isDemo && <ProvenanceTag kind="sim">{t.simulatedFiat}</ProvenanceTag>}</td>
                    <td data-label={t.updated} className="cf-muted">
                      {formatDayMonth(row.updatedAt)}, {formatHourMinute(new Date(row.updatedAt * 1000))}
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
            <h2 className="cf-heading">{t.contract}</h2>
            <ProvenanceTag kind="chain" />
          </div>
          <dl className="cf-dl">
            <dt>{t.source}</dt>
            <dd>
              <a href={`${REPO_URL}/blob/master/contracts/CampfireEscrow.cash`}>contracts/CampfireEscrow.cash</a>, CashScript 0.14,
              P2SH32
            </dd>
            {config && (
              <>
                <dt>{t.arbiterKey}</dt>
                <dd>
                  <HashLink value={config.arbiterPk} kind="plain" /> <CopyButton value={config.arbiterPk} />
                </dd>
                <dt>{t.oracleKey}</dt>
                <dd>
                  <HashLink value={config.oraclePk} kind="plain" /> <CopyButton value={config.oraclePk} />
                </dd>
                <dt>{t.pusdCategory}</dt>
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
