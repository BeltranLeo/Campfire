import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { verifyPriceQuote, computeFiatAmount } from '../../protocol/trades.js';
import { MARKER_SATOSHIS, buildPublishOfferTransaction } from '../../protocol/offers.js';
import { ApiError, apiGet, apiPost, type DemoInfo, type Offer, type PriceQuote, type SponsorshipStatus, type TradeSummary } from '../api';
import { Button, WALLET_DECLINED } from '../components/Button';
import { Details } from '../components/Details';
import { noWalletNote } from '../components/NoWalletNote';
import { HashLink, ProvenanceTag, SimBox } from '../components/Provenance';
import { Notice, Skeleton } from '../components/States';
import { describeScan, spendableBch } from '../coins';
import { useConfig } from '../config';
import { withKeptElectrum } from '../electrum';
import { READING_WALLET, useBusyStep } from '../hooks/useBusyStep';
import { unusedIndex } from '../indices';
import { applyMargin, formatBch, formatDateTime, formatFiat, formatFiatAmount, toAmountInput } from '../format';
import { usePoll } from '../hooks/usePoll';
import { VISIBLE_METHODS, reversibleWarning } from '../paymentMethods';
import { freshWalletScan, latestWalletScan, refreshWalletCoins, useWalletCoins } from '../walletCoins';
import {
  EXPIRIES_SEC,
  addMethods,
  describeYourPrice,
  keepMethodsFor,
  methodChips,
  methodsProblem,
  selectedMethods,
  toggleMethod,
  PAYMENT_WINDOWS_SEC,
  SELL_FIATS,
  COIN_DECIMALS,
  DEFAULT_RANGE,
  OFFER_COINS,
  buildOfferDocument,
  formatCoin,
  marginRange,
  parseFixedPrice,
  parseMarginBps,
  type FormErrors,
  type FormField,
  type OfferCoin,
  type OfferForm,
} from '../sell';
import { parseAmount, payoutAddress } from '../take';
import { WalletDeclined, useWallet } from '../wallet';

// Create an offer in three steps and a review (Create-Sell-* and Create-Buy-* screens): sell or buy, price and amounts,
// ways to pay, then the one publish button. A sell offer is one wallet signature: a transaction with the offer's
// hash in an OP_RETURN and a 1,000-sat marker the seller gets back by closing it. A buy offer needs no signature and
// no BCH: Campfire builds and pays for the same transaction, with the marker on a fresh address of the buyer.

const QUOTE_INTERVAL_MS = 30_000;
const COINS_REFRESH_MS = 15_000;
/** A rough fee for the publication: one input, three outputs and an OP_RETURN. */
const FEE_ESTIMATE_SATS = 600n;

const INITIAL: Omit<OfferForm, 'side'> = {
  fiat: 'ARS',
  priceType: 'market',
  margin: '2.5',
  fixedPrice: '',
  coin: 'BCH',
  min: DEFAULT_RANGE.BCH.min,
  max: DEFAULT_RANGE.BCH.max,
  methods: '',
  paymentWindowSec: 3600,
  expirySec: 7 * 86_400,
};

export function CreateOffer() {
  const wallet = useWallet();
  const config = useConfig();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  // A buy offer starts from a buyer's typical margin; the seller's default stays as it was.
  const [form, setForm] = useState<OfferForm>(() =>
    params.get('side') === 'buy' ? { ...INITIAL, side: 'buy', margin: '0.5' } : { ...INITIAL, side: 'sell' },
  );
  // A field shows its mistake once the person has typed in it (or tried to publish), not while the form is untouched.
  const [touched, setTouched] = useState<ReadonlySet<FormField>>(new Set());
  const [publishing, setPublishing] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const [limitHit, setLimitHit] = useState<string | null>(null);
  const [declined, setDeclined] = useState(false);
  const [published, setPublished] = useState<Offer | null>(null);
  // The wizard step; the form above stays one piece of state whichever step shows it.
  const [step, setStep] = useState<1 | 2 | 3 | 'review'>(1);
  const [otherOpen, setOtherOpen] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const [other, setOther] = useState('');
  const heading = useRef<HTMLHeadingElement>(null);
  const firstStep = useRef(true);
  // A new step starts at its title, for people on a phone and for screen readers.
  useEffect(() => {
    if (firstStep.current) {
      firstStep.current = false;
      return;
    }
    window.scrollTo(0, 0);
    heading.current?.focus({ preventScroll: true });
  }, [step]);
  const set = (patch: Partial<OfferForm>) => setForm((f) => ({ ...f, ...patch }));
  const edit = (field: FormField, patch: Partial<OfferForm>) => {
    set(patch);
    setTouched((t) => new Set(t).add(field));
  };
  const buying = form.side === 'buy';
  const coin: OfferCoin = form.coin ?? 'BCH';
  const decimals = COIN_DECIMALS[coin];
  const coinAsset = { decimals, isBch: coin === 'BCH' };

  const identity = wallet.status === 'connected' ? wallet.identity : null;
  const xpubs = wallet.xpubs;

  // The addresses the publication will use. A fresh marker address keeps the offer's coin apart from anything the
  // wallet shared; the change goes to a fresh change address when there is one.
  // The shared scan already knows each path's last used address, so no address-by-address search is needed.
  const prep = usePoll(async () => {
    if (!identity || !xpubs) return null;
    const scan = await latestWalletScan({ receive: xpubs.receive, change: xpubs.change }).catch(() => null);
    return {
      markerIndex: scan ? unusedIndex(scan, 'receive') : null,
      changeIndex: scan && xpubs.change ? unusedIndex(scan, 'change') : null,
    };
  }, identity ?? 'none');
  const busyStep = useBusyStep();

  // The wallet's coins, from the scan shared with the header and read again every few seconds: BCH sent while the
  // page is open shows up without reloading. A buy offer spends nothing of the wallet, so it does not ask.
  const scan = useWalletCoins(buying ? undefined : COINS_REFRESH_MS);

  // What is left of the buy offers Campfire pays for, and the demo seller's range for the hint.
  const sponsorship = usePoll(
    () => (buying ? apiGet<SponsorshipStatus>(`/api/offers/sponsored${identity ? `?identity=${identity}` : ''}`) : Promise.resolve(null)),
    `${form.side}:${identity ?? ''}`,
  );
  const demo = usePoll(() => (buying ? apiGet<DemoInfo>('/api/demo').catch(() => null) : Promise.resolve(null)), form.side);

  // The oracle signs both coins against both currencies: BCH/ARS, BCH/USD, PUSD/ARS and PUSD/USD.
  const pair = `${coin}/${form.fiat}`;
  const quote = usePoll(
    () => apiGet<{ quote: PriceQuote }>(`/api/oracle/quote?pair=${encodeURIComponent(pair)}`).then((r) => r.quote),
    pair,
    QUOTE_INTERVAL_MS,
  );
  const offers = usePoll(() => apiGet<{ offers: Offer[] }>('/api/offers?onlyOpen=true').then((r) => r.offers), 'open');

  const verifiedQuote =
    quote.data && config && quote.data.pair === pair && verifyPriceQuote(quote.data, config.oraclePk) ? quote.data : null;
  const marginBps = parseMarginBps(form.margin);
  const unitPrice = form.priceType === 'fixed' ? parseFixedPrice(form.fixedPrice) : verifiedQuote?.price ?? null;
  const effectiveMargin = form.priceType === 'market' ? marginBps ?? 0 : 0;
  const fiatInfo = SELL_FIATS.find((f) => f.code === form.fiat) ?? SELL_FIATS[0];
  const approx = (typed: string) => {
    const amount = parseAmount(typed, decimals);
    if (!unitPrice || amount === null || amount <= 0n || (form.priceType === 'market' && marginBps === null)) return null;
    return formatFiatAmount(computeFiatAmount({ amount, assetDecimals: decimals, unitPrice, marginBps: effectiveMargin }), form.fiat);
  };
  // The margin is kept as one signed number ("-2"); the form shows its direction and its size apart.
  const marginBelow = /^\s*[-−]/.test(form.margin);
  const marginSize = form.margin.trim().replace(/^[+\-−]\s*/, '');
  const setMargin = (below: boolean, size: string) => edit('margin', { margin: below ? `-${size}` : size });
  const range = marginRange(offers.data ?? [], form.fiat, form.side, coin === 'BCH' ? 'BCH' : (config?.pusdCategory ?? ''));

  const status = sponsorship.data ?? null;
  const maxExpirySec = buying ? status?.maxExpirySec : undefined;
  const expiries = EXPIRIES_SEC.filter((s) => maxExpirySec === undefined || s <= maxExpirySec);
  // The demo seller's limit, known before the form is built so a demo offer it would skip is caught here.
  const demoMaxText = coin === 'BCH' ? demo.data?.limits.maxBchSats : demo.data?.limits.maxPusdUnits;
  const demoMaxUnits = demoMaxText !== undefined ? BigInt(demoMaxText) : undefined;
  const built = config
    ? buildOfferDocument({
        form,
        arbiter: config.arbiterPk,
        oracle: config.oraclePk,
        now: Math.floor(Date.now() / 1000),
        maxExpirySec,
        demoMaxUnits,
        pusdCategory: config.pusdCategory,
      })
    : null;
  const errors: FormErrors = built && !built.ok ? built.errors : {};
  const shown = (field: FormField) => (touched.has(field) ? errors[field] : undefined);

  const bch = scan.data ? spendableBch(scan.data.coins) : null;
  const needed = MARKER_SATOSHIS + FEE_ESTIMATE_SATS;
  const short = !buying && bch !== null && bch < needed;

  // Why Campfire will not pay for this buy offer right now, if it will not.
  const blocked: 'disabled' | 'daily' | 'open' | null = !buying || !status
    ? null
    : !status.enabled
      ? 'disabled'
      : (status.remainingToday ?? 1) <= 0
        ? 'daily'
        : status.openNow !== undefined && status.openOffersPerIdentity !== undefined && status.openNow >= status.openOffersPerIdentity
          ? 'open'
          : null;

  async function publishSell() {
    if (!built?.ok || !identity || !xpubs || !prep.data || !scan.data || prep.data.markerIndex === null) return;
    const markerAddress = payoutAddress(xpubs.receive, prep.data.markerIndex, false);
    const changeAddress = xpubs.change && prep.data.changeIndex !== null ? payoutAddress(xpubs.change, prep.data.changeIndex, false) : markerAddress;
    // The coins are read again now, so a coin spent since the last refresh is never used.
    busyStep.setStep(READING_WALLET);
    const tx = await withKeptElectrum(async (provider) =>
      buildPublishOfferTransaction({
        provider,
        document: built.document,
        offerJson: built.json,
        utxos: (await freshWalletScan({ receive: xpubs.receive, change: xpubs.change })).coins,
        markerAddress,
        changeAddress,
      }),
    );
    busyStep.setStep(null);
    const signedTxHex = await wallet.sign(tx.request, tx.inputPaths);
    busyStep.setStep('Publishing the offer…');
    const { offer } = await apiPost<{ offer: Offer }>('/api/offers', {
      sellerIdentity: identity,
      offerJson: built.json,
      offerTxHex: signedTxHex,
      markerReceiveIndex: prep.data.markerIndex,
    });
    setPublished(offer);
    void refreshWalletCoins();
  }

  // Campfire builds and pays for the transaction. If the demo seller took the offer at once, its request is already
  // waiting, with the 10-minute quote running: the buyer goes straight to it.
  async function publishBuy() {
    if (!built?.ok || !identity || !prep.data || prep.data.markerIndex === null) return;
    const { offer, trade } = await apiPost<{ offer: Offer; trade: TradeSummary | null }>('/api/offers/sponsored', {
      buyerIdentity: identity,
      offerJson: built.json,
      markerReceiveIndex: prep.data.markerIndex,
    });
    if (trade) navigate(`/trade/${trade.id}`);
    else setPublished(offer);
  }

  async function publish() {
    if (!built?.ok || !identity || !prep.data || prep.data.markerIndex === null || (!buying && (!xpubs || !scan.data))) {
      setTouched(new Set(['margin', 'fixedPrice', 'min', 'max', 'methods']));
      return;
    }
    setPublishing(true);
    setFailure(null);
    setLimitHit(null);
    setDeclined(false);
    try {
      await (buying ? publishBuy() : publishSell());
    } catch (err) {
      if (err instanceof WalletDeclined) setDeclined(true);
      else if (err instanceof ApiError && err.status === 429) setLimitHit(err.message);
      else setFailure(err instanceof ApiError ? err.message : err instanceof Error ? err.message : 'Something went wrong. Try again.');
      setPublishing(false);
      busyStep.setStep(null);
      if (buying) sponsorship.reload();
      else scan.reload();
    }
  }

  if (published) return <Published offer={published} />;

  const demoMax = demoMaxUnits;
  // Turning the demo on brings the smallest trade within the demo seller's reach, and says so under the switch.
  const toggleDemo = (on: boolean) => {
    const min = parseAmount(form.min, decimals);
    if (on && demoMax !== undefined && (min === null || min > demoMax)) edit('min', { demo: on, min: toAmountInput(demoMax, coinAsset) });
    else set({ demo: on });
  };
  const nextSlot = status?.nextSlotAt ? formatDateTime(status.nextSlotAt) : null;

  // The wizard only decides which part of the one form is on screen.
  const priceFields: FormField[] = [form.priceType === 'market' ? 'margin' : 'fixedPrice', 'min', 'max'];
  const priceOk = priceFields.every((f) => !errors[f]);
  const demoOn = buying && form.demo === true;
  const chosen = selectedMethods(form.methods);
  const chipNames = methodChips(form.fiat);
  const isChosen = (name: string) => chosen.some((n) => n.toLowerCase() === name.toLowerCase());
  // The most used methods are always on screen; the rest show behind "More", or once one of them is chosen.
  const hiddenNames = chipNames.slice(VISIBLE_METHODS);
  const shownNames = moreOpen ? chipNames : [...chipNames.slice(0, VISIBLE_METHODS), ...hiddenNames.filter(isChosen)];
  const customNames = chosen.filter((n) => !chipNames.some((c) => c.toLowerCase() === n.toLowerCase()));
  // Whoever receives the fiat carries the risk of a payment that can be clawed back: the seller of a sell offer.
  // On a buy offer the seller who answers sees the same warning (Take.tsx).
  const reversibleNote = buying ? null : reversibleWarning(chosen, form.fiat);
  const methodsMessage = shown('methods') ? methodsProblem(form.methods, demoOn ? 1 : 0) ?? shown('methods') : undefined;

  const priceLine = describeYourPrice({
    priceType: form.priceType,
    marginBps,
    fixedPrice: parseFixedPrice(form.fixedPrice),
    marketPrice: verifiedQuote?.price ?? null,
    fiat: form.fiat,
    coin,
  });
  // While the market price is missing the line says why, in the words the hint always used.
  const priceStatus =
    form.priceType === 'market' && !verifiedQuote ? (quote.loading ? 'Loading the market price…' : 'The market price could not be loaded or verified.') : null;

  const chooseSide = (side: 'sell' | 'buy') => {
    // The margin follows the side's default only while the person has not typed their own.
    const margin = form.margin === defaultMargin(form.side) ? defaultMargin(side) : form.margin;
    set({ side, margin, demo: side === 'buy' ? form.demo : false });
  };
  // A new coin starts from that coin's amounts: 0.001 BCH and 1.00 PUSD are not the same kind of number.
  const chooseCoin = (next: OfferCoin) => {
    if (next !== coin) set({ coin: next, min: DEFAULT_RANGE[next].min, max: DEFAULT_RANGE[next].max });
  };
  const chooseFiat = (fiat: string) => set({ fiat, methods: keepMethodsFor(form.methods, fiat) });
  const toggleChip = (name: string) => edit('methods', { methods: toggleMethod(form.methods, name) });
  const addOther = () => {
    if (!other.trim()) return;
    edit('methods', { methods: addMethods(form.methods, other, form.fiat) });
    setOther('');
  };
  const nextFromPrice = () => {
    if (priceOk) setStep(3);
    else setTouched((t) => new Set([...t, ...priceFields]));
  };
  const nextFromMethods = () => {
    if (errors.methods) setTouched((t) => new Set(t).add('methods'));
    else if (!priceOk) {
      // Something from the price step broke since (the demo switch lowers the smallest trade): show it there.
      setTouched((t) => new Set([...t, ...priceFields]));
      setStep(2);
    } else setStep('review');
  };

  const rangeText = `${toAmountInput(parseAmount(form.min, decimals) ?? 0n, coinAsset)} to ${toAmountInput(parseAmount(form.max, decimals) ?? 0n, coinAsset)} ${coin}`;
  const payNames = [...chosen, ...(demoOn ? ['Simulated (demo)'] : [])];
  const windowMinutes = form.paymentWindowSec / 60;
  const openFor = form.expirySec === 86_400 ? '1 day' : `${form.expirySec / 86_400} days`;

  const priceHint = (
    <p className="co-price" aria-live="polite">
      {priceLine ?? priceStatus ?? ' '}
    </p>
  );

  return (
    <main className="s-main" data-narrow>
      <div className="s-pagehead">
        <Link className="s-back" to="/trades">
          ← My trades
        </Link>
        <span className="cf-stepper">{step === 'review' ? 'Review' : `Step ${step} of 3`}</span>
        <div className="cf-progress" aria-hidden="true">
          {[1, 2, 3].map((n) => (
            <i key={n} data-state={step === 'review' || n < step ? 'done' : n === step ? 'current' : undefined} />
          ))}
        </div>
        <h1 className="cf-title">Create an offer</h1>
      </div>

      <section className="cf-card" data-pad>
        <div className="s-form">
          <h2 className="co-step" tabIndex={-1} ref={heading}>
            {step === 1 ? 'What do you want to do?' : step === 2 ? 'Price and amounts' : step === 3 ? (buying ? 'How can you pay?' : 'How can buyers pay you?') : 'Review your offer'}
          </h2>

          {step === 1 && (
            <>
              {/* Invented copy: the design offers BCH only. */}
              <div className="cf-field">
                <label id="co-coin">Which coin?</label>
                <div className="cf-seg" role="group" aria-labelledby="co-coin">
                  {OFFER_COINS.map((c) => (
                    <button key={c} type="button" aria-pressed={coin === c} onClick={() => chooseCoin(c)}>
                      {c === 'BCH' ? 'Bitcoin Cash' : 'PUSD (dollar token)'}
                    </button>
                  ))}
                </div>
              </div>
              <div className="cf-stack" data-gap="3">
                <button type="button" className="cf-choice" aria-pressed={!buying} onClick={() => chooseSide('sell')}>
                  <span>
                    Sell {coin}
                    <small>Buyers pay you in the currency you choose</small>
                  </span>
                </button>
                <button type="button" className="cf-choice" aria-pressed={buying} onClick={() => chooseSide('buy')}>
                  <span>
                    Buy {coin}
                    <small>Sellers send you {coin}, you pay them</small>
                  </span>
                </button>
              </div>
              <div className="cf-field">
                <label id="co-money">In which money?</label>
                <div className="cf-seg" role="group" aria-labelledby="co-money">
                  {SELL_FIATS.map((f) => (
                    <button key={f.code} type="button" aria-pressed={form.fiat === f.code} onClick={() => chooseFiat(f.code)}>
                      {f.name}
                    </button>
                  ))}
                </div>
              </div>
              <div className="s-actions">
                <Button variant="primary" onClick={() => setStep(2)}>
                  Continue
                </Button>
              </div>
            </>
          )}

          {step === 2 && (
            <>
              <div className="cf-field">
                <label id="co-price">Price</label>
                <div className="cf-seg" role="group" aria-labelledby="co-price">
                  <button type="button" aria-pressed={form.priceType === 'market'} onClick={() => set({ priceType: 'market' })}>
                    Market price
                  </button>
                  <button type="button" aria-pressed={form.priceType === 'fixed'} onClick={() => set({ priceType: 'fixed' })}>
                    Fixed price
                  </button>
                </div>
              </div>

              {form.priceType === 'market' ? (
                <div className="cf-field" data-invalid={shown('margin') ? true : undefined}>
                  <label id="co-margin" htmlFor="margin">
                    {buying ? 'The most I pay, compared with the market price' : 'Your price, compared with the market price'}
                  </label>
                  <div className="cf-seg" role="group" aria-labelledby="co-margin">
                    <button type="button" aria-pressed={!marginBelow} onClick={() => setMargin(false, marginSize)}>
                      Above market
                    </button>
                    <button type="button" aria-pressed={marginBelow} onClick={() => setMargin(true, marginSize)}>
                      Below market
                    </button>
                  </div>
                  <div className="cf-inputgroup">
                    <span className="cf-addon" aria-hidden="true">
                      {marginBelow ? '−' : '+'}
                    </span>
                    <input
                      id="margin"
                      className="cf-input"
                      data-mono
                      inputMode="decimal"
                      value={marginSize}
                      aria-describedby="margin-hint"
                      aria-invalid={shown('margin') ? true : undefined}
                      onChange={(e) => {
                        // A typed sign moves the toggle, so "-2" still means 2% below the market.
                        const typed = e.target.value.trim();
                        if (/^[+\-−]/.test(typed)) setMargin(typed[0] !== '+', typed.slice(1).trim());
                        else setMargin(marginBelow, typed);
                      }}
                    />
                    <span className="cf-addon">%</span>
                  </div>
                  <span className="cf-hint" id="margin-hint">
                    {shown('margin') ??
                      [
                        verifiedQuote && marginBps !== null
                          ? `${buying ? 'You pay' : 'Buyers pay'} ${formatFiat(applyMargin(verifiedQuote.price, marginBps), form.fiat)} per ${coin} today, ${describeVsMarket(marginBps)} the market price of ${formatFiat(Number(verifiedQuote.price), form.fiat)}.`
                          : verifiedQuote
                            ? null
                            : quote.loading
                              ? 'Loading the market price…'
                              : 'The market price could not be loaded or verified.',
                        range ? `${buying ? 'Similar offers pay' : 'Open offers use'} ${describeRange(range)}.` : null,
                      ]
                        .filter(Boolean)
                        .join(' ')}
                  </span>
                </div>
              ) : (
                <div className="cf-field" data-invalid={shown('fixedPrice') ? true : undefined}>
                  <label htmlFor="fixed">Price per {coin}</label>
                  <div className="cf-inputgroup">
                    <input
                      id="fixed"
                      className="cf-input"
                      data-mono
                      inputMode="decimal"
                      value={form.fixedPrice}
                      aria-invalid={shown('fixedPrice') ? true : undefined}
                      onChange={(e) => edit('fixedPrice', { fixedPrice: e.target.value })}
                    />
                    <span className="cf-addon">{form.fiat}</span>
                  </div>
                  <span className="cf-hint">
                    {shown('fixedPrice') ??
                      (verifiedQuote ? `The market price is ${formatFiat(Number(verifiedQuote.price), form.fiat)} today. A fixed price does not follow it.` : 'The price stays the same until you close the offer.')}
                  </span>
                </div>
              )}
              {priceHint}

              <div className="s-2">
                <div className="cf-field" data-invalid={shown('min') ? true : undefined}>
                  <label htmlFor="min">Smallest trade</label>
                  <div className="cf-inputgroup">
                    <input
                      id="min"
                      className="cf-input"
                      data-mono
                      inputMode="decimal"
                      value={form.min}
                      aria-invalid={shown('min') ? true : undefined}
                      onChange={(e) => edit('min', { min: e.target.value })}
                    />
                    <span className="cf-addon">{coin}</span>
                  </div>
                  <span className="cf-hint">{shown('min') ?? (approx(form.min) ? `≈ ${approx(form.min)}` : ' ')}</span>
                </div>
                <div className="cf-field" data-invalid={shown('max') ? true : undefined}>
                  <label htmlFor="max">Largest trade</label>
                  <div className="cf-inputgroup">
                    <input
                      id="max"
                      className="cf-input"
                      data-mono
                      inputMode="decimal"
                      value={form.max}
                      aria-invalid={shown('max') ? true : undefined}
                      onChange={(e) => edit('max', { max: e.target.value })}
                    />
                    <span className="cf-addon">{coin}</span>
                  </div>
                  <span className="cf-hint">{shown('max') ?? (approx(form.max) ? `≈ ${approx(form.max)}` : ' ')}</span>
                </div>
              </div>

              <div className="s-actions">
                <Button variant="primary" onClick={nextFromPrice}>
                  Continue
                </Button>
                <Button variant="ghost" onClick={() => setStep(1)}>
                  Back
                </Button>
              </div>
            </>
          )}

          {step === 3 && (
            <>
              <div className="cf-field" data-invalid={methodsMessage ? true : undefined}>
                <label id="co-methods">{buying ? 'Ways you can pay' : 'Ways buyers can pay you'}</label>
                <div className="co-chips" role="group" aria-labelledby="co-methods">
                  {[...shownNames, ...customNames].map((name) => (
                    <button key={name} type="button" className="co-chip" aria-pressed={isChosen(name)} onClick={() => toggleChip(name)}>
                      {name}
                    </button>
                  ))}
                  {!moreOpen && hiddenNames.some((n) => !isChosen(n)) && (
                    // Invented copy: the design shows only the most used methods.
                    <button type="button" className="co-chip" aria-expanded={false} onClick={() => setMoreOpen(true)}>
                      More
                    </button>
                  )}
                  <button type="button" className="co-chip" aria-pressed={otherOpen} aria-expanded={otherOpen} onClick={() => setOtherOpen((o) => !o)}>
                    + Other
                  </button>
                </div>
                {otherOpen && (
                  <div className="co-other">
                    <input
                      className="cf-input"
                      aria-label="Other ways to pay, separated by commas"
                      placeholder="Revolut, Payoneer"
                      value={other}
                      onChange={(e) => setOther(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          e.preventDefault();
                          addOther();
                        }
                      }}
                    />
                    <Button onClick={addOther} disabled={!other.trim()}>
                      Add
                    </Button>
                  </div>
                )}
                <span className="cf-hint">{methodsMessage ?? 'Only the names are public. You share your account details with each buyer, encrypted, after you accept them.'}</span>
                {/* Invented copy: the design has no reversible payment methods. */}
                {reversibleNote && <Notice tone="attention">{reversibleNote}</Notice>}
              </div>

              <div className="s-2">
                <div className="cf-field">
                  <label htmlFor="window">Time to pay</label>
                  <select id="window" className="cf-select" value={form.paymentWindowSec} onChange={(e) => set({ paymentWindowSec: Number(e.target.value) })}>
                    {PAYMENT_WINDOWS_SEC.map((s) => (
                      <option key={s} value={s}>
                        {s / 60} minutes
                      </option>
                    ))}
                  </select>
                </div>
                <div className="cf-field">
                  <label htmlFor="expires">Offer stays open for</label>
                  <select id="expires" className="cf-select" value={form.expirySec} onChange={(e) => set({ expirySec: Number(e.target.value) })}>
                    {expiries.map((s) => (
                      <option key={s} value={s}>
                        {s === 86_400 ? '1 day' : `${s / 86_400} days`}
                      </option>
                    ))}
                  </select>
                  {buying && maxExpirySec !== undefined && (
                    <span className="cf-hint">{Math.round(maxExpirySec / 86_400)} days at most for offers Campfire pays for.</span>
                  )}
                </div>
              </div>

              {/* The demo is chosen, not discovered: a visible switch instead of typing a magic payment method. */}
              {buying && demoMax !== undefined && (
                <SimBox label="Demo">
                  <label className="s-tick">
                    <input type="checkbox" checked={form.demo === true} onChange={(e) => toggleDemo(e.target.checked)} />
                    <span className="cf-stack" data-gap="1">
                      <strong>Get a demo answer (simulated {fiatInfo.label.toLowerCase()})</strong>
                      <span className="cf-small cf-muted">
                        The demo seller answers right away for trades up to {formatCoin(demoMax, coin)}. The payment is simulated: no
                        money moves, and the {coin} you get is real.
                      </span>
                    </span>
                  </label>
                </SimBox>
              )}

              <div className="s-actions">
                <Button variant="primary" onClick={nextFromMethods}>
                  Review offer
                </Button>
                <Button variant="ghost" onClick={() => setStep(2)}>
                  Back
                </Button>
              </div>
            </>
          )}

          {step === 'review' && (
            <>
              <div className="cf-card" data-pad>
                <dl className="cf-dl">
                  <dt>{buying ? 'You buy' : 'You sell'}</dt>
                  <dd className="co-num">
                    {rangeText} <EditLink onClick={() => setStep(2)} />
                  </dd>
                  <dt>Price</dt>
                  <dd className="co-num">
                    {priceLine?.replace(/^Your price: /, '') ?? priceStatus ?? '—'} <EditLink onClick={() => setStep(2)} />
                  </dd>
                  <dt>{buying ? 'You pay by' : 'Buyers pay by'}</dt>
                  <dd>
                    {payNames.join(', ') || '—'} <EditLink onClick={() => setStep(3)} />
                  </dd>
                  <dt>Time to pay</dt>
                  <dd className="co-num">{windowMinutes} minutes</dd>
                  <dt>Open for</dt>
                  <dd className="co-num">{openFor}</dd>
                </dl>
              </div>

              {buying ? (
                blocked === 'daily' ? (
                  <Notice tone="attention" title="Today’s free offers are used up">
                    Campfire pays the network fee for {status?.dailyOffers} buy offers per day across all users. Please try again
                    {nextSlot ? ` after ${nextSlot}.` : ' tomorrow.'}
                  </Notice>
                ) : blocked === 'open' ? (
                  // Invented copy: the design has a screen for the daily limit only.
                  <Notice tone="attention" title={`You already have ${status?.openNow} open offers paid for by Campfire`}>
                    Close one in My trades to publish another. Campfire pays for {status?.openOffersPerIdentity} open offers per wallet.
                  </Notice>
                ) : blocked === 'disabled' ? (
                  // Invented copy.
                  <Notice tone="attention" title="Campfire is not paying for buy offers right now">Please try again later.</Notice>
                ) : limitHit ? (
                  <Notice tone="attention" title="Campfire could not pay for this offer">
                    {limitHit}
                  </Notice>
                ) : (
                  <Notice tone="verified" title="Publishing is free for you">
                    Campfire pays the network fee. It is still a real mainnet transaction, and you can close the offer anytime.
                  </Notice>
                )
              ) : (
                <Notice title="Publishing costs less than a cent">
                  No coins are locked until someone takes your offer. You choose whether to accept each buyer.
                </Notice>
              )}

              {!buying && Boolean(scan.error) && !scan.data && (
                <Notice tone="danger" title="We could not read your wallet's coins">
                  The network did not answer.{' '}
                  <button type="button" className="cf-copy" onClick={scan.reload}>
                    Try again
                  </button>
                </Notice>
              )}
              {short && scan.data && (
                <Notice tone="attention" title="Your wallet does not have enough BCH">
                  Publishing needs about {formatBch(needed)} for the marker and the fee. This wallet has {bch !== null && formatBch(bch)}
                  that Campfire can see. {describeScan(scan.data)} Send some BCH to it: this page checks again every few seconds.{' '}
                  <button type="button" className="cf-copy" onClick={scan.reload}>
                    Check again
                  </button>
                </Notice>
              )}
              {prep.data && prep.data.markerIndex === null && (
                <Notice tone="attention" title="We could not find a fresh address in your wallet">
                  The lookup took too long.{' '}
                  <button type="button" className="cf-copy" onClick={prep.reload}>
                    Try again
                  </button>
                </Notice>
              )}
              {declined && (
                <Notice tone="attention" title="Nothing was published">
                  {WALLET_DECLINED}
                </Notice>
              )}
              {failure && (
                <Notice tone="danger" title="The offer was not published">
                  {failure}
                </Notice>
              )}

              <div className="s-actions">
                {wallet.status !== 'connected' ? (
                  <Button variant="primary" busy={wallet.status === 'pairing' || wallet.status === 'connecting'} onClick={wallet.connect} note={noWalletNote}>
                    Connect wallet to publish
                  </Button>
                ) : buying && (blocked === 'daily' || blocked === 'disabled') ? (
                  <Button variant="primary" to="/offers">
                    Back to offers
                  </Button>
                ) : buying && blocked === 'open' ? (
                  <Button variant="primary" to="/trades?tab=offers">
                    Go to My offers
                  </Button>
                ) : buying ? (
                  <Button
                    variant="primary"
                    busy={publishing}
                    disabled={!config || !prep.data || prep.data.markerIndex === null || !status}
                    onClick={publish}
                    note="No signature needed."
                  >
                    Publish offer
                  </Button>
                ) : (
                  <Button
                    variant="primary"
                    signs
                    busy={publishing}
                    busyLabel={busyStep.label}
                    disabled={!config || !prep.data || !scan.data || prep.data.markerIndex === null || short}
                    onClick={publish}
                  >
                    Publish offer
                  </Button>
                )}
                <Button variant="ghost" onClick={() => setStep(3)}>
                  Back
                </Button>
              </div>

              <Details summary="Arbiter and price source" tag={null}>
                <div className="cf-well cf-small">
                  Campfire arbiter {config ? <HashLink value={config.arbiterPk} kind="plain" /> : <Skeleton width={90} style={{ display: 'inline-block' }} />}
                  <br />
                  <span className="cf-muted">Decides disputes by choosing buyer or seller. It can never take the coins.</span>
                </div>
                {form.priceType === 'market' && (
                  <div className="cf-well cf-small">
                    Campfire oracle {config ? <HashLink value={config.oraclePk} kind="plain" /> : <Skeleton width={90} style={{ display: 'inline-block' }} />}
                    <br />
                    <span className="cf-muted">Signs the market price each time someone takes the offer.</span>
                  </div>
                )}
                <div className="cf-well cf-small">
                  The offer is a mainnet transaction with a {formatBch(MARKER_SATOSHIS)} marker
                  {buying ? ' on a fresh address of yours' : ''}. It comes back to you when you close the offer
                  {buying ? '' : ', and the network fee is the only cost'}.
                </div>
              </Details>
            </>
          )}
        </div>
      </section>
    </main>
  );
}

function EditLink({ onClick }: { onClick: () => void }) {
  return (
    <button type="button" className="co-edit" onClick={onClick}>
      Edit
    </button>
  );
}

const defaultMargin = (side: 'sell' | 'buy') => (side === 'buy' ? '0.5' : INITIAL.margin);

/** 250 → "+2.5%", -100 → "-1%". */
const signedPercent = (bps: number) => `${bps > 0 ? '+' : bps < 0 ? '-' : ''}${Math.abs(bps) / 100}%`;
/** 250 → "2.5% above", -100 → "1% below", 0 → "equal to". */
const describeVsMarket = (bps: number) => (bps === 0 ? 'equal to' : `${Math.abs(bps) / 100}% ${bps > 0 ? 'above' : 'below'}`);
/** "+0% to +1%", or "+0.5%" when every offer uses the same margin. */
const describeRange = (r: { low: number; high: number }) => (r.low === r.high ? signedPercent(r.low) : `${signedPercent(r.low)} to ${signedPercent(r.high)}`);

function Published({ offer }: { offer: Offer }) {
  const buying = offer.document.side === 'buy';
  return (
    <main className="s-main" data-narrow>
      <div className="s-pagehead">
        <h1 className="cf-title">Your offer is published</h1>
        <div className="cf-row">
          <ProvenanceTag kind="chain">Real offer on mainnet</ProvenanceTag>
        </div>
      </div>
      <section className="cf-card" data-pad>
        <div className="cf-stack">
          {buying ? (
            // Invented copy: the design has no screen after publishing a buy offer.
            <p className="cf-muted">
              Sellers can answer it now. When one does, you have 10 minutes to accept their request, and you pay only after the seller locks the coins
              for you. Open My trades to see requests.
            </p>
          ) : (
            <p className="cf-muted">
              Buyers can take it now. When someone does, you will have 10 minutes to accept before the signed quote expires, and nothing is locked until
              you do. Open My trades to see requests.
            </p>
          )}
          <dl className="cf-dl">
            <dt>Offer</dt>
            <dd>
              <HashLink value={offer.offerTxid} kind="transaction" />
              {offer.sponsored && <span className="cf-small cf-subtle"> Publishing fee paid by Campfire</span>}
            </dd>
          </dl>
          <div className="s-actions">
            <Button variant="primary" to="/trades">
              Go to My trades
            </Button>
            <Button to={`/offers/${offer.offerTxid}`}>View offer</Button>
          </div>
        </div>
      </section>
    </main>
  );
}
