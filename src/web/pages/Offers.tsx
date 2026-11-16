import { useState } from 'react';
import { useSearchParams } from 'react-router';
import { ApiError, apiGet, type Offer, type PriceQuote, type Reputation } from '../api';
import { assetInfo } from '../assets';
import { Button } from '../components/Button';
import { OfferHead, OfferRow, OfferRowSkeleton } from '../components/OfferRow';
import { EmptyState, Notice } from '../components/States';
import { useConfig } from '../config';
import {
  applyMargin,
  describeMargin,
  formatClock,
  formatDayMonth,
  formatFiat,
  formatPaymentWindow,
  formatRange,
} from '../format';
import { usePoll } from '../hooks/usePoll';

// The offer list (Offers-* screens). The visitor starts from an intention: "I want to buy" lists
// sell offers, "I want to sell" lists buy offers. The choice lives in the URL (?side=sell) so the
// landing page and Home can link straight to it.

const QUOTE_INTERVAL_MS = 30_000;

export function Offers() {
  const [params, setParams] = useSearchParams();
  const intent = params.get('side') === 'sell' ? 'sell' : 'buy';
  // Buying means taking someone's sell offer, and the other way round.
  const offerSide = intent === 'buy' ? 'sell' : 'buy';
  const config = useConfig();

  const offers = usePoll(() => apiGet<{ offers: Offer[] }>('/api/offers?onlyOpen=true').then((r) => r.offers), 'offers');
  const all = offers.data ?? [];

  // One quote per floating pair, refreshed every 30 s. A pair whose quote fails shows no price.
  const pairs = unique(all.flatMap((o) => (o.document.price.type === 'floating' ? [o.document.price.pair] : [])));
  const quotes = usePoll(() => loadQuotes(pairs), pairs.join(','), pairs.length ? QUOTE_INTERVAL_MS : undefined);

  const identities = unique(all.map((o) => o.sellerIdentity));
  const reputations = usePoll(() => loadReputations(identities), identities.join(','));

  const [coin, setCoin] = useState('');
  const [fiat, setFiat] = useState('');
  const [method, setMethod] = useState('');
  const clearFilters = () => {
    setCoin('');
    setFiat('');
    setMethod('');
  };
  // Each side has its own filter choices, so a filter from the other side would hide everything.
  const switchTo = (next: 'buy' | 'sell') => {
    if (next === intent) return;
    clearFilters();
    setParams(next === 'sell' ? { side: 'sell' } : {});
  };

  const sideOffers = all.filter((o) => o.document.side === offerSide);
  const rows = sideOffers
    .map((offer) => ({ offer, asset: assetInfo(offer.document.asset, offer.document.assetDecimals, config) }))
    .filter(
      ({ offer, asset }) =>
        (!coin || asset.symbol === coin) &&
        (!fiat || offer.document.fiat === fiat) &&
        (!method || offer.document.paymentMethods.includes(method)),
    )
    // Demo offers first (the way in for a first visit), then BCH before tokens; otherwise the service's order.
    .sort((a, b) => Number(b.offer.isDemo) - Number(a.offer.isDemo) || Number(b.asset.isBch) - Number(a.asset.isBch));

  // Filter choices come from the offers on this side, not from a fixed list.
  const coinOptions = unique(sideOffers.map((o) => assetInfo(o.document.asset, o.document.assetDecimals, config).symbol));
  const fiatOptions = unique(sideOffers.map((o) => o.document.fiat));
  const methodOptions = unique(sideOffers.flatMap((o) => o.document.paymentMethods));

  const showSkeleton = offers.loading && !offers.data;
  const failed = !offers.data && Boolean(offers.error);
  const updated = quotes.data?.updatedAt ? ` · Prices updated ${formatClock(quotes.data.updatedAt)}` : '';
  const status = showSkeleton
    ? 'Loading offers…'
    : failed
      ? 'Offers unavailable'
      : `${rows.length} open ${rows.length === 1 ? 'offer' : 'offers'}`;

  const party = offerSide === 'sell' ? 'Seller' : 'Buyer';

  return (
    <main className="s-main">
      <div className="s-pagehead">
        <h1 className="cf-title">Offers</h1>
      </div>

      <div className="s-toolbar">
        <div className="cf-seg" role="group" aria-label="What do you want to do">
          <button type="button" aria-pressed={intent === 'buy'} onClick={() => switchTo('buy')}>
            I want to buy
          </button>
          <button type="button" aria-pressed={intent === 'sell'} onClick={() => switchTo('sell')}>
            I want to sell
          </button>
        </div>
        <div className="s-filters">
          <Filter label="Coin" any="Any coin" value={coin} options={coinOptions} onChange={setCoin} />
          <Filter label="Currency" any="Any currency" value={fiat} options={fiatOptions} onChange={setFiat} />
          <Filter label="Payment method" any="Any payment method" value={method} options={methodOptions} onChange={setMethod} />
        </div>
      </div>
      <span className="cf-small cf-muted">
        {status}
        {updated}
      </span>

      {showSkeleton ? (
        <section className="cf-card" data-flush aria-busy="true">
          <OfferRowSkeleton />
          <OfferRowSkeleton />
          <OfferRowSkeleton />
        </section>
      ) : failed ? (
        <section className="cf-card">
          <div className="cf-stack">
            <LoadError error={offers.error} />
            <div className="s-actions">
              <Button variant="primary" onClick={offers.reload}>
                Try again
              </Button>
            </div>
          </div>
        </section>
      ) : rows.length === 0 ? (
        <section className="cf-card">
          <EmptyOffers
            intent={intent}
            filtered={sideOffers.length > 0}
            onClear={clearFilters}
          />
        </section>
      ) : (
        <section className="cf-card" data-flush>
          <OfferHead first={offerSide === 'sell' ? 'Asset and price' : 'They want and pay'} party={party} />
          {rows.map(({ offer, asset }) => {
            const doc = offer.document;
            const price = priceOf(offer, quotes.data?.byPair);
            const rep = reputations.data?.get(offer.sellerIdentity);
            return (
              <OfferRow
                key={offer.offerTxid}
                coin={asset.coin}
                symbol={asset.symbol}
                price={price === null ? null : formatFiat(price, doc.fiat)}
                priceNote={doc.price.type === 'fixed' ? 'Fixed price' : describeMargin(doc.price.marginBps)}
                isDemo={offer.isDemo}
                range={formatRange(doc.min, doc.max, asset)}
                paymentMethods={doc.paymentMethods}
                paymentWindow={formatPaymentWindow(doc.paymentWindowSec)}
                partyLabel={party}
                partyIdentity={offer.sellerIdentity}
                reputation={rep ? describeReputation(rep, offerSide) : null}
                arbiter={doc.arbiter}
                offerTxid={offer.offerTxid}
                action={
                  // The demo offers are the one-click way in for the jury, so they carry the primary button.
                  <Button variant={offer.isDemo ? 'primary' : undefined} to={`/offers/${offer.offerTxid}`}>
                    {intent === 'buy' ? 'Buy' : 'Sell'}
                  </Button>
                }
              />
            );
          })}
        </section>
      )}

      <p className="cf-small cf-subtle">
        Completed trades are counted by Campfire. The number cannot be verified on-chain and can be inflated with a
        second wallet.
      </p>
    </main>
  );
}

function Filter(props: { label: string; any: string; value: string; options: string[]; onChange: (value: string) => void }) {
  return (
    <select className="cf-select" aria-label={props.label} value={props.value} onChange={(e) => props.onChange(e.target.value)}>
      <option value="">{props.any}</option>
      {props.options.map((option) => (
        <option key={option} value={option}>
          {option}
        </option>
      ))}
    </select>
  );
}

function EmptyOffers({ intent, filtered, onClear }: { intent: 'buy' | 'sell'; filtered: boolean; onClear: () => void }) {
  if (filtered) {
    return (
      <EmptyState title="No offers match these filters" action={<Button onClick={onClear}>Clear filters</Button>}>
        Try another coin, currency or payment method.
      </EmptyState>
    );
  }
  if (intent === 'sell') {
    return (
      <EmptyState title="No buy offers right now" action={<Button to="/offers/new">Publish an offer</Button>}>
        Offers to buy appear here as soon as a buyer publishes one on-chain.
      </EmptyState>
    );
  }
  return (
    <EmptyState title="No open offers right now" action={<Button to="/offers/new">Publish an offer</Button>}>
      Offers appear here as soon as a seller publishes one on-chain.
    </EmptyState>
  );
}

// A message the server wrote for people (a 4xx) is shown as it is; anything else gets the design's text.
function LoadError({ error }: { error: unknown }) {
  const serverMessage = error instanceof ApiError && error.status >= 400 && error.status < 500 ? error.message : null;
  return (
    <Notice tone="danger" title="We could not load the offers">
      {serverMessage ?? 'The server did not answer. Offers are published on-chain, so nothing is lost.'}
    </Notice>
  );
}

function priceOf(offer: Offer, quotes: Map<string, PriceQuote> | undefined): number | null {
  const price = offer.document.price;
  if (price.type === 'fixed') return Number(price.value);
  const quote = quotes?.get(price.pair);
  return quote ? applyMargin(quote.price, price.marginBps) : null;
}

// The count for the role the person has on this offer: sellers on sell offers, buyers on buy offers.
function describeReputation(rep: Reputation, offerSide: 'sell' | 'buy'): string {
  const count = offerSide === 'sell' ? rep.completedAsSeller : rep.completedAsBuyer;
  if (count === 0 || rep.firstCompletedAt === null) return `0 completed · new ${offerSide === 'sell' ? 'seller' : 'buyer'}`;
  return `${count} completed · since ${formatDayMonth(rep.firstCompletedAt)}`;
}

async function loadQuotes(pairs: string[]): Promise<{ byPair: Map<string, PriceQuote>; updatedAt: Date | null }> {
  const results = await Promise.allSettled(
    pairs.map((pair) => apiGet<{ quote: PriceQuote }>(`/api/oracle/quote?pair=${encodeURIComponent(pair)}`)),
  );
  const byPair = new Map<string, PriceQuote>();
  results.forEach((result, i) => {
    if (result.status === 'fulfilled') byPair.set(pairs[i], result.value.quote);
  });
  // "Prices updated" tells when the oracle observed the oldest price shown, not when this page fetched it.
  const oldest = Math.min(...[...byPair.values()].map((q) => q.timestamp));
  return { byPair, updatedAt: byPair.size ? new Date(oldest * 1000) : null };
}

async function loadReputations(identities: string[]): Promise<Map<string, Reputation>> {
  const results = await Promise.allSettled(identities.map((id) => apiGet<Reputation>(`/api/identities/${id}/reputation`)));
  const map = new Map<string, Reputation>();
  results.forEach((result, i) => {
    if (result.status === 'fulfilled') map.set(identities[i], result.value);
  });
  return map;
}

function unique(values: string[]): string[] {
  return [...new Set(values)].sort();
}
