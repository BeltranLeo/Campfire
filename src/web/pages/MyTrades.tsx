import { Link, Navigate, useSearchParams } from 'react-router';
import { ApiError, apiGet, type Trade } from '../api';
import { assetInfo } from '../assets';
import { Button } from '../components/Button';
import { EmptyState, Notice, Skeleton } from '../components/States';
import { StatusPill } from '../components/StatusPill';
import { Countdown } from '../components/Timeline';
import { useConfig } from '../config';
import { formatAmount, formatFiatAmount } from '../format';
import { useNow } from '../hooks/useNow';
import { usePoll } from '../hooks/usePoll';
import { historyNote, isActive, nextStep, otherParty, rowTitle, sortActive, sortHistory } from '../mytrades';
import { roleOf } from '../trade';
import { useWallet } from '../wallet';
import { useMessages } from '../lang';

// My trades (Trades-* screens): the trades in progress with what each needs next, and the finished ones. The lists
// refresh every few seconds, so a new request shows up on its own. The offers published from this wallet live in
// the Offers section (pages/MyOffers.tsx).

const TABS = ['active', 'history'] as const;
type Tab = (typeof TABS)[number];
const REFRESH_MS = 10_000;

export function MyTrades() {
  const wallet = useWallet();
  const [params] = useSearchParams();
  const requested = params.get('tab');
  const tab: Tab = TABS.find((name) => name === requested) ?? 'active';
  const messages = useMessages();
  const t = messages.mytrades;
  const identity = wallet.status === 'connected' ? wallet.identity : null;

  const trades = usePoll(
    () => (identity ? apiGet<{ trades: Trade[] }>(`/api/trades?identity=${identity}`).then((r) => r.trades) : Promise.resolve(null)),
    identity ?? 'none',
    REFRESH_MS,
  );
  const activeCount = trades.data ? trades.data.filter(isActive).length : 0;

  // My offers used to be a tab here; links to it from before keep working.
  if (requested === 'offers') return <Navigate to="/offers/mine" replace />;

  return (
    <main className="s-main" data-desk="medium">
      <div className="s-toolbar">
        <h1 className="cf-display">{t.title}</h1>
        <Button to="/offers/new">{t.createOffer}</Button>
      </div>
      <nav className="s-tabs" aria-label={t.sections}>
        <Link to="/trades" aria-current={tab === 'active' ? 'page' : undefined}>
          {t.active}
          {activeCount > 0 && <span className="cf-badge">{activeCount}</span>}
        </Link>
        <Link to="/trades?tab=history" aria-current={tab === 'history' ? 'page' : undefined}>
          {t.history}
        </Link>
      </nav>

      {!identity ? (
        <section className="cf-card">
          <EmptyState
            title={t.connectTitle}
            action={
              <Button variant="primary" busy={wallet.status === 'pairing' || wallet.status === 'connecting'} onClick={wallet.connect}>
                {t.connect}
              </Button>
            }
          >
            {t.connectBody}
          </EmptyState>
        </section>
      ) : trades.data ? (
        tab === 'active' ? (
          <ActiveTab trades={trades.data} identity={identity} />
        ) : (
          <HistoryTab trades={trades.data} identity={identity} />
        )
      ) : trades.error ? (
        <section className="cf-card">
          <div className="cf-stack">
            <Notice tone="danger" title={t.loadError}>
              {trades.error instanceof ApiError ? trades.error.message : t.serverSilent}
            </Notice>
            <div className="s-actions">
              <Button variant="primary" onClick={trades.reload}>
                {messages.common.tryAgain}
              </Button>
            </div>
          </div>
        </section>
      ) : (
        <ListSkeleton />
      )}
    </main>
  );
}

function ListSkeleton() {
  return (
    <section className="cf-card" data-flush aria-busy="true">
      {[0, 1].map((i) => (
        <div key={i} className="s-item">
          <span className="s-cell">
            <Skeleton width="55%" height={16} />
            <Skeleton width="35%" />
          </span>
        </div>
      ))}
    </section>
  );
}

/** What a row says about the trade: amounts in the trade's own units, from the viewer's side. */
function useRowText() {
  const config = useConfig();
  return (trade: Trade, role: 'buyer' | 'seller') => {
    const asset = assetInfo(trade.asset, trade.assetDecimals, config);
    return rowTitle(trade, role, formatAmount(trade.amount, asset), formatFiatAmount(trade.fiatAmount, trade.fiat));
  };
}

const sideOf = (trade: Trade, identity: string): 'buyer' | 'seller' => (roleOf(trade, identity) === 'seller' ? 'seller' : 'buyer');

function ActiveTab({ trades, identity }: { trades: Trade[]; identity: string }) {
  const title = useRowText();
  const t = useMessages().mytrades;
  const now = Math.floor(useNow(1000) / 1000);
  const rows = sortActive(
    trades.filter(isActive).map((trade) => ({ trade, next: nextStep(trade, sideOf(trade, identity), now) })),
  );
  if (rows.length === 0) {
    return (
      <section className="cf-card">
        <EmptyState
          title={t.noActive}
          action={
            <Button variant="primary" to="/offers">
              {t.browseOffers}
            </Button>
          }
        >
          {t.noActiveBody}
        </EmptyState>
      </section>
    );
  }
  return (
    <section className="cf-card" data-flush>
      {rows.map(({ trade, next }) => {
        const role = sideOf(trade, identity);
        const other = otherParty(trade, role);
        return (
          <Link key={trade.id} className="s-item" to={`/trade/${trade.id}`}>
            <span className="s-cell">
              <strong>{title(trade, role)}</strong>
              <span className="cf-small cf-muted">
                {t.with(other, next.step)}
              </span>
            </span>
            {next.deadline && next.windowSec ? <Countdown deadline={next.deadline} windowSec={next.windowSec} /> : null}
            {next.turn ? (
              <span className="cf-pill" data-tone="attention">
                {t.yourTurn}
              </span>
            ) : trade.status === 'Disputed' ? (
              <StatusPill state={trade.status} role={role} side={trade.side} />
            ) : (
              <span className="cf-pill" data-tone="escrow">
                {t.waiting}
              </span>
            )}
          </Link>
        );
      })}
    </section>
  );
}

function HistoryTab({ trades, identity }: { trades: Trade[]; identity: string }) {
  const title = useRowText();
  const t = useMessages().mytrades;
  const rows = sortHistory(trades.filter((trade) => !isActive(trade)));
  if (rows.length === 0) {
    return (
      <section className="cf-card">
        <EmptyState title={t.noHistory}>{t.noHistoryBody}</EmptyState>
      </section>
    );
  }
  return (
    <section className="cf-card" data-flush>
      {rows.map((trade) => {
        const role = sideOf(trade, identity);
        return (
          <Link key={trade.id} className="s-item" to={`/trade/${trade.id}`}>
            <span className="s-cell">
              <strong>{title(trade, role)}</strong>
              <span className="cf-small cf-muted">{historyNote(trade, role, otherParty(trade, role))}</span>
            </span>
            <StatusPill state={trade.status} role={role} side={trade.side} />
          </Link>
        );
      })}
    </section>
  );
}
