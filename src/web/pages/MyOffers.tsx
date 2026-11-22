import { useState } from 'react';
import { Link } from 'react-router';
import { ApiError, apiGet, apiPost, type Offer, type Trade } from '../api';
import { assetInfo } from '../assets';
import { Button } from '../components/Button';
import { useAdvanced } from '../advanced';
import { OffersTabs } from '../components/OffersTabs';
import { HashLink, ProvenanceTag, explorerTxUrl } from '../components/Provenance';
import { EmptyState, Notice, Skeleton } from '../components/States';
import { useConfig } from '../config';
import { withKeptElectrum } from '../electrum';
import { formatBch, formatDayMonth, formatRange } from '../format';
import { usePoll, type PollState } from '../hooks/usePoll';
import { myOffers, tradesPerOffer } from '../mytrades';
import { buildCloseOffer } from '../sell';
import { TradeActionError } from '../trade';
import { WalletDeclined, useWallet } from '../wallet';
import { useMessages } from '../lang';

// My offers (the Trades-Offers screen, moved to the Offers section): the offers published from this wallet, open
// or not, with the transactions that opened and closed each one and a button to close it. Requests to trade on
// them are trades, so they stay in My trades. The list refreshes every few seconds.

const REFRESH_MS = 10_000;
/** After a close, the indexer behind the service may take a moment to show the marker as spent. */
const CLOSE_RETRIES = 3;
const CLOSE_RETRY_MS = 2000;

export function MyOffers() {
  const wallet = useWallet();
  const messages = useMessages();
  const t = messages.myoffers;
  const identity = wallet.status === 'connected' ? wallet.identity : null;

  // Every offer, closed ones included, so the list keeps the history of each one.
  const offers = usePoll(
    () => (identity ? apiGet<{ offers: Offer[] }>('/api/offers').then((r) => r.offers) : Promise.resolve(null)),
    identity ?? 'none',
    REFRESH_MS,
  );
  // Only for the number of trades on each offer.
  const trades = usePoll(
    () => (identity ? apiGet<{ trades: Trade[] }>(`/api/trades?identity=${identity}`).then((r) => r.trades) : Promise.resolve(null)),
    identity ?? 'none',
    REFRESH_MS,
  );
  const openCount = identity && offers.data ? myOffers(offers.data, identity).filter((o) => o.status === 'Published').length : 0;

  return (
    // As wide as the offer list next door, so switching tabs does not move them.
    <main className="s-main" data-wide data-desk="wide">
      <div className="s-pagehead o-head">
        <h1 className="cf-display">{messages.offers.title}</h1>
        <Button to="/offers/new">{t.createOffer}</Button>
      </div>
      {identity && <OffersTabs current="mine" openCount={openCount} />}

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
      ) : (
        <>
          <OfferList identity={identity} offers={offers} trades={trades.data ?? []} />
          <p className="cf-small cf-muted">
            {t.requestsNote} <Link to="/trades">{t.myTrades}</Link>.
          </p>
        </>
      )}
    </main>
  );
}

/** What the last close did, when it did not fail: closed (with its transaction when known), or not yet. */
type CloseOutcome = { kind: 'closed'; closeTxid?: string } | { kind: 'notYet' };

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

function OfferList({ identity, offers, trades }: { identity: string; offers: PollState<Offer[] | null>; trades: Trade[] }) {
  const wallet = useWallet();
  const config = useConfig();
  const [closing, setClosing] = useState<string | null>(null);
  // True once the wallet has signed (or nothing needed signing), so the button stops saying "Preparing…".
  const [sent, setSent] = useState(false);
  const advanced = useAdvanced();
  const [failure, setFailure] = useState<string | null>(null);
  const [outcome, setOutcome] = useState<CloseOutcome | null>(null);
  const messages = useMessages();
  const t = messages.myoffers;

  async function close(offer: Offer) {
    if (!wallet.xpubs) return;
    setClosing(offer.offerTxid);
    setSent(false);
    setFailure(null);
    setOutcome(null);
    try {
      const receiveXpub = wallet.xpubs.receive;
      const tx = await withKeptElectrum((provider) => buildCloseOffer({ offer, provider, receiveXpub }));
      // No transaction when the wallet's server no longer lists the marker: the service then only checks the chain.
      const closeTxHex = tx ? await wallet.sign(tx.request, tx.inputPaths) : undefined;
      setSent(true);
      const send = (hex?: string) =>
        apiPost<{ offer: Offer }>(`/api/offers/${offer.offerTxid}/close`, {
          sellerIdentity: identity,
          ...(hex ? { closeTxHex: hex } : {}),
        });
      let closed: Offer | null = null;
      try {
        closed = (await send(closeTxHex)).offer;
      } catch (err) {
        // With a transaction, the service sends it and records the close at once, so "still unspent" only comes
        // back when nothing was sent: the wallet's server no longer lists the marker, but the service's indexer
        // still does. Ask again a few times, since one of the two is running late. Any other error is real.
        if (closeTxHex || !(err instanceof ApiError && /still unspent/i.test(err.message))) throw err;
        for (let i = 0; i < CLOSE_RETRIES && !closed; i++) {
          await new Promise((r) => setTimeout(r, CLOSE_RETRY_MS));
          closed = await send().then(
            (r) => r.offer,
            () => null,
          );
        }
      }
      // If the retries end with the two views still disagreeing, nothing was signed or sent. That is not a failure
      // either: the offer may well still be open, so the notice says "not yet", not "not closed".
      setOutcome(closed ? { kind: 'closed', closeTxid: closed.closeTxid } : { kind: 'notYet' });
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
      setSent(false);
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
      {/* Always in the page, so a screen reader announces what a close did when its notice appears. */}
      <div role="status" aria-live="polite">
        {outcome?.kind === 'closed' && (
          <Notice tone="verified" title={t.closedTitle}>
            {t.closedBody}
            {/* A close the service only detected on-chain may have no recorded transaction to link. */}
            {outcome.closeTxid && (
              <>
                {' '}
                <a href={explorerTxUrl(outcome.closeTxid)} target="_blank" rel="noreferrer">
                  {t.closingTx}
                </a>
              </>
            )}
          </Notice>
        )}
        {outcome?.kind === 'notYet' && <Notice title={t.notYetTitle}>{t.notYetBody}</Notice>}
      </div>
      <section className="cf-card" data-flush>
        {mine.map((offer) => {
          const doc = offer.document;
          const asset = assetInfo(doc.asset, doc.assetDecimals, config);
          const c = counts.get(offer.offerTxid) ?? { total: 0, active: 0, waiting: 0 };
          const buying = doc.side === 'buy';
          const title = t.offerTitle(buying, asset.symbol, doc.fiat);
          return (
            <div key={offer.offerTxid} className="s-req">
              <div className="s-cell">
                <span>
                  {/* An open offer links to its page, as the other side sees it. A closed one's page only says
                      it is closed, so it has no link. */}
                  <strong>{offer.status === 'Published' ? <Link to={`/offers/${offer.offerTxid}`}>{title}</Link> : title}</strong>{' '}
                  · <span className="cf-mono">{formatRange(doc.min, doc.max, asset)}</span>
                </span>
                <span className="cf-small cf-muted">
                  <span className="cf-pill" data-tone={offer.status === 'Published' ? 'escrow' : undefined}>
                    {t.offerStatus(offer.status)}
                  </span>{' '}
                  {/* A request lapses if the owner doesn't accept it in time, so it stands out and leads to My trades. */}
                  {c.waiting > 0 && (
                    <>
                      <Link className="cf-pill" data-tone="attention" to="/trades">
                        {t.waiting(c.waiting)}
                      </Link>{' '}
                    </>
                  )}
                  {c.total > 0 ? (
                    <Link to={c.active > 0 ? '/trades' : '/trades?tab=history'}>{t.tradeCount(c.total)}</Link>
                  ) : (
                    t.tradeCount(0)
                  )}{' '}
                  ·{' '}
                  {offer.status === 'Closed'
                    ? t.published(formatDayMonth(offer.createdAt))
                    : t.expires(offer.status === 'Expired', formatDayMonth(doc.expiresAt))}{' '}
                  ·{' '}
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
                {/* An NFT marker closes the offer on any spend, and a wallet shows it like any other token. */}
                {offer.markerCategory && offer.status !== 'Closed' && (
                  <span className="cf-small cf-subtle">{t.markerWarning}</span>
                )}
                {offer.status === 'Expired' && (
                  <span className="cf-small cf-subtle">{t.expiredNote(buying, formatBch(1000n))}</span>
                )}
              </div>
              {offer.status !== 'Closed' && (
                <Button
                  size="sm"
                  signs={t.closeSigns}
                  busy={closing === offer.offerTxid}
                  busyLabel={closing === offer.offerTxid && sent ? t.closing : null}
                  disabled={closing !== null && closing !== offer.offerTxid}
                  onClick={() => close(offer)}
                >
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
