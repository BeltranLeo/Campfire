import { useState, type ReactNode } from 'react';
import { expectedEscrowFunding } from '../../protocol/escrow.js';
import { pkhToCashAddress } from '../../protocol/keys.js';
import { aliasFor } from '../alias';
import { verifyPriceQuote, type PriceQuote } from '../../protocol/trades.js';
import type { TradeFee } from '../../protocol/fees.js';
import { apiGet, apiPost, type Offer, type Reputation, type Trade } from '../api';
import { ActionCard } from '../components/ActionCard';
import { Button } from '../components/Button';
import { DisputeForm } from '../components/DisputeForm';
import { useAdvanced } from '../advanced';
import { Details } from '../components/Details';
import { HashLink, ProvenanceTag } from '../components/Provenance';
import { Notice, Skeleton } from '../components/States';
import { Countdown } from '../components/Timeline';
import { describeScan } from '../coins';
import { READING_WALLET, useBusyStep, useFindingAddressNote } from '../hooks/useBusyStep';
import { assetInfo } from '../assets';
import { loadConfig, useConfig } from '../config';
import { withKeptElectrum } from '../electrum';
import { applyMargin, formatAmount, formatBch, formatDate, formatDateTime, formatFiat, fromBaseUnits } from '../format';
import { usePoll } from '../hooks/usePoll';
import { useNow } from '../hooks/useNow';
import { useTradeAction } from '../hooks/useTradeAction';
import { prepareIndices } from '../indices';
import {
  assertCanDeposit,
  buildAcceptBody,
  buildDeposit,
  buildSellerRelease,
  canDeposit,
  checkAcceptedTrade,
  checkDeposit,
  clearSavedDeposit,
  EMPTY_PAYMENT_FIELDS,
  MAX_DETAILS_LENGTH,
  clearSavedDetails,
  composePaymentDetails,
  findDeposit,
  loadSavedDeposit,
  loadSavedDetails,
  saveDeposit,
  saveDetails,
  paymentFieldsReady,
  sealPaymentDetails,
  type PaymentFields,
  type SealedDetails,
} from '../seller';
import { browserStore, commitSession, generateSessionKeyPair, loadPendingSession, payoutAddress, readSessionKey, savePendingSession } from '../take';
import { RELEASE_CHECKS, TradeActionError, actionProgress, disputeKeyHex, releaseReady, signedPayoutPkh, type ReleaseCheck } from '../trade';
import { freshWalletScan, refreshWalletCoins, useWalletCoins } from '../walletCoins';
import { WalletDeclined, useWallet } from '../wallet';
import { useMessages } from '../lang';
import { MESSAGES, text } from '../messages';

// The seller's side of one trade (Sell-Accept-*, Trade-Seller-*, Trade-BuyOffer-Seller screens): accept a request
// and deposit into the escrow, wait for the buyer, release after checking the payment, or open a dispute. On a buy
// offer the seller took the offer, waits for the buyer to accept, and then deposits with the payment details. The wallet signs the deposit
// and the release; everything else is off-chain. The seller checks the terms the service built before every
// signature (seller.ts), so a wrong address or key stops here and not on-chain.

// Invented copy: generic reasons for a dispute, chosen from a list. Sent to the arbiter in English.
const disputeReasons = () =>
  MESSAGES.en.seller.disputeReasons.map((value, i) => ({ value, label: text().seller.disputeReasons[i] ?? value }));
const BCH = { symbol: 'BCH', decimals: 8, isBch: true } as const;
/** Stands in for localStorage when the browser blocks it: nothing is saved, nothing is found. */
const NO_STORE = { getItem: () => null, setItem: () => undefined, removeItem: () => undefined };

type Action = 'accept' | 'decline' | 'deposit' | 'release' | 'dispute' | 'withdraw';

export function SellerAction(props: { trade: Trade; amount: string; fiat: string; onUpdate: (t: Trade) => void }) {
  const { trade } = props;
  const wallet = useWallet();
  const { identity, xpubs } = wallet;
  const { busy, error, run } = useTradeAction<Action>(trade, identity, props.onUpdate);
  const messages = useMessages();
  const t = messages.seller;
  const tp = messages.tradePage;
  const [fields, setFields] = useState<PaymentFields>(EMPTY_PAYMENT_FIELDS);
  // The fields travel as one text, sealed for the buyer; '' while nothing is typed, so an earlier saved version counts.
  const details = composePaymentDetails(fields, trade.fiat);
  const detailsReady = paymentFieldsReady(fields, trade.fiat);
  const [disputing, setDisputing] = useState(false);
  const [ticked, setTicked] = useState<ReadonlySet<ReleaseCheck>>(new Set());
  const now = useNow(1000);
  const progress = actionProgress(trade.status, 'seller', trade.side);

  // Keys and coins are looked up while a request waits, so the buttons are ready when the seller decides.
  const preparing = trade.status === 'Requested' || trade.status === 'Accepted';
  const findingNote = useFindingAddressNote();
  const prep = usePoll(() => (preparing && identity && xpubs ? prepareIndices(identity, xpubs, 'seller') : Promise.resolve(null)), `${identity}:${trade.id}:${preparing}`);
  // The shared scan of the wallet's coins, asked for again every few seconds while a deposit is due.
  const coins = useWalletCoins(preparing ? 15_000 : undefined);
  const busyStep = useBusyStep();

  const isBch = trade.asset === 'BCH';
  const funding = expectedEscrowFunding(trade);
  // What the escrow holds. A token always travels with some BCH, which goes to the buyer with it.
  const deposit = isBch ? formatAmount(funding.satoshis, BCH) : t.depositPlus(props.amount, formatBch(funding.satoshis));
  const lockLabel = isBch ? deposit : props.amount;
  const breakdown = isBch
    ? t.breakdownBch(formatAmount(trade.amount, BCH), formatBch(1000n))
    : t.breakdownToken(props.amount, formatBch(funding.satoshis - 1000n), formatBch(1000n));
  const { symbol, decimals } = assetInfo(trade.asset, trade.assetDecimals, useConfig());
  const depositCheck = preparing && coins.data ? checkDeposit(trade, coins.data.coins) : null;
  const shortToken = depositCheck?.token !== undefined && depositCheck.token.have < depositCheck.token.need;
  const shortBch = depositCheck !== null && depositCheck.bch.have < depositCheck.bch.need;
  const short = depositCheck !== null && !canDeposit(depositCheck);
  const expired = trade.status === 'Requested' && trade.quoteExpiresAt !== undefined && now / 1000 >= trade.quoteExpiresAt;

  /** A BCH/USD price signed by the service's oracle, to cap the fees of a token trade before locking. */
  async function signedBchUsd(): Promise<string | null> {
    const [config, { quote }] = await Promise.all([loadConfig(), apiGet<{ quote: PriceQuote }>('/api/oracle/quote?pair=BCH/USD')]);
    return quote.pair === 'BCH/USD' && verifyPriceQuote(quote, config.oraclePk) ? quote.price : null;
  }

  /** Asks the service to accept: the wallet must already cover the deposit, because accepting starts the funding window. */
  async function accept(): Promise<Trade> {
    if (!identity || !xpubs || !prep.data || !trade.buyerSessionPk) throw new TradeActionError(tp.stillPreparing);
    const store = browserStore();
    busyStep.setStep(READING_WALLET);
    assertCanDeposit(trade, (await withKeptElectrum(() => freshWalletScan({ receive: xpubs.receive, change: xpubs.change }))).coins);
    busyStep.setStep(t.accepting);
    // The session key is saved before the request, so a lost answer can still be matched to its trade.
    const session = (store && loadPendingSession(store, trade.id)) || generateSessionKeyPair();
    if (store) savePendingSession(store, trade.id, session);
    const body = await buildAcceptBody({
      identity,
      defiXpub: xpubs.defi,
      receiveXpub: xpubs.receive,
      defiIndex: prep.data.defi,
      receiveIndex: prep.data.receive,
      session,
      buyerSessionPk: trade.buyerSessionPk,
      details,
    });
    const { trade: accepted } = await apiPost<{ trade: Trade }>(`/api/trades/${trade.id}/accept`, body);
    if (store) commitSession(store, accepted.id, session);
    return accepted;
  }

  /**
   * Locks the coins. Checks the terms, then looks for a deposit that already exists (never deposit twice), then for
   * a signed one this browser kept from an earlier attempt, and only then builds and signs a new one.
   */
  async function makeDeposit(t: Trade): Promise<Trade> {
    type Prepared = { done: Trade } | { tx: ReturnType<typeof buildDeposit>; record: (hex?: string) => Promise<Trade> };
    if (!xpubs) throw new WalletDeclined();
    const store = browserStore();
    // Everything read from the chain before the wallet is asked runs in one block that is repeated if the connection
    // drops while the visitor is away (see withKeptElectrum). Nothing in it signs or deposits.
    busyStep.setStep(messages.seller.checkingTerms);
    const prepared = await withKeptElectrum<Prepared>(async (provider) => {
      const { offer } = await apiGet<{ offer: Offer }>(`/api/offers/${t.offerTxid}`);
      const checked = checkAcceptedTrade(t, {
        provider,
        defiXpub: xpubs.defi,
        receiveXpub: xpubs.receive,
        sessionPrivateKey: readSessionKey(t.id),
        offer: offer.document,
        now: Math.floor(Date.now() / 1000),
        bchUsd: t.asset === 'BCH' ? null : await signedBchUsd(),
      });
      // On a buy offer the details go with the deposit, sealed before the wallet signs anything: the service refuses a
      // deposit without them, so they are kept next to the signed deposit for a retry after a reload.
      const sealed: SealedDetails | null = t.side === 'buy' ? await sealDetails(t) : null;
      const record = (hex?: string) =>
        apiPost<{ trade: Trade }>(`/api/trades/${t.id}/funding`, { ...(hex ? { fundingTxHex: hex } : {}), ...sealed }).then((r) => {
          if (store) clearSavedDetails(store, t.id);
          return r.trade;
        });

      if (await findDeposit(checked.contract, checked.terms)) return { done: await record() };

      // The same signed transaction is sent again, never a new one: a second deposit to the same escrow would stay
      // locked until the refund time. If it cannot be recorded the trade simply ends when the funding window does,
      // with nothing locked twice.
      const saved = store && loadSavedDeposit(store, t.id);
      if (saved) {
        const recorded = await record(saved);
        if (store) clearSavedDeposit(store, t.id);
        return { done: recorded };
      }

      busyStep.setStep(READING_WALLET);
      const owned = (await freshWalletScan({ receive: xpubs.receive, change: xpubs.change })).coins;
      const changeIndex = prep.data?.change ?? null;
      // One change address in its two forms: plain for the BCH change, token-aware (z…) for the token change.
      const change = (tokenAware: boolean) =>
        xpubs.change && changeIndex !== null
          ? payoutAddress(xpubs.change, changeIndex, tokenAware)
          : payoutAddress(xpubs.receive, t.sellerReceiveIndex ?? 0, tokenAware);
      return { tx: buildDeposit({ trade: t, checked, coins: owned, changeAddress: change(false), tokenChangeAddress: change(true) }), record };
    });
    if ('done' in prepared) return prepared.done;
    const { tx, record } = prepared;
    busyStep.setStep(null);
    const signedTxHex = await wallet.sign(tx.request, tx.inputPaths);
    busyStep.setStep(messages.seller.recordingDeposit);
    if (store) saveDeposit(store, t.id, signedTxHex);
    const recorded = await record(signedTxHex);
    if (store) clearSavedDeposit(store, t.id);
    void refreshWalletCoins();
    return recorded;
  }

  /** The details typed now, or the ones sealed in an earlier attempt when the box is empty after a reload. */
  async function sealDetails(t: Trade): Promise<SealedDetails> {
    const store = browserStore();
    const saved = store && loadSavedDetails(store, t.id);
    if (details.trim() === '' && saved) return saved;
    const key = readSessionKey(t.id);
    if (!key) throw new TradeActionError(messages.seller.noKeyToSeal);
    if (!t.buyerSessionPk || !t.tradeId) throw new TradeActionError(messages.seller.buyerNotAccepted);
    const sealedNow = await sealPaymentDetails({ sessionPrivateKey: key, buyerSessionPk: t.buyerSessionPk, tradeId: t.tradeId, details });
    if (store) saveDetails(store, t.id, sealedNow);
    return sealedNow;
  }

  async function acceptAndDeposit() {
    try {
      await acceptThenDeposit();
    } finally {
      busyStep.setStep(null);
    }
  }

  async function acceptThenDeposit() {
    const accepted = await run('accept', tp.notAccepted, accept);
    if (!accepted || accepted.status !== 'Accepted') return;
    // If the answer to the accept was lost, the key is still waiting under the pending name: file it under the trade.
    const store = browserStore();
    if (store && !readSessionKey(accepted.id)) {
      const pending = loadPendingSession(store, trade.id);
      if (pending && pending.publicKey === accepted.sellerSessionPk) commitSession(store, accepted.id, pending);
    }
    await run('deposit', t.notLocked(isBch), () => makeDeposit(accepted), accepted);
  }

  const depositOnly = () =>
    run('deposit', t.notLocked(isBch), () => makeDeposit(trade)).finally(() =>
      busyStep.setStep(null),
    );

  const decline = () =>
    run('decline', tp.notDeclined, () =>
      apiPost<{ trade: Trade }>(`/api/trades/${trade.id}/decline`, { sellerIdentity: identity }).then((r) => r.trade),
    );

  // The wallet signs the escrow's `release` path; the service checks it and broadcasts.
  const release = () =>
    run('release', t.notReleased, async () => {
      if (!xpubs) throw new WalletDeclined();
      const built = await withKeptElectrum((provider) => buildSellerRelease(trade, provider, xpubs.defi));
      const signedTxHex = await wallet.sign(built.request, built.inputPaths);
      return apiPost<{ trade: Trade }>(`/api/trades/${trade.id}/settle`, { path: 'release', signedTxHex }).then((r) => r.trade);
    });

  // The chat key goes along when this browser has it, so the arbiter can read the messages (protocol section 6).
  const openDispute = (reason: string, more: string) =>
    run('dispute', tp.notDisputed, () => {
      const sharedTradeKeyHex = disputeKeyHex(readSessionKey(trade.id), trade.buyerSessionPk);
      const extra = more.trim();
      return apiPost<{ trade: Trade }>(`/api/trades/${trade.id}/dispute`, {
        callerIdentity: identity,
        reason: extra ? `${reason}: ${extra}` : reason,
        ...(sharedTradeKeyHex && { sharedTradeKeyHex }),
      }).then((r) => r.trade);
    });

  const failure = error && (
    <Notice tone="danger" title={error.title}>
      {error.message}
    </Notice>
  );
  const disputeButton = !disputing && (
    <Button variant="arbiter" disabled={busy !== null} onClick={() => setDisputing(true)}>
      {t.openDispute}
    </Button>
  );
  const disputeForm = disputing && (
    <DisputeForm reasons={disputeReasons()} busy={busy === 'dispute'} locked={busy !== null} onSend={openDispute} onBack={() => setDisputing(false)} />
  );
  const walletNotices = (
    <>
      {shortToken && depositCheck?.token && coins.data && (
        // Invented copy: the design has no seller short of tokens.
        <Notice tone="attention" title={t.shortToken(symbol)}>
          {t.shortTokenBody(props.amount, fromBaseUnits(depositCheck.token.have, decimals), symbol, describeScan(coins.data))}{' '}
          <button type="button" className="cf-copy" onClick={coins.reload}>
            {t.checkAgain}
          </button>
        </Notice>
      )}
      {!shortToken && shortBch && depositCheck && coins.data && (
        <Notice tone="attention" title={t.shortBch}>
          {t.shortBchBody(formatBch(depositCheck.bch.need), isBch ? null : symbol, formatBch(depositCheck.bch.have), describeScan(coins.data))}{' '}
          <button type="button" className="cf-copy" onClick={coins.reload}>
            {t.checkAgain}
          </button>
        </Notice>
      )}
      {Boolean(coins.error) && !coins.data && (
        <Notice tone="danger" title={t.coinsError}>
          {t.networkSilent}{' '}
          <button type="button" className="cf-copy" onClick={coins.reload}>
            {messages.common.tryAgain}
          </button>
        </Notice>
      )}
    </>
  );

  // Releasing cannot be undone: the button waits for both checks, which stop the fake-screenshot scam.
  const tick = (check: ReleaseCheck, on: boolean) =>
    setTicked((current) => {
      const next = new Set(current);
      if (on) next.add(check);
      else next.delete(check);
      return next;
    });
  const checkLabels: Record<ReleaseCheck, ReactNode> = {
    bankApp: t.checkBankApp,
    exactAmount: (
      <>
        {t.checkAmountBefore}
        <strong>{props.fiat}</strong>
        {t.checkAmountAfter}
      </>
    ),
  };
  const releaseChecks = (
    <>
      <Notice tone="attention" title={t.bankOnly}>
        {t.bankOnlyBody(isBch)}
      </Notice>
      <div className="cf-stack" data-gap="2">
        {RELEASE_CHECKS.map((check) => (
          <label key={check} className="s-tick">
            <input type="checkbox" checked={ticked.has(check)} disabled={busy !== null} onChange={(e) => tick(check, e.target.checked)} />
            <span>{checkLabels[check]}</span>
          </label>
        ))}
      </div>
    </>
  );
  // Releasing cannot be undone, so the button is red (danger), not the Brasa of an ordinary next step.
  const releaseButton = () => (
    <Button
      variant="danger"
      signs
      busy={busy === 'release'}
      disabled={!releaseReady(ticked) || (busy !== null && busy !== 'release')}
      onClick={release}
    >
      {t.releaseTo(props.amount)}
    </Button>
  );

  const savedDetails = trade.side === 'buy' ? loadSavedDetails(browserStore() ?? NO_STORE, trade.id) : null;

  if (trade.side === 'buy' && trade.status === 'Requested') {
    // Invented copy: the design shows the buyer's side of this wait only.
    return (
      <ActionCard
        turn="other"
        progress={progress}
        title={t.waitingBuyer}
        reassurance={t.nothingLockedYet}
        deadline={
          trade.quoteExpiresAt && (
            <>
              <Countdown deadline={trade.quoteExpiresAt} windowSec={600} />
              <span className="cf-small cf-muted">{t.leftForBuyer}</span>
            </>
          )
        }
      >
        <p className="cf-muted">{t.whenBuyerAccepts(deposit)}</p>
        {walletNotices}
        {failure}
        <div className="s-actions">
          {/* Nothing is on-chain before the buyer accepts, so taking the request back needs no signature. */}
          <Button
            busy={busy === 'withdraw'}
            disabled={busy !== null && busy !== 'withdraw'}
            onClick={() =>
              run('withdraw', tp.notWithdrawn, () =>
                apiPost<{ trade: Trade }>(`/api/trades/${trade.id}/withdraw`, { identity }).then((r) => r.trade),
              )
            }
          >
            {tp.cancelRequest}
          </Button>
        </div>
      </ActionCard>
    );
  }

  if (trade.side === 'buy' && trade.status === 'Accepted') {
    return (
      <ActionCard
        turn="you"
        progress={progress}
        title={t.buyerAccepted(isBch)}
        reassurance={t.contractOnly}
        deadline={
          trade.fundingDeadline && (
            <>
              <Countdown deadline={trade.fundingDeadline} windowSec={1800} />
              <span className="cf-small cf-muted">{t.leftToLockThen(isBch)}</span>
            </>
          )
        }
      >
        <PaymentFieldsForm
          fields={fields}
          fiat={trade.fiat}
          onChange={setFields}
          title={t.howToPay}
          saved={savedDetails !== null}
          hint={t.sealedHint(isBch)}
        />
        <p className="cf-small cf-muted">{t.youLock(deposit, breakdown)}</p>
        <FeeNote fees={trade.fees} />
        {walletNotices}
        {failure}
        <div className="s-actions">
          <Button
            variant="primary"
            signs
            busy={busy === 'deposit'}
            busyLabel={busyStep.label}
            disabled={short || (details === '' ? !savedDetails : !detailsReady) || (busy !== null && busy !== 'deposit')}
            onClick={depositOnly}
          >
            {t.lockForTrade(lockLabel)}
          </Button>
        </div>
      </ActionCard>
    );
  }

  switch (trade.status) {
    case 'Requested':
      // One card: what the seller gives and gets, how that compares with the market, who is asking, how to be paid.
      return (
        <ActionCard
          turn="you"
          progress={progress}
          title={t.acceptBuyer}
          deadline={
            trade.quoteExpiresAt && (
              <>
                <Countdown deadline={trade.quoteExpiresAt} windowSec={600} />
                <span className="cf-small cf-muted">{t.leftToAcceptPrice}</span>
              </>
            )
          }
        >
          <DealSummary trade={trade} amount={props.amount} fiat={props.fiat} symbol={symbol} />
          <BuyerLine trade={trade} />
          <PaymentFieldsForm
            fields={fields}
            fiat={trade.fiat}
            onChange={setFields}
            title={t.howToPay}
            hint={t.sealedHintShort}
          />
          {expired && (
            <Notice tone="attention" title={t.expired}>
              {t.expiredBody}
            </Notice>
          )}
          {walletNotices}
          {failure}
          <div className="s-actions">
            <Button
              variant="primary"
              signs
              busy={busy === 'accept' || busy === 'deposit'}
              busyLabel={busyStep.label}
              disabled={expired || !detailsReady || !prep.data || short || (busy !== null && busy !== 'accept' && busy !== 'deposit')}
              onClick={acceptAndDeposit}
            >
              {t.acceptAndLock(lockLabel)}
            </Button>
            <Button busy={busy === 'decline'} disabled={busy !== null && busy !== 'decline'} onClick={decline}>
              {tp.decline}
            </Button>
          </div>
          {!prep.data && !prep.error && <span className="cf-small cf-subtle">{findingNote}</span>}
          <Details summary={t.whatAccepting} tag={null}>
            <div className="cf-stack" data-gap="2">
              <p className="cf-small cf-muted">{t.acceptingBody(deposit, breakdown, isBch)}</p>
              <FeeNote fees={trade.fees} />
              {trade.quote && (
                <p className="cf-small cf-muted">{t.priceSigned}</p>
              )}
              <RequestTechnical trade={trade} />
            </div>
          </Details>
        </ActionCard>
      );
    case 'Accepted':
      return (
        <ActionCard
          turn="you"
          progress={progress}
          title={t.lockForTrade(lockLabel)}
          reassurance={t.contractOnly}
          deadline={
            trade.fundingDeadline && (
              <>
                <Countdown deadline={trade.fundingDeadline} windowSec={1800} />
                <span className="cf-small cf-muted">{t.leftToLockOrDrop}</span>
              </>
            )
          }
        >
          <p className="cf-muted">{t.youLockShown(deposit, breakdown, isBch)}</p>
          {walletNotices}
          {failure}
          <div className="s-actions">
            <Button variant="primary" signs busy={busy === 'deposit'} busyLabel={busyStep.label} disabled={short || (busy !== null && busy !== 'deposit')} onClick={depositOnly}>
              {t.lock(lockLabel)}
            </Button>
          </div>
        </ActionCard>
      );
    case 'Funded': {
      const windowSec = trade.paymentDeadline && trade.fundedAt ? trade.paymentDeadline - trade.fundedAt : 0;
      return (
        <ActionCard
          turn="other"
          progress={progress}
          title={t.waitingPayment}
          reassurance={t.onlyBuyerOrYou(isBch)}
          deadline={
            trade.paymentDeadline && (
              <>
                <Countdown deadline={trade.paymentDeadline} windowSec={windowSec} />
                <span className="cf-small cf-muted">{t.leftForBuyerPay}</span>
              </>
            )
          }
        >
          <p className="cf-muted">{t.checkThenRelease}</p>
          {failure}
          {disputeForm}
          <div className="s-actions">{disputeButton}</div>
        </ActionCard>
      );
    }
    case 'Paid':
      return (
        <ActionCard
          turn="you"
          progress={progress}
          title={t.buyerSaysPaid}
          reassurance={t.lockedUntilRelease(isBch)}
        >
          {releaseChecks}
          {failure}
          {disputeForm}
          <div className="s-actions">
            {releaseButton()}
            {disputeButton}
          </div>
          <Details summary={t.notReceived} tag={null}>
            <p className="cf-small cf-muted">{t.notReceivedBody(isBch)}</p>
          </Details>
        </ActionCard>
      );
    case 'Disputed': {
      const opened = trade.disputedAt !== undefined ? formatDateTime(trade.disputedAt) : null;
      return (
        <ActionCard turn="arbiter" title={tp.reviewing}>
          <p className="cf-muted">{t.disputeBy(trade.disputedBy === 'seller', opened)}</p>
          {releaseChecks}
          {failure}
          <div className="s-actions">{releaseButton()}</div>
        </ActionCard>
      );
    }
    default:
      return null;
  }
}

/**
 * The details a buyer needs to pay, typed in fields: the account, its holder and an optional note. They are written for
 * this trade only and never stored in clear (the sealed copy kept for a retry is encrypted for the buyer).
 */
function PaymentFieldsForm(props: {
  fields: PaymentFields;
  fiat: string;
  onChange: (fields: PaymentFields) => void;
  title: string;
  hint: ReactNode;
  /** An earlier, sealed version exists: empty fields keep it. */
  saved?: boolean;
}) {
  const { fields } = props;
  const t = useMessages().seller;
  const set = (patch: Partial<PaymentFields>) => props.onChange({ ...fields, ...patch });
  const tooLong = composePaymentDetails(fields, props.fiat).length > MAX_DETAILS_LENGTH;
  return (
    <fieldset className="s-paymentfields">
      <legend>{props.title}</legend>
      {props.saved && <span className="cf-small cf-muted">{t.savedKept}</span>}
      <div className="cf-field">
        <label htmlFor="pay-account">{t.accountLabel(props.fiat)}</label>
        <input id="pay-account" className="cf-input" autoComplete="off" maxLength={120} value={fields.account} onChange={(e) => set({ account: e.target.value })} />
      </div>
      <div className="cf-field">
        <label htmlFor="pay-holder">{t.holder}</label>
        <input id="pay-holder" className="cf-input" autoComplete="off" maxLength={120} value={fields.holder} onChange={(e) => set({ holder: e.target.value })} />
      </div>
      <div className="cf-field" data-invalid={tooLong || undefined}>
        <label htmlFor="pay-note">{t.noteLabel}</label>
        <input
          id="pay-note"
          className="cf-input"
          autoComplete="off"
          maxLength={200}
          placeholder={t.notePlaceholder}
          value={fields.note}
          onChange={(e) => set({ note: e.target.value })}
        />
        <span className="cf-hint">{tooLong ? t.tooLong(MAX_DETAILS_LENGTH) : props.hint}</span>
      </div>
    </fieldset>
  );
}

/** BCH costs of a deposit beyond what reaches the buyer as the traded amount: the fee budget, the BCH that travels with a token, and the service fees. */
function depositCosts(trade: Trade): bigint {
  const funding = expectedEscrowFunding(trade).satoshis;
  const escrowExtra = trade.asset === 'BCH' ? funding - BigInt(trade.amount) : funding;
  return escrowExtra + (trade.fees ?? []).reduce((sum, f) => sum + BigInt(f.satoshis), 0n);
}

/** "+1,219.52 ARS", "−80.00 ARS". */
function formatSignedFiat(value: number, fiat: string): string {
  return `${value < 0 ? '−' : '+'}${formatFiat(Math.abs(value), fiat)}`;
}

/** "+2.5%", "−1%". */
function formatSignedPercent(ratio: number): string {
  const percent = Math.round(Math.abs(ratio) * 1000) / 10;
  return `${ratio < 0 ? '−' : '+'}${percent.toLocaleString('en-US')}%`;
}

/**
 * What the seller gives and receives, and the gain against selling at the oracle's price (Sell-Accept-*). A request
 * from a market-price offer carries the signed quote it was priced with; a fixed-price one does not, so the current
 * oracle price is read only to compare, and says so.
 */
function DealSummary({ trade, amount, fiat, symbol }: { trade: Trade; amount: string; fiat: string; symbol: string }) {
  const t = useMessages().seller;
  const pair = `${symbol}/${trade.fiat}`;
  const bchPair = `BCH/${trade.fiat}`;
  const live = usePoll(
    () => (trade.quote ? Promise.resolve(null) : apiGet<{ quote: PriceQuote }>(`/api/oracle/quote?pair=${encodeURIComponent(pair)}`).then((r) => r.quote)),
    `${pair}:${trade.quote ? 'signed' : 'live'}`,
  );
  // The fees are paid in BCH; a token trade reads the BCH price to show them in money too.
  const bch = usePoll(
    () =>
      trade.asset === 'BCH' ? Promise.resolve(null) : apiGet<{ quote: PriceQuote }>(`/api/oracle/quote?pair=${encodeURIComponent(bchPair)}`).then((r) => r.quote),
    `${bchPair}:${trade.asset}`,
  );
  const market = trade.quote ?? live.data ?? null;
  const units = Number(trade.amount) / 10 ** trade.assetDecimals;
  const received = Number(trade.fiatAmount);
  const yourPrice = trade.quote ? applyMargin(trade.quote.price, trade.marginBps ?? 0) : units > 0 ? received / units : null;
  const marketValue = market ? units * Number(market.price) : null;
  const gain = marketValue !== null ? received - marketValue : null;
  const bchPrice = trade.asset === 'BCH' ? (market ? Number(market.price) : null) : bch.data ? Number(bch.data.price) : null;
  const costs = depositCosts(trade);
  const costsFiat = bchPrice !== null ? (Number(costs) / 1e8) * bchPrice : null;
  const net = gain !== null && costsFiat !== null ? gain - costsFiat : null;
  const result = net ?? gain;

  return (
    <div className="cf-well cf-stack s-deal" data-gap="3">
      <dl className="s-deal__sides">
        <dt className="cf-label">{t.youGive}</dt>
        <dd className="tk-big">{amount}</dd>
        <dt className="cf-label">{t.youReceive}</dt>
        <dd className="tk-big">{fiat}</dd>
      </dl>
      <dl className="cf-dl s-deal__terms">
        <dt>{t.marketPrice}</dt>
        <dd>
          {market ? (
            <>
              <span className="cf-num">
                {formatFiat(Number(market.price), trade.fiat)}/{symbol}
              </span>
              {!trade.quote && <span className="cf-small cf-subtle">{t.nowForReference}</span>}
            </>
          ) : live.loading ? (
            <Skeleton width={140} />
          ) : (
            <span className="cf-small cf-muted">{t.notAvailable}</span>
          )}
        </dd>
        <dt>{t.yourPrice}</dt>
        <dd>
          {yourPrice !== null && (
            <span className="cf-num">
              {formatFiat(yourPrice, trade.fiat)}/{symbol}
            </span>
          )}
          {marketValue !== null && gain !== null && marketValue > 0 && (
            <span className="cf-small cf-muted">{t.vsMarket(formatSignedPercent(gain / marketValue))}</span>
          )}
        </dd>
        <dt>{t.costs(trade.asset === 'BCH')}</dt>
        <dd>
          <span className="cf-num">{formatBch(costs)}</span>
          {costsFiat !== null && <span className="cf-small cf-muted"> ≈ {formatFiat(costsFiat, trade.fiat)}</span>}
        </dd>
      </dl>
      {result !== null && marketValue !== null && (
        <div className="s-deal__gain" data-sign={result < 0 ? 'negative' : 'positive'}>
          <span>{t.gain(result < 0)}</span>
          <strong className="cf-amount">
            {net !== null ? '≈ ' : ''}
            {formatSignedFiat(result, trade.fiat)}
          </strong>
          {net !== null && gain !== null && costsFiat !== null && (
            <span className="cf-small cf-muted">{t.gainBreakdown(formatSignedFiat(gain, trade.fiat), formatFiat(costsFiat, trade.fiat))}</span>
          )}
        </div>
      )}
    </div>
  );
}

/** Who asks, in one line. The count is Campfire's own, so it says so. */
function BuyerLine({ trade }: { trade: Trade }) {
  const reputation = usePoll(() => apiGet<Reputation>(`/api/identities/${trade.buyerIdentity}/reputation`), trade.buyerIdentity);
  const rep = reputation.data;
  const messages = useMessages();
  const t = messages.seller;
  return (
    <div className="cf-stack" data-gap="1">
      <span>
        <span className="cf-label">{messages.tradePage.buyer}</span> <strong>{aliasFor(trade.buyerIdentity).name}</strong>
        {' · '}
        {rep ? (
          <span className="cf-small">
            {t.completedAsBuyer(rep.completedAsBuyer)}
            {rep.firstCompletedAt !== null && t.since(formatDate(rep.firstCompletedAt))}
          </span>
        ) : (
          <Skeleton width={140} />
        )}
      </span>
      <span className="cf-small cf-subtle">{t.countedByCampfire}</span>
    </div>
  );
}

/** Where the buyer's name comes from and, with technical details on, the buyer's key and where the coins go. */
function RequestTechnical({ trade }: { trade: Trade }) {
  const advanced = useAdvanced();
  const t = useMessages().seller;
  return (
    <>
      <p className="cf-small cf-muted">{t.buyerName}</p>
      {advanced && (
        <dl className="cf-dl">
          <dt>{t.buyerKey}</dt>
          <dd>
            <HashLink value={trade.buyerIdentity} kind="plain" />
          </dd>
          {/* The buyer's payout address is checked before you lock. */}
          {trade.buyerPayoutPkh && (
            <>
              <dt>{t.paysTo}</dt>
              <dd>
                <HashLink value={pkhToCashAddress(trade.buyerPayoutPkh)} kind="address" />
              </dd>
            </>
          )}
        </dl>
      )}
    </>
  );
}

// --- Endings ---

export function SellerResult({ trade, amount }: { trade: Trade; amount: string }) {
  const messages = useMessages();
  const t = messages.seller;
  const tp = messages.tradePage;
  const settlement = trade.settlementTxid && (
    <>
      <HashLink value={trade.settlementTxid} kind="transaction" /> · <ProvenanceTag kind="chain" />
    </>
  );
  const ended = trade.completedAt ?? trade.verdictIssuedAt ?? trade.updatedAt;
  const back = signedPayoutPkh(trade, 'seller');
  const backAddress = back ? <HashLink value={pkhToCashAddress(back)} kind="address" /> : null;
  let notice: ReactNode;
  let rows: ReactNode;
  const row = (label: string) =>
    settlement && (
      <>
        <dt>{label}</dt>
        <dd>{settlement}</dd>
      </>
    );
  const returned = (
    <>
      <dt>{t.returnedTo}</dt>
      <dd>{backAddress}</dd>
    </>
  );
  switch (trade.status) {
    case 'Released':
      notice = (
        <Notice tone="verified" title={tp.completed}>
          {t.youReleased(amount)}
        </Notice>
      );
      rows = row(tp.release);
      break;
    case 'ResolvedBuyer':
      notice = (
        <Notice tone="attention" title={t.decidedBuyer}>
          {t.wentToBuyer(amount)}
        </Notice>
      );
      rows = row(tp.arbitrate);
      break;
    case 'ResolvedSeller':
      notice = trade.disputedAt ? (
        <Notice title={t.decidedYou}>{t.cameBack(amount)}</Notice>
      ) : (
        <Notice title={tp.windowEnded}>{t.windowEndedBody(amount)}</Notice>
      );
      rows = (
        <>
          {row(tp.arbitrate)}
          {returned}
        </>
      );
      break;
    case 'Cancelled':
      notice = <Notice title={t.buyerCancelled}>{t.cameBack(amount)}</Notice>;
      rows = (
        <>
          {row(tp.cancel)}
          {returned}
        </>
      );
      break;
    case 'Refunded':
      notice = <Notice title={t.coinsBack}>{t.refundBack(amount)}</Notice>;
      rows = (
        <>
          {row(tp.refund)}
          {returned}
        </>
      );
      break;
    default:
      notice =
        trade.withdrawnAt !== undefined ? (
          <Notice title={tp.withdrawn}>{tp.withdrawnBody}</Notice>
        ) : (
          <Notice title={tp.dropped}>{t.droppedBody}</Notice>
        );
      rows = null;
  }
  return (
    <section className="cf-card" data-flush>
      <div className="cf-card__section cf-stack">
        {notice}
        <dl className="cf-dl">
          {rows}
          <dt>{tp.ended}</dt>
          <dd>{formatDateTime(ended)}</dd>
        </dl>
        <div className="s-actions">
          <Button variant="primary" to="/trades">
            {t.backToTrades}
          </Button>
        </div>
      </div>
    </section>
  );
}


// Invented copy: the design predates the service fees (protocol section 5.1).
/** The service fees the deposit pays besides the escrow, fixed when the trade was requested. */
function FeeNote({ fees }: { fees?: TradeFee[] }) {
  const messages = useMessages();
  if (!fees || fees.length === 0) return null;
  const t = messages.seller;
  const parts = fees.map((f) => t.feeTo(formatBch(BigInt(f.satoshis)), f.role === 'oracle'));
  return <p className="cf-small cf-muted">{t.feeNote(parts.join(` ${messages.common.and} `))}</p>;
}
