import { useState, type ReactNode } from 'react';
import { expectedEscrowFunding } from '../../protocol/escrow.js';
import { pkhToCashAddress } from '../../protocol/keys.js';
import { aliasFor } from '../alias';
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
import { describeScan, loadWalletCoins, spendableBch } from '../coins';
import { withKeptElectrum } from '../electrum';
import { applyMargin, describeMargin, formatAmount, formatBch, formatDate, formatDateTime, formatFiat } from '../format';
import { usePoll } from '../hooks/usePoll';
import { useNow } from '../hooks/useNow';
import { useTradeAction } from '../hooks/useTradeAction';
import { prepareIndices } from '../indices';
import {
  assertCanDeposit,
  buildAcceptBody,
  buildDeposit,
  buildSellerRelease,
  checkAcceptedTrade,
  clearSavedDeposit,
  EMPTY_PAYMENT_FIELDS,
  MAX_DETAILS_LENGTH,
  accountLabel,
  clearSavedDetails,
  composePaymentDetails,
  depositNeeds,
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
import { RELEASE_CHECKS, TradeActionError, actionProgress, disputeKeyHex, lockedCoins, releaseReady, signedPayoutPkh, type ReleaseCheck } from '../trade';
import { refreshWalletCoins, useWalletCoins } from '../walletCoins';
import { WalletDeclined, useWallet } from '../wallet';

// The seller's side of one trade (Sell-Accept-*, Trade-Seller-*, Trade-BuyOffer-Seller screens): accept a request
// and deposit into the escrow, wait for the buyer, release after checking the payment, or open a dispute. On a buy
// offer the seller took the offer, waits for the buyer to accept, and then deposits with the payment details. The wallet signs the deposit
// and the release; everything else is off-chain. The seller checks the terms the service built before every
// signature (seller.ts), so a wrong address or key stops here and not on-chain.

// Invented copy: generic reasons for a dispute, chosen from a list.
const DISPUTE_REASONS = [
  'The buyer marked it as paid but I received nothing',
  'The amount I received is wrong',
  'The buyer is not answering',
  'Something else',
];
const BCH = { symbol: 'BCH', decimals: 8, isBch: true } as const;
/** Stands in for localStorage when the browser blocks it: nothing is saved, nothing is found. */
const NO_STORE = { getItem: () => null, setItem: () => undefined, removeItem: () => undefined };

type Action = 'accept' | 'decline' | 'deposit' | 'release' | 'dispute';

export function SellerAction(props: { trade: Trade; amount: string; fiat: string; onUpdate: (t: Trade) => void }) {
  const { trade } = props;
  const wallet = useWallet();
  const { identity, xpubs } = wallet;
  const { busy, error, run } = useTradeAction<Action>(trade, identity, props.onUpdate);
  const [fields, setFields] = useState<PaymentFields>(EMPTY_PAYMENT_FIELDS);
  // The fields travel as one text, sealed for the buyer; '' while nothing is typed, so an earlier saved version counts.
  const details = composePaymentDetails(fields, trade.fiat);
  const detailsReady = paymentFieldsReady(fields, trade.fiat);
  const [disputing, setDisputing] = useState(false);
  const [ticked, setTicked] = useState<ReadonlySet<ReleaseCheck>>(new Set());
  const now = useNow(1000);
  const progress = actionProgress(trade.status, 'seller', trade.side);
  const locked = lockedCoins(trade.asset);

  // Keys and coins are looked up while a request waits, so the buttons are ready when the seller decides.
  const preparing = trade.status === 'Requested' || trade.status === 'Accepted';
  const prep = usePoll(() => (preparing && identity && xpubs ? prepareIndices(identity, xpubs, 'seller') : Promise.resolve(null)), `${identity}:${trade.id}:${preparing}`);
  // The shared scan of the wallet's coins, asked for again every few seconds while a deposit is due.
  const coins = useWalletCoins(preparing ? 15_000 : undefined);

  const isBch = trade.asset === 'BCH';
  const deposit = isBch ? formatAmount(expectedEscrowFunding(trade).satoshis, BCH) : null;
  const short = preparing && isBch && coins.data ? spendableBch(coins.data.coins) < depositNeeds(trade) : false;
  const expired = trade.status === 'Requested' && trade.quoteExpiresAt !== undefined && now / 1000 >= trade.quoteExpiresAt;

  /** Asks the service to accept: the wallet must already cover the deposit, because accepting starts the funding window. */
  async function accept(): Promise<Trade> {
    if (!identity || !xpubs || !prep.data || !trade.buyerSessionPk) throw new TradeActionError('Campfire is still preparing your wallet. Try again in a moment.');
    const store = browserStore();
    assertCanDeposit(trade, await withKeptElectrum((provider) => loadWalletCoins(provider, xpubs)));
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
    const prepared = await withKeptElectrum<Prepared>(async (provider) => {
      const { offer } = await apiGet<{ offer: Offer }>(`/api/offers/${t.offerTxid}`);
      const checked = checkAcceptedTrade(t, {
        provider,
        defiXpub: xpubs.defi,
        receiveXpub: xpubs.receive,
        sessionPrivateKey: readSessionKey(t.id),
        offer: offer.document,
        now: Math.floor(Date.now() / 1000),
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

      const owned = await loadWalletCoins(provider, xpubs);
      const changeIndex = prep.data?.change ?? null;
      const changeAddress =
        xpubs.change && changeIndex !== null
          ? payoutAddress(xpubs.change, changeIndex, false)
          : payoutAddress(xpubs.receive, t.sellerReceiveIndex ?? 0, false);
      return { tx: buildDeposit({ trade: t, checked, coins: owned, changeAddress }), record };
    });
    if ('done' in prepared) return prepared.done;
    const { tx, record } = prepared;
    const signedTxHex = await wallet.sign(tx.request, tx.inputPaths);
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
    if (!key) throw new TradeActionError('This browser does not have the key for this trade, so it cannot encrypt the payment details. Nothing was locked.');
    if (!t.buyerSessionPk || !t.tradeId) throw new TradeActionError('The buyer has not accepted yet. Nothing was locked.');
    const sealedNow = await sealPaymentDetails({ sessionPrivateKey: key, buyerSessionPk: t.buyerSessionPk, tradeId: t.tradeId, details });
    if (store) saveDetails(store, t.id, sealedNow);
    return sealedNow;
  }

  async function acceptAndDeposit() {
    const accepted = await run('accept', 'The request was not accepted', accept);
    if (!accepted || accepted.status !== 'Accepted') return;
    // If the answer to the accept was lost, the key is still waiting under the pending name: file it under the trade.
    const store = browserStore();
    if (store && !readSessionKey(accepted.id)) {
      const pending = loadPendingSession(store, trade.id);
      if (pending && pending.publicKey === accepted.sellerSessionPk) commitSession(store, accepted.id, pending);
    }
    await run('deposit', `${capitalize(locked)} ${trade.asset === 'BCH' ? 'was' : 'were'} not locked`, () => makeDeposit(accepted), accepted);
  }

  const depositOnly = () => run('deposit', `${capitalize(locked)} ${trade.asset === 'BCH' ? 'was' : 'were'} not locked`, () => makeDeposit(trade));

  const decline = () =>
    run('decline', 'The request was not declined', () =>
      apiPost<{ trade: Trade }>(`/api/trades/${trade.id}/decline`, { sellerIdentity: identity }).then((r) => r.trade),
    );

  // The wallet signs the escrow's `release` path; the service checks it and broadcasts.
  const release = () =>
    run('release', 'The coins were not released', async () => {
      if (!xpubs) throw new WalletDeclined();
      const built = await withKeptElectrum((provider) => buildSellerRelease(trade, provider, xpubs.defi));
      const signedTxHex = await wallet.sign(built.request, built.inputPaths);
      return apiPost<{ trade: Trade }>(`/api/trades/${trade.id}/settle`, { path: 'release', signedTxHex }).then((r) => r.trade);
    });

  // The chat key goes along when this browser has it, so the arbiter can read the messages (protocol section 6).
  const openDispute = (reason: string, more: string) =>
    run('dispute', 'The dispute was not opened', () => {
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
      Open dispute
    </Button>
  );
  const disputeForm = disputing && (
    <DisputeForm reasons={DISPUTE_REASONS} busy={busy === 'dispute'} locked={busy !== null} onSend={openDispute} onBack={() => setDisputing(false)} />
  );
  const walletNotices = (
    <>
      {short && coins.data && (
        <Notice tone="attention" title="Your wallet does not have enough BCH">
          Locking needs about {formatBch(depositNeeds(trade))} and Campfire can see{' '}
          {formatBch(spendableBch(coins.data.coins))} in this wallet. {describeScan(coins.data)} Send some BCH to it: this page checks
          again every few seconds.{' '}
          <button type="button" className="cf-copy" onClick={coins.reload}>
            Check again
          </button>
        </Notice>
      )}
      {Boolean(coins.error) && !coins.data && (
        <Notice tone="danger" title="We could not read your wallet's coins">
          The network did not answer.{' '}
          <button type="button" className="cf-copy" onClick={coins.reload}>
            Try again
          </button>
        </Notice>
      )}
      {!isBch && (
        <Notice tone="attention" title="Locking PUSD is not available yet">
          This trade is for a token. Only BCH trades can be locked from this page for now.
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
    bankApp: 'I opened my bank app, not a screenshot',
    exactAmount: (
      <>
        I see exactly <strong>{props.fiat}</strong> from this buyer
      </>
    ),
  };
  const releaseChecks = (
    <>
      <Notice tone="attention" title="Only your bank app counts">
        Don't trust screenshots or messages. Once you release, {locked} can't come back.
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
      {`Release ${props.amount} to the buyer`}
    </Button>
  );

  const savedDetails = trade.side === 'buy' ? loadSavedDetails(browserStore() ?? NO_STORE, trade.id) : null;

  if (trade.side === 'buy' && trade.status === 'Requested') {
    // Invented copy: the design shows the buyer's side of this wait only.
    return (
      <ActionCard
        turn="other"
        progress={progress}
        title="Waiting for the buyer to accept"
        reassurance="Nothing is locked yet. You sign only when you lock the coins."
        deadline={
          trade.quoteExpiresAt && (
            <>
              <Countdown deadline={trade.quoteExpiresAt} windowSec={600} />
              <span className="cf-small cf-muted">left for the buyer to accept at this price</span>
            </>
          )
        }
      >
        <p className="cf-muted">
          When the buyer accepts, you have 30 minutes to lock {deposit ?? 'the coins'} and share how to pay you. If the buyer does not answer in time,
          the request is dropped.
        </p>
        {walletNotices}
      </ActionCard>
    );
  }

  if (trade.side === 'buy' && trade.status === 'Accepted') {
    return (
      <ActionCard
        turn="you"
        progress={progress}
        title={`The buyer accepted. Lock ${locked} and share how to pay you.`}
        reassurance="The contract can only pay the buyer or return the coins to you. Campfire cannot move them."
        deadline={
          trade.fundingDeadline && (
            <>
              <Countdown deadline={trade.fundingDeadline} windowSec={1800} />
              <span className="cf-small cf-muted">left to lock {locked}. After that the trade is dropped.</span>
            </>
          )
        }
      >
        <PaymentFieldsForm
          fields={fields}
          fiat={trade.fiat}
          onChange={setFields}
          title="How the buyer should pay you"
          saved={savedDetails !== null}
          hint={<>Encrypted in your browser for this buyer only. Shown once {locked} {lockVerb(trade.asset)} locked. Campfire cannot read it.</>}
        />
        {deposit && (
          <p className="cf-small cf-muted">
            You lock {deposit}: {formatAmount(trade.amount, BCH)} for the buyer plus a {formatBch(1000n)} fee budget for the closing transaction.
          </p>
        )}
        <FeeNote fees={trade.fees} />
        {walletNotices}
        {failure}
        <div className="s-actions">
          <Button
            variant="primary"
            signs
            busy={busy === 'deposit'}
            disabled={!isBch || short || (details === '' ? !savedDetails : !detailsReady) || (busy !== null && busy !== 'deposit')}
            onClick={depositOnly}
          >
            {deposit ? `Lock ${deposit} for this trade` : `Lock ${locked}`}
          </Button>
        </div>
      </ActionCard>
    );
  }

  switch (trade.status) {
    case 'Requested':
      return (
        <>
          <ActionCard
            turn="you"
            progress={progress}
            title="Accept this buyer"
            deadline={
              trade.quoteExpiresAt && (
                <>
                  <Countdown deadline={trade.quoteExpiresAt} windowSec={600} />
                  <span className="cf-small cf-muted">left on the signed quote. After that the request is dropped.</span>
                </>
              )
            }
          >
            <PaymentFieldsForm
              fields={fields}
              fiat={trade.fiat}
              onChange={setFields}
              title="How the buyer should pay you"
              hint={<>Encrypted in your browser for this buyer only. Shown to them once {locked} {lockVerb(trade.asset)} locked. Campfire cannot read it.</>}
            />
            {deposit && (
              <Notice title={`This locks ${deposit} now.`}>
                It can only go to the buyer or back to you: {formatAmount(trade.amount, BCH)} for the buyer plus a {formatBch(1000n)} fee budget for the
                closing transaction.
              </Notice>
            )}
            <FeeNote fees={trade.fees} />
            {expired && (
              <Notice tone="attention" title="This request expired">
                The signed quote ran out. The request is dropped and nothing was locked.
              </Notice>
            )}
            {walletNotices}
            {failure}
            <div className="s-actions">
              <Button
                variant="primary"
                signs
                busy={busy === 'accept' || busy === 'deposit'}
                disabled={!isBch || expired || !detailsReady || !prep.data || short || (busy !== null && busy !== 'accept' && busy !== 'deposit')}
                onClick={acceptAndDeposit}
              >
                {deposit ? `Accept and lock ${deposit}` : 'Accept and lock'}
              </Button>
              <Button busy={busy === 'decline'} disabled={busy !== null && busy !== 'decline'} onClick={decline}>
                Decline
              </Button>
            </div>
            {!prep.data && !prep.error && <span className="cf-small cf-subtle">Finding a fresh address of your wallet…</span>}
          </ActionCard>
          <RequestCard trade={trade} fiat={props.fiat} />
        </>
      );
    case 'Accepted':
      return (
        <ActionCard
          turn="you"
          progress={progress}
          title={deposit ? `Lock ${deposit} for this trade` : `Lock ${locked} for this trade`}
          reassurance="The contract can only pay the buyer or return the coins to you. Campfire cannot move them."
          deadline={
            trade.fundingDeadline && (
              <>
                <Countdown deadline={trade.fundingDeadline} windowSec={1800} />
                <span className="cf-small cf-muted">left to lock. If you do not lock in time the trade is dropped and nothing is charged.</span>
              </>
            )
          }
        >
          <p className="cf-muted">
            {formatAmount(trade.amount, BCH)} for the buyer plus a {formatBch(1000n)} fee budget for the closing transaction. Your payment details are shown to the
            buyer once {locked} {lockVerb(trade.asset)} locked.
          </p>
          {walletNotices}
          {failure}
          <div className="s-actions">
            <Button variant="primary" signs busy={busy === 'deposit'} disabled={!isBch || short || (busy !== null && busy !== 'deposit')} onClick={depositOnly}>
              {deposit ? `Lock ${deposit}` : 'Lock'}
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
          title="Waiting for the buyer's payment"
          reassurance={`${capitalize(locked)} ${lockVerb(trade.asset)} locked. It can only go to the buyer or back to you.`}
          deadline={
            trade.paymentDeadline && (
              <>
                <Countdown deadline={trade.paymentDeadline} windowSec={windowSec} />
                <span className="cf-small cf-muted">left for the buyer to pay. After that the arbiter returns the coins to you.</span>
              </>
            )
          }
        >
          <p className="cf-muted">
            When the buyer marks the payment as sent, check your bank app and release. Do not release before the money is there.
          </p>
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
          title="The buyer says they paid. Check your bank."
          reassurance={`${capitalize(locked)} ${lockVerb(trade.asset)} locked until you release. Take the time to check.`}
        >
          {releaseChecks}
          {failure}
          {disputeForm}
          <div className="s-actions">
            {releaseButton()}
            {disputeButton}
          </div>
          <Details summary="Not received yet?" tag={null}>
            <p className="cf-small cf-muted">
              Transfers can take a few minutes. {capitalize(locked)} {lockVerb(trade.asset)} still locked while you wait. If the money doesn't arrive,
              open a dispute and the arbiter will help.
            </p>
          </Details>
        </ActionCard>
      );
    case 'Disputed': {
      const opened = trade.disputedAt !== undefined ? formatDateTime(trade.disputedAt) : null;
      return (
        <ActionCard turn="arbiter" title="The arbiter is reviewing this trade">
          <p className="cf-muted">
            {trade.disputedBy === 'seller' ? 'You opened a dispute' : 'The buyer opened a dispute'}
            {opened ? ` on ${opened}` : ''}. The arbiter can now read the chat and will decide for the buyer or the seller. If you receive the payment
            meanwhile, you can still release.
          </p>
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
  const set = (patch: Partial<PaymentFields>) => props.onChange({ ...fields, ...patch });
  const tooLong = composePaymentDetails(fields, props.fiat).length > MAX_DETAILS_LENGTH;
  return (
    <fieldset className="s-paymentfields">
      <legend>{props.title}</legend>
      {props.saved && <span className="cf-small cf-muted">Your earlier details are kept. Fill these in only to replace them.</span>}
      <div className="cf-field">
        <label htmlFor="pay-account">{accountLabel(props.fiat)}</label>
        <input id="pay-account" className="cf-input" autoComplete="off" maxLength={120} value={fields.account} onChange={(e) => set({ account: e.target.value })} />
      </div>
      <div className="cf-field">
        <label htmlFor="pay-holder">Account holder</label>
        <input id="pay-holder" className="cf-input" autoComplete="off" maxLength={120} value={fields.holder} onChange={(e) => set({ holder: e.target.value })} />
      </div>
      <div className="cf-field" data-invalid={tooLong || undefined}>
        <label htmlFor="pay-note">Note for the buyer (optional)</label>
        <input
          id="pay-note"
          className="cf-input"
          autoComplete="off"
          maxLength={200}
          placeholder="Bank name, reference to write"
          value={fields.note}
          onChange={(e) => set({ note: e.target.value })}
        />
        <span className="cf-hint">{tooLong ? `Keep the details under ${MAX_DETAILS_LENGTH} characters in total.` : props.hint}</span>
      </div>
    </fieldset>
  );
}

/** What was asked, for the seller deciding on a request (Sell-Accept-*). */
function RequestCard({ trade, fiat }: { trade: Trade; fiat: string }) {
  const reputation = usePoll(() => apiGet<Reputation>(`/api/identities/${trade.buyerIdentity}/reputation`), trade.buyerIdentity);
  const rep = reputation.data;
  const advanced = useAdvanced();
  return (
    <section className="cf-card" data-flush>
      <div className="cf-card__section">
        <h2 className="cf-heading" style={{ marginBottom: 'var(--space-3)' }}>
          Request
        </h2>
        <dl className="cf-dl">
          <dt>Buyer</dt>
          <dd>
            {aliasFor(trade.buyerIdentity).name}
            {advanced && (
              <>
                {' · '}
                <HashLink value={trade.buyerIdentity} kind="plain" />
              </>
            )}
            <br />
            {rep ? (
              <span className="cf-small">
                <strong>{rep.completedAsBuyer}</strong> completed as buyer
                {rep.firstCompletedAt !== null && ` · since ${formatDate(rep.firstCompletedAt)}`}
              </span>
            ) : (
              <Skeleton width={160} />
            )}
            <br />
            <span className="cf-small cf-subtle">Counted by Campfire. It cannot be verified on-chain and can be inflated with a second wallet.</span>
            <br />
            <span className="cf-small cf-subtle">The name comes from the buyer's key; nobody chooses it.</span>
          </dd>
          <dt>Amount</dt>
          <dd>
            <span className="cf-num">{formatAmount(trade.amount, BCH)}</span>
          </dd>
          <dt>Price</dt>
          <dd>
            {trade.quote ? (
              <>
                <span className="cf-num">
                  {formatFiat(applyMargin(trade.quote.price, trade.marginBps ?? 0), trade.fiat)}/BCH
                </span>
                <br />
                <span className="cf-small cf-muted">
                  Oracle price {formatFiat(Number(trade.quote.price), trade.fiat)} · {describeMargin(trade.marginBps ?? 0)}. The signature is checked
                  before you lock.
                </span>
              </>
            ) : (
              <span className="cf-small cf-muted">The fixed price from your offer.</span>
            )}
          </dd>
          <dt>You receive</dt>
          <dd>
            <span className="cf-amount">{fiat}</span>
          </dd>
          {/* The buyer's payout address is checked before you lock; read it here with technical details on. */}
          {advanced && (
            <>
              <dt>Pays to</dt>
              <dd>
                {trade.buyerPayoutPkh && <HashLink value={pkhToCashAddress(trade.buyerPayoutPkh)} kind="address" />}
              </dd>
            </>
          )}
        </dl>
      </div>
    </section>
  );
}

// --- Endings ---

export function SellerResult({ trade, amount }: { trade: Trade; amount: string }) {
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
      <dt>Returned to</dt>
      <dd>{backAddress}</dd>
    </>
  );
  switch (trade.status) {
    case 'Released':
      notice = (
        <Notice tone="verified" title="Trade completed">
          You released {amount} to the buyer. The fiat payment happened off-chain: it is between you and the buyer.
        </Notice>
      );
      rows = row('Release');
      break;
    case 'ResolvedBuyer':
      notice = (
        <Notice tone="attention" title="The arbiter decided for the buyer">
          The {amount} went to the buyer.
        </Notice>
      );
      rows = row('Arbitrate');
      break;
    case 'ResolvedSeller':
      notice = trade.disputedAt ? (
        <Notice title="The arbiter decided for you">The {amount} came back to you.</Notice>
      ) : (
        <Notice title="The payment window ended">
          The buyer did not mark the payment as sent in time, so the arbiter returned the {amount} to you.
        </Notice>
      );
      rows = (
        <>
          {row('Arbitrate')}
          {returned}
        </>
      );
      break;
    case 'Cancelled':
      notice = <Notice title="The buyer cancelled the trade">The {amount} came back to you.</Notice>;
      rows = (
        <>
          {row('Cancel')}
          {returned}
        </>
      );
      break;
    case 'Refunded':
      notice = <Notice title="The coins came back to you">The {amount} came back after the refund time.</Notice>;
      rows = (
        <>
          {row('Refund')}
          {returned}
        </>
      );
      break;
    default:
      notice = <Notice title="The trade was dropped">The request was declined or not funded in time. Nothing was locked.</Notice>;
      rows = null;
  }
  return (
    <section className="cf-card" data-flush>
      <div className="cf-card__section cf-stack">
        {notice}
        <dl className="cf-dl">
          {rows}
          <dt>Ended</dt>
          <dd>{formatDateTime(ended)}</dd>
        </dl>
        <div className="s-actions">
          <Button variant="primary" to="/trades">
            Back to My trades
          </Button>
        </div>
      </div>
    </section>
  );
}

const capitalize = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);
/** "is" for the BCH, "are" for the coins of a token. */
const lockVerb = (asset: string) => (asset === 'BCH' ? 'is' : 'are');

// Invented copy: the design predates the service fees (protocol section 5.1).
/** The service fees the deposit pays besides the escrow, fixed when the trade was requested. */
function FeeNote({ fees }: { fees?: TradeFee[] }) {
  if (!fees || fees.length === 0) return null;
  const parts = fees.map((f) => `${formatBch(BigInt(f.satoshis))} to the ${f.role === 'oracle' ? 'price oracle' : 'arbiter'}`);
  return (
    <p className="cf-small cf-muted">
      The same transaction pays the service fees: {parts.join(' and ')}. They are paid in BCH and are not returned if the trade is
      cancelled or refunded.
    </p>
  );
}
