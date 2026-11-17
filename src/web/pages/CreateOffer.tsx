import { useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { verifyPriceQuote, computeFiatAmount } from '../../protocol/trades.js';
import { MARKER_SATOSHIS, buildPublishOfferTransaction } from '../../protocol/offers.js';
import { ApiError, apiGet, apiPost, type DemoInfo, type Offer, type PriceQuote, type SponsorshipStatus, type TradeSummary } from '../api';
import { Button, WALLET_DECLINED } from '../components/Button';
import { Details } from '../components/Details';
import { HashLink, ProvenanceTag } from '../components/Provenance';
import { Notice, Skeleton } from '../components/States';
import { describeScan, scanWalletCoins, spendableBch } from '../coins';
import { useConfig } from '../config';
import { findUnusedReceiveIndex, withKeptElectrum } from '../electrum';
import { applyMargin, formatBch, formatDateTime, formatFiat, formatFiatAmount } from '../format';
import { usePoll } from '../hooks/usePoll';
import { refreshWalletCoins, useWalletCoins } from '../walletCoins';
import {
  EXPIRIES_SEC,
  PAYMENT_WINDOWS_SEC,
  SELL_FIATS,
  buildOfferDocument,
  marginRange,
  parseFixedPrice,
  parseMarginBps,
  type FormErrors,
  type FormField,
  type OfferForm,
} from '../sell';
import { parseAmount, payoutAddress } from '../take';
import { WalletDeclined, useWallet } from '../wallet';

// Create an offer (Create-Sell-* and Create-Buy-* screens), chosen as a pair: "I give BCH, I get pesos" is a sell
// offer, "I give pesos, I get BCH" a buy offer. A sell offer is one wallet signature: a transaction with the offer's
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
  min: '0.001',
  max: '0.02',
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
  const set = (patch: Partial<OfferForm>) => setForm((f) => ({ ...f, ...patch }));
  const edit = (field: FormField, patch: Partial<OfferForm>) => {
    set(patch);
    setTouched((t) => new Set(t).add(field));
  };
  const buying = form.side === 'buy';

  const identity = wallet.status === 'connected' ? wallet.identity : null;
  const xpubs = wallet.xpubs;

  // The addresses the publication will use. A fresh marker address keeps the offer's coin apart from anything the
  // wallet shared; the change goes to a fresh change address when there is one.
  const prep = usePoll(async () => {
    if (!identity || !xpubs) return null;
    const [markerIndex, changeIndex] = await Promise.all([
      findUnusedReceiveIndex(xpubs.receive, 0).catch(() => null),
      xpubs.change ? findUnusedReceiveIndex(xpubs.change, 0).catch(() => null) : Promise.resolve(null),
    ]);
    return { markerIndex, changeIndex };
  }, identity ?? 'none');

  // The wallet's coins, from the scan shared with the header and read again every few seconds: BCH sent while the
  // page is open shows up without reloading. A buy offer spends nothing of the wallet, so it does not ask.
  const scan = useWalletCoins(buying ? undefined : COINS_REFRESH_MS);

  // What is left of the buy offers Campfire pays for, and the demo seller's range for the hint.
  const sponsorship = usePoll(
    () => (buying ? apiGet<SponsorshipStatus>(`/api/offers/sponsored${identity ? `?identity=${identity}` : ''}`) : Promise.resolve(null)),
    `${form.side}:${identity ?? ''}`,
  );
  const demo = usePoll(() => (buying ? apiGet<DemoInfo>('/api/demo').catch(() => null) : Promise.resolve(null)), form.side);

  const quote = usePoll(
    () => apiGet<{ quote: PriceQuote }>(`/api/oracle/quote?pair=${encodeURIComponent(`BCH/${form.fiat}`)}`).then((r) => r.quote),
    `BCH/${form.fiat}`,
    QUOTE_INTERVAL_MS,
  );
  const offers = usePoll(() => apiGet<{ offers: Offer[] }>('/api/offers?onlyOpen=true').then((r) => r.offers), 'open');

  const verifiedQuote =
    quote.data && config && quote.data.pair === `BCH/${form.fiat}` && verifyPriceQuote(quote.data, config.oraclePk) ? quote.data : null;
  const marginBps = parseMarginBps(form.margin);
  const unitPrice = form.priceType === 'fixed' ? parseFixedPrice(form.fixedPrice) : verifiedQuote?.price ?? null;
  const effectiveMargin = form.priceType === 'market' ? marginBps ?? 0 : 0;
  const fiatInfo = SELL_FIATS.find((f) => f.code === form.fiat) ?? SELL_FIATS[0];
  const approx = (typed: string) => {
    const amount = parseAmount(typed, 8);
    if (!unitPrice || amount === null || amount <= 0n || (form.priceType === 'market' && marginBps === null)) return null;
    return formatFiatAmount(computeFiatAmount({ amount, assetDecimals: 8, unitPrice, marginBps: effectiveMargin }), form.fiat);
  };
  const range = marginRange(offers.data ?? [], form.fiat, form.side);

  const status = sponsorship.data ?? null;
  const maxExpirySec = buying ? status?.maxExpirySec : undefined;
  const expiries = EXPIRIES_SEC.filter((s) => maxExpirySec === undefined || s <= maxExpirySec);
  const built = config
    ? buildOfferDocument({ form, arbiter: config.arbiterPk, oracle: config.oraclePk, now: Math.floor(Date.now() / 1000), maxExpirySec })
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
    const tx = await withKeptElectrum(async (provider) =>
      buildPublishOfferTransaction({
        provider,
        document: built.document,
        offerJson: built.json,
        utxos: (await scanWalletCoins(provider, xpubs)).coins,
        markerAddress,
        changeAddress,
      }),
    );
    const signedTxHex = await wallet.sign(tx.request, tx.inputPaths);
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
      if (buying) sponsorship.reload();
      else scan.reload();
    }
  }

  if (published) return <Published offer={published} />;

  const demoMax = demo.data?.limits.maxBchSats;
  const nextSlot = status?.nextSlotAt ? formatDateTime(status.nextSlotAt) : null;

  return (
    <main className="s-main" data-narrow>
      <div className="s-pagehead">
        <Link className="s-back" to="/trades">
          ← My trades
        </Link>
        <h1 className="cf-title">Create an offer</h1>
      </div>

      <section className="cf-card" data-pad>
        <div className="s-form">
          <div className="s-2">
            <div className="cf-field">
              <label>I give</label>
              <div className="cf-seg" role="group" aria-label="I give">
                <button type="button" aria-pressed={!buying} onClick={() => set({ side: 'sell' })}>
                  BCH
                </button>
                <button type="button" aria-pressed="false" disabled title="PUSD offers are coming soon">
                  PUSD
                </button>
                {SELL_FIATS.map((f) => (
                  <button key={f.code} type="button" aria-pressed={buying && form.fiat === f.code} onClick={() => set({ side: 'buy', fiat: f.code })}>
                    {f.label}
                  </button>
                ))}
              </div>
            </div>
            <div className="cf-field">
              <label>I get</label>
              <div className="cf-seg" role="group" aria-label="I get">
                {SELL_FIATS.map((f) => (
                  <button key={f.code} type="button" aria-pressed={!buying && form.fiat === f.code} onClick={() => set({ side: 'sell', fiat: f.code })}>
                    {f.label}
                  </button>
                ))}
                <button type="button" aria-pressed={buying} onClick={() => set({ side: 'buy' })}>
                  BCH
                </button>
                <button type="button" aria-pressed="false" disabled title="PUSD offers are coming soon">
                  PUSD
                </button>
              </div>
            </div>
          </div>
          <span className="cf-small cf-subtle">PUSD offers are coming soon.</span>

          {buying ? (
            <Notice title={`You are buying BCH with ${fiatInfo.name}.`}>You don’t need any BCH: a seller will lock the coins for you.</Notice>
          ) : (
            <Notice title={`You are selling BCH for ${fiatInfo.name}.`}>Buyers will pay you in {fiatInfo.label.toLowerCase()}.</Notice>
          )}

          <div className="cf-field">
            <label>Price</label>
            <div className="cf-seg" role="group" aria-label="Price">
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
              <label htmlFor="margin">{buying ? 'I pay up to this much over the market price' : 'Over the market price'}</label>
              <div className="cf-inputgroup">
                <input
                  id="margin"
                  className="cf-input"
                  data-mono
                  inputMode="decimal"
                  value={form.margin}
                  aria-invalid={shown('margin') ? true : undefined}
                  onChange={(e) => edit('margin', { margin: e.target.value })}
                />
                <span className="cf-addon">%</span>
              </div>
              <span className="cf-hint">
                {shown('margin') ??
                  [
                    verifiedQuote && marginBps !== null
                      ? `${buying ? 'You pay' : 'Buyers pay'} ${formatFiat(applyMargin(verifiedQuote.price, marginBps), form.fiat)} per BCH today.`
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
              <label htmlFor="fixed">Price per BCH</label>
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
                <span className="cf-addon">BCH</span>
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
                <span className="cf-addon">BCH</span>
              </div>
              <span className="cf-hint">{shown('max') ?? (approx(form.max) ? `≈ ${approx(form.max)}` : ' ')}</span>
            </div>
          </div>

          <div className="cf-field" data-invalid={shown('methods') ? true : undefined}>
            <label htmlFor="methods">{buying ? 'How you can pay' : 'How buyers can pay you'}</label>
            <input
              id="methods"
              className="cf-input"
              placeholder="bank-transfer, mercadopago"
              value={form.methods}
              aria-invalid={shown('methods') ? true : undefined}
              onChange={(e) => edit('methods', { methods: e.target.value })}
            />
            <span className="cf-hint">
              {shown('methods') ?? 'Names only. Account details are shared per trade, encrypted for the other person.'}
              {/* Invented copy: how a visitor with one wallet gets the demo seller to answer a buy offer. */}
              {buying && demoMax && (
                <>
                  {' '}
                  To try it with the demo seller, add <span className="cf-mono">simulated</span> and keep the smallest trade at{' '}
                  {formatBch(demoMax)} or less: it answers right away, and no money moves.
                </>
              )}
            </span>
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
          </Details>

          {buying ? (
            blocked === 'daily' ? (
              <Notice tone="warn" title="Today’s free offers are used up">
                Campfire pays the network fee for {status?.dailyOffers} buy offers per day across all users. Please try again
                {nextSlot ? ` after ${nextSlot}.` : ' tomorrow.'}
              </Notice>
            ) : blocked === 'open' ? (
              // Invented copy: the design has a screen for the daily limit only.
              <Notice tone="warn" title={`You already have ${status?.openNow} open offers paid for by Campfire`}>
                Close one in My trades to publish another. Campfire pays for {status?.openOffersPerIdentity} open offers per wallet.
              </Notice>
            ) : blocked === 'disabled' ? (
              // Invented copy.
              <Notice tone="warn" title="Campfire is not paying for buy offers right now">Please try again later.</Notice>
            ) : limitHit ? (
              <Notice tone="warn" title="Campfire could not pay for this offer">
                {limitHit}
              </Notice>
            ) : (
              <Notice tone="chain" title="Publishing is free for you">
                Campfire pays the network fee. It is still a real mainnet transaction, and you can close the offer anytime.
              </Notice>
            )
          ) : (
            <Notice title="Publishing locks no coins.">
              The offer is a mainnet transaction with a {formatBch(MARKER_SATOSHIS)} marker you get back when you close it, plus the
              network fee. You lock coins only when you accept a buyer.
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
            <Notice tone="warn" title="Your wallet does not have enough BCH">
              Publishing needs about {formatBch(needed)} for the marker and the fee. This wallet has {bch !== null && formatBch(bch)}
              that Campfire can see. {describeScan(scan.data)} Send some BCH to it: this page checks again every few seconds.{' '}
              <button type="button" className="cf-copy" onClick={scan.reload}>
                Check again
              </button>
            </Notice>
          )}
          {prep.data && prep.data.markerIndex === null && (
            <Notice tone="warn" title="We could not find a fresh address in your wallet">
              The lookup took too long.{' '}
              <button type="button" className="cf-copy" onClick={prep.reload}>
                Try again
              </button>
            </Notice>
          )}
          {declined && (
            <Notice tone="warn" title="Nothing was published">
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
              <Button variant="primary" busy={wallet.status === 'pairing' || wallet.status === 'connecting'} onClick={wallet.connect} note="Pairs with Selene or Paytaca through WizardConnect.">
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
                disabled={!config || !prep.data || !scan.data || prep.data.markerIndex === null || short}
                onClick={publish}
              >
                Publish offer
              </Button>
            )}
            {!(buying && blocked) && (
              <Button variant="ghost" to={buying ? '/offers' : '/offers?side=sell'}>
                Cancel
              </Button>
            )}
          </div>
        </div>
      </section>
    </main>
  );
}

/** 250 → "+2.5%", -100 → "-1%". */
const signedPercent = (bps: number) => `${bps > 0 ? '+' : bps < 0 ? '-' : ''}${Math.abs(bps) / 100}%`;
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
