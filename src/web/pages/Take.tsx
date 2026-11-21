import { useState, type ReactNode } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { verifyPriceQuote } from '../../protocol/trades.js';
import { expectedEscrowFunding } from '../../protocol/escrow.js';
import { onlySimulatedPayment } from '../../protocol/offers.js';
import { aliasFor } from '../alias';
import { ApiError, apiGet, apiPost, type DemoInfo, type Offer, type PriceQuote, type Reputation, type TradeSummary } from '../api';
import { assetInfo, type AssetInfo } from '../assets';
import { Button } from '../components/Button';
import { CoinIcon } from '../components/CoinIcon';
import { Details } from '../components/Details';
import { noWalletNote } from '../components/NoWalletNote';
import { Term } from '../components/Term';
import { HashLink, ProvenanceTag } from '../components/Provenance';
import { EmptyState, Notice, Skeleton } from '../components/States';
import { reversibleWarning } from '../paymentMethods';
import { useConfig } from '../config';
import { applyMargin, formatAmount, formatBch, formatClock, formatFiat, formatFiatAmount, formatPaymentWindow, formatRange, paymentMethodLabel, toAmountInput } from '../format';
import { fiatForUnits } from '../fiatAmount';
import { useFindingAddressNote } from '../hooks/useBusyStep';
import { prepareIndices } from '../indices';
import { canDeposit, checkDeposit } from '../seller';
import { spendableBch, tokenBalance } from '../coins';
import { useWalletCoins } from '../walletCoins';
import { useNow } from '../hooks/useNow';
import { usePoll } from '../hooks/usePoll';
import {
  browserStore,
  buildSellerTakeRequest,
  buildTakeRequest,
  commitSession,
  demoLimitKind,
  findStartedTrade,
  generateSessionKeyPair,
  parseAmount,
  payoutAddress,
  savePendingSession,
} from '../take';
import { effectiveMode, resolveAmount, usablePrice, type AmountMode } from '../takeAmount';
import { useWallet } from '../wallet';
import { useMessages } from '../lang';

// Taking an offer (Take-* screens). On a sell offer the buyer chooses an amount, sees an indicative signed quote and
// takes the offer without signing anything; against the demo seller the answer comes back already funded. On a buy
// offer (Take-Buy) the seller chooses the amount and sends a request, also unsigned: the seller signs only when
// locking the coins, after the buyer accepts.

const QUOTE_INTERVAL_MS = 30_000;
/** The indicative quote is not trusted after this long without a refresh (Take-Expired). */
const QUOTE_MAX_AGE_SEC = 10 * 60;

export function Take() {
  const { offerTxid = '' } = useParams();
  const offer = usePoll(() => apiGet<{ offer: Offer }>(`/api/offers/${offerTxid}`).then((r) => r.offer), offerTxid);
  const config = useConfig();
  const symbol = offer.data ? assetInfo(offer.data.document.asset, offer.data.document.assetDecimals, config).symbol : null;
  const buyOffer = offer.data?.document.side === 'buy';
  const m = useMessages();
  const t = m.take;

  return (
    <main className="s-main" data-narrow>
      <div className="s-pagehead">
        <Link className="s-back" to="/offers">
          {t.back}
        </Link>
        <h1 className="cf-title">{symbol ? (buyOffer ? t.titleSellTo(symbol) : t.titleBuy(symbol)) : t.titleLoading}</h1>
      </div>
      {offer.data ? (
        buyOffer ? <TakeBuyOffer offer={offer.data} /> : <TakeOffer offer={offer.data} />
      ) : offer.loading ? (
        <section className="cf-card" aria-busy="true">
          <div className="cf-stack" data-gap="2">
            <Skeleton width="60%" />
            <Skeleton width="80%" />
            <Skeleton width="45%" />
          </div>
        </section>
      ) : offer.error instanceof ApiError && offer.error.status === 404 ? (
        <section className="cf-card">
          <EmptyState title={t.notFound} action={<Button to="/offers">{t.backToOffers}</Button>}>
            {t.notFoundBody}
          </EmptyState>
        </section>
      ) : (
        <section className="cf-card">
          <div className="cf-stack">
            <Notice tone="danger" title={t.loadError}>
              {offer.error instanceof ApiError ? offer.error.message : t.noAnswer}
            </Notice>
            <div className="s-actions">
              <Button variant="primary" onClick={offer.reload}>
                {m.common.tryAgain}
              </Button>
            </div>
          </div>
        </section>
      )}
    </main>
  );
}

function TakeOffer({ offer }: { offer: Offer }) {
  const doc = offer.document;
  const config = useConfig();
  const asset = assetInfo(doc.asset, doc.assetDecimals, config);
  const wallet = useWallet();
  const navigate = useNavigate();
  const m = useMessages();
  const t = m.take;

  const reputation = usePoll(() => apiGet<Reputation>(`/api/identities/${offer.sellerIdentity}/reputation`), offer.sellerIdentity);
  const demo = usePoll(() => (offer.isDemo ? apiGet<DemoInfo>('/api/demo') : Promise.resolve(null)), String(offer.isDemo));

  // --- Indicative quote, verified against the offer's oracle key ---
  const price = doc.price;
  const quote = usePoll(
    () =>
      price.type === 'floating'
        ? apiGet<{ quote: PriceQuote }>(`/api/oracle/quote?pair=${encodeURIComponent(price.pair)}`).then((r) => r.quote)
        : Promise.resolve(null),
    price.type === 'floating' ? price.pair : 'fixed',
    price.type === 'floating' ? QUOTE_INTERVAL_MS : undefined,
  );
  const now = useNow(15_000);
  const verified =
    price.type === 'floating' && quote.data && doc.oracle && quote.data.pair === price.pair && verifyPriceQuote(quote.data, doc.oracle)
      ? quote.data
      : null;
  const expired = verified !== null && now / 1000 - verified.timestamp > QUOTE_MAX_AGE_SEC;
  const unitPrice = price.type === 'fixed' ? price.value : verified?.price ?? null;
  const marginBps = price.type === 'floating' ? price.marginBps : 0;

  // --- Amount: money by default, because that is what the buyer has in mind ---
  const asked = { min: BigInt(doc.min), max: BigInt(doc.max), assetDecimals: doc.assetDecimals, unitPrice, marginBps };
  const priced = usablePrice(unitPrice, marginBps, doc.assetDecimals);
  const [wanted, setWanted] = useState<AmountMode>('fiat');
  const [fiatInput, setFiatInput] = useState<string | null>(null);
  const [coinInput, setCoinInput] = useState(() => toAmountInput(doc.min, asset));
  const mode = effectiveMode(wanted, { hasPrice: priced });
  const priceArgs = unitPrice ? { unitPrice, marginBps, assetDecimals: doc.assetDecimals } : null;
  const fiatOf = (units: bigint) => (priceArgs && priced ? fiatForUnits({ units, ...priceArgs }) : null);
  // Until the buyer types, the field offers the fiat price of the smallest amount.
  const input = mode === 'fiat' ? (fiatInput ?? fiatOf(BigInt(doc.min)) ?? '') : coinInput;
  const result = resolveAmount({ ...asked, mode, input });
  const amount = result.units;
  const inRange = result.state === 'ok';
  const coinRange = t.rangeEnds(toAmountInput(doc.min, asset), formatAmount(doc.max, asset));
  const fiatRange = (() => {
    const lo = fiatOf(BigInt(doc.min));
    const hi = fiatOf(BigInt(doc.max));
    return lo && hi ? t.rangeEnds(formatFiatAmount(lo, '').trim(), `${formatFiatAmount(hi, '').trim()} ${doc.fiat}`) : coinRange;
  })();
  // What the buyer pays is recomputed from the units that will be sent, never from the number typed.
  const payFiat = amount !== null && amount > 0n ? fiatOf(amount) : null;
  const youPay = payFiat ? formatFiatAmount(payFiat, doc.fiat) : null;

  function chooseMode(next: AmountMode) {
    // Carry the amount across so switching does not lose what was typed.
    if (amount !== null && amount > 0n) {
      if (next === 'coin') setCoinInput(toAmountInput(amount, asset));
      else if (fiatOf(amount)) setFiatInput(fiatOf(amount));
    }
    setWanted(next);
  }

  // --- The buyer's keys: next Campfire indices, and a payout address never used on-chain ---
  const identity = wallet.status === 'connected' ? wallet.identity : null;
  const xpubs = wallet.xpubs;
  const findingNote = useFindingAddressNote();
  const prep = usePoll(() => (identity && xpubs ? prepareIndices(identity, xpubs, 'buyer') : Promise.resolve(null)), identity ?? 'none');
  const payout = prep.data && xpubs ? payoutAddress(xpubs.receive, prep.data.receive, !asset.isBch) : null;

  // --- Taking ---
  const [taking, setTaking] = useState(false);
  const [limit, setLimit] = useState<string | null>(null);
  const [failure, setFailure] = useState<string | null>(null);

  async function take() {
    if (!identity || !xpubs || !prep.data || amount === null) return;
    setTaking(true);
    setLimit(null);
    setFailure(null);
    const store = browserStore();
    const session = generateSessionKeyPair();
    if (store) savePendingSession(store, offer.offerTxid, session);
    const body = buildTakeRequest({
      offerTxid: offer.offerTxid,
      identity,
      amount,
      defiXpub: xpubs.defi,
      receiveXpub: xpubs.receive,
      defiIndex: prep.data.defi,
      receiveIndex: prep.data.receive,
      session,
    });
    try {
      const { trade } = await apiPost<{ trade: TradeSummary }>('/api/trades', body);
      if (store) commitSession(store, trade.id, session);
      navigate(`/trade/${trade.id}`);
      return;
    } catch (err) {
      // A 429 means the demo seller turned the take down; nothing was started, so there is nothing to resume.
      if (err instanceof ApiError && err.status === 429) {
        setLimit(err.message);
        setTaking(false);
        return;
      }
      // Any other failure may have come after the trade was recorded: look for it before reporting an error.
      try {
        const { trades } = await apiGet<{ trades: TradeSummary[] }>(`/api/trades?identity=${identity}`);
        const started = findStartedTrade(trades, session.publicKey);
        if (started) {
          if (store) commitSession(store, started.id, session);
          navigate(`/trade/${started.id}`);
          return;
        }
      } catch {
        // Fall through to the original error.
      }
      setFailure(err instanceof ApiError ? err.message : t.somethingWrong);
      setTaking(false);
      prep.reload();
    }
  }

  const ownOffer = identity !== null && identity === offer.sellerIdentity;
  const rep = reputation.data;

  return (
    <>
      <OfferSummary
        asset={asset}
        title={offer.isDemo ? t.fromDemoSeller(asset.symbol) : asset.symbol}
        tag={offer.isDemo && <ProvenanceTag kind="sim">{t.demoTag}</ProvenanceTag>}
        range={formatRange(doc.min, doc.max, asset)}
        methods={doc.paymentMethods}
        window={formatPaymentWindow(doc.paymentWindowSec)}
        party={t.sellerRecord(aliasFor(offer.sellerIdentity).name, rep ? rep.completedAsSeller : null)}
        terms={doc.terms}
      />

      {offer.status !== 'Published' ? (
        <section className="cf-card">
          <EmptyState title={t.closed} action={<Button to="/offers">{t.backToOffers}</Button>}>
            {t.closedBySeller}
          </EmptyState>
        </section>
      ) : (
        <section className="cf-card" data-pad>
          <div className="s-form">
            <div className="cf-field" data-invalid={!inRange || undefined}>
              {/* Pesos or coins for every coin: a PUSD buyer thinks in their own money as much as a BCH buyer. */}
              <div className="tk-label">
                <label htmlFor="amount">{t.youPay}</label>
                <div className="cf-seg" role="group" aria-label={t.typeIn}>
                  <button type="button" aria-pressed={mode === 'fiat'} disabled={!priced} title={priced ? undefined : t.priceUnavailable} onClick={() => chooseMode('fiat')}>
                    {doc.fiat}
                  </button>
                  <button type="button" aria-pressed={mode === 'coin'} onClick={() => chooseMode('coin')}>
                    {asset.symbol}
                  </button>
                </div>
              </div>
              <div className="cf-inputgroup">
                <input
                  id="amount"
                  className="cf-input"
                  data-mono={mode === 'coin' || undefined}
                  inputMode="decimal"
                  value={input}
                  aria-invalid={!inRange || undefined}
                  onChange={(e) => (mode === 'fiat' ? setFiatInput(e.target.value) : setCoinInput(e.target.value))}
                />
                <span className="cf-addon">{mode === 'fiat' ? doc.fiat : asset.symbol}</span>
              </div>
              <span className="cf-hint">
                {mode === 'fiat'
                  ? inRange
                    ? t.between(fiatRange)
                    : result.state === 'invalid'
                      ? t.enterMoney(fiatRange)
                      : t.outside(fiatRange)
                  : inRange
                    ? t.betweenDot(coinRange)
                    : t.enterBetween(coinRange)}
              </span>
            </div>

            {expired ? (
              <Notice tone="attention" title={t.expired}>
                {t.expiredBody}
              </Notice>
            ) : (
              <TakeWell
                label={mode === 'fiat' ? t.youGet : t.youPay}
                big={mode === 'fiat' ? (amount !== null && amount > 0n ? `≈ ${formatAmount(amount, asset)}` : null) : youPay && `≈ ${youPay}`}
                unitPrice={unitPrice}
                marginBps={marginBps}
                fiat={doc.fiat}
                asset={asset}
                lockWhen={t.lockWhenTake}
                loading={price.type === 'floating' && quote.loading && !quote.data}
              />
            )}

            {limit && <LimitNotice message={limit} demo={demo.data ?? null} />}
            {prep.error && !prep.data ? (
              <Notice tone="danger" title={t.prepError}>
                {prep.error instanceof ApiError ? prep.error.message : t.noAnswer}{' '}
                <button type="button" className="cf-copy" onClick={prep.reload}>
                  {m.common.tryAgain}
                </button>
              </Notice>
            ) : null}
            {failure && (
              <Notice tone="danger" title={t.notTaken}>
                {failure}
              </Notice>
            )}

            <div className="s-actions">
              {wallet.status !== 'connected' ? (
                <Button
                  variant="primary"
                  busy={wallet.status === 'pairing' || wallet.status === 'connecting'}
                  onClick={wallet.connect}
                  note={noWalletNote}
                >
                  {t.connectToTake}
                </Button>
              ) : ownOffer ? (
                <Notice>{t.ownOffer}</Notice>
              ) : limit && demoLimitKind(limit) === 'daily' ? (
                <Button variant="primary" to="/transparency">
                  {t.seePastTrades}
                </Button>
              ) : limit && demoLimitKind(limit) === 'funds' ? (
                <Button variant="primary" to="/offers">
                  {t.backToOffers}
                </Button>
              ) : limit ? (
                <Button variant="primary" onClick={take}>
                  {m.common.tryAgain}
                </Button>
              ) : expired ? (
                <Button variant="primary" onClick={quote.reload}>
                  {t.newQuote}
                </Button>
              ) : !inRange || !youPay ? (
                <Button variant="primary" disabled>
                  {t.takeOffer}
                </Button>
              ) : (
                <Button
                  variant="primary"
                  busy={taking}
                  disabled={!prep.data}
                  onClick={take}
                  note={
                    // Say why the button waits: a long-used wallet takes a few seconds to find a fresh address.
                    !prep.data
                      ? findingNote
                      : offer.isDemo
                        ? t.noSignatureDemo
                        : t.noSignature
                  }
                >
                  {t.takeBuy(formatAmount(amount!, asset), youPay)}
                </Button>
              )}
            </div>
            {/* What reassures a first-time buyer, in one line under the button instead of a box above it. */}
            <p className="cf-small cf-muted">
              <strong>{t.noBchNeeded}</strong>{' '}
              {identity ? t.freeWithWallet(prep.data?.fresh !== false) : t.freeNoWallet}
            </p>
          </div>
        </section>
      )}

      <OfferDetails
        offer={offer}
        party="seller"
        quote={verified}
        payout={identity ? { address: payout, fresh: prep.data?.fresh !== false } : null}
      />
    </>
  );
}


// --- Selling to a buy offer (Take-Buy) ---

function TakeBuyOffer({ offer }: { offer: Offer }) {
  const doc = offer.document;
  const config = useConfig();
  const asset = assetInfo(doc.asset, doc.assetDecimals, config);
  const wallet = useWallet();
  const navigate = useNavigate();
  const reputation = usePoll(() => apiGet<Reputation>(`/api/identities/${offer.sellerIdentity}/reputation`), offer.sellerIdentity);
  const m = useMessages();
  const t = m.take;

  const [input, setInput] = useState(() => toAmountInput(doc.min, asset));
  const amount = parseAmount(input, doc.assetDecimals);
  const inRange = amount !== null && amount >= BigInt(doc.min) && amount <= BigInt(doc.max);
  const range = t.rangeEnds(toAmountInput(doc.min, asset), formatAmount(doc.max, asset));

  const price = doc.price;
  const quote = usePoll(
    () =>
      price.type === 'floating'
        ? apiGet<{ quote: PriceQuote }>(`/api/oracle/quote?pair=${encodeURIComponent(price.pair)}`).then((r) => r.quote)
        : Promise.resolve(null),
    price.type === 'floating' ? price.pair : 'fixed',
    price.type === 'floating' ? QUOTE_INTERVAL_MS : undefined,
  );
  const now = useNow(15_000);
  const verified =
    price.type === 'floating' && quote.data && doc.oracle && quote.data.pair === price.pair && verifyPriceQuote(quote.data, doc.oracle)
      ? quote.data
      : null;
  const expired = verified !== null && now / 1000 - verified.timestamp > QUOTE_MAX_AGE_SEC;
  const unitPrice = price.type === 'fixed' ? price.value : verified?.price ?? null;
  const marginBps = price.type === 'floating' ? price.marginBps : 0;
  const receiveFiat =
    unitPrice && amount !== null && amount > 0n && usablePrice(unitPrice, marginBps, doc.assetDecimals)
      ? fiatForUnits({ units: amount, unitPrice, marginBps, assetDecimals: doc.assetDecimals })
      : null;
  const youReceive = receiveFiat ? formatFiatAmount(receiveFiat, doc.fiat) : null;

  // The seller deposits once the buyer accepts, so the wallet must already hold the deposit: a request the seller
  // cannot fund would only make the buyer wait for nothing.
  const identity = wallet.status === 'connected' ? wallet.identity : null;
  const xpubs = wallet.xpubs;
  const coins = useWalletCoins(identity ? 15_000 : undefined);
  const findingNote = useFindingAddressNote();
  const prep = usePoll(() => (identity && xpubs ? prepareIndices(identity, xpubs, 'seller') : Promise.resolve(null)), identity ?? 'none');
  const have = coins.data ? spendableBch(coins.data.coins) : null;
  const haveToken = coins.data && !asset.isBch ? tokenBalance(coins.data.coins, doc.asset) : null;
  // The fees are not known until the buyer accepts, so this checks the escrow and the deposit's own fee only.
  const check = amount !== null && amount > 0n && coins.data ? checkDeposit({ asset: doc.asset, amount: amount.toString() }, coins.data.coins) : null;
  const escrowSats = amount !== null && amount > 0n ? expectedEscrowFunding({ asset: doc.asset, amount: amount.toString() }).satoshis : null;
  const lock =
    amount === null || escrowSats === null ? null : asset.isBch ? formatAmount(escrowSats, asset) : t.plus(formatAmount(amount, asset), formatBch(escrowSats));
  const shortToken = check?.token !== undefined && check.token.have < check.token.need;
  const short = check !== null && !canDeposit(check);

  const [taking, setTaking] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);

  async function take() {
    if (!identity || !xpubs || !prep.data || amount === null) return;
    setTaking(true);
    setFailure(null);
    const store = browserStore();
    const session = generateSessionKeyPair();
    if (store) savePendingSession(store, offer.offerTxid, session);
    const body = buildSellerTakeRequest({
      offerTxid: offer.offerTxid,
      identity,
      amount,
      defiXpub: xpubs.defi,
      receiveXpub: xpubs.receive,
      defiIndex: prep.data.defi,
      receiveIndex: prep.data.receive,
      session,
    });
    try {
      const { trade } = await apiPost<{ trade: TradeSummary }>('/api/trades', body);
      if (store) commitSession(store, trade.id, session);
      navigate(`/trade/${trade.id}`);
    } catch (err) {
      // The request may have been recorded before the answer was lost: look for it by this browser's session key.
      try {
        const { trades } = await apiGet<{ trades: TradeSummary[] }>(`/api/trades?identity=${identity}`);
        const started = findStartedTrade(trades, session.publicKey);
        if (started) {
          if (store) commitSession(store, started.id, session);
          navigate(`/trade/${started.id}`);
          return;
        }
      } catch {
        // Fall through to the original error.
      }
      setFailure(err instanceof ApiError ? err.message : t.somethingWrong);
      setTaking(false);
      prep.reload();
    }
  }

  const ownOffer = identity !== null && identity === offer.sellerIdentity;
  const rep = reputation.data;

  return (
    <>
      <OfferSummary
        asset={asset}
        title={t.buyerWants(asset.symbol)}
        tag={
          // Next to a real method the trade is real, so only an offer paid in simulated fiat alone gets the tag.
          onlySimulatedPayment(doc.paymentMethods) ? (
            <ProvenanceTag kind="sim">{t.simulatedFiat}</ProvenanceTag>
          ) : (
            <ProvenanceTag kind="chain">{t.offerOnMainnet}</ProvenanceTag>
          )
        }
        range={formatRange(doc.min, doc.max, asset)}
        methods={doc.paymentMethods}
        window={t.within(Math.round(doc.paymentWindowSec / 60))}
        party={t.buyerRecord(aliasFor(offer.sellerIdentity).name, rep ? rep.completedAsBuyer : null)}
        terms={doc.terms}
      />
      {/* Invented copy: answering a buy offer makes you the one paid in fiat, so the risk of a reversed payment is yours. */}
      {reversibleWarning(doc.paymentMethods, doc.fiat) && <Notice tone="attention">{reversibleWarning(doc.paymentMethods, doc.fiat)}</Notice>}

      {offer.status !== 'Published' ? (
        <section className="cf-card">
          {/* Invented copy: the closed state of a buy offer. */}
          <EmptyState title={t.closed} action={<Button to="/offers?side=sell">{t.backToOffers}</Button>}>
            {t.closedByBuyer}
          </EmptyState>
        </section>
      ) : onlySimulatedPayment(doc.paymentMethods) ? (
        <section className="cf-card">
          {/* The service refuses a real seller here too (requestBuyOfferTrade); this says why before anyone tries. */}
          <EmptyState title={t.demoOnly} action={<Button to="/offers?side=sell">{t.backToOffers}</Button>}>
            {t.demoOnlyBody}
          </EmptyState>
        </section>
      ) : (
        <section className="cf-card" data-pad>
          <div className="s-form">
            <div className="cf-field" data-invalid={!inRange || undefined}>
              <label htmlFor="amount">{t.amountToSell}</label>
              <div className="cf-inputgroup">
                <input
                  id="amount"
                  className="cf-input"
                  data-mono
                  inputMode="decimal"
                  value={input}
                  aria-invalid={!inRange || undefined}
                  onChange={(e) => setInput(e.target.value)}
                />
                <span className="cf-addon">{asset.symbol}</span>
              </div>
              <span className="cf-hint">
                {inRange ? t.betweenDot(range) : t.enterBetween(range)}
                {have !== null && t.walletHas(haveToken !== null ? t.rangeEnds(formatAmount(haveToken, asset), formatBch(have)) : formatBch(have))}
              </span>
            </div>

            {expired ? (
              <Notice tone="attention" title={t.expired}>
                {t.expiredBody}
              </Notice>
            ) : (
              <TakeWell
                label={t.youGet}
                big={youReceive && `≈ ${youReceive}`}
                unitPrice={unitPrice}
                marginBps={marginBps}
                fiat={doc.fiat}
                asset={asset}
                lockWhen={t.lockWhenRequest}
                loading={price.type === 'floating' && quote.loading && !quote.data}
              />
            )}

            {Boolean(coins.error) && !coins.data && identity && (
              <Notice tone="danger" title={t.coinsError}>
                {t.networkNoAnswer}{' '}
                <button type="button" className="cf-copy" onClick={coins.reload}>
                  {m.common.tryAgain}
                </button>
              </Notice>
            )}
            {short && check && (
              // Invented copy: the design does not show a seller without enough coins here.
              <Notice tone="attention" title={t.notEnough(shortToken ? asset.symbol : 'BCH')}>
                {shortToken && check.token
                  ? t.needsToken(formatAmount(check.token.need, asset), formatAmount(check.token.have, asset))
                  : t.needsBch(formatBch(check.bch.need), asset.isBch ? null : asset.symbol, formatBch(check.bch.have))}{' '}
                {t.buyerWouldWait}
              </Notice>
            )}
            {prep.error && !prep.data ? (
              <Notice tone="danger" title={t.prepError}>
                {prep.error instanceof ApiError ? prep.error.message : t.noAnswer}{' '}
                <button type="button" className="cf-copy" onClick={prep.reload}>
                  {m.common.tryAgain}
                </button>
              </Notice>
            ) : null}
            {failure && (
              <Notice tone="danger" title={t.notSent}>
                {failure}
              </Notice>
            )}

            <div className="s-actions">
              {wallet.status !== 'connected' ? (
                <Button
                  variant="primary"
                  busy={wallet.status === 'pairing' || wallet.status === 'connecting'}
                  onClick={wallet.connect}
                  note={noWalletNote}
                >
                  {t.connectToSell}
                </Button>
              ) : ownOffer ? (
                <Notice>{t.ownBuyOffer}</Notice>
              ) : expired ? (
                <Button variant="primary" onClick={quote.reload}>
                  {t.newQuote}
                </Button>
              ) : (
                <Button
                  variant="primary"
                  busy={taking}
                  disabled={!inRange || !youReceive || !prep.data || short || have === null}
                  onClick={take}
                  note={!prep.data ? findingNote : t.signLater}
                >
                  {t.offerToSell(inRange && amount !== null ? formatAmount(amount, asset) : null)}
                </Button>
              )}
            </div>
            <p className="cf-small cf-muted">
              <strong>{t.nextTitle}</strong> {t.next(lock)}
            </p>
          </div>
        </section>
      )}

      <OfferDetails offer={offer} party="buyer" quote={verified} payout={null} />
    </>
  );
}

// The offer at a glance in three short lines, so the amount field and the button fit on a phone's first screen.
function OfferSummary(props: {
  asset: AssetInfo;
  title: string;
  tag: ReactNode;
  range: string;
  methods: string[];
  /** The payment window, already worded. */
  window: string;
  /** Who published it and their record. */
  party: string;
  terms?: string;
}) {
  const t = useMessages().take;
  return (
    <section className="cf-card" data-flush>
      <div className="cf-card__section tk-summary">
        <div className="cf-row" data-between>
          <span className="s-asset">
            <CoinIcon asset={props.asset} />
            {props.title}
          </span>
          {props.tag}
        </div>
        <span className="s-chips">
          <span className="cf-mono">{props.range}</span>
          {props.methods.map((method) => (
            <span key={method} className="s-chip">
              {paymentMethodLabel(method)}
            </span>
          ))}
        </span>
        <span className="cf-small cf-muted">
          {props.window} · {props.party}
        </span>
        {/* Long terms show two lines; a tap opens the rest. */}
        {props.terms && (
          <details className="tk-terms cf-small cf-muted">
            <summary>
              {t.terms} {props.terms}
            </summary>
          </details>
        )}
      </div>
    </section>
  );
}

// The big figure is the answer to "what do I get / pay"; the small line says which price made it and how long it holds.
function TakeWell(props: {
  label: string;
  big: string | null;
  unitPrice: string | null;
  marginBps: number;
  fiat: string;
  asset: AssetInfo;
  /** "you take it" or "you send the request". */
  lockWhen: string;
  loading: boolean;
}) {
  const t = useMessages().take;
  return (
    <div className="cf-well cf-stack" data-gap="2">
      <span className="cf-label">{props.label}</span>
      <span className="tk-big">{props.big ?? (props.loading ? <Skeleton width={140} height={28} /> : '—')}</span>
      {props.unitPrice ? (
        <p className="cf-small cf-muted">
          1 {props.asset.symbol} = {formatFiat(applyMargin(props.unitPrice, props.marginBps), props.fiat)} · {t.priceLocked}{' '}
          <strong>10:00</strong> {t.once(props.lockWhen)}
        </p>
      ) : props.loading ? null : (
        <p className="cf-small cf-muted">{t.priceUnavailable}</p>
      )}
    </div>
  );
}

// Technical identifiers, folded: the On-chain tag stays visible in the summary.
function OfferDetails(props: {
  offer: Offer;
  /** The seller on a sell offer, the buyer on a buy offer: whoever published it, and so set a fixed price. */
  party: 'seller' | 'buyer';
  quote: PriceQuote | null;
  payout: { address: string | null; fresh: boolean } | null;
}) {
  const { offer } = props;
  const doc = offer.document;
  const m = useMessages();
  const t = m.take;
  return (
    <Details summary={t.offerDetails} tag={<ProvenanceTag kind="chain">{m.common.onChain}</ProvenanceTag>}>
      <dl className="cf-dl">
        <dt>{t.offer}</dt>
        <dd>
          <HashLink value={offer.offerTxid} kind="transaction" />
          {offer.sponsored && <span className="cf-small cf-subtle">{t.sponsored}</span>}
        </dd>
        <dt>{props.party === 'seller' ? t.sellerId : t.buyerId}</dt>
        <dd>
          <HashLink value={offer.sellerIdentity} kind="plain" />
        </dd>
        <dt>
          <Term word="arbiter">{t.arbiter}</Term>
        </dt>
        <dd>
          <HashLink value={doc.arbiter} kind="plain" />
        </dd>
        <dt>{t.priceSource}</dt>
        <dd>
          {doc.price.type === 'fixed' ? (
            props.party === 'seller' ? t.fixedBySeller : t.fixedByBuyer
          ) : doc.oracle ? (
            <>
              <Term word="oracle">{t.oracle}</Term> <HashLink value={doc.oracle} kind="plain" />
              {props.quote && t.signedAt(formatClock(new Date(props.quote.timestamp * 1000)))}
            </>
          ) : (
            '—'
          )}
        </dd>
        {props.payout && (
          <>
            <dt>{t.payoutAddress}</dt>
            <dd>
              {props.payout.address ? <HashLink value={props.payout.address} kind="address" /> : <Skeleton width={160} style={{ display: 'inline-block' }} />}
              <span className="cf-small cf-subtle">{props.payout.fresh ? t.freshAddress : t.anAddress}</span>
            </dd>
          </>
        )}
      </dl>
    </Details>
  );
}

function LimitNotice({ message, demo }: { message: string; demo: DemoInfo | null }) {
  const limits = demo?.limits;
  const t = useMessages().take;
  switch (demoLimitKind(message)) {
    case 'busy':
      return (
        <Notice tone="attention" title={t.busy}>
          {t.busyBody(limits ? limits.maxActiveTrades : null)}
        </Notice>
      );
    case 'daily':
      return (
        <Notice tone="attention" title={t.daily}>
          {t.dailyBody(limits ? limits.maxDailyFundings : null)}
        </Notice>
      );
    case 'funds':
      return (
        <Notice tone="attention" title={t.noFunds}>
          {t.noFundsBody}
        </Notice>
      );
    default:
      return <Notice tone="attention">{message}</Notice>;
  }
}
