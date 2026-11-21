import { useState } from 'react';
import { useSearchParams } from 'react-router';
import { SIMULATED_PAYMENT_METHOD } from '../../protocol/offers.js';
import { aliasFor } from '../alias';
import { ApiError, apiGet, type Offer, type PriceQuote } from '../api';
import { assetInfo, type AssetInfo } from '../assets';
import { Button } from '../components/Button';
import { OfferHeader, OfferRow, OfferRowSkeleton, type OfferColumns } from '../components/OfferRow';
import { EmptyState, Notice } from '../components/States';
import { useConfig } from '../config';
import {
  formatAmount,
  formatClock,
  formatFiat,
  formatFiatAmount,
  formatPaymentWindow,
  formatRange,
  paymentMethodLabel,
} from '../format';
import { fiatForUnits, parseFiatCents, unitsForFiat } from '../fiatAmount';
import { parseAmount } from '../take';
import { usePoll } from '../hooks/usePoll';
import { isSimulatedOffer, loadQuotes, loadReputations, priceOf, unique } from '../offerData';
import { filterOptions, offerTakes } from '../paymentMethods';

// The offer list (Offers-* screens). The visitor starts from an intention: "I want to buy" lists
// sell offers, "I want to sell" lists buy offers. The choice lives in the URL (?side=sell) so the
// landing page and Home can link straight to it.

const QUOTE_INTERVAL_MS = 30_000;

export function Offers() {
  const [params, setParams] = useSearchParams();
  // The link decides; without one, the list starts on buying.
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

  // The filters start empty: every open offer is shown until the visitor narrows the list.
  const [chosenCoin, setCoin] = useState('');
  const [chosenFiat, setFiat] = useState('');
  const [chosenMethod, setMethod] = useState('');
  // What the visitor wants to pay (buying) or sell (selling). Component state only: it is a question, not a setting.
  const [amount, setAmount] = useState('');
  const [filtersOpen, setFiltersOpen] = useState(false);
  const clearFilters = () => {
    setCoin('');
    setFiat('');
    setMethod('');
  };
  // Each side has its own filter choices, so a filter from the other side would hide everything.
  const switchTo = (next: 'buy' | 'sell') => {
    if (next === intent) return;
    clearFilters();
    setAmount('');
    setParams({ side: next });
  };

  const sideOffers = all.filter((o) => o.document.side === offerSide);

  // Coin and currency choices come from the offers on this side, not from a fixed list.
  const coinOptions = unique(sideOffers.map((o) => assetInfo(o.document.asset, o.document.assetDecimals, config).symbol));
  const fiatOptions = unique(sideOffers.map((o) => o.document.fiat));
  // A choice counts only while it is one of the options. Otherwise the select would show "Any …" while a
  // value left over from the other side (the back button) silently hid every offer.
  const coin = coinOptions.includes(chosenCoin) ? chosenCoin : '';
  const fiat = fiatOptions.includes(chosenFiat) ? chosenFiat : '';
  // Methods come from Campfire's fixed list, for the chosen currency or all of them, so the choices do not depend on
  // how each author spelled theirs. Offers whose only methods are typed by hand show with "Any method".
  const methodOptions = filterOptions(fiat);
  const method = methodOptions.includes(chosenMethod) ? chosenMethod : '';

  const activeFilters = [coin, fiat, method].filter(Boolean).length;

  const filtered = sideOffers
    .map((offer) => ({ offer, asset: assetInfo(offer.document.asset, offer.document.assetDecimals, config) }))
    .filter(
      ({ offer, asset }) =>
        (!coin || asset.symbol === coin) &&
        (!fiat || offer.document.fiat === fiat) &&
        (!method || offerTakes(offer.document.paymentMethods, offer.document.fiat, method)),
    );

  // The pay field needs one currency. Use the filtered one, else the one most listed offers are in.
  const payFiat = fiat || majority(filtered.map(({ offer }) => offer.document.fiat));
  const payCents = intent === 'buy' ? parseFiatCents(amount) : null;
  const sellUnits = intent === 'sell' ? parseAmount(amount, 8) : null;
  const typed = amount.trim() !== '';
  const hasAmount = (payCents !== null && payFiat !== '') || (sellUnits !== null && sellUnits > 0n);

  const quoted = filtered.map(({ offer, asset }) => {
    const doc = offer.document;
    const price = priceOf(offer, quotes.data?.byPair);
    const rate = unitRate(offer, quotes.data?.byPair);
    // Fixed order key: what the visitor gets for their amount, or null when the offer cannot answer.
    let result: { text: string; sortKey: number } | null = null;
    // Which end of the range the typed amount crossed, so the row can name the limit instead of just saying no.
    let outside: 'below' | 'above' | false = false;
    if (hasAmount && rate) {
      if (payCents !== null && doc.fiat === payFiat) {
        const units = unitsForFiat({ fiatCents: payCents, unitPrice: rate.unitPrice, marginBps: rate.marginBps, assetDecimals: asset.decimals });
        if (units === null) result = null;
        else if (units < BigInt(doc.min)) outside = 'below';
        else if (units > BigInt(doc.max)) outside = 'above';
        else result = { text: `≈ ${formatAmount(units, asset)}`, sortKey: Number(units) / 10 ** asset.decimals };
      } else if (sellUnits !== null && asset.isBch) {
        if (sellUnits < BigInt(doc.min)) outside = 'below';
        else if (sellUnits > BigInt(doc.max)) outside = 'above';
        else {
          const worth = fiatForUnits({ units: sellUnits, unitPrice: rate.unitPrice, marginBps: rate.marginBps, assetDecimals: asset.decimals });
          if (worth !== null) result = { text: `≈ ${formatFiatAmount(worth, doc.fiat)}`, sortKey: Number(worth) };
        }
      }
    }
    return { offer, asset, price, rate, result, outside, applies: hasAmount && (payCents !== null ? doc.fiat === payFiat : asset.isBch) };
  });

  const rows = hasAmount
    ? // Answers first (most for the money), then offers that cannot answer, in the service's order.
      [...quoted].sort((a, b) => (b.result?.sortKey ?? -1) - (a.result?.sortKey ?? -1))
    : // Demo offers first (the way in for a first visit), then BCH before tokens; otherwise the service's order.
      [...quoted].sort((a, b) => Number(b.offer.isDemo) - Number(a.offer.isDemo) || Number(b.asset.isBch) - Number(a.asset.isBch));

  const showSkeleton = offers.loading && !offers.data;
  const failed = !offers.data && Boolean(offers.error);
  const columns: OfferColumns = {
    party: intent === 'buy' ? 'Seller' : 'Buyer',
    // Fixed even with an amount typed: "You get …" and "Min …" name themselves, and offers in another currency
    // keep showing their limits in the same column.
    limits: 'Limits',
    payment: intent === 'buy' ? 'Pay by' : 'Paid by',
  };
  const updated = quotes.data?.updatedAt ? ` · Prices updated ${formatClock(quotes.data.updatedAt)}` : '';
  const status = showSkeleton
    ? 'Loading offers…'
    : failed
      ? 'Offers unavailable'
      : hasAmount
        ? `${rows.length} ${rows.length === 1 ? 'offer' : 'offers'} · most ${intent === 'buy' ? 'BCH' : 'money'} for your ${intent === 'buy' ? 'money' : 'BCH'} first`
        : `${rows.length} open ${rows.length === 1 ? 'offer' : 'offers'}`;

  return (
    // Wide on a computer: the offers are a table, compared by reading down each column.
    <main className="s-main" data-wide>
      {/* Title and side in one row, so the list starts high on a phone. */}
      <div className="s-pagehead o-head">
        <h1 className="cf-display">Offers</h1>
        <div className="cf-seg" role="group" aria-label="What do you want to do">
          <button type="button" aria-pressed={intent === 'buy'} onClick={() => switchTo('buy')}>
            Buy
          </button>
          <button type="button" aria-pressed={intent === 'sell'} onClick={() => switchTo('sell')}>
            Sell
          </button>
        </div>
      </div>
      {/* What the choice means in one short sentence: who sends what, and what keeps the visitor safe on that side. */}
      <p className="s-intent cf-small cf-muted">
        {intent === 'buy'
          ? `You pay the seller directly. Their ${coin || 'coins'} ${coin ? 'is' : 'are'} locked in a contract before you pay.`
          : `The buyer pays you directly. You lock your ${coin || 'coins'} only after you accept their request.`}
      </p>
      {/* The amount is the question most visitors have, so it stays out; the three filters fold behind one button. */}
      <div className="o-ask">
        {!showSkeleton && !failed && sideOffers.length > 0 && (intent === 'sell' || payFiat) && (
          <div className="cf-field o-amount">
            <label htmlFor="offers-amount">{intent === 'buy' ? 'I want to pay' : 'I want to sell'}</label>
            <div className="cf-inputgroup">
              <input
                id="offers-amount"
                className="cf-input o-amountinput"
                inputMode="decimal"
                autoComplete="off"
                placeholder={intent === 'buy' ? '10,000' : '0.01'}
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                aria-describedby={typed && !hasAmount ? 'offers-amount-hint' : undefined}
              />
              <span className="cf-addon">{intent === 'buy' ? payFiat : 'BCH'}</span>
            </div>
            {typed && !hasAmount && (
              <span id="offers-amount-hint" className="cf-hint">
                Enter an amount like {intent === 'buy' ? '10,000' : '0.01'}.
              </span>
            )}
          </div>
        )}
        <button
          type="button"
          className="cf-btn o-filterbtn"
          aria-expanded={filtersOpen}
          aria-controls="offers-filters"
          onClick={() => setFiltersOpen(!filtersOpen)}
        >
          {activeFilters ? `Filters (${activeFilters})` : 'Filters'}
        </button>
      </div>
      {filtersOpen && (
        // Each filter says which side of the trade it describes, in the same words as the columns below.
        <div className="s-filters" id="offers-filters">
          <Filter
            id="offers-coin"
            label={intent === 'buy' ? 'You get' : 'You give'}
            any="Any coin"
            value={coin}
            options={coinOptions}
            onChange={setCoin}
          />
          <Filter
            id="offers-fiat"
            label={intent === 'buy' ? 'You pay in' : 'You get paid in'}
            any="Any currency"
            value={fiat}
            options={fiatOptions}
            onChange={setFiat}
          />
          <Filter
            id="offers-method"
            label={intent === 'buy' ? 'You pay by' : 'You get paid by'}
            any="Any method"
            value={method}
            options={methodOptions}
            optionLabel={paymentMethodLabel}
            onChange={setMethod}
          />
        </div>
      )}
      <div className="o-status">
        <span className="cf-small cf-muted">
          {status}
          {updated}
        </span>
        {/* The same place on both sides: no offer fits, so post the one you want. */}
        <Button size="sm" to={intent === 'buy' ? '/offers/new?side=buy' : '/offers/new'}>
          Create offer
        </Button>
      </div>

      {showSkeleton ? (
        <section className="cf-card" data-flush aria-busy="true">
          <OfferHeader columns={columns} />
          <ul className="o-list">
            <OfferRowSkeleton />
            <OfferRowSkeleton />
            <OfferRowSkeleton />
          </ul>
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
        <section className="cf-card" data-flush aria-label={`Offers to ${intent}`}>
          <OfferHeader columns={columns} />
          <ul className="o-list">
            {rows.map(({ offer, asset, price, rate, result, outside, applies }) => {
              const doc = offer.document;
              const alias = aliasFor(offer.sellerIdentity);
              const rep = reputations.data?.get(offer.sellerIdentity);
              const trades = rep ? (offerSide === 'sell' ? rep.completedAsSeller : rep.completedAsBuyer) : null;
              const limits = rangeTexts(doc.min, doc.max, doc.fiat, asset, rate);
              // Without a typed amount the column shows the limits; with one, the answer or the limit it crossed.
              let main = limits.fiat ?? limits.coin;
              let tone: 'answer' | 'outside' | undefined;
              if (applies && result) {
                main = `You get ${result.text}`;
                tone = 'answer';
              } else if (applies && outside) {
                const edge = outside === 'below' ? 'Min' : 'Max';
                const fiatEdge = outside === 'below' ? limits.fiatMin : limits.fiatMax;
                const coinEdge = formatAmount(outside === 'below' ? doc.min : doc.max, asset);
                main = `${edge} ${intent === 'buy' && fiatEdge ? fiatEdge : coinEdge}`;
                tone = 'outside';
              } else if (applies) {
                main = '—';
              }
              return (
                <OfferRow
                  key={offer.offerTxid}
                  to={`/offers/${offer.offerTxid}`}
                  columns={columns}
                  party={
                    offer.isDemo
                      ? { initials: 'DS', name: 'Demo seller', detail: 'Run by Campfire', demo: true }
                      : { initials: alias.initials, name: alias.name, detail: trades === null ? null : tradesText(trades), demo: false }
                  }
                  price={price === null ? null : formatFiat(price, doc.fiat)}
                  priceDetail={`per ${asset.symbol} · ${priceKind(doc.price)}`}
                  limits={main}
                  limitsTone={tone}
                  limitsDetail={tone || !limits.fiat ? (limits.fiat ?? limits.coin) : limits.coin}
                  methods={doc.paymentMethods.filter((m) => m !== SIMULATED_PAYMENT_METHOD).map(paymentMethodLabel)}
                  simulated={isSimulatedOffer(offer)}
                  paymentWindow={formatPaymentWindow(doc.paymentWindowSec)}
                  action={intent === 'buy' ? 'Buy' : 'Sell'}
                />
              );
            })}
          </ul>
        </section>
      )}

      <p className="cf-small cf-muted">
        Names like Quiet Ember come from each person's key. Nobody chooses them, and trade counts come from Campfire
        and can be inflated with a second wallet.
      </p>
    </main>
  );
}

/** The price per whole coin as text, plus the margin to apply: the offer's own price, exactly as the trade will use it. */
function unitRate(offer: Offer, quotes: Map<string, PriceQuote> | undefined): { unitPrice: string; marginBps: number } | null {
  const price = offer.document.price;
  if (price.type === 'fixed') return { unitPrice: price.value, marginBps: 0 };
  const quote = quotes?.get(price.pair);
  return quote ? { unitPrice: quote.price, marginBps: price.marginBps } : null;
}

/** "21 trades", "1 trade", "No trades yet". */
function tradesText(count: number): string {
  return count === 0 ? 'No trades yet' : `${count} ${count === 1 ? 'trade' : 'trades'}`;
}

/** Whether the price follows the market: "at market", "market +2%", "market −1%", or "fixed price". */
function priceKind(price: Offer['document']['price']): string {
  if (price.type === 'fixed') return 'fixed price';
  if (price.marginBps === 0) return 'at market';
  return `market ${price.marginBps > 0 ? '+' : '−'}${Math.abs(price.marginBps) / 100}%`;
}

/**
 * The offer's limits in the coin ("0.001 – 0.02 BCH") and, when the price is known, in its fiat ("354 – 7,084
 * ARS"), at the price the trade would use. The fiat ends are kept for the "Min" and "Max" answers.
 */
function rangeTexts(
  min: string,
  max: string,
  fiat: string,
  asset: AssetInfo,
  rate: { unitPrice: string; marginBps: number } | null,
): { coin: string; fiat: string | null; fiatMin: string | null; fiatMax: string | null } {
  const coin = formatRange(min, max, asset);
  const atPrice = (units: string) =>
    rate ? fiatForUnits({ units: BigInt(units), unitPrice: rate.unitPrice, marginBps: rate.marginBps, assetDecimals: asset.decimals }) : null;
  const low = atPrice(min);
  const high = atPrice(max);
  if (low === null || high === null) return { coin, fiat: null, fiatMin: null, fiatMax: null };
  const fiatMin = formatFiatAmount(wholeAbove100(low, 'up'), fiat);
  const fiatMax = formatFiatAmount(wholeAbove100(high, 'down'), fiat);
  return { coin, fiat: `${fiatMin.slice(0, -(fiat.length + 1))} – ${fiatMax}`, fiatMin, fiatMax };
}

/**
 * Cents add nothing to a limit of hundreds or thousands, and they push the range onto two lines. From 100 up the
 * limit is a whole number, rounded inwards (the minimum up, the maximum down) so the range shown stays inside the
 * real one.
 */
function wholeAbove100(decimal: string, direction: 'up' | 'down'): string {
  const [whole, fraction = ''] = decimal.split('.');
  if (BigInt(whole) < 100n) return decimal;
  const rest = /[1-9]/.test(fraction);
  return (direction === 'up' && rest ? BigInt(whole) + 1n : BigInt(whole)).toString();
}

/** The most common value, or '' for an empty list. */
function majority(values: string[]): string {
  const counts = new Map<string, number>();
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);
  let best = '';
  for (const [value, count] of counts) if (count > (counts.get(best) ?? 0)) best = value;
  return best;
}

function Filter(props: {
  id: string;
  label: string;
  any: string;
  value: string;
  options: string[];
  /** The text shown for an option; its value stays as the offers store it, so filtering keeps working. */
  optionLabel?: (option: string) => string;
  onChange: (value: string) => void;
}) {
  return (
    <div className="cf-field">
      <label htmlFor={props.id}>{props.label}</label>
      <select id={props.id} className="cf-select" value={props.value} onChange={(e) => props.onChange(e.target.value)}>
        <option value="">{props.any}</option>
        {props.options.map((option) => (
          <option key={option} value={option}>
            {props.optionLabel ? props.optionLabel(option) : option}
          </option>
        ))}
      </select>
    </div>
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
    <EmptyState title="No open offers right now" action={<Button to="/offers/new?side=buy">Publish an offer</Button>}>
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
