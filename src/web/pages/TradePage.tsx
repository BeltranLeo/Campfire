import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { Link, useParams } from 'react-router';
import { expectedEscrowFunding } from '../../protocol/escrow.js';
import { decryptPaymentDetails, verifyPaymentDetailsSignature } from '../../protocol/crypto.js';
import { pkhToCashAddress } from '../../protocol/keys.js';
import { verifyPriceQuote } from '../../protocol/trades.js';
import { ApiError, apiGet, apiPost, type Offer, type Reputation, type Trade } from '../api';
import { aliasFor } from '../alias';
import { assetInfo, type AssetInfo } from '../assets';
import { ActionCard } from '../components/ActionCard';
import { Button } from '../components/Button';
import { DisputeForm } from '../components/DisputeForm';
import { CopyButton } from '../components/CopyButton';
import { Details } from '../components/Details';
import { HashLink, ProvenanceTag, SimBox } from '../components/Provenance';
import { EmptyState, Notice, Skeleton } from '../components/States';
import { StatusPill } from '../components/StatusPill';
import { TradeChat } from '../components/TradeChat';
import { Countdown, Timeline, confirmationsText } from '../components/Timeline';
import { useConfig } from '../config';
import { electrum } from '../electrum';
import {
  applyMargin,
  describeMargin,
  formatAmount,
  formatBch,
  formatClock,
  formatDate,
  formatDateTime,
  formatFiat,
  formatFiatAmount,
  formatHourMinute,
  paymentMethodLabel,
} from '../format';
import { useCompletedWith } from '../hooks/useCompletedWith';
import { useConfirmations } from '../hooks/useConfirmations';
import { otherParty } from '../mytrades';
import { usePoll } from '../hooks/usePoll';
import { useTradeAction } from '../hooks/useTradeAction';
import { SellerAction, SellerResult } from './SellerTrade';
import { useFindingAddressNote } from '../hooks/useBusyStep';
import { prepareIndices } from '../indices';
import { browserStore, buildBuyerAcceptBody, commitSession, generateSessionKeyPair, loadPendingSession, readSessionKey, savePendingSession } from '../take';
import {
  TradeActionError,
  actionProgress,
  buildBuyerCancel,
  checkBuyRequest,
  checkEscrow,
  disputeKeyHex,
  isFinal,
  lockedCoins,
  newerTrade,
  readPaymentDetails,
  roleOf,
  timeline,
  tradeTitle,
  type EscrowCheck,
  type PaymentDetailsView,
  type Role,
  type Step,
} from '../trade';
import { DSPROOF_WATCH_SEC, useDoubleSpendWatch, type DoubleSpendState } from '../dsproof';
import { WalletDeclined, useWallet } from '../wallet';
import { useMessages } from '../lang';
import { MESSAGES, text } from '../messages';

// One trade, for the buyer or a visitor (Main, Trade-* screens). One column: title and status, the action
// card (the only part that changes with the state), progress, and the on-chain details folded away.
// The buyer can mark paid, open a dispute and cancel; the arbiter console is its own page (Arbiter.tsx).
// The seller's own view is in SellerTrade.tsx. On a buy offer the buyer also accepts the seller's request here
// (Trade-BuyOffer-Buyer). Under progress the buyer and the seller get the trade chat (TradeChat.tsx).

const POLL_MS = 3000;
// Invented copy: generic reasons for a dispute, chosen from a list. The arbiter reads the English one.
const disputeReasons = () =>
  MESSAGES.en.tradePage.disputeReasons.map((value, i) => ({ value, label: text().tradePage.disputeReasons[i] ?? value }));

export function TradePage() {
  const { id = '' } = useParams();
  // A new id is a new page: nothing from the previous trade may carry over.
  return <TradeLoader key={id} id={id} />;
}

function TradeLoader({ id }: { id: string }) {
  const wallet = useWallet();
  // While a stored pairing is being restored the role is not known yet; wait instead of flashing the visitor view.
  const walletSettled = wallet.status !== 'connecting';
  const identity = wallet.status === 'connected' ? wallet.identity : null;

  const [trade, setTrade] = useState<Trade>();
  const accept = useCallback((incoming: Trade) => setTrade((current) => newerTrade(current, incoming)), []);
  const final = trade !== undefined && isFinal(trade);
  const load = usePoll(
    () =>
      apiGet<{ trade: Trade }>(`/api/trades/${id}${identity ? `?viewer=${identity}` : ''}`).then((r) => {
        accept(r.trade);
        return r.trade;
      }),
    `${id}:${identity ?? ''}`,
    final ? undefined : POLL_MS,
  );

  if (!trade || !walletSettled) {
    if (load.error && !trade) return <TradeError error={load.error} id={id} onRetry={load.reload} />;
    return <TradeLoading />;
  }
  return <TradeView trade={trade} role={roleOf(trade, identity)} onUpdate={accept} reload={load.reload} />;
}

function TradeView({ trade, role, onUpdate, reload }: { trade: Trade; role: Role; onUpdate: (t: Trade) => void; reload: () => void }) {
  const config = useConfig();
  const wallet = useWallet();
  const asset = assetInfo(trade.asset, trade.assetDecimals, config);
  const amount = formatAmount(trade.amount, asset);
  // The public view a visitor reads has no fiat terms (src/server/tradeViews.ts).
  const fiat = trade.public ? '' : formatFiatAmount(trade.fiatAmount, trade.fiat);
  // On a buy offer the buyer's payout is chosen when the buyer accepts.
  const payout = trade.buyerPayoutPkh ? pkhToCashAddress(trade.buyerPayoutPkh, { tokenAware: !asset.isBch }) : null;
  const view: Role = role;
  const t = useMessages().tradePage;

  // The browser checks the escrow itself before telling the buyer the coins are locked (protocol section 5).
  const [check, setCheck] = useState<EscrowCheck | null | 'error'>(null);
  const [attempt, setAttempt] = useState(0);
  const receiveXpub = view === 'buyer' ? wallet.xpubs?.receive ?? null : null;
  useEffect(() => {
    let current = true;
    let retry: ReturnType<typeof setTimeout> | undefined;
    // A failed lookup, or a deposit not visible yet, is looked up again every 15 s.
    const again = () => (retry = setTimeout(() => setAttempt((n) => n + 1), 15_000));
    checkEscrow(trade, electrum(), receiveXpub).then(
      (result) => {
        if (!current) return;
        setCheck(result);
        if (result?.funding === 'missing') again();
      },
      () => {
        if (!current) return;
        setCheck('error');
        again();
      },
    );
    return () => {
      current = false;
      clearTimeout(retry);
    };
    // Re-check when the deposit or the state changes, or on a retry; not on every poll.
  }, [trade.tradeId, trade.fundingTxid, trade.status, receiveXpub, attempt]);

  // The deposit's confirmations come from the chain, not from the trade record: the server stores 0 when it sees the
  // deposit and never follows it into a block. Until the chain answers the count is unknown and shown nowhere.
  const confirmations = useConfirmations(trade.fundingTxid, !isFinal(trade));
  const onChain: Trade = { ...trade, fundingConfirmations: confirmations };
  // A deposit still in the mempool (or not looked up yet) is watched for double-spend proofs until it is in a block.
  const zeroConf = (trade.status === 'Funded' || trade.status === 'Paid') && (confirmations ?? 0) === 0;
  const ds = useDoubleSpendWatch(trade.fundingTxid, trade.fundedAt, zeroConf);

  return (
    <main className="s-main" data-desk="wide">
      <div className="s-trade">
        <div className="s-pagehead">
          {view === 'buyer' && trade.side !== 'buy' ? (
            <Link className="s-back" to="/offers">
              {t.backOffers}
            </Link>
          ) : view === 'buyer' || view === 'seller' ? (
            <Link className="s-back" to="/trades">
              {t.backTrades}
            </Link>
          ) : (
            <Link className="s-back" to="/transparency">
              {t.backTransparency}
            </Link>
          )}
          <h1 className="cf-title">
            {(view === 'visitor' && isFinal(trade) && t.visitorTitle(trade.status, amount)) ||
              (trade.public ? amount : tradeTitle(trade.status, view, amount, fiat))}
          </h1>
          <div className="cf-row">
            <StatusPill state={trade.status} role={view} side={trade.side} />
            {trade.fundingTxid ? (
              <ProvenanceTag kind="chain">{t.realEscrow}</ProvenanceTag>
            ) : (
              <ProvenanceTag kind="offchain">{isFinal(trade) ? t.nothingWentOnChain : t.nothingOnChain}</ProvenanceTag>
            )}
            {trade.isDemo && <ProvenanceTag kind="sim">{t.simulatedPayment}</ProvenanceTag>}
          </div>
          {(view === 'buyer' || view === 'seller') && <PartyLine trade={trade} view={view} />}
        </div>

        {view === 'buyer' ? (
          isFinal(trade) ? (
            <BuyerResult trade={trade} amount={amount} payout={payout} />
          ) : (
            <BuyerAction trade={onChain} amount={amount} fiat={fiat} check={check} ds={ds} onUpdate={onUpdate} reload={reload} />
          )
        ) : view === 'seller' ? (
          isFinal(trade) ? (
            <SellerResult trade={trade} amount={amount} />
          ) : (
            <SellerAction trade={trade} amount={amount} fiat={fiat} onUpdate={onUpdate} />
          )
        ) : (
          <VisitorCard trade={trade} />
        )}

        {/* A visitor to an ended trade came to read its story, so it starts open for them. */}
        <ProgressCard steps={timeline(onChain, view, amount)} final={isFinal(trade)} open={view === 'visitor' && isFinal(trade)} />

        {(view === 'buyer' || view === 'seller') && <TradeChat trade={trade} role={view} />}

        <OnChainDetails trade={onChain} asset={asset} amount={amount} fiat={fiat} payout={payout} check={check} ds={ds} view={view} />
      </div>
    </main>
  );
}

// Who the other person is, under the title, for the two people in the trade only: the visitor's public view names
// nobody. Their alias (the same name the offers list shows), their record, and how many trades the reader completed
// with them, from the reader's own list. Invented: the design only names the other person under on-chain details.
function PartyLine({ trade, view }: { trade: Trade; view: 'buyer' | 'seller' }) {
  const party = view === 'seller' ? 'buyer' : 'seller';
  const partyIdentity = party === 'buyer' ? trade.buyerIdentity : trade.sellerIdentity;
  const reputation = usePoll(() => apiGet<Reputation>(`/api/identities/${partyIdentity}/reputation`), partyIdentity);
  const withYou = useCompletedWith(partyIdentity);
  const rep = reputation.data;
  const t = useMessages().tradePage;
  return (
    <p className="cf-small">
      <span className="cf-muted">{t.partyLabel(party)}</span> <strong>{otherParty(trade, view)}</strong>
      {rep && (
        <span className="cf-muted">
          {' · '}
          {party === 'buyer' ? rep.completedAsBuyer : rep.completedAsSeller}
          {t.completedAs(party)}
        </span>
      )}
      {withYou !== null && <span className="cf-muted"> · {t.withYou(withYou)}</span>}
    </p>
  );
}

// The timeline folds behind one line that names the step the trade is on, so the action card above and the rest of
// the page fit on a phone's screen. The action card already says what to do now; the full story is one tap away.
// A trade that has ended names its outcome (the last step) instead: counting steps would call a dispute the buyer won
// "step 3 of 5" after the payment step it skipped, and a cancelled trade "all steps done".
function ProgressCard({ steps, final, open }: { steps: Step[]; final: boolean; open: boolean }) {
  const at = steps.findIndex((step) => step.state === 'current' || step.state === 'failed');
  const index = at >= 0 ? at : steps.length - 1;
  const allDone = at < 0 && steps.every((step) => step.state === 'done');
  const t = useMessages().tradePage;
  const outcome = steps[steps.length - 1]?.title ?? '';
  return (
    <details className="cf-card tr-progress" data-flush open={open || undefined}>
      <summary className="cf-card__section">
        <h2 className="cf-heading">{t.progress}</h2>
        <span className="cf-small cf-muted tr-progress__now">
          {final ? t.endedWith(outcome) : allDone ? t.allDone(steps.length) : t.stepOf(index + 1, steps.length, steps[index]?.title ?? '')}
        </span>
      </summary>
      <div className="cf-card__section">
        <Timeline steps={steps} />
      </div>
    </details>
  );
}

// --- Action card (the buyer, while the trade is open) ---

function BuyerAction(props: {
  trade: Trade;
  amount: string;
  fiat: string;
  check: EscrowCheck | null | 'error';
  ds: DoubleSpendState;
  onUpdate: (t: Trade) => void;
  reload: () => void;
}) {
  const { trade } = props;
  const wallet = useWallet();
  const { busy, error, run } = useTradeAction<'paid' | 'dispute' | 'cancel' | 'withdraw'>(trade, wallet.identity, props.onUpdate);
  const progress = actionProgress(trade.status, 'buyer', trade.side);
  const coins = lockedCoins(trade.asset);
  const t = useMessages().tradePage;
  const isBch = trade.asset === 'BCH';
  // The dispute asks for a reason first, so it opens a small form.
  const [disputing, setDisputing] = useState(false);
  // Marking the payment needs no signature and cannot be undone, so the button asks once more before it sends.
  const [confirmingPaid, setConfirmingPaid] = useState(false);
  // After the payment is marked, cancelling would lose the money already sent, so it too asks once more.
  const [confirmingCancel, setConfirmingCancel] = useState(false);
  // The last check before fiat leaves the buyer's account: this browser rebuilt the escrow from the terms and found the
  // deposit in it. Until then (still checking, a lookup that failed, terms that do not match, no deposit) the buyer
  // cannot mark the payment; the notice above says why.
  const escrowChecked =
    props.check !== null &&
    props.check !== 'error' &&
    props.check.termsMatch &&
    props.check.addressMatch &&
    props.check.payoutIsMine !== false &&
    props.check.funding === 'match';
  const cannotPay = props.ds.phase === 'proof' || !escrowChecked;

  const markPaid = () =>
    run('paid', t.notMarked, () =>
      apiPost<{ trade: Trade }>(`/api/trades/${trade.id}/paid`, { buyerIdentity: wallet.identity }).then((r) => r.trade),
    );

  // The chat key goes along when this browser has it, so the arbiter can read the messages (protocol section 6).
  const openDispute = (reason: string, details: string) =>
    run('dispute', t.notDisputed, () => {
      const sharedTradeKeyHex = disputeKeyHex(readSessionKey(trade.id), trade.sellerSessionPk);
      const extra = details.trim();
      return apiPost<{ trade: Trade }>(`/api/trades/${trade.id}/dispute`, {
        callerIdentity: wallet.identity,
        reason: extra ? `${reason}: ${extra}` : reason,
        ...(sharedTradeKeyHex && { sharedTradeKeyHex }),
      }).then((r) => r.trade);
    });

  // Before the seller accepts nothing is on-chain, so taking the request back needs no signature.
  const withdraw = () =>
    run('withdraw', t.notWithdrawn, () =>
      apiPost<{ trade: Trade }>(`/api/trades/${trade.id}/withdraw`, { identity: wallet.identity }).then((r) => r.trade),
    );

  // The wallet signs the escrow's `cancel` path; the server checks it and broadcasts.
  const cancelTrade = () =>
    run('cancel', t.notCancelled, async () => {
      if (!wallet.xpubs) throw new WalletDeclined();
      const built = await buildBuyerCancel(trade, electrum(), wallet.xpubs.defi);
      const signedTxHex = await wallet.sign(built.request, built.inputPaths);
      return apiPost<{ trade: Trade }>(`/api/trades/${trade.id}/settle`, { path: 'cancel', signedTxHex }).then((r) => r.trade);
    });

  const failure = error && (
    <Notice tone="danger" title={error.title}>
      {error.message}
    </Notice>
  );
  const disputeForm = disputing && (
    <DisputeForm reasons={disputeReasons()} busy={busy === 'dispute'} locked={busy !== null} onSend={openDispute} onBack={() => setDisputing(false)} />
  );
  // Cancelling signs and ends the trade, so while the buyer can still pay it sits in the fold, away from the main button.
  // The fold stays open while the dispute form is showing, so the person does not lose what they typed.
  // The cancel note depends on the step: before the payment it is a plain exit; after it, cancelling would lose the money,
  // so with `confirm` the button first asks whether the money really did not leave (or came back).
  const somethingWrong = (arbiterLine: string, cancelNote: string, confirm = false) => (
    <Details summary={t.somethingWrong} tag={null} open={disputing || undefined}>
      <div className="cf-stack">
        {disputeForm || (
          <div className="cf-stack" data-gap="2">
            <Button block variant="arbiter" disabled={busy !== null} onClick={() => setDisputing(true)}>
              {t.askArbiter}
            </Button>
            <p className="cf-small cf-muted">{arbiterLine}</p>
          </div>
        )}
        {confirm && confirmingCancel ? (
          <div className="cf-well cf-stack" data-gap="3">
            <strong>{t.confirmCancelTitle(props.fiat)}</strong>
            <p className="cf-small">{t.confirmCancelBody}</p>
            <div className="s-actions">
              <Button
                variant="danger"
                signs={cancelNote}
                busy={busy === 'cancel'}
                disabled={busy !== null && busy !== 'cancel'}
                onClick={() => cancelTrade().finally(() => setConfirmingCancel(false))}
              >
                {t.confirmCancel}
              </Button>
              <Button variant="ghost" disabled={busy !== null} onClick={() => setConfirmingCancel(false)}>
                {t.goBack}
              </Button>
            </div>
          </div>
        ) : (
          <div className="cf-stack" data-gap="2">
            <Button
              block
              variant="danger"
              signs={cancelNote}
              busy={busy === 'cancel'}
              disabled={busy !== null && busy !== 'cancel'}
              onClick={confirm ? () => setConfirmingCancel(true) : cancelTrade}
            >
              {t.cancelReturn(coins)}
            </Button>
            <p className="cf-small cf-muted">{t.cancelNote(isBch)}</p>
          </div>
        )}
      </div>
    </Details>
  );
  // In a dispute the cancel button stays in plain sight. Once the payment was marked, cancelling would lose the money
  // already sent, so it asks once more, the same way it does in the Paid state.
  const cancelButton =
    trade.paidAt !== undefined && confirmingCancel ? (
      <div className="cf-well cf-stack" data-gap="3">
        <strong>{t.confirmCancelTitle(props.fiat)}</strong>
        <p className="cf-small">{t.confirmCancelBody}</p>
        <div className="s-actions">
          <Button
            variant="danger"
            signs={t.cancelSigns}
            busy={busy === 'cancel'}
            disabled={busy !== null && busy !== 'cancel'}
            onClick={() => cancelTrade().finally(() => setConfirmingCancel(false))}
          >
            {t.confirmCancel}
          </Button>
          <Button variant="ghost" disabled={busy !== null} onClick={() => setConfirmingCancel(false)}>
            {t.goBack}
          </Button>
        </div>
      </div>
    ) : (
      <div className="s-actions">
        <Button
          variant="danger"
          signs={t.cancelSigns}
          busy={busy === 'cancel'}
          disabled={busy !== null && busy !== 'cancel'}
          onClick={trade.paidAt !== undefined ? () => setConfirmingCancel(true) : cancelTrade}
        >
          {t.cancelTrade}
        </Button>
      </div>
    );

  switch (trade.status) {
    case 'Requested':
      if (trade.side === 'buy') return <BuyRequest trade={trade} amount={props.amount} fiat={props.fiat} onUpdate={props.onUpdate} />;
      return (
        <ActionCard
          turn="other"
          progress={progress}
          title={t.waitingAccept}
          reassurance={t.nothingCharged}
          deadline={
            trade.quoteExpiresAt && (
              <>
                <Countdown deadline={trade.quoteExpiresAt} windowSec={600} />
                <span className="cf-small cf-muted">{t.leftOnQuote}</span>
              </>
            )
          }
        >
          <p className="cf-muted">{t.priceLocked}</p>
          {failure}
          <div className="s-actions">
            <Button to="/offers">{t.backToOffers}</Button>
            <Button busy={busy === 'withdraw'} disabled={busy !== null && busy !== 'withdraw'} onClick={withdraw}>
              {t.cancelRequest}
            </Button>
          </div>
        </ActionCard>
      );
    case 'Accepted':
      return (
        <ActionCard
          turn="other"
          progress={progress}
          title={t.waitingLock(coins)}
          reassurance={t.dontPayYet(coins, isBch)}
          deadline={
            trade.fundingDeadline && (
              <>
                <Countdown deadline={trade.fundingDeadline} windowSec={1800} />
                <span className="cf-small cf-muted">{t.leftToLock(coins)}</span>
              </>
            )
          }
        >
          <div className="s-actions">
            <Button to="/offers">{t.backToOffers}</Button>
          </div>
        </ActionCard>
      );
    case 'Funded': {
      const windowSec = trade.paymentDeadline && trade.fundedAt ? trade.paymentDeadline - trade.fundedAt : 0;
      return (
        <ActionCard
          turn="you"
          progress={progress}
          title={t.sendPayment}
          reassurance={props.check && props.check !== 'error' && props.check.funding === 'match' ? t.lockedForYou : undefined}
          deadline={
            trade.paymentDeadline && (
              <>
                <Countdown deadline={trade.paymentDeadline} windowSec={windowSec} />
                <span className="cf-small cf-muted">{t.leftToMark}</span>
              </>
            )
          }
        >
          <EscrowCheckNotice check={props.check} />
          <ZeroConfNotice ds={props.ds} isDemo={trade.isDemo === true} confirmed={(trade.fundingConfirmations ?? 0) > 0} />
          <PaymentDetails trade={trade} fiat={props.fiat} />
          {failure}
          {confirmingPaid ? (
            <div className="cf-well cf-stack" data-gap="3">
              <strong>{t.confirmPaidTitle(props.fiat)}</strong>
              <p className="cf-small">{t.confirmPaidBody}</p>
              <div className="s-actions">
                <Button
                  variant="primary"
                  busy={busy === 'paid'}
                  disabled={cannotPay || (busy !== null && busy !== 'paid')}
                  onClick={() => markPaid().finally(() => setConfirmingPaid(false))}
                >
                  {t.confirmPaid}
                </Button>
                <Button variant="ghost" disabled={busy !== null} onClick={() => setConfirmingPaid(false)}>
                  {t.notYet}
                </Button>
              </div>
            </div>
          ) : (
            <div className="s-actions">
              <Button
                variant="primary"
                // Also held while the deposit is still being watched: a double spend shows within those seconds.
                disabled={cannotPay || props.ds.phase === 'watching' || busy !== null}
                onClick={() => setConfirmingPaid(true)}
                note={t.noSignatureNeeded}
              >
                {t.sentPayment}
              </Button>
            </div>
          )}
          {somethingWrong(t.wrongFunded, t.cancelFunded)}
        </ActionCard>
      );
    }
    case 'Paid':
      return (
        <ActionCard
          turn="other"
          progress={progress}
          title={t.waitingRelease}
          reassurance={props.check && props.check !== 'error' && props.check.funding === 'match' ? t.lockedForYou : undefined}
        >
          <p className="cf-muted">{t.youMarked(props.amount)}</p>
          {failure}
          {somethingWrong(t.wrongPaid, t.cancelPaid, true)}
        </ActionCard>
      );
    case 'Disputed': {
      const opened = trade.disputedAt !== undefined ? formatHourMinute(new Date(trade.disputedAt * 1000)) : null;
      return (
        <ActionCard turn="arbiter" title={t.reviewing}>
          <p className="cf-muted">{t.disputeBy(trade.disputedBy === 'seller', opened)}</p>
          {trade.isDemo && (
            <SimBox tag={t.simulatedArbiter} label={t.decideYourself} bodyGap={3}>
              <p className="cf-small">{t.realArbiterOnly}</p>
              <div>
                <Button variant="primary" to={`/trade/${trade.id}/arbiter`}>
                  {t.openConsole}
                </Button>
              </div>
            </SimBox>
          )}
          {failure}
          {cancelButton}
        </ActionCard>
      );
    }
    default:
      return null;
  }
}

// The buyer who published a buy offer accepts a seller's request (Trade-BuyOffer-Buyer). Accepting sends only the
// buyer's keys: no signature and no coins. Before that, this browser checks the request against the offer.
function BuyRequest(props: { trade: Trade; amount: string; fiat: string; onUpdate: (t: Trade) => void }) {
  const { trade } = props;
  const wallet = useWallet();
  const { identity, xpubs } = wallet;
  const { busy, error, run } = useTradeAction<'accept' | 'decline'>(trade, identity, props.onUpdate);
  const offer = usePoll(() => apiGet<{ offer: Offer }>(`/api/offers/${trade.offerTxid}`).then((r) => r.offer.document), trade.offerTxid);
  const findingNote = useFindingAddressNote();
  const prep = usePoll(() => (identity && xpubs ? prepareIndices(identity, xpubs, 'buyer') : Promise.resolve(null)), `${identity}:${trade.id}`);
  const problem = offer.data ? checkBuyRequest(trade, offer.data) : null;
  const t = useMessages().tradePage;
  const methods = offer.data?.paymentMethods.map(paymentMethodLabel).join(` ${t.or} `);

  const accept = () =>
    run('accept', t.notAccepted, async () => {
      if (!identity || !xpubs || !prep.data || !offer.data) throw new TradeActionError(t.stillPreparing);
      const stop = checkBuyRequest(trade, offer.data);
      if (stop) throw new TradeActionError(t.nothingAccepted(stop));
      // The session key is saved before the request, so a lost answer can still be matched to its trade.
      const store = browserStore();
      const session = (store && loadPendingSession(store, trade.id)) || generateSessionKeyPair();
      if (store) savePendingSession(store, trade.id, session);
      const body = buildBuyerAcceptBody({
        identity,
        defiXpub: xpubs.defi,
        receiveXpub: xpubs.receive,
        defiIndex: prep.data.defi,
        receiveIndex: prep.data.receive,
        session,
      });
      const { trade: accepted } = await apiPost<{ trade: Trade }>(`/api/trades/${trade.id}/accept`, body);
      if (store) commitSession(store, accepted.id, session);
      return accepted;
    });

  const decline = () =>
    run('decline', t.notDeclined, () =>
      apiPost<{ trade: Trade }>(`/api/trades/${trade.id}/decline`, { buyerIdentity: identity }).then((r) => r.trade),
    );

  return (
    <ActionCard
      turn="you"
      progress={actionProgress(trade.status, 'buyer', trade.side)}
      title={t.sellerWants(props.amount)}
      reassurance={t.acceptFree}
      deadline={
        trade.quoteExpiresAt && (
          <>
            <Countdown deadline={trade.quoteExpiresAt} windowSec={600} />
            <span className="cf-small cf-muted">{t.leftToAccept}</span>
          </>
        )
      }
    >
      <p className="cf-muted">{t.youWillPay(props.fiat, methods || null)}</p>
      {problem && (
        // Invented copy: the design has no screen for a request that fails the check.
        <Notice tone="danger" title={t.doNotAccept}>
          {problem}
        </Notice>
      )}
      {error && (
        <Notice tone="danger" title={error.title}>
          {error.message}
        </Notice>
      )}
      <div className="s-actions">
        <Button
          variant="primary"
          busy={busy === 'accept'}
          disabled={!prep.data || !offer.data || problem !== null || (busy !== null && busy !== 'accept')}
          onClick={accept}
          note={!prep.data ? findingNote : t.noSignature}
        >
          {t.accept}
        </Button>
        <Button busy={busy === 'decline'} disabled={busy !== null && busy !== 'decline'} onClick={decline}>
          {t.decline}
        </Button>
      </div>
    </ActionCard>
  );
}

// The deposit at zero confirmations (Bitcoin Cash 0-conf): watched for a double-spend proof for a few
// seconds, then safe to act on. Without the check the page falls back to asking for one confirmation.
function ZeroConfNotice({ ds, isDemo, confirmed }: { ds: DoubleSpendState; isDemo: boolean; confirmed: boolean }) {
  const t = useMessages().tradePage;
  // Once the deposit is in a block the double-spend watch stops; the buyer still gets the quiet good-news line.
  if (confirmed && ds.phase !== 'proof') {
    return (
      <div className="cf-notice tr-safe" data-tone="verified">
        <div>
          <strong>{t.confirmedInBlock}.</strong> {t.confirmedInBlockBody}
        </div>
      </div>
    );
  }
  switch (ds.phase) {
    case 'watching':
      return (
        <div className="cf-notice">
          <div>
            <strong>{t.checkingLock}</strong>
            {t.checkingLockBody(ds.secondsLeft)}
          </div>
        </div>
      );
    case 'clear':
      // Good news with nothing to do: one quiet line beside the shield line, not a green box that competes with the
      // button. The warnings below keep the box, since they ask for attention.
      return (
        <div className="cf-notice tr-safe" data-tone="verified">
          <div>
            <strong>{t.safe}.</strong> {t.safeBody(DSPROOF_WATCH_SEC)}
          </div>
        </div>
      );
    case 'uncovered':
      return (
        <Notice tone="attention" title={t.uncovered}>
          {t.uncoveredBody}
        </Notice>
      );
    case 'proof':
      return (
        <Notice tone="danger" title={t.doubleSpend}>
          {t.doubleSpendBody}
        </Notice>
      );
    case 'error':
      return isDemo ? (
        <Notice tone="attention" title={t.noDsCheck}>
          {t.noDsCheckDemo}
        </Notice>
      ) : (
        <Notice tone="attention" title={t.noDsCheck}>
          {t.noDsCheckReal}
        </Notice>
      );
    default:
      return null;
  }
}

// Says what this browser verified about the escrow, or that it could not.
function EscrowCheckNotice({ check }: { check: EscrowCheck | null | 'error' }) {
  const t = useMessages().tradePage;
  if (check === null) return <p className="cf-small cf-muted">{t.checkingDeposit}</p>;
  if (check === 'error') {
    return <p className="cf-small cf-muted">{t.checkFailed}</p>;
  }
  if (!check.termsMatch || !check.addressMatch || check.payoutIsMine === false) {
    return (
      <Notice tone="danger" title={t.mismatch}>
        {t.mismatchBody}
      </Notice>
    );
  }
  if (check.funding === 'missing') {
    return (
      <Notice tone="attention" title={t.depositMissing}>
        {t.depositMissingBody}
      </Notice>
    );
  }
  return null;
}

// The seller's payment details, decrypted in this browser with the session key stored when the offer was taken.
function PaymentDetails({ trade, fiat }: { trade: Trade; fiat: string }) {
  const [state, setState] = useState<
    { kind: 'loading' } | { kind: 'nokey' } | { kind: 'failed' } | { kind: 'unsigned' } | { kind: 'ok'; view: PaymentDetailsView }
  >({ kind: 'loading' });
  const m = useMessages();
  const t = m.tradePage;
  useEffect(() => {
    let current = true;
    const key = readSessionKey(trade.id);
    if (!key || !trade.encryptedPaymentDetails || !trade.sellerSessionPk) {
      setState({ kind: 'nokey' });
      return;
    }
    // On a buy offer the buyer shares the encryption key, so only the seller's signature shows who wrote the details.
    if (
      trade.side === 'buy' &&
      !(trade.tradeId && trade.paymentDetailsSignature && verifyPaymentDetailsSignature(trade.sellerSessionPk, trade.tradeId, trade.encryptedPaymentDetails, trade.paymentDetailsSignature))
    ) {
      setState({ kind: 'unsigned' });
      return;
    }
    decryptPaymentDetails(key, trade.sellerSessionPk, trade.encryptedPaymentDetails).then(
      (text) => current && setState({ kind: 'ok', view: readPaymentDetails(text) }),
      () => current && setState({ kind: 'failed' }),
    );
    return () => {
      current = false;
    };
  }, [trade.id, trade.side, trade.tradeId, trade.encryptedPaymentDetails, trade.paymentDetailsSignature, trade.sellerSessionPk]);

  if (state.kind === 'loading') return <Skeleton height={96} />;
  if (state.kind === 'nokey') return <Notice tone="attention">{m.chat.noKey}</Notice>;
  // Invented copy: the key is here but does not open the details.
  if (state.kind === 'failed') return <Notice tone="attention">{t.cannotDecrypt}</Notice>;
  // Invented copy.
  if (state.kind === 'unsigned') {
    return (
      <Notice tone="danger" title={t.doNotPay}>
        {t.unsigned}
      </Notice>
    );
  }

  const amount = (
    <>
      <dt>{t.amount}</dt>
      <dd>
        <span className="cf-num">{fiat}</span>
      </dd>
    </>
  );
  if (state.view.kind === 'text') {
    return (
      <div className="cf-well">
        <dl className="cf-dl">
          <dt>{t.payTo}</dt>
          <dd style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{state.view.text}</dd>
          {amount}
        </dl>
      </div>
    );
  }
  const { simulated, notice: _notice, method, reference, ...rest } = state.view.fields;
  const detailLabels = text().seller.detailLabels;
  const rows = (
    <dl className="cf-dl">
      {method !== undefined && (
        <>
          <dt>{t.method}</dt>
          <dd>{String(method)}</dd>
        </>
      )}
      {reference !== undefined && (
        <>
          <dt>{t.reference}</dt>
          <dd>
            <span className="cf-mono">{String(reference)}</span>
          </dd>
        </>
      )}
      {Object.entries(rest).map(([label, value]) => (
        <span key={label} style={{ display: 'contents' }}>
          {/* The seller's browser writes the field names in English; known ones are shown in the reader's language. */}
          <dt>{detailLabels[label] ?? label}</dt>
          <dd>{String(value)}</dd>
        </span>
      ))}
      {amount}
    </dl>
  );
  // Only details the seller marked as simulated go in the violet box; the demo seller marks its own.
  return simulated === true ? (
    <SimBox label={t.demoDetails}>{rows}</SimBox>
  ) : (
    <div className="cf-well">{rows}</div>
  );
}

// --- Endings ---

function BuyerResult({ trade, amount, payout }: { trade: Trade; amount: string; payout: string | null }) {
  const t = useMessages().tradePage;
  const settlement = trade.settlementTxid && (
    <>
      <HashLink value={trade.settlementTxid} kind="transaction" /> · <ProvenanceTag kind="chain" />
    </>
  );
  const ended = trade.completedAt ?? trade.verdictIssuedAt ?? trade.updatedAt;
  let notice: ReactNode;
  let rows: ReactNode;
  switch (trade.status) {
    case 'Released':
    case 'ResolvedBuyer':
      notice = (
        <Notice tone="verified" title={t.completed}>
          {trade.status === 'Released' ? t.releasedBySeller(amount) : t.releasedByArbiter(amount)} {t.useRightAway}
        </Notice>
      );
      rows = (
        <>
          {settlement && (
            <>
              <dt>{trade.status === 'Released' ? t.release : t.arbitrate}</dt>
              <dd>{settlement}</dd>
            </>
          )}
          {payout && (
            <>
              <dt>{t.receivedAt}</dt>
              <dd>
                <HashLink value={payout} kind="address" />
              </dd>
            </>
          )}
          <dt>{t.completedAt}</dt>
          <dd>{formatDateTime(ended)}</dd>
        </>
      );
      break;
    case 'ResolvedSeller': {
      const minutes = trade.paymentDeadline && trade.fundedAt ? Math.round((trade.paymentDeadline - trade.fundedAt) / 60) : null;
      notice = trade.disputedAt ? (
        <Notice tone="attention" title={t.decidedSeller}>
          {t.fundsBack}
        </Notice>
      ) : (
        <Notice tone="attention" title={t.windowEnded}>
          {t.notMarkedInTime(minutes)}
        </Notice>
      );
      rows = (
        <>
          {settlement && (
            <>
              <dt>{t.arbitrate}</dt>
              <dd>{settlement}</dd>
            </>
          )}
          <dt>{t.verdict}</dt>
          <dd>{trade.disputedAt ? t.forSeller : t.forSellerAuto}</dd>
          <dt>{t.ended}</dt>
          <dd>{formatDateTime(ended)}</dd>
        </>
      );
      break;
    }
    case 'Dropped':
      notice = (
        trade.withdrawnAt !== undefined ? (
          <Notice title={t.withdrawn}>{t.withdrawnBody}</Notice>
        ) : (
          <Notice title={t.dropped}>{t.droppedBody}</Notice>
        )
      );
      rows = (
        <>
          <dt>{t.ended}</dt>
          <dd>{formatDateTime(ended)}</dd>
        </>
      );
      break;
    default: {
      const cancelled = trade.status === 'Cancelled';
      notice = cancelled ? (
        // Invented copy: the design has no screen for a cancelled trade.
        <Notice title={t.cancelled}>{t.cancelledBody}</Notice>
      ) : (
        <Notice title={t.returned}>{t.returnedBody}</Notice>
      );
      rows = (
        <>
          {settlement && (
            <>
              <dt>{cancelled ? t.cancel : t.refund}</dt>
              <dd>{settlement}</dd>
            </>
          )}
          <dt>{t.ended}</dt>
          <dd>{formatDateTime(ended)}</dd>
        </>
      );
    }
  }
  return (
    <section className="cf-card" data-flush>
      <div className="cf-card__section cf-stack">
        {notice}
        <dl className="cf-dl">{rows}</dl>
        <div className="s-actions">
          <Button variant="primary" to="/offers">
            {t.backToOffers}
          </Button>
          {(trade.status === 'Released' || trade.status === 'ResolvedBuyer') && <Button to="/transparency">{t.seeAllPaths}</Button>}
        </div>
      </div>
    </section>
  );
}

// A visitor to an ended trade (often someone checking the project) came for the proof, so it leads: the two
// transactions that locked and settled the coins, each linked to the explorer. What a visitor cannot see is one line
// under it. While the trade is open there is no proof to show yet, so the notice stays in front.
function VisitorCard({ trade }: { trade: Trade }) {
  const ended = trade.completedAt ?? trade.verdictIssuedAt ?? trade.updatedAt;
  const t = useMessages().tradePage;
  const hidden = trade.public ? t.visitorPublicBody : t.visitorBody;
  if (!isFinal(trade)) {
    return (
      <section className="cf-card" data-flush>
        <div className="cf-card__section">
          <Notice title={t.visitor}>{hidden}</Notice>
        </div>
      </section>
    );
  }
  return (
    <section className="cf-card" data-flush>
      <div className="cf-card__section cf-stack">
        <dl className="cf-dl">
          {trade.fundingTxid && (
            <>
              <dt>{t.deposit}</dt>
              <dd>
                <HashLink value={trade.fundingTxid} kind="transaction" /> · <ProvenanceTag kind="chain" />
              </dd>
            </>
          )}
          {trade.settlementTxid && (
            <>
              <dt>{trade.status === 'Released' ? t.release : t.settlement}</dt>
              <dd>
                <HashLink value={trade.settlementTxid} kind="transaction" /> · <ProvenanceTag kind="chain" />
              </dd>
            </>
          )}
          <dt>{trade.status === 'Released' ? t.completedAt : t.ended}</dt>
          <dd>{formatDateTime(ended)}</dd>
        </dl>
        <p className="cf-small cf-muted">
          {t.visitor} {hidden}
        </p>
      </div>
    </section>
  );
}

// --- On-chain details ---

function OnChainDetails(props: {
  trade: Trade;
  asset: AssetInfo;
  amount: string;
  fiat: string;
  payout: string | null;
  check: EscrowCheck | null | 'error';
  ds: DoubleSpendState;
  view: Role;
}) {
  const { trade, asset } = props;
  // The other person: the seller for the buyer and visitors, the buyer for the seller.
  const party = props.view === 'seller' ? 'buyer' : 'seller';
  const partyIdentity = party === 'buyer' ? trade.buyerIdentity : trade.sellerIdentity;
  // The public view names nobody, so there is no one to look up.
  const reputation = usePoll(
    () => (partyIdentity ? apiGet<Reputation>(`/api/identities/${partyIdentity}/reputation`) : Promise.resolve(null)),
    partyIdentity ?? '',
  );
  const expected = expectedEscrowFunding({ asset: trade.asset, amount: trade.amount });
  const holds = expected.token
    ? `${formatAmount(expected.satoshis, { symbol: 'BCH', decimals: 8, isBch: true })} + ${props.amount}`
    : `${formatAmount(expected.satoshis, asset)}`;
  const quoteOk = trade.quote && trade.oraclePk ? verifyPriceQuote(trade.quote, trade.oraclePk) : false;
  const check = props.check && props.check !== 'error' ? props.check : null;
  const rep = reputation.data;
  const m = useMessages();
  const t = m.tradePage;

  return (
    <Details>
      <p className="cf-small cf-muted">{t.forChecking}</p>

      {!trade.escrowAddress && !isFinal(trade) && (
        <section className="cf-card" data-flush>
          <div className="cf-card__section">
            <div className="cf-row" data-between style={{ marginBottom: 'var(--space-2)' }}>
              <h2 className="cf-heading">{t.escrow}</h2>
              <span className="cf-tag">{t.notCreated}</span>
            </div>
            <p className="cf-small cf-muted">{t.notCreatedBody}</p>
          </div>
        </section>
      )}

      {trade.escrowAddress && (
        <section className="cf-card cf-glass cf-glass--escrow" data-flush>
          <div className="cf-card__section">
            <div className="cf-row" data-between style={{ marginBottom: 'var(--space-3)' }}>
              <h2 className="cf-heading">{t.escrow}</h2>
              <ProvenanceTag kind="chain" />
            </div>
            <dl className="cf-dl">
              <dt>{t.address}</dt>
              <dd>
                <HashLink value={trade.escrowAddress} kind="address" /> <CopyButton value={trade.escrowAddress} />
              </dd>
              <dt>{isFinal(trade) ? t.held : t.holds}</dt>
              <dd>
                <span className="cf-num">
                  {holds}
                  {!expected.token && <span className="cf-subtle">{t.feeBudget(props.amount, formatBch(1000n))}</span>}
                </span>
              </dd>
              {trade.fundingTxid && (
                <>
                  <dt>{t.deposit}</dt>
                  <dd>
                    <HashLink value={trade.fundingTxid} kind="transaction" />
                    {trade.fundingConfirmations !== undefined && ` · ${confirmationsText(trade.fundingConfirmations)}`}
                  </dd>
                </>
              )}
              {trade.tradeId && (
                <>
                  <dt>{t.tradeId}</dt>
                  <dd>
                    <HashLink value={trade.tradeId} kind="plain" /> <CopyButton value={trade.tradeId} />
                  </dd>
                </>
              )}
              {/* Once the trade has ended the escrow is empty, so there is nothing left to recover. */}
              {trade.refundTime && !isFinal(trade) && (
                <>
                  <dt>{t.refundPath}</dt>
                  <dd>
                    <span className="cf-small">{t.recoverAfter(formatDateTime(trade.refundTime))}</span>
                  </dd>
                </>
              )}
            </dl>
            <p className="cf-small cf-subtle" style={{ marginTop: 'var(--space-3)' }}>
              {t.derived}
            </p>
            {check && (
              <div className="cf-stack" data-gap="2" style={{ marginTop: 'var(--space-3)' }}>
                <span className="cf-label">{t.checkedHere}</span>
                {check.termsMatch && <span className="s-check">{t.checkTerms}</span>}
                {check.addressMatch && <span className="s-check">{t.checkAddress}</span>}
                {check.payoutIsMine && <span className="s-check">{t.checkPayout}</span>}
                {check.funding === 'match' && <span className="s-check">{t.checkFunding(holds)}</span>}
                {props.ds.phase === 'clear' && <span className="s-check">{t.checkDs(formatClock(props.ds.checkedAt))}</span>}
                {(trade.fundingConfirmations ?? 0) > 0 && <span className="s-check">{t.checkConfirmed}</span>}
                {props.ds.phase === 'uncovered' && (
                  <span className="s-check" data-tone="attention">
                    {t.checkDsUncovered}
                  </span>
                )}
              </div>
            )}
          </div>
        </section>
      )}

      <section className="cf-card" data-flush>
        <div className="cf-card__section">
          <h2 className="cf-heading" style={{ marginBottom: 'var(--space-3)' }}>
            {t.terms}
          </h2>
          <dl className="cf-dl">
            <dt>{t.amount}</dt>
            <dd>
              <span className="cf-num">{props.amount}</span>
            </dd>
            {trade.quote && (
              <>
                <dt>{t.price}</dt>
                <dd>
                  <span className="cf-num">
                    {formatFiat(applyMargin(trade.quote.price, trade.marginBps ?? 0), trade.fiat)}/{asset.symbol}
                  </span>
                  <br />
                  <span className="cf-small cf-muted">
                    {t.floating(describeMargin(trade.marginBps ?? 0, t.marketPrice))}
                    {quoteOk && trade.oraclePk && (
                      <>
                        {' '}
                        {t.quoteSigned} <HashLink value={trade.oraclePk} kind="plain" />
                      </>
                    )}
                  </span>
                </dd>
              </>
            )}
            {!trade.public && (
              <>
                <dt>{t.fiatAmount}</dt>
                <dd>
                  <span className="cf-num">{props.fiat}</span>
                </dd>
                <dt>{t.paidTo}</dt>
                <dd>
                  {/* Invented copy: on a buy offer the payout is not known before the buyer accepts. */}
                  {props.payout ? <HashLink value={props.payout} kind="address" /> : <span className="cf-small cf-muted">{t.chosenOnAccept}</span>}
                  {props.view === 'buyer' && check?.payoutIsMine && (
                    <>
                      <br />
                      <span className="cf-small cf-muted">{t.yourAddress}</span>
                    </>
                  )}
                </dd>
              </>
            )}
            <dt>{t.arbiter}</dt>
            <dd>
              <HashLink value={trade.arbiterPk} kind="plain" />
            </dd>
            {/* The public view leaves the offer out: the offer names its publisher. */}
            {trade.offerTxid && (
              <>
                <dt>{t.offer}</dt>
                <dd>
                  <HashLink value={trade.offerTxid} kind="transaction" />
                  {/* Buy offers are only published by Campfire, which pays for them. */}
                  {trade.side === 'buy' && (
                    <>
                      <br />
                      <span className="cf-small cf-muted">{t.buyOfferSponsored}</span>
                    </>
                  )}
                </dd>
              </>
            )}
          </dl>
        </div>
      </section>

      {partyIdentity && (
        <section className="cf-card" data-flush>
          <div className="cf-card__section">
            <div className="cf-row" data-between style={{ marginBottom: 'var(--space-2)' }}>
              <h2 className="cf-heading">{party === 'buyer' ? t.buyer : t.seller}</h2>
              {party === 'seller' && trade.isDemo && <ProvenanceTag kind="sim">{m.trade.simulatedFiat}</ProvenanceTag>}
            </div>
            <div className="cf-stack" data-gap="1">
              <span>
                {party === 'seller' && trade.isDemo ? <strong>{t.demoSeller}</strong> : <strong>{aliasFor(partyIdentity).name} </strong>}
                <HashLink value={partyIdentity} kind="plain" />
              </span>
              {rep && (
                <span className="cf-small">
                  <strong>{party === 'buyer' ? rep.completedAsBuyer : rep.completedAsSeller}</strong>
                  {t.completedAs(party)}
                  {rep.firstCompletedAt !== null && t.since(formatDate(rep.firstCompletedAt))}
                </span>
              )}
              <span className="cf-small cf-subtle">{t.countedByCampfire}</span>
            </div>
          </div>
        </section>
      )}
    </Details>
  );
}

// --- Loading and errors (Trade-Loading, Trade-Error) ---

function TradeLoading() {
  const t = useMessages().tradePage;
  return (
    <main className="s-main">
      <div className="s-trade">
        <div className="s-pagehead" aria-busy="true">
          <span className="cf-small cf-muted">{t.loading}</span>
          <Skeleton width="65%" height={30} />
          <Skeleton width="35%" height={24} />
        </div>
        <section className="cf-card" data-flush>
          <div className="cf-card__section">
            <div className="cf-stack" data-gap="3">
              <Skeleton width="30%" height={12} />
              <Skeleton width="70%" height={24} />
              <Skeleton width="40%" height={32} />
              <Skeleton height={96} />
              <Skeleton height={44} />
            </div>
          </div>
        </section>
      </div>
    </main>
  );
}

function TradeError({ error, id, onRetry }: { error: unknown; id: string; onRetry: () => void }) {
  const notFound = error instanceof ApiError && error.status === 404;
  const m = useMessages();
  const t = m.tradePage;
  return (
    <main className="s-main">
      <div className="s-trade">
        <div className="s-pagehead">
          <Link className="s-back" to="/offers">
            {t.backOffers}
          </Link>
          <h1 className="cf-title">{t.trade}</h1>
        </div>
        <section className="cf-card" data-flush>
          <div className="cf-card__section">
            {notFound ? (
              <EmptyState title={t.notFound} action={<Button to="/offers">{t.backToOffers}</Button>}>
                {t.noTradeWithId} <span className="cf-mono">{id.length > 12 ? `${id.slice(0, 6)}…${id.slice(-4)}` : id}</span>. {t.checkLink}
              </EmptyState>
            ) : (
              <div className="cf-stack">
                <Notice tone="danger" title={t.loadError}>
                  {error instanceof ApiError && error.status >= 400 && error.status < 500
                    ? error.message
                    : t.loadErrorBody}
                </Notice>
                <div className="s-actions">
                  <Button variant="primary" onClick={onRetry}>
                    {m.common.tryAgain}
                  </Button>
                  <Button to="/offers">{t.backToOffers}</Button>
                </div>
              </div>
            )}
          </div>
        </section>
      </div>
    </main>
  );
}
