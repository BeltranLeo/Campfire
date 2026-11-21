import { Link } from 'react-router';
import { apiGet, type Offer, type PublicTradePage } from '../api';
import { assetInfo } from '../assets';
import { Button } from '../components/Button';
import { Details } from '../components/Details';
import { Icon } from '../components/Icon';
import { ProvenanceTag, SimBox } from '../components/Provenance';
import { Skeleton } from '../components/States';
import { useConfig } from '../config';
import { DSPROOF_WATCH_SEC } from '../dsproof';
import { formatFiat, formatRange, fromBaseUnits, paymentMethodLabel } from '../format';
import { usePoll } from '../hooks/usePoll';
import { useMessages } from '../lang';
import { isSimulatedOffer, loadQuotes, priceOf, unique } from '../offerData';

// The front page (Landing-* screens): the two intentions and where to get a wallet, the demo, how a trade works
// (with why nobody waits for blocks folded under it), the latest offers and Campfire's numbers. Every number is real.

export function Landing() {
  const config = useConfig();
  const offers = usePoll(() => apiGet<{ offers: Offer[] }>('/api/offers?onlyOpen=true').then((r) => r.offers), 'offers');
  // Only the totals: the list itself is the public view, and the front page shows none of it.
  const stats = usePoll(() => apiGet<PublicTradePage>('/api/trades?limit=1').then((r) => r.stats), 'trades');
  const latest = offers.data?.slice(0, 3) ?? [];
  const pairs = unique(latest.flatMap((o) => (o.document.price.type === 'floating' ? [o.document.price.pair] : [])));
  const quotes = usePoll(() => loadQuotes(pairs), pairs.join(','), pairs.length ? 30_000 : undefined);
  const demoOffer = offers.data?.find((o) => o.isDemo && o.document.asset === 'BCH') ?? offers.data?.find((o) => o.isDemo);
  const t = useMessages().landing;

  return (
    <main className="s-main" data-site>
      <section className="s-hero">
        <div className="cf-stack">
          <h1>{t.title}</h1>
          <p className="cf-muted s-herolead">{t.lead}</p>
        </div>
        <div className="s-intents">
          <Link className="cf-quick" data-variant="primary" to="/offers?side=buy">
            <Icon name="buy" />
            {t.buy}
            <small>{t.buyHint}</small>
          </Link>
          <Link className="cf-quick" to="/offers?side=sell">
            <Icon name="sell" />
            {t.sell}
            <small>{t.sellHint}</small>
          </Link>
          <p className="s-walletlink">
            {/* Welcome shows how to get a wallet, then connects it. */}
            {t.newcomer} <Link to="/welcome">{t.getWallet}</Link>
          </p>
        </div>
      </section>

      {/* The demo is the safest way to try, so it comes right after the two intentions. */}
      <SimBox tag={t.demoTag} label={t.demoLabel} bodyGap={3}>
        <p>{t.demoBody}</p>
        <div>
          <Button to={demoOffer ? `/offers/${demoOffer.offerTxid}` : '/offers'}>{t.demoButton}</Button>
        </div>
      </SimBox>

      {/* What sets Campfire apart, one plain sentence each. Every card is true today. */}
      <section className="cf-stack">
        <h2 className="cf-title">{t.whyTitle}</h2>
        <div className="s-3">
          {t.why.map((item) => (
            <div key={item.title} className="cf-card cf-stack" data-pad data-gap="1">
              <strong>{item.title}</strong>
              <span className="cf-small cf-muted">{item.body}</span>
            </div>
          ))}
        </div>
      </section>

      <section className="cf-stack">
        <h2 className="cf-title">{t.howTitle}</h2>
        <HowSteps steps={t.how} />
        {/* The 0-conf explanation does not help a newcomer decide, so it is folded; its On-chain tag stays on the summary. */}
        <Details summary={t.safeSummary} tag={<ProvenanceTag kind="chain">{t.safeTag}</ProvenanceTag>}>
          <p className="cf-muted">{t.safeLead}</p>
          <HowSteps steps={t.safe(DSPROOF_WATCH_SEC)} />
        </Details>
      </section>

      <section className="cf-card" data-flush>
        <div className="s-sechead">
          <h2 className="cf-heading">{t.latest}</h2>
          <Link to="/offers">{t.seeAll}</Link>
        </div>
        {offers.data ? (
          latest.map((offer) => {
            const doc = offer.document;
            const asset = assetInfo(doc.asset, doc.assetDecimals, config);
            // Say what the visitor does: a buy offer is where *you* sell.
            const visitorBuys = doc.side === 'sell';
            const deal = visitorBuys ? t.payFiat(doc.fiat) : t.getFiat(doc.fiat);
            const price = priceOf(offer, quotes.data?.byPair);
            return (
              <Link key={offer.offerTxid} className="s-item" to={`/offers/${offer.offerTxid}`}>
                <span className="s-cell">
                  <span>
                    <strong>{visitorBuys ? t.youBuy(asset.symbol) : t.youSell(asset.symbol)}</strong>{' '}
                    · <span className="cf-num">{price === null ? deal : formatFiat(price, doc.fiat)}</span>
                  </span>
                  <span className="cf-small cf-muted">
                    {formatRange(doc.min, doc.max, asset)} ·{' '}
                    {doc.paymentMethods.map((m) => (m === 'simulated' ? t.simulatedPayment : paymentMethodLabel(m))).join(', ')}
                  </span>
                  {isSimulatedOffer(offer) && (
                    <span>
                      <ProvenanceTag kind="sim">{t.demoTag}</ProvenanceTag>
                    </span>
                  )}
                </span>
                <span className="cf-btn" data-size="sm">
                  {visitorBuys ? t.buyButton : t.sellButton}
                </span>
              </Link>
            );
          })
        ) : (
          <div className="s-item">
            <Skeleton width="60%" />
          </div>
        )}
      </section>

      <section className="cf-card" data-pad>
        <div className="cf-stack">
          <div className="cf-row" data-between>
            <h2 className="cf-heading">{t.statsTitle}</h2>
            <ProvenanceTag kind="chain">{t.statsTag}</ProvenanceTag>
          </div>
          <Stats stats={stats.data} openOffers={offers.data?.length} />
          <p className="cf-small cf-subtle">
            {t.proofBefore}
            <Link to="/transparency">{t.proofLink}</Link>
            {t.proofAfter}
            {stats.data && stats.data.demo > 0 && t.mostlyDemo}
          </p>
        </div>
      </section>
    </main>
  );
}

function HowSteps({ steps }: { steps: { title: string; body: string }[] }) {
  return (
    <ol className="s-howto">
      {steps.map((step, i) => (
        <li key={step.title}>
          <i>{i + 1}</i>
          <span>
            <strong>{step.title}</strong>
            <span className="cf-small cf-muted">{step.body}</span>
          </span>
        </li>
      ))}
    </ol>
  );
}

function Stats({ stats, openOffers }: { stats?: PublicTradePage['stats']; openOffers?: number }) {
  const sats = stats ? BigInt(stats.bchSats) : undefined;
  const value = (v: string | undefined) => (v === undefined ? <Skeleton width={64} height={28} /> : v);
  const t = useMessages().landing;
  return (
    <div className="s-3">
      <div className="s-stat">
        <strong>{value(stats?.completed.toString())}</strong>
        <span className="cf-small cf-muted">{t.tradesCompleted(stats?.completed ?? 0)}</span>
      </div>
      <div className="s-stat">
        <strong>{value(sats === undefined ? undefined : `${trimZeros(fromBaseUnits(sats, 8))} BCH`)}</strong>
        <span className="cf-small cf-muted">{t.traded}</span>
      </div>
      <div className="s-stat">
        <strong>{value(openOffers?.toString())}</strong>
        <span className="cf-small cf-muted">{t.openOffers}</span>
      </div>
    </div>
  );
}

// "0.00005000" → "0.00005"; "1.84000000" → "1.84".
const trimZeros = (decimal: string) => decimal.replace(/\.?0+$/, '');
