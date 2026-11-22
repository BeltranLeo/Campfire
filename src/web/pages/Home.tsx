import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import QRCode from 'qrcode';
import { ApiError, apiGet, type Offer, type PriceQuote, type Trade } from '../api';
import { assetInfo } from '../assets';
import { Button } from '../components/Button';
import { CopyButton } from '../components/CopyButton';
import { Icon } from '../components/Icon';
import { HashLink, ProvenanceTag } from '../components/Provenance';
import { EmptyState, Notice, Skeleton } from '../components/States';
import { StatusPill } from '../components/StatusPill';
import { Countdown } from '../components/Timeline';
import { HIDDEN_AMOUNT, useHideBalance } from '../hideBalance';
import { BalanceEye } from '../components/BalanceEye';
import { BalanceLoading } from '../components/BalanceLoading';
import { freshReceiveAddress, spendableBch, tokenBalance } from '../coins';
import { useConfig } from '../config';
import { formatAmount, formatBchBalance, formatDate, formatFiat, formatFiatAmount, formatRange, fromBaseUnits, paymentMethodLabel } from '../format';
import { useNow } from '../hooks/useNow';
import { usePoll } from '../hooks/usePoll';
import { isActive, nextStep, rowTitle, sortActive, sortHistory, historyNote } from '../mytrades';
import { demoFirst, describeReputation, isSimulatedOffer, loadQuotes, loadReputations, priceOf } from '../offerData';
import { roleOf } from '../trade';
import { refreshWalletCoins, useWalletCoins } from '../walletCoins';
import { useWallet } from '../wallet';
import { useMessages } from '../lang';

// Home (Home-* screens): what a connected person sees at "/". The balance read from the network, the four ways
// in, the trade that needs them now, a few offers that fit what they said they want, and what happened lately.
// Anything that fails to load says so in its own place and leaves the rest working.

const REFRESH_MS = 10_000;
const BCH_USD = 'BCH/USD';
const FOR_YOU = 3;
const RECENT = 3;

export function Home() {
  const wallet = useWallet();
  if (!wallet.identity) return null;
  return <HomeBody identity={wallet.identity} receiveXpub={wallet.xpubs?.receive ?? null} />;
}

function HomeBody({ identity, receiveXpub }: { identity: string; receiveXpub: string | null }) {
  const trades = usePoll(() => apiGet<{ trades: Trade[] }>(`/api/trades?identity=${identity}`).then((r) => r.trades), identity, REFRESH_MS);
  const all = trades.data ?? [];
  const now = Math.floor(useNow(1000) / 1000);
  const sideOf = (t: Trade) => (roleOf(t, identity) === 'seller' ? 'seller' : 'buyer');
  const active = sortActive(all.filter(isActive).map((trade) => ({ trade, next: nextStep(trade, sideOf(trade), now) })));
  const waiting = active.filter((a) => a.next.turn);
  const finished = sortHistory(all.filter((trade) => !isActive(trade)));
  const t = useMessages().home;

  return (
    <main className="s-main" data-desk="wide">
      <div className="s-pagehead">
        <h1 className="cf-display">{t.welcome(!(trades.data && all.length === 0))}</h1>
      </div>

      <WalletCard receiveXpub={receiveXpub} trades={trades.data ? all : null} />

      {trades.data && all.length === 0 && (
        <Notice>
          <strong>{t.noBchYet}</strong>
          {t.noBchYetBody}
        </Notice>
      )}

      <QuickLinks activeCount={trades.data ? active.length : null} total={trades.data ? all.length : null} />

      <div className="s-home">
        <div className="s-col">
          {waiting.length > 0 && <Attention items={waiting} sideOf={sideOf} />}
          <ForYou />
        </div>
        <div className="s-col">
          <Activity finished={finished} sideOf={sideOf} failed={!trades.data && Boolean(trades.error)} loading={!trades.data && !trades.error} retry={trades.reload} />
        </div>
      </div>
    </main>
  );
}

function WalletCard({ receiveXpub, trades }: { receiveXpub: string | null; trades: Trade[] | null }) {
  const wallet = useWallet();
  const config = useConfig();
  const coins = useWalletCoins();
  const quote = usePoll(() => apiGet<{ quote: PriceQuote }>(`/api/oracle/quote?pair=${BCH_USD}`).then((r) => r.quote), BCH_USD, 30_000);

  const scan = coins.data ?? null;
  const sats = scan ? spendableBch(scan.coins) : null;
  const pusd = scan && config ? tokenBalance(scan.coins, config.pusdCategory) : 0n;
  const usd = sats !== null && quote.data ? (Number(sats) / 1e8) * Number(quote.data.price) : null;
  const address = receiveXpub ? freshReceiveAddress(scan, receiveXpub) : null;
  const rep = wallet.reputation;
  const completed = rep ? rep.completedAsBuyer + rep.completedAsSeller : null;
  const failed = !scan && coins.error !== null;
  const [receiving, setReceiving] = useState(false);
  const hidden = useHideBalance();
  const messages = useMessages();
  const t = messages.home;

  return (
    <section className="cf-card cf-glass" data-pad>
      <div className="s-idcard">
        <div>
          <div className="s-balance">
            <span className="s-balancehead">
              <span className="cf-label">{t.yourWallet}</span>
              <BalanceEye />
            </span>
            {sats !== null && hidden ? (
              <>
                {/* Every amount goes, PUSD too: showing it only when there is some would give that away. */}
                <strong>{HIDDEN_AMOUNT} BCH</strong>
                <span className="cf-muted">
                  ≈ {HIDDEN_AMOUNT} USD{config && ` · ${HIDDEN_AMOUNT} PUSD`}
                </span>
              </>
            ) : sats !== null ? (
              <>
                <strong>{formatBchBalance(sats)} BCH</strong>
                <span className="cf-muted">
                  {usd !== null && `≈ ${formatFiat(usd, 'USD')}`}
                  {usd !== null && pusd > 0n && ' · '}
                  {pusd > 0n && config && <span className="cf-num">{fromBaseUnits(pusd, config.pusdDecimals)} PUSD</span>}
                </span>
              </>
            ) : failed ? (
              <>
                <strong className="cf-muted">— BCH</strong>
                <span className="cf-small cf-muted">{t.balanceError}</span>
              </>
            ) : (
              // A long-used wallet takes a while to read: say what is happening and how far it has got.
              <BalanceLoading progress={coins.progress} variant="card" />
            )}
          </div>
          {failed && (
            <div style={{ marginTop: 'var(--space-2)' }}>
              <Button size="sm" onClick={() => void refreshWalletCoins()}>
                {messages.common.tryAgain}
              </Button>
            </div>
          )}
        </div>
        <div className="cf-stack" data-gap="2">
          <div className="hm-receive">
            <Button size="sm" onClick={() => setReceiving((open) => !open)}>
              {receiving ? t.hide : t.receive}
            </Button>
            {receiving && (
              <div className="cf-well hm-well">
                {address ? (
                  <>
                    <AddressQr value={address} />
                    <span className="cf-row" data-nowrap>
                      <HashLink value={address} kind="address" />
                      <CopyButton value={address} />
                    </span>
                    <span className="cf-small cf-muted">{t.sendHere}</span>
                  </>
                ) : (
                  // Invented text: the design always shows an address. One is only shown once the network has said which is unused.
                  <span className="cf-small cf-muted">{t.addressLater}</span>
                )}
              </div>
            )}
          </div>
          {trades === null || completed === null ? (
            <Skeleton width={160} />
          ) : completed > 0 ? (
            <span className="cf-small">
              <strong>{completed}</strong> {t.completed(completed)}
              {rep?.firstCompletedAt != null && t.since(formatDate(rep.firstCompletedAt))}
            </span>
          ) : (
            <span className="cf-small cf-muted">{t.noTrades}</span>
          )}
          <span className="cf-small cf-subtle">{t.publicKeyOnly}</span>
        </div>
      </div>
    </section>
  );
}

function AddressQr({ value }: { value: string }) {
  const [src, setSrc] = useState<string | null>(null);
  const t = useMessages().home;

  useEffect(() => {
    let current = true;
    QRCode.toDataURL(value, { margin: 0, width: 320, color: { dark: '#1f1a15', light: '#ffffff' } }).then(
      (url) => current && setSrc(url),
      () => {},
    );
    return () => {
      current = false;
    };
  }, [value]);

  return (
    <div className="cf-qr hm-qr" role="img" aria-label={t.qrLabel}>
      {src && <img src={src} alt="" width={140} height={140} />}
    </div>
  );
}

function QuickLinks({ activeCount, total }: { activeCount: number | null; total: number | null }) {
  const t = useMessages().home;
  const tradesNote = activeCount === null ? t.tradesAndOffers : activeCount > 0 ? t.activeCount(activeCount) : total ? t.noActive : t.noneYet;
  return (
    <div className="s-quick3">
      <Link className="cf-quick" to="/offers?side=buy">
        <Icon name="buy" />
        {t.buyBch}
        <small>{t.withLocal}</small>
      </Link>
      {/* Same place as "I want to sell" on the landing page: the buy offers, with "Or post your own offer" on top. */}
      <Link className="cf-quick" to="/offers?side=sell">
        <Icon name="sell" />
        {t.sellBch}
        <small>{t.forLocal}</small>
      </Link>
      <Link className="cf-quick" to="/trades">
        <Icon name="trades" />
        {t.myTrades}
        <small>{tradesNote}</small>
        {activeCount ? <span className="cf-badge">{activeCount}</span> : null}
      </Link>
    </div>
  );
}

function Attention({ items, sideOf }: { items: ReturnType<typeof sortActive>; sideOf: (t: Trade) => 'buyer' | 'seller' }) {
  const config = useConfig();
  const { trade, next } = items[0];
  const asset = assetInfo(trade.asset, trade.assetDecimals, config);
  const role = sideOf(trade);
  const title = rowTitle(trade, role, formatAmount(trade.amount, asset), formatFiatAmount(trade.fiatAmount, trade.fiat));
  const t = useMessages().home;
  return (
    <section className="cf-card s-action" data-flush>
      <div className="cf-card__section cf-stack" data-gap="3">
        <span className="cf-stepper">{t.attention}</span>
        <div className="cf-row" data-between data-nowrap>
          <div className="s-cell">
            <strong>{title}</strong>
            <span className="cf-small cf-muted">{t.yourTurn(next.step)}</span>
          </div>
          {next.deadline && next.windowSec ? <Countdown deadline={next.deadline} windowSec={next.windowSec} /> : null}
        </div>
        <div className="s-actions">
          <Button variant="primary" to={`/trade/${trade.id}`}>
            {t.continueTrade}
          </Button>
          {items.length > 1 && (
            <Link to="/trades">
              {t.more(items.length - 1)}
            </Link>
          )}
        </div>
      </div>
    </section>
  );
}

function ForYou() {
  const config = useConfig();
  const offers = usePoll(() => apiGet<{ offers: Offer[] }>('/api/offers?onlyOpen=true').then((r) => r.offers), 'offers', REFRESH_MS * 3);
  const ranked = demoFirst(offers.data ?? []).slice(0, FOR_YOU);

  const pairs = [...new Set(ranked.flatMap((o) => (o.document.price.type === 'floating' ? [o.document.price.pair] : [])))];
  const quotes = usePoll(() => loadQuotes(pairs), pairs.join(','), pairs.length ? 30_000 : undefined);
  const identities = [...new Set(ranked.map((o) => o.sellerIdentity))];
  const reputations = usePoll(() => loadReputations(identities), identities.join(','));
  const messages = useMessages();
  const t = messages.home;

  return (
    <section className="cf-card" data-flush>
      <div className="s-sechead">
        <div className="s-cell">
          <h2 className="cf-heading">{t.forYou}</h2>
          <span className="cf-small cf-muted">{t.newest}</span>
        </div>
        <Link to="/offers">{t.seeAll}</Link>
      </div>
      {!offers.data && !offers.error ? (
        <div className="s-item">
          <Skeleton width="60%" />
        </div>
      ) : !offers.data ? (
        <div className="s-item">
          <span className="cf-small cf-muted">
            {offers.error instanceof ApiError ? offers.error.message : t.offersError}{' '}
            <button type="button" className="cf-copy" onClick={offers.reload}>
              {messages.common.tryAgain}
            </button>
          </span>
        </div>
      ) : ranked.length === 0 ? (
        <div className="s-item">
          <span className="cf-small cf-muted">{t.noOffers}</span>
        </div>
      ) : (
        ranked.map((offer) => {
          const doc = offer.document;
          const asset = assetInfo(doc.asset, doc.assetDecimals, config);
          const verb = t.verb(doc.side === 'sell');
          const price = priceOf(offer, quotes.data?.byPair);
          const rep = reputations.data?.get(offer.sellerIdentity);
          return (
            <Link key={offer.offerTxid} className="s-item" to={`/offers/${offer.offerTxid}`}>
              <span className="s-cell">
                <span>
                  <strong>
                    {verb} {asset.symbol}
                  </strong>
                  {' · '}
                  <span className="cf-num">{price === null ? doc.fiat : formatFiat(price, doc.fiat)}</span>
                </span>
                <span className="cf-small cf-muted">
                  {formatRange(doc.min, doc.max, asset)} · {doc.paymentMethods.map(paymentMethodLabel).join(', ')}
                  {rep && ` · ${describeReputation(rep, doc.side)}`}
                </span>
                {isSimulatedOffer(offer) && (
                  <span>
                    <ProvenanceTag kind="sim">{t.simulatedFiat}</ProvenanceTag>
                  </span>
                )}
              </span>
              <span className="cf-btn" data-size="sm">
                {verb}
              </span>
            </Link>
          );
        })
      )}
      <Link className="s-item" to="/offers">
        <span>{t.seeAllOffers}</span>
        <span aria-hidden="true">→</span>
      </Link>
    </section>
  );
}

function Activity({ finished, sideOf, failed, loading, retry }: { finished: Trade[]; sideOf: (t: Trade) => 'buyer' | 'seller'; failed: boolean; loading: boolean; retry: () => void }) {
  const config = useConfig();
  const messages = useMessages();
  const t = messages.home;
  if (loading) {
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
  if (failed) {
    return (
      <section className="cf-card">
        <EmptyState title={t.activityError} action={<Button onClick={retry}>{messages.common.tryAgain}</Button>}>
          {t.activityErrorBody}
        </EmptyState>
      </section>
    );
  }
  if (finished.length === 0) {
    return (
      <section className="cf-card">
        <div className="cf-empty" style={{ padding: 'var(--space-6) var(--space-4)' }}>
          <strong>{t.noActivity}</strong>
          <span>{t.noActivityBody}</span>
        </div>
      </section>
    );
  }
  return (
    <section className="cf-card" data-flush>
      <div className="s-sechead">
        <h2 className="cf-heading">{t.recent}</h2>
        <Link to="/trades?tab=history">{t.allTrades}</Link>
      </div>
      {finished.slice(0, RECENT).map((trade) => {
        const role = sideOf(trade);
        const asset = assetInfo(trade.asset, trade.assetDecimals, config);
        return (
          <Link key={trade.id} className="s-item" to={`/trade/${trade.id}`}>
            <span className="s-cell">
              <strong>{rowTitle(trade, role, formatAmount(trade.amount, asset), formatFiatAmount(trade.fiatAmount, trade.fiat))}</strong>
              <span className="cf-small cf-muted">{historyNote(trade, role)}</span>
            </span>
            <StatusPill state={trade.status} role={role} side={trade.side} />
          </Link>
        );
      })}
    </section>
  );
}
