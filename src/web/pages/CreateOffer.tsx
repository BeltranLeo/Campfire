import { useState } from 'react';
import { Link } from 'react-router';
import { verifyPriceQuote, computeFiatAmount } from '../../protocol/trades.js';
import { MARKER_SATOSHIS, buildPublishOfferTransaction } from '../../protocol/offers.js';
import { ApiError, apiGet, apiPost, type Offer, type PriceQuote } from '../api';
import { Button, WALLET_DECLINED } from '../components/Button';
import { Details } from '../components/Details';
import { HashLink, ProvenanceTag } from '../components/Provenance';
import { Notice, Skeleton } from '../components/States';
import { describeScan, scanWalletCoins, spendableBch } from '../coins';
import { useConfig } from '../config';
import { findUnusedReceiveIndex, keptElectrum } from '../electrum';
import { applyMargin, formatFiat, formatFiatAmount } from '../format';
import { usePoll } from '../hooks/usePoll';
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

// Create an offer (Create-Sell-* screens). Publishing is one wallet signature: a transaction with the offer's
// hash in an OP_RETURN and a 1,000-sat marker the seller gets back by closing the offer. No coins are locked.

const QUOTE_INTERVAL_MS = 30_000;
const COINS_REFRESH_MS = 15_000;
/** A rough fee for the publication: one input, three outputs and an OP_RETURN. */
const FEE_ESTIMATE_SATS = 600n;

const INITIAL: OfferForm = {
  fiat: 'ARS',
  priceType: 'market',
  margin: '2.5',
  fixedPrice: '',
  min: '100,000',
  max: '2,000,000',
  methods: '',
  paymentWindowSec: 3600,
  expirySec: 7 * 86_400,
};

export function CreateOffer() {
  const wallet = useWallet();
  const config = useConfig();
  const [form, setForm] = useState<OfferForm>(INITIAL);
  // A field shows its mistake once the person has typed in it (or tried to publish), not while the form is untouched.
  const [touched, setTouched] = useState<ReadonlySet<FormField>>(new Set());
  const [publishing, setPublishing] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const [declined, setDeclined] = useState(false);
  const [published, setPublished] = useState<Offer | null>(null);
  const set = (patch: Partial<OfferForm>) => setForm((f) => ({ ...f, ...patch }));
  const edit = (field: FormField, patch: Partial<OfferForm>) => {
    set(patch);
    setTouched((t) => new Set(t).add(field));
  };

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

  // The wallet's coins, read again every few seconds: BCH sent while the page is open shows up without reloading.
  const scan = usePoll(async () => (identity && xpubs ? scanWalletCoins(await keptElectrum(), xpubs) : null), identity ?? 'none', COINS_REFRESH_MS);

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
  const approx = (sats: string) => {
    const amount = parseAmount(sats, 8, true);
    if (!unitPrice || amount === null || amount <= 0n || (form.priceType === 'market' && marginBps === null)) return null;
    return formatFiatAmount(computeFiatAmount({ amount, assetDecimals: 8, unitPrice, marginBps: effectiveMargin }), form.fiat);
  };
  const range = marginRange(offers.data ?? [], form.fiat);

  const built = config ? buildOfferDocument({ form, arbiter: config.arbiterPk, oracle: config.oraclePk, now: Math.floor(Date.now() / 1000) }) : null;
  const errors: FormErrors = built && !built.ok ? built.errors : {};
  const shown = (field: FormField) => (touched.has(field) ? errors[field] : undefined);

  const bch = scan.data ? spendableBch(scan.data.coins) : null;
  const needed = MARKER_SATOSHIS + FEE_ESTIMATE_SATS;
  const short = bch !== null && bch < needed;

  async function publish() {
    if (!built?.ok || !identity || !xpubs || !prep.data || !scan.data || prep.data.markerIndex === null) {
      setTouched(new Set(['margin', 'fixedPrice', 'min', 'max', 'methods']));
      return;
    }
    setPublishing(true);
    setFailure(null);
    setDeclined(false);
    try {
      const markerAddress = payoutAddress(xpubs.receive, prep.data.markerIndex, false);
      const changeAddress = xpubs.change && prep.data.changeIndex !== null ? payoutAddress(xpubs.change, prep.data.changeIndex, false) : markerAddress;
      // The coins are read again now, so a coin spent since the last refresh is never used.
      const provider = await keptElectrum();
      const tx = buildPublishOfferTransaction({
        provider,
        document: built.document,
        offerJson: built.json,
        utxos: (await scanWalletCoins(provider, xpubs)).coins,
        markerAddress,
        changeAddress,
      });
      const signedTxHex = await wallet.sign(tx.request, tx.inputPaths);
      const { offer } = await apiPost<{ offer: Offer }>('/api/offers', {
        sellerIdentity: identity,
        offerJson: built.json,
        offerTxHex: signedTxHex,
        markerReceiveIndex: prep.data.markerIndex,
      });
      setPublished(offer);
    } catch (err) {
      if (err instanceof WalletDeclined) setDeclined(true);
      else setFailure(err instanceof ApiError ? err.message : err instanceof Error ? err.message : 'Something went wrong. Try again.');
      setPublishing(false);
      scan.reload();
    }
  }

  if (published) return <Published offer={published} />;

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
                <button type="button" aria-pressed="true">
                  BCH
                </button>
                <button type="button" aria-pressed="false" disabled title="Selling PUSD is coming soon">
                  PUSD
                </button>
                <button type="button" aria-pressed="false" disabled title="Buy offers are not built yet">
                  Pesos
                </button>
                <button type="button" aria-pressed="false" disabled title="Buy offers are not built yet">
                  Dollars
                </button>
              </div>
            </div>
            <div className="cf-field">
              <label>I get</label>
              <div className="cf-seg" role="group" aria-label="I get">
                {SELL_FIATS.map((f) => (
                  <button key={f.code} type="button" aria-pressed={form.fiat === f.code} onClick={() => set({ fiat: f.code })}>
                    {f.label}
                  </button>
                ))}
                <button type="button" aria-pressed="false" disabled title="Swaps between coins are not offered">
                  BCH
                </button>
                <button type="button" aria-pressed="false" disabled title="Swaps between coins are not offered">
                  PUSD
                </button>
              </div>
            </div>
          </div>
          <span className="cf-small cf-subtle">PUSD offers and buy offers are coming soon.</span>

          <Notice title={`You are selling BCH for ${fiatInfo.name}.`}>Buyers will pay you in {fiatInfo.label.toLowerCase()}.</Notice>

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
              <label htmlFor="margin">Over the market price</label>
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
                      ? `Buyers pay ${formatFiat(applyMargin(verifiedQuote.price, marginBps), form.fiat)} per BCH today.`
                      : verifiedQuote
                        ? null
                        : quote.loading
                        ? 'Loading the market price…'
                        : 'The market price could not be loaded or verified.',
                    range ? `Open offers use ${signedPercent(range.low)} to ${signedPercent(range.high)}.` : null,
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
                  inputMode="numeric"
                  value={form.min}
                  aria-invalid={shown('min') ? true : undefined}
                  onChange={(e) => edit('min', { min: e.target.value })}
                />
                <span className="cf-addon">sats</span>
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
                  inputMode="numeric"
                  value={form.max}
                  aria-invalid={shown('max') ? true : undefined}
                  onChange={(e) => edit('max', { max: e.target.value })}
                />
                <span className="cf-addon">sats</span>
              </div>
              <span className="cf-hint">{shown('max') ?? (approx(form.max) ? `≈ ${approx(form.max)}` : ' ')}</span>
            </div>
          </div>

          <div className="cf-field" data-invalid={shown('methods') ? true : undefined}>
            <label htmlFor="methods">How buyers can pay you</label>
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
                {EXPIRIES_SEC.map((s) => (
                  <option key={s} value={s}>
                    {s === 86_400 ? '1 day' : `${s / 86_400} days`}
                  </option>
                ))}
              </select>
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

          <Notice title="Publishing locks no coins.">
            The offer is a mainnet transaction with a {MARKER_SATOSHIS.toLocaleString('en-US')}-sat marker you get back when you close it, plus the
            network fee. You lock coins only when you accept a buyer.
          </Notice>

          {Boolean(scan.error) && !scan.data && (
            <Notice tone="danger" title="We could not read your wallet's coins">
              The network did not answer.{' '}
              <button type="button" className="cf-copy" onClick={scan.reload}>
                Try again
              </button>
            </Notice>
          )}
          {short && scan.data && (
            <Notice tone="warn" title="Your wallet does not have enough BCH">
              Publishing needs about {needed.toLocaleString('en-US')} sats for the marker and the fee. This wallet has {bch?.toLocaleString('en-US')} sats
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
            <Button variant="ghost" to="/offers?side=sell">
              Cancel
            </Button>
          </div>
        </div>
      </section>
    </main>
  );
}

/** 250 → "+2.5%", -100 → "-1%". */
const signedPercent = (bps: number) => `${bps > 0 ? '+' : bps < 0 ? '-' : ''}${Math.abs(bps) / 100}%`;

function Published({ offer }: { offer: Offer }) {
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
          <p className="cf-muted">
            Buyers can take it now. When someone does, you will have 10 minutes to accept before the signed quote expires, and nothing is locked until you
            do. Open My trades to see requests.
          </p>
          <dl className="cf-dl">
            <dt>Offer</dt>
            <dd>
              <HashLink value={offer.offerTxid} kind="transaction" />
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
