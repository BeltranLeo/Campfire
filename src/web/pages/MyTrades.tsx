import { useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { ApiError, apiGet, apiPost, type Offer, type Trade } from '../api';
import { assetInfo } from '../assets';
import { Button, WALLET_DECLINED } from '../components/Button';
import { HashLink, shorten } from '../components/Provenance';
import { EmptyState, Notice, Skeleton } from '../components/States';
import { StatusPill } from '../components/StatusPill';
import { Countdown } from '../components/Timeline';
import { useConfig } from '../config';
import { keptElectrum } from '../electrum';
import { formatAmount, formatDayMonth, formatFiatAmount, formatRange } from '../format';
import { useNow } from '../hooks/useNow';
import { usePoll } from '../hooks/usePoll';
import { historyNote, isActive, myOffers, nextStep, rowTitle, sortActive, sortHistory, tradesPerOffer } from '../mytrades';
import { buildCloseOffer } from '../sell';
import { TradeActionError, roleOf } from '../trade';
import { WalletDeclined, useWallet } from '../wallet';

// My trades (Trades-* screens): the trades in progress with what each needs next, the finished ones, and the
// offers published from this wallet. The lists refresh every few seconds, so a new request shows up on its own.

const TABS = ['active', 'history', 'offers'] as const;
type Tab = (typeof TABS)[number];
const REFRESH_MS = 10_000;
/** After a close, the indexer behind the service may take a moment to show the marker as spent. */
const CLOSE_RETRIES = 3;
const CLOSE_RETRY_MS = 2000;

export function MyTrades() {
  const wallet = useWallet();
  const [params] = useSearchParams();
  const requested = params.get('tab');
  const tab: Tab = TABS.find((t) => t === requested) ?? 'active';
  const identity = wallet.status === 'connected' ? wallet.identity : null;

  const trades = usePoll(
    () => (identity ? apiGet<{ trades: Trade[] }>(`/api/trades?identity=${identity}`).then((r) => r.trades) : Promise.resolve(null)),
    identity ?? 'none',
    REFRESH_MS,
  );
  const activeCount = trades.data ? trades.data.filter(isActive).length : 0;

  return (
    <main className="s-main">
      <div className="s-toolbar">
        <h1 className="cf-title">My trades</h1>
        <Button to="/offers/new">Create an offer</Button>
      </div>
      <nav className="s-tabs" aria-label="Sections">
        <Link to="/trades" aria-current={tab === 'active' ? 'page' : undefined}>
          Active{activeCount > 0 && <span className="cf-badge">{activeCount}</span>}
        </Link>
        <Link to="/trades?tab=history" aria-current={tab === 'history' ? 'page' : undefined}>
          History
        </Link>
        <Link to="/trades?tab=offers" aria-current={tab === 'offers' ? 'page' : undefined}>
          My offers
        </Link>
      </nav>

      {!identity ? (
        <section className="cf-card">
          <EmptyState
            title="Connect your wallet"
            action={
              <Button variant="primary" busy={wallet.status === 'pairing' || wallet.status === 'connecting'} onClick={wallet.connect}>
                Connect wallet
              </Button>
            }
          >
            Your trades and offers are found through your wallet. Connecting needs no signature.
          </EmptyState>
        </section>
      ) : tab === 'offers' ? (
        <OffersTab identity={identity} trades={trades.data ?? []} />
      ) : trades.data ? (
        tab === 'active' ? (
          <ActiveTab trades={trades.data} identity={identity} />
        ) : (
          <HistoryTab trades={trades.data} identity={identity} />
        )
      ) : trades.error ? (
        <section className="cf-card">
          <div className="cf-stack">
            <Notice tone="danger" title="We could not load your trades">
              {trades.error instanceof ApiError ? trades.error.message : 'The server did not answer.'}
            </Notice>
            <div className="s-actions">
              <Button variant="primary" onClick={trades.reload}>
                Try again
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
  const now = Math.floor(useNow(1000) / 1000);
  const rows = sortActive(
    trades.filter(isActive).map((trade) => ({ trade, next: nextStep(trade, sideOf(trade, identity), now) })),
  );
  if (rows.length === 0) {
    return (
      <section className="cf-card">
        <EmptyState title="No active trades" action={<Button variant="primary" to="/offers">Browse offers</Button>}>
          When you take an offer or someone takes yours, it shows up here.
        </EmptyState>
      </section>
    );
  }
  return (
    <section className="cf-card" data-flush>
      {rows.map(({ trade, next }) => {
        const role = sideOf(trade, identity);
        const other = role === 'buyer' ? (trade.isDemo ? 'Demo seller' : shorten(trade.sellerIdentity)) : shorten(trade.buyerIdentity);
        return (
          <Link key={trade.id} className="s-item" to={`/trade/${trade.id}`}>
            <span className="s-cell">
              <strong>{title(trade, role)}</strong>
              <span className="cf-small cf-muted">
                With {other} · {next.step}
              </span>
            </span>
            {next.deadline && next.windowSec ? <Countdown deadline={next.deadline} windowSec={next.windowSec} /> : null}
            {next.turn ? (
              <span className="cf-pill" data-tone="active">
                Your turn
              </span>
            ) : trade.status === 'Disputed' ? (
              <StatusPill state={trade.status} role={role} />
            ) : (
              <span className="cf-pill" data-tone="idle">
                Waiting
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
  const rows = sortHistory(trades.filter((t) => !isActive(t)));
  if (rows.length === 0) {
    return (
      <section className="cf-card">
        <EmptyState title="No finished trades yet">Completed, cancelled and returned trades are listed here.</EmptyState>
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
              <span className="cf-small cf-muted">{historyNote(trade, role)}</span>
            </span>
            <StatusPill state={trade.status} role={role} />
          </Link>
        );
      })}
    </section>
  );
}

function OffersTab({ identity, trades }: { identity: string; trades: Trade[] }) {
  const wallet = useWallet();
  const config = useConfig();
  const offers = usePoll(() => apiGet<{ offers: Offer[] }>('/api/offers').then((r) => r.offers), 'all-offers', REFRESH_MS);
  const [closing, setClosing] = useState<string | null>(null);
  const [failure, setFailure] = useState<string | null>(null);

  async function close(offer: Offer) {
    if (!wallet.xpubs) return;
    setClosing(offer.offerTxid);
    setFailure(null);
    try {
      const tx = await buildCloseOffer({ offer, provider: await keptElectrum(), receiveXpub: wallet.xpubs.receive });
      const closeTxHex = await wallet.sign(tx.request, tx.inputPaths);
      const send = (hex?: string) =>
        apiPost(`/api/offers/${offer.offerTxid}/close`, { sellerIdentity: identity, ...(hex ? { closeTxHex: hex } : {}) });
      try {
        await send(closeTxHex);
      } catch (err) {
        // The transaction was sent, but the service looked before its indexer listed the spent marker: ask again
        // without the transaction, which only re-checks. Any other error is real.
        if (!(err instanceof ApiError && /still unspent/i.test(err.message))) throw err;
        let done = false;
        for (let i = 0; i < CLOSE_RETRIES && !done; i++) {
          await new Promise((r) => setTimeout(r, CLOSE_RETRY_MS));
          done = await send().then(
            () => true,
            () => false,
          );
        }
        if (!done) throw err;
      }
      offers.reload();
    } catch (err) {
      setFailure(
        err instanceof WalletDeclined
          ? WALLET_DECLINED
          : err instanceof TradeActionError || err instanceof ApiError
            ? err.message
            : 'Something went wrong. Try again.',
      );
    } finally {
      setClosing(null);
    }
  }

  if (!offers.data) {
    return offers.error ? (
      <section className="cf-card">
        <div className="cf-stack">
          <Notice tone="danger" title="We could not load your offers">
            {offers.error instanceof ApiError ? offers.error.message : 'The server did not answer.'}
          </Notice>
          <div className="s-actions">
            <Button variant="primary" onClick={offers.reload}>
              Try again
            </Button>
          </div>
        </div>
      </section>
    ) : (
      <ListSkeleton />
    );
  }
  const mine = myOffers(offers.data, identity);
  const counts = tradesPerOffer(trades);
  if (mine.length === 0) {
    return (
      <section className="cf-card">
        <EmptyState title="No offers yet" action={<Button variant="primary" to="/offers/new">Create an offer</Button>}>
          Offers you publish from this wallet are listed here, and you can close them.
        </EmptyState>
      </section>
    );
  }
  return (
    <>
      {failure && (
        <Notice tone="danger" title="The offer was not closed">
          {failure}
        </Notice>
      )}
      <section className="cf-card" data-flush>
        {mine.map((offer) => {
          const doc = offer.document;
          const asset = assetInfo(doc.asset, doc.assetDecimals, config);
          const n = counts.get(offer.offerTxid) ?? 0;
          return (
            <div key={offer.offerTxid} className="s-req">
              <div className="s-cell">
                <span>
                  <strong>
                    Selling {asset.symbol} for {doc.fiat}
                  </strong>{' '}
                  · <span className="cf-mono">{formatRange(doc.min, doc.max, asset)}</span>
                </span>
                <span className="cf-small cf-muted">
                  <span className="cf-pill" data-tone={offer.status === 'Published' ? 'done' : undefined}>
                    {offer.status === 'Published' ? 'Open' : offer.status}
                  </span>{' '}
                  {n} {n === 1 ? 'trade' : 'trades'} · {offer.status === 'Expired' ? 'expired' : 'expires'} {formatDayMonth(doc.expiresAt)} · Offer{' '}
                  <HashLink value={offer.offerTxid} kind="transaction" />
                </span>
                {offer.status === 'Expired' && (
                  <span className="cf-small cf-subtle">It no longer shows to buyers. Close it to get the 1,000-sat marker back.</span>
                )}
              </div>
              {offer.status !== 'Closed' && (
                <Button variant="danger" size="sm" signs busy={closing === offer.offerTxid} disabled={closing !== null && closing !== offer.offerTxid} onClick={() => close(offer)}>
                  Close offer
                </Button>
              )}
            </div>
          );
        })}
      </section>
    </>
  );
}
