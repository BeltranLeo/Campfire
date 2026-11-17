import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { computeFiatAmount, verifyPriceQuote } from '../../protocol/trades.js';
import { ApiError, apiGet, apiPost, type DemoInfo, type Offer, type PriceQuote, type Reputation, type TradeSummary } from '../api';
import { assetInfo, type AssetInfo } from '../assets';
import { Button } from '../components/Button';
import { CoinIcon } from '../components/CoinIcon';
import { HashLink, ProvenanceTag } from '../components/Provenance';
import { EmptyState, Notice, Skeleton } from '../components/States';
import { useConfig } from '../config';
import { applyMargin, describeMargin, formatAmount, formatBch, formatClock, formatFiat, formatFiatAmount, formatPaymentWindow, formatRange, toAmountInput } from '../format';
import { prepareIndices } from '../indices';
import { depositNeeds } from '../seller';
import { spendableBch } from '../coins';
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
import { useWallet } from '../wallet';

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

  return (
    <main className="s-main" data-narrow>
      <div className="s-pagehead">
        <Link className="s-back" to="/offers">
          ← Offers
        </Link>
        <h1 className="cf-title">{symbol ? (buyOffer ? `Sell ${symbol} to this buyer` : `Buy ${symbol}`) : 'Offer'}</h1>
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
          <EmptyState title="This offer does not exist" action={<Button to="/offers">Back to offers</Button>}>
            It may have been published from another service, or the link is incomplete.
          </EmptyState>
        </section>
      ) : (
        <section className="cf-card">
          <div className="cf-stack">
            <Notice tone="danger" title="We could not load this offer">
              {offer.error instanceof ApiError ? offer.error.message : 'The server did not answer.'}
            </Notice>
            <div className="s-actions">
              <Button variant="primary" onClick={offer.reload}>
                Try again
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

  const reputation = usePoll(() => apiGet<Reputation>(`/api/identities/${offer.sellerIdentity}/reputation`), offer.sellerIdentity);
  const demo = usePoll(() => (offer.isDemo ? apiGet<DemoInfo>('/api/demo') : Promise.resolve(null)), String(offer.isDemo));

  // --- Amount ---
  const [input, setInput] = useState(() => toAmountInput(doc.min, asset));
  const amount = parseAmount(input, doc.assetDecimals);
  const inRange = amount !== null && amount >= BigInt(doc.min) && amount <= BigInt(doc.max);
  const range = `${toAmountInput(doc.min, asset)} and ${formatAmount(doc.max, asset)}`;

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
  const youPay =
    unitPrice && amount !== null && amount > 0n
      ? formatFiatAmount(computeFiatAmount({ amount, assetDecimals: doc.assetDecimals, unitPrice, marginBps }), doc.fiat)
      : null;

  // --- The buyer's keys: next Campfire indices, and a payout address never used on-chain ---
  const identity = wallet.status === 'connected' ? wallet.identity : null;
  const xpubs = wallet.xpubs;
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
      setFailure(err instanceof ApiError ? err.message : 'Something went wrong. Try again.');
      setTaking(false);
      prep.reload();
    }
  }

  const ownOffer = identity !== null && identity === offer.sellerIdentity;
  const rep = reputation.data;

  return (
    <>
      <section className="cf-card" data-flush>
        <div className="cf-card__section">
          <div className="cf-row" data-between>
            <span className="s-asset">
              <CoinIcon asset={asset} />
              {offer.isDemo ? `${asset.symbol} from Demo seller` : asset.symbol}
            </span>
            {offer.isDemo && <ProvenanceTag kind="sim">Demo seller · simulated fiat</ProvenanceTag>}
          </div>
          <div style={{ marginTop: 'var(--space-3)' }}>
            <dl className="cf-dl">
              <dt>Range</dt>
              <dd>
                <span className="cf-mono">{formatRange(doc.min, doc.max, asset)}</span>
              </dd>
              <dt>Payment</dt>
              <dd>
                {doc.paymentMethods.map((method) => (
                  <span key={method} className="s-chip">
                    {method}
                  </span>
                ))}{' '}
                · {formatPaymentWindow(doc.paymentWindowSec)}
              </dd>
              <dt>Seller</dt>
              <dd>
                <HashLink value={offer.sellerIdentity} kind="plain" />
                {rep && ` · ${rep.completedAsSeller} completed`}
              </dd>
              {doc.terms && (
                <>
                  <dt>Terms</dt>
                  <dd>
                    <span className="cf-small">{doc.terms}</span>
                  </dd>
                </>
              )}
              <dt>Offer</dt>
              <dd>
                <HashLink value={offer.offerTxid} kind="transaction" /> · <ProvenanceTag kind="chain" />
              </dd>
            </dl>
          </div>
        </div>
      </section>

      {offer.status !== 'Published' ? (
        <section className="cf-card">
          <EmptyState title="This offer is closed" action={<Button to="/offers">Back to offers</Button>}>
            The seller closed it or it expired. Other offers are still open.
          </EmptyState>
        </section>
      ) : (
        <section className="cf-card" data-pad>
          <div className="s-form">
            <div className="cf-field" data-invalid={!inRange || undefined}>
              <label htmlFor="amount">Amount to buy</label>
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
              <span className="cf-hint">{inRange ? `Between ${range}.` : `Enter an amount between ${range}.`}</span>
            </div>

            {expired ? (
              <Notice tone="warn" title="This quote expired">
                The price was not refreshed for over 10 minutes. Get a new quote to continue.
              </Notice>
            ) : (
              <QuoteWell
                youPay={youPay}
                unitPrice={unitPrice}
                marginBps={marginBps}
                fiat={doc.fiat}
                asset={asset}
                quote={verified}
                oracle={doc.oracle}
                fixed={price.type === 'fixed'}
                loading={price.type === 'floating' && quote.loading && !quote.data}
              />
            )}

            {identity ? (
              <Notice title="You do not need any BCH.">
                Taking an offer is free and needs no signature. The seller funds the escrow and its network fee. The
                funds will be sent to{' '}
                {payout ? <HashLink value={payout} kind="address" /> : <Skeleton width={160} style={{ display: 'inline-block' }} />}
                {prep.data?.fresh === false ? ', an address of your wallet.' : ', a fresh address of your wallet.'}
              </Notice>
            ) : (
              <Notice title="You do not need any BCH.">
                You only need a wallet to receive the funds. Taking an offer is free and needs no signature.
              </Notice>
            )}

            {limit && <LimitNotice message={limit} demo={demo.data ?? null} />}
            {prep.error && !prep.data ? (
              <Notice tone="danger" title="We could not prepare your wallet for this trade">
                {prep.error instanceof ApiError ? prep.error.message : 'The server did not answer.'}{' '}
                <button type="button" className="cf-copy" onClick={prep.reload}>
                  Try again
                </button>
              </Notice>
            ) : null}
            {failure && (
              <Notice tone="danger" title="The offer was not taken">
                {failure}
              </Notice>
            )}

            <div className="s-actions">
              {wallet.status !== 'connected' ? (
                <Button
                  variant="primary"
                  busy={wallet.status === 'pairing' || wallet.status === 'connecting'}
                  onClick={wallet.connect}
                  note="Pairs with Selene or Paytaca through WizardConnect."
                >
                  Connect wallet to take this offer
                </Button>
              ) : ownOffer ? (
                <Notice>This is your own offer. Someone else has to take it.</Notice>
              ) : limit && demoLimitKind(limit) === 'daily' ? (
                <Button variant="primary" to="/transparency">
                  See past trades on-chain
                </Button>
              ) : limit && demoLimitKind(limit) === 'funds' ? (
                <Button variant="primary" to="/offers">
                  Back to offers
                </Button>
              ) : limit ? (
                <Button variant="primary" onClick={take}>
                  Try again
                </Button>
              ) : expired ? (
                <Button variant="primary" onClick={quote.reload}>
                  Get a new quote
                </Button>
              ) : !inRange || !youPay ? (
                <Button variant="primary" disabled>
                  Take offer
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
                      ? 'Finding a fresh address of your wallet…'
                      : offer.isDemo
                        ? 'No signature needed. The demo seller funds the escrow right away.'
                        : 'No signature needed.'
                  }
                >
                  {`Take offer: buy ${formatAmount(amount!, asset)} for ${youPay}`}
                </Button>
              )}
            </div>
          </div>
        </section>
      )}
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

  const [input, setInput] = useState(() => toAmountInput(doc.min, asset));
  const amount = parseAmount(input, doc.assetDecimals);
  const inRange = amount !== null && amount >= BigInt(doc.min) && amount <= BigInt(doc.max);
  const range = `${toAmountInput(doc.min, asset)} and ${formatAmount(doc.max, asset)}`;

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
  const youReceive =
    unitPrice && amount !== null && amount > 0n
      ? formatFiatAmount(computeFiatAmount({ amount, assetDecimals: doc.assetDecimals, unitPrice, marginBps }), doc.fiat)
      : null;

  // The seller deposits once the buyer accepts, so the wallet must already hold the deposit: a request the seller
  // cannot fund would only make the buyer wait for nothing.
  const identity = wallet.status === 'connected' ? wallet.identity : null;
  const xpubs = wallet.xpubs;
  const coins = useWalletCoins(identity ? 15_000 : undefined);
  const prep = usePoll(() => (identity && xpubs ? prepareIndices(identity, xpubs, 'seller') : Promise.resolve(null)), identity ?? 'none');
  const have = coins.data ? spendableBch(coins.data.coins) : null;
  const deposit = amount !== null && amount > 0n && asset.isBch ? depositNeeds({ asset: doc.asset, amount: amount.toString() }) : null;
  const lock = amount !== null && asset.isBch ? formatAmount(amount + 1000n, asset) : null;
  const short = deposit !== null && have !== null && have < deposit;

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
      setFailure(err instanceof ApiError ? err.message : 'Something went wrong. Try again.');
      setTaking(false);
      prep.reload();
    }
  }

  const ownOffer = identity !== null && identity === offer.sellerIdentity;
  const rep = reputation.data;

  return (
    <>
      <section className="cf-card" data-flush>
        <div className="cf-card__section">
          <div className="cf-row" data-between>
            <span className="s-asset">
              <CoinIcon asset={asset} />A buyer wants {asset.symbol}
            </span>
            <ProvenanceTag kind="chain">Offer on mainnet</ProvenanceTag>
          </div>
          <div style={{ marginTop: 'var(--space-3)' }}>
            <dl className="cf-dl">
              <dt>Wants</dt>
              <dd>
                <span className="cf-mono">{formatRange(doc.min, doc.max, asset)}</span>
              </dd>
              <dt>Pays with</dt>
              <dd>
                {doc.paymentMethods.map((method) => (
                  <span key={method} className="s-chip">
                    {method}
                  </span>
                ))}{' '}
                · within {formatPaymentWindow(doc.paymentWindowSec).replace(' to pay', '')}
              </dd>
              <dt>Buyer</dt>
              <dd>
                <HashLink value={offer.sellerIdentity} kind="plain" />
                {rep && ` · ${rep.completedAsBuyer} ${rep.completedAsBuyer === 1 ? 'trade' : 'trades'} completed`}
              </dd>
              {doc.terms && (
                <>
                  <dt>Terms</dt>
                  <dd>
                    <span className="cf-small">{doc.terms}</span>
                  </dd>
                </>
              )}
              <dt>Offer</dt>
              <dd>
                <HashLink value={offer.offerTxid} kind="transaction" />
                {offer.sponsored && <span className="cf-small cf-subtle"> Publishing fee paid by Campfire</span>}
              </dd>
            </dl>
          </div>
        </div>
      </section>

      {offer.status !== 'Published' ? (
        <section className="cf-card">
          {/* Invented copy: the closed state of a buy offer. */}
          <EmptyState title="This offer is closed" action={<Button to="/offers?side=sell">Back to offers</Button>}>
            The buyer closed it or it expired. Other offers are still open.
          </EmptyState>
        </section>
      ) : (
        <section className="cf-card" data-pad>
          <div className="s-form">
            <div className="cf-field" data-invalid={!inRange || undefined}>
              <label htmlFor="amount">Amount to sell</label>
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
                {inRange ? `Between ${range}.` : `Enter an amount between ${range}.`}
                {have !== null && ` Your wallet has ${formatBch(have)}.`}
              </span>
            </div>

            {expired ? (
              <Notice tone="warn" title="This quote expired">
                The price was not refreshed for over 10 minutes. Get a new quote to continue.
              </Notice>
            ) : (
              <QuoteWell
                seller
                youPay={youReceive}
                unitPrice={unitPrice}
                marginBps={marginBps}
                fiat={doc.fiat}
                asset={asset}
                quote={verified}
                oracle={doc.oracle}
                fixed={price.type === 'fixed'}
                loading={price.type === 'floating' && quote.loading && !quote.data}
              />
            )}

            <Notice title="What happens next">
              The buyer accepts. Then you lock {lock ?? 'the coins'} in the contract and share how to pay you. The buyer pays, and you release the coins.
            </Notice>

            {!asset.isBch && (
              // Invented copy: the page deposits BCH only for now.
              <Notice tone="warn" title="Selling PUSD is not available yet">
                Only BCH can be locked from this page for now.
              </Notice>
            )}
            {Boolean(coins.error) && !coins.data && identity && (
              <Notice tone="danger" title="We could not read your wallet's coins">
                The network did not answer.{' '}
                <button type="button" className="cf-copy" onClick={coins.reload}>
                  Try again
                </button>
              </Notice>
            )}
            {short && (
              // Invented copy: the design does not show a seller without enough BCH here.
              <Notice tone="warn" title="Your wallet does not have enough BCH">
                Locking this amount needs about {deposit !== null && formatBch(deposit)} with the network fee, and Campfire can see{' '}
                {have !== null && formatBch(have)}. The buyer would accept and wait for coins you cannot lock.
              </Notice>
            )}
            {prep.error && !prep.data ? (
              <Notice tone="danger" title="We could not prepare your wallet for this trade">
                {prep.error instanceof ApiError ? prep.error.message : 'The server did not answer.'}{' '}
                <button type="button" className="cf-copy" onClick={prep.reload}>
                  Try again
                </button>
              </Notice>
            ) : null}
            {failure && (
              <Notice tone="danger" title="The request was not sent">
                {failure}
              </Notice>
            )}

            <div className="s-actions">
              {wallet.status !== 'connected' ? (
                <Button
                  variant="primary"
                  busy={wallet.status === 'pairing' || wallet.status === 'connecting'}
                  onClick={wallet.connect}
                  note="Pairs with Selene or Paytaca through WizardConnect."
                >
                  Connect wallet to sell
                </Button>
              ) : ownOffer ? (
                <Notice>This is your own offer. A seller has to answer it.</Notice>
              ) : expired ? (
                <Button variant="primary" onClick={quote.reload}>
                  Get a new quote
                </Button>
              ) : (
                <Button
                  variant="primary"
                  busy={taking}
                  disabled={!inRange || !youReceive || !prep.data || !asset.isBch || short || have === null}
                  onClick={take}
                  note={!prep.data ? 'Finding a fresh address of your wallet…' : 'No signature yet. You sign when you lock the coins.'}
                >
                  {inRange && amount !== null ? `Offer to sell ${formatAmount(amount, asset)}` : 'Offer to sell'}
                </Button>
              )}
            </div>
          </div>
        </section>
      )}
    </>
  );
}

function QuoteWell(props: {
  youPay: string | null;
  /** On a buy offer the seller receives the fiat and the buyer accepts. */
  seller?: boolean;
  unitPrice: string | null;
  marginBps: number;
  fiat: string;
  asset: AssetInfo;
  quote: PriceQuote | null;
  oracle?: string;
  fixed: boolean;
  loading: boolean;
}) {
  const priceText = props.unitPrice
    ? `${formatFiat(applyMargin(props.unitPrice, props.marginBps), props.fiat)}/${props.asset.symbol}`
    : null;
  return (
    <div className="cf-well cf-stack" data-gap="3">
      <div className="s-quote">
        <div className="s-cell">
          <span className="cf-label">{props.seller ? 'You receive' : 'You pay'}</span>
          <span className="cf-amount">{props.youPay ?? (props.loading ? <Skeleton width={96} height={20} /> : '—')}</span>
        </div>
        <div className="s-cell">
          <span className="cf-label">Price</span>
          <span className="cf-mono">{priceText ?? (props.loading ? <Skeleton width={120} /> : '—')}</span>
        </div>
      </div>
      {props.fixed ? (
        <p className="cf-small cf-muted">
          {props.seller
            ? 'Fixed price set by the buyer. It is locked when you send the request, and the buyer has '
            : 'Fixed price set by the seller. It is locked when you take the offer and the seller has '}
          <strong>10:00</strong> to accept it.
        </p>
      ) : props.quote && props.oracle ? (
        <p className="cf-small cf-muted">
          {props.seller && `${describeMargin(props.marginBps)}, `}
          {props.seller ? 'signed' : 'Quote signed'} by oracle <HashLink value={props.oracle} kind="plain" /> at{' '}
          {formatClock(new Date(props.quote.timestamp * 1000))}.
          {props.seller ? ' The price is locked when you send the request, and the buyer has ' : ' It refreshes every 30 s. The price is locked when you take the offer and the seller has '}
          <strong>10:00</strong> to accept it.
        </p>
      ) : props.loading ? null : (
        <p className="cf-small cf-muted">The price could not be loaded or verified. It is retried every 30 s.</p>
      )}
    </div>
  );
}

function LimitNotice({ message, demo }: { message: string; demo: DemoInfo | null }) {
  const limits = demo?.limits;
  switch (demoLimitKind(message)) {
    case 'busy':
      return (
        <Notice tone="warn" title="The demo seller is busy with other visitors">
          {limits ? `It handles ${limits.maxActiveTrades} trades at a time. ` : ''}Please try again in a few minutes.
        </Notice>
      );
    case 'daily':
      return (
        <Notice tone="warn" title="The demo seller has reached its daily limit of trades">
          {limits ? `It funds ${limits.maxDailyFundings} trades per day across all visitors. ` : ''}Please try again
          tomorrow, or see the real transactions of earlier trades.
        </Notice>
      );
    case 'funds':
      return (
        <Notice tone="warn" title="The demo seller has run out of funds for this offer">
          Please try again later, or try the other demo offer.
        </Notice>
      );
    default:
      return <Notice tone="warn">{message}</Notice>;
  }
}
