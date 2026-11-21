import { useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { aliasFor } from '../alias';
import { ApiError, apiGet, apiPost, type Offer, type Trade } from '../api';
import { assetInfo } from '../assets';
import { Button } from '../components/Button';
import { useAdvanced } from '../advanced';
import { HashLink, ProvenanceTag, explorerTxUrl } from '../components/Provenance';
import { EmptyState, Notice, Skeleton } from '../components/States';
import { StatusPill } from '../components/StatusPill';
import { Countdown } from '../components/Timeline';
import { useConfig } from '../config';
import { withKeptElectrum } from '../electrum';
import { formatAmount, formatBch, formatDayMonth, formatFiatAmount, formatRange } from '../format';
import { useNow } from '../hooks/useNow';
import { usePoll } from '../hooks/usePoll';
import { historyNote, isActive, myOffers, nextStep, rowTitle, sortActive, sortHistory, tradesPerOffer } from '../mytrades';
import { buildCloseOffer } from '../sell';
import { TradeActionError, roleOf } from '../trade';
import { WalletDeclined, useWallet } from '../wallet';
import { useMessages } from '../lang';

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
        <Link to="/trades?tab=offers" aria-current={tab === 'offers' ? 'page' : undefined}>
          {t.myOffers}
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
        const other = role === 'buyer' ? (trade.isDemo ? t.demoSeller : aliasFor(trade.sellerIdentity).name) : aliasFor(trade.buyerIdentity).name;
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
              <span className="cf-small cf-muted">{historyNote(trade, role)}</span>
            </span>
            <StatusPill state={trade.status} role={role} side={trade.side} />
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
  const advanced = useAdvanced();
  const [failure, setFailure] = useState<string | null>(null);
  const messages = useMessages();
  const t = messages.mytrades;

  async function close(offer: Offer) {
    if (!wallet.xpubs) return;
    setClosing(offer.offerTxid);
    setFailure(null);
    try {
      const receiveXpub = wallet.xpubs.receive;
      const tx = await withKeptElectrum((provider) => buildCloseOffer({ offer, provider, receiveXpub }));
      // No transaction when the marker is already spent: the offer is closed on-chain and the service only checks it.
      const closeTxHex = tx ? await wallet.sign(tx.request, tx.inputPaths) : undefined;
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
          ? messages.trade.walletDeclined
          : err instanceof TradeActionError || err instanceof ApiError
            ? err.message
            : t.somethingWrong,
      );
    } finally {
      setClosing(null);
    }
  }

  if (!offers.data) {
    return offers.error ? (
      <section className="cf-card">
        <div className="cf-stack">
          <Notice tone="danger" title={t.offersError}>
            {offers.error instanceof ApiError ? offers.error.message : t.serverSilent}
          </Notice>
          <div className="s-actions">
            <Button variant="primary" onClick={offers.reload}>
              {messages.common.tryAgain}
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
        <EmptyState
          title={t.noOffers}
          action={
            <Button variant="primary" to="/offers/new">
              {t.createOffer}
            </Button>
          }
        >
          {t.noOffersBody}
        </EmptyState>
      </section>
    );
  }
  return (
    <>
      {failure && (
        <Notice tone="danger" title={t.notClosed}>
          {failure}
        </Notice>
      )}
      <section className="cf-card" data-flush>
        {mine.map((offer) => {
          const doc = offer.document;
          const asset = assetInfo(doc.asset, doc.assetDecimals, config);
          const n = counts.get(offer.offerTxid) ?? 0;
          const buying = doc.side === 'buy';
          return (
            <div key={offer.offerTxid} className="s-req">
              <div className="s-cell">
                <span>
                  <strong>{t.offerTitle(buying, asset.symbol, doc.fiat)}</strong>{' '}
                  · <span className="cf-mono">{formatRange(doc.min, doc.max, asset)}</span>
                </span>
                <span className="cf-small cf-muted">
                  <span className="cf-pill" data-tone={offer.status === 'Published' ? 'escrow' : undefined}>
                    {t.offerStatus(offer.status)}
                  </span>{' '}
                  {t.tradeCount(n)} · {t.expires(offer.status === 'Expired', formatDayMonth(doc.expiresAt))} ·{' '}
                  {advanced ? (
                    <>
                      {t.offer} <HashLink value={offer.offerTxid} kind="transaction" />
                      {offer.closeTxid && (
                        <>
                          {' '}· {t.close} <HashLink value={offer.closeTxid} kind="transaction" />
                        </>
                      )}
                    </>
                  ) : (
                    <ProvenanceTag kind="chain" />
                  )}
                </span>
                {/* The transactions that opened and closed the offer, in the explorer. A close the service only
                    detected on-chain has no recorded transaction, so it has no link. */}
                {!advanced && (
                  <span className="cf-small">
                    <a href={explorerTxUrl(offer.offerTxid)} target="_blank" rel="noreferrer">
                      {t.publicationTx}
                    </a>
                    {offer.closeTxid && (
                      <>
                        {' '}·{' '}
                        <a href={explorerTxUrl(offer.closeTxid)} target="_blank" rel="noreferrer">
                          {t.closingTx}
                        </a>
                      </>
                    )}
                  </span>
                )}
                {offer.sponsored && <span className="cf-small cf-subtle">{t.feePaid}</span>}
                {offer.status === 'Expired' && (
                  <span className="cf-small cf-subtle">{t.expiredNote(buying, formatBch(1000n))}</span>
                )}
              </div>
              {offer.status !== 'Closed' && (
                <Button size="sm" signs busy={closing === offer.offerTxid} disabled={closing !== null && closing !== offer.offerTxid} onClick={() => close(offer)}>
                  {t.closeOffer}
                </Button>
              )}
            </div>
          );
        })}
      </section>
    </>
  );
}
