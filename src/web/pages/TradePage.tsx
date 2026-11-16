import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { Link, useParams } from 'react-router';
import { expectedEscrowFunding } from '../../protocol/escrow.js';
import { decryptPaymentDetails } from '../../protocol/crypto.js';
import { pkhToCashAddress } from '../../protocol/keys.js';
import { verifyPriceQuote } from '../../protocol/trades.js';
import { ApiError, apiGet, apiPost, type Reputation, type Trade } from '../api';
import { assetInfo, type AssetInfo } from '../assets';
import { Button, WALLET_DECLINED } from '../components/Button';
import { CopyButton } from '../components/CopyButton';
import { Details } from '../components/Details';
import { Icon } from '../components/Icon';
import { HashLink, ProvenanceTag, SimBox } from '../components/Provenance';
import { EmptyState, Notice, Skeleton } from '../components/States';
import { StatusPill } from '../components/StatusPill';
import { Countdown, Timeline, confirmationsText } from '../components/Timeline';
import { useConfig } from '../config';
import { electrum } from '../electrum';
import {
  applyMargin,
  describeMargin,
  formatAmount,
  formatClock,
  formatDate,
  formatDateTime,
  formatFiat,
  formatFiatAmount,
  formatHourMinute,
} from '../format';
import { usePoll } from '../hooks/usePoll';
import {
  TradeActionError,
  buildBuyerCancel,
  checkEscrow,
  disputeKeyHex,
  isFinal,
  newerTrade,
  roleOf,
  timeline,
  tradeTitle,
  type EscrowCheck,
  type Role,
} from '../trade';
import { DSPROOF_WATCH_SEC, useDoubleSpendWatch, type DoubleSpendState } from '../dsproof';
import { WalletDeclined, useWallet } from '../wallet';

// One trade, for the buyer or a visitor (Main, Trade-* screens). One column: title and status, the action
// card (the only part that changes with the state), progress, and the on-chain details folded away.
// The buyer can mark paid, open a dispute and cancel; the arbiter console is its own page (Arbiter.tsx).
// Not here yet: the chat (step 12) and the seller's view (step 10).

const POLL_MS = 3000;
// Invented copy: generic reasons for a dispute, chosen from a list.
const DISPUTE_REASONS = [
  'The seller did not release after I paid',
  'The payment details do not work',
  'The seller is not answering',
  'Something else',
];
const NO_KEY = 'This browser does not have the key for this trade. Open it on the device where you started it.';

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
  const fiat = formatFiatAmount(trade.fiatAmount, trade.fiat);
  const payout = pkhToCashAddress(trade.buyerPayoutPkh, { tokenAware: !asset.isBch });
  // The seller's own view comes with step 10; until then a seller sees what a visitor sees.
  const view: Role = role === 'seller' ? 'visitor' : role;

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

  // A deposit still in the mempool is watched for double-spend proofs until it is in a block.
  const zeroConf = (trade.status === 'Funded' || trade.status === 'Paid') && (trade.fundingConfirmations ?? 0) === 0;
  const ds = useDoubleSpendWatch(trade.fundingTxid, trade.fundedAt, zeroConf);

  return (
    <main className="s-main">
      <div className="s-trade">
        <div className="s-pagehead">
          {view === 'buyer' ? (
            <Link className="s-back" to="/offers">
              ← Offers
            </Link>
          ) : (
            <Link className="s-back" to="/transparency">
              ← Transparency
            </Link>
          )}
          <h1 className="cf-title">{tradeTitle(trade.status, view, amount, fiat)}</h1>
          <div className="cf-row">
            <StatusPill state={trade.status} role={view} />
            {trade.fundingTxid ? (
              <ProvenanceTag kind="chain">Real escrow on mainnet</ProvenanceTag>
            ) : (
              <ProvenanceTag kind="offchain">Nothing on-chain yet</ProvenanceTag>
            )}
            {trade.isDemo && <ProvenanceTag kind="sim">Simulated fiat payment</ProvenanceTag>}
          </div>
        </div>

        {view === 'buyer' ? (
          isFinal(trade) ? (
            <BuyerResult trade={trade} amount={amount} payout={payout} />
          ) : (
            <BuyerAction trade={trade} amount={amount} fiat={fiat} check={check} ds={ds} onUpdate={onUpdate} reload={reload} />
          )
        ) : (
          <VisitorCard trade={trade} sellerViewing={role === 'seller'} />
        )}

        <section className="cf-card" data-flush>
          <div className="cf-card__section">
            <h2 className="cf-heading" style={{ marginBottom: 'var(--space-4)' }}>
              Progress
            </h2>
            <Timeline steps={timeline(trade, view, amount)} />
          </div>
        </section>

        <OnChainDetails trade={trade} asset={asset} amount={amount} fiat={fiat} payout={payout} check={check} ds={ds} view={view} />
      </div>
    </main>
  );
}

// --- Action card (the buyer, while the trade is open) ---

function ActionCard(props: { step: string; title: string; reassurance?: ReactNode; deadline?: ReactNode; children?: ReactNode }) {
  return (
    <section className="cf-card s-action" data-flush>
      <div className="cf-card__section">
        <span className="cf-stepper">{props.step}</span>
        <h2 className="cf-heading">{props.title}</h2>
        {props.reassurance && (
          <p className="cf-row cf-small" data-nowrap style={{ color: 'var(--chain)', alignItems: 'flex-start' }}>
            <Icon name="shield" />
            <span>{props.reassurance}</span>
          </p>
        )}
        {props.deadline && <div className="s-deadline">{props.deadline}</div>}
        {props.children}
      </div>
    </section>
  );
}

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
  // Which action is running; the others wait, so two writes never race.
  const [busy, setBusy] = useState<'paid' | 'dispute' | 'cancel' | null>(null);
  const [error, setError] = useState<{ title: string; message: string } | null>(null);
  // The dispute asks for a reason first (a generic list, plus optional details), so it opens a small form.
  const [disputing, setDisputing] = useState(false);
  const [reason, setReason] = useState('');
  const [details, setDetails] = useState('');

  // Runs one write. The answer may be lost after the server recorded it (the demo seller releases within
  // the request; a cancel is broadcast within it): read the trade again before reporting an error, and
  // never offer the same step twice.
  async function run(action: 'paid' | 'dispute' | 'cancel', failed: string, write: () => Promise<Trade>) {
    setBusy(action);
    setError(null);
    try {
      props.onUpdate(await write());
    } catch (err) {
      if (err instanceof WalletDeclined) {
        setError({ title: failed, message: WALLET_DECLINED });
        return;
      }
      if (err instanceof TradeActionError) {
        setError({ title: failed, message: err.message });
        return;
      }
      try {
        const { trade: latest } = await apiGet<{ trade: Trade }>(`/api/trades/${trade.id}?viewer=${wallet.identity}`);
        props.onUpdate(latest);
        if (latest.status !== trade.status) return;
      } catch {
        // Fall through to the original error.
      }
      setError({ title: failed, message: err instanceof ApiError ? err.message : 'Something went wrong. Try again.' });
    } finally {
      setBusy(null);
    }
  }

  const markPaid = () =>
    run('paid', 'The trade was not marked as paid', () =>
      apiPost<{ trade: Trade }>(`/api/trades/${trade.id}/paid`, { buyerIdentity: wallet.identity }).then((r) => r.trade),
    );

  // The chat key goes along when this browser has it, so the arbiter can read the messages (protocol section 6).
  const openDispute = () =>
    run('dispute', 'The dispute was not opened', () => {
      const sharedTradeKeyHex = disputeKeyHex(readSessionKey(trade.id), trade.sellerSessionPk);
      const extra = details.trim();
      return apiPost<{ trade: Trade }>(`/api/trades/${trade.id}/dispute`, {
        callerIdentity: wallet.identity,
        reason: extra ? `${reason}: ${extra}` : reason,
        ...(sharedTradeKeyHex && { sharedTradeKeyHex }),
      }).then((r) => r.trade);
    });

  // The wallet signs the escrow's `cancel` path; the server checks it and broadcasts.
  const cancelTrade = () =>
    run('cancel', 'The trade was not cancelled', async () => {
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
  const disputeButton = !disputing && (
    <Button disabled={busy !== null} onClick={() => setDisputing(true)}>
      Open dispute
    </Button>
  );
  // Invented copy: the design has no screen for the reason.
  const disputeForm = disputing && (
    <div className="cf-well cf-stack" data-gap="3">
      <div className="cf-field">
        <label htmlFor="dispute-reason">Why are you opening a dispute?</label>
        <select id="dispute-reason" className="cf-select" value={reason} onChange={(e) => setReason(e.target.value)}>
          <option value="" disabled>
            Choose a reason
          </option>
          {DISPUTE_REASONS.map((r) => (
            <option key={r}>{r}</option>
          ))}
        </select>
      </div>
      <div className="cf-field">
        <label htmlFor="dispute-details">More details (optional)</label>
        <textarea
          id="dispute-details"
          className="cf-textarea"
          rows={3}
          maxLength={500}
          value={details}
          onChange={(e) => setDetails(e.target.value)}
        />
        <span className="cf-hint">The arbiter reads this when it decides.</span>
      </div>
      <div className="s-actions">
        <Button busy={busy === 'dispute'} disabled={reason === '' || (busy !== null && busy !== 'dispute')} onClick={openDispute}>
          Send dispute
        </Button>
        <Button variant="ghost" disabled={busy !== null} onClick={() => setDisputing(false)}>
          Back
        </Button>
      </div>
    </div>
  );
  const cancelButton = (
    <Button
      variant="danger"
      signs="Signs in your wallet. Returns the funds to the seller."
      busy={busy === 'cancel'}
      disabled={busy !== null && busy !== 'cancel'}
      onClick={cancelTrade}
    >
      Cancel trade
    </Button>
  );

  switch (trade.status) {
    case 'Requested':
      return (
        <ActionCard
          step="Step 2 of 4 · Waiting"
          title="Waiting for the seller to accept"
          reassurance="You have not paid anything. Nothing is charged if the seller does not answer."
          deadline={
            trade.quoteExpiresAt && (
              <>
                <Countdown deadline={trade.quoteExpiresAt} windowSec={600} />
                <span className="cf-small cf-muted">left on the signed quote</span>
              </>
            )
          }
        >
          <p className="cf-muted">The price is locked. If the seller does not accept in time, the trade is dropped and nothing is charged.</p>
          <div className="s-actions">
            <Button to="/offers">Back to offers</Button>
          </div>
        </ActionCard>
      );
    case 'Accepted':
      return (
        <ActionCard
          step="Step 2 of 4 · Waiting"
          title="Waiting for the seller to fund the escrow"
          reassurance="You have not paid anything. Do not pay until the escrow is funded."
          deadline={
            trade.fundingDeadline && (
              <>
                <Countdown deadline={trade.fundingDeadline} windowSec={1800} />
                <span className="cf-small cf-muted">left for the seller to fund the escrow</span>
              </>
            )
          }
        >
          <div className="s-actions">
            <Button to="/offers">Back to offers</Button>
          </div>
        </ActionCard>
      );
    case 'Funded': {
      const windowSec = trade.paymentDeadline && trade.fundedAt ? trade.paymentDeadline - trade.fundedAt : 0;
      return (
        <ActionCard
          step="Step 3 of 4 · Your turn"
          title="Send the payment, then mark it as paid"
          reassurance={props.check && props.check !== 'error' && props.check.funding === 'match' ? "The seller's coins are locked for you. They can only go to you or back to the seller." : undefined}
          deadline={
            trade.paymentDeadline && (
              <>
                <Countdown deadline={trade.paymentDeadline} windowSec={windowSec} />
                <span className="cf-small cf-muted">left to mark as paid. After that the arbiter returns the funds to the seller.</span>
              </>
            )
          }
        >
          <EscrowCheckNotice check={props.check} />
          <ZeroConfNotice ds={props.ds} isDemo={trade.isDemo === true} />
          <PaymentDetails trade={trade} fiat={props.fiat} />
          {failure}
          {disputeForm}
          <div className="s-actions">
            <Button
              variant="primary"
              busy={busy === 'paid'}
              disabled={props.ds.phase === 'proof' || (busy !== null && busy !== 'paid')}
              onClick={markPaid}
              note="No signature needed. This step is off-chain."
            >
              Mark as paid
            </Button>
            {disputeButton}
            {cancelButton}
          </div>
        </ActionCard>
      );
    }
    case 'Paid':
      return (
        <ActionCard
          step="Step 4 of 4 · Waiting"
          title="Waiting for the seller to release"
          reassurance={props.check && props.check !== 'error' && props.check.funding === 'match' ? "The seller's coins are locked for you. They can only go to you or back to the seller." : undefined}
        >
          <p className="cf-muted">You marked the payment as sent. When the seller confirms it, {props.amount} go to your wallet.</p>
          {failure}
          {disputeForm}
          <div className="s-actions">
            {disputeButton}
            {cancelButton}
          </div>
        </ActionCard>
      );
    case 'Disputed': {
      const opened = trade.disputedAt !== undefined ? formatHourMinute(new Date(trade.disputedAt * 1000)) : null;
      return (
        <ActionCard step="Paused · In dispute" title="The arbiter is reviewing this trade">
          <p className="cf-muted">
            {trade.disputedBy === 'seller' ? 'The seller opened a dispute' : 'You opened a dispute'}
            {opened ? ` at ${opened}` : ''}. The arbiter can now read the chat and will decide for the buyer or the seller.
          </p>
          {trade.isDemo && (
            <SimBox tag="Simulated arbiter" label="In this demo you can decide the dispute yourself." bodyGap={3}>
              <p className="cf-small">
                On a real trade only the arbiter named in the offer can decide. Here the console signs your choice with the real
                arbiter key and the result is a real mainnet transaction.
              </p>
              <div>
                <Button variant="primary" to={`/trade/${trade.id}/arbiter`}>
                  Open demo arbiter console
                </Button>
              </div>
            </SimBox>
          )}
          {failure}
          <div className="s-actions">{cancelButton}</div>
        </ActionCard>
      );
    }
    default:
      return null;
  }
}

// The deposit at zero confirmations (Bitcoin Cash 0-conf): watched for a double-spend proof for a few
// seconds, then safe to act on. Without the check the page falls back to asking for one confirmation.
function ZeroConfNotice({ ds, isDemo }: { ds: DoubleSpendState; isDemo: boolean }) {
  switch (ds.phase) {
    case 'watching':
      return (
        <div className="cf-notice">
          <div>
            <strong>Deposit seen · watching for double spends</strong>
            Bitcoin Cash nodes publish a double-spend proof (DSProof) within seconds if anyone tries to spend these coins
            twice. Ready in about {ds.secondsLeft} s.
          </div>
        </div>
      );
    case 'clear':
      return (
        <Notice tone="chain" title="Safe at 0-conf">
          The deposit reached the network and no double-spend attempt was seen in {DSPROOF_WATCH_SEC} seconds. On Bitcoin Cash
          you can rely on it now, without waiting for a block.
        </Notice>
      );
    case 'proof':
      return (
        <Notice tone="danger" title="Double-spend attempt detected">
          Do not pay. The network saw an attempt to spend the deposit twice. Wait until the escrow is confirmed in a block.
        </Notice>
      );
    case 'error':
      return isDemo ? (
        <Notice tone="warn" title="Could not check for double spends">
          With real money, wait for 1 confirmation before you pay. In this demo no money is sent, so you can continue.
        </Notice>
      ) : (
        <Notice tone="warn" title="Could not check for double spends">
          Wait for 1 confirmation before you pay.
        </Notice>
      );
    default:
      return null;
  }
}

// Says what this browser verified about the escrow, or that it could not.
function EscrowCheckNotice({ check }: { check: EscrowCheck | null | 'error' }) {
  if (check === null) return <p className="cf-small cf-muted">Checking the deposit on-chain…</p>;
  if (check === 'error') {
    return <p className="cf-small cf-muted">This browser could not check the deposit on-chain right now. It will retry.</p>;
  }
  if (!check.termsMatch || !check.addressMatch || check.payoutIsMine === false) {
    return (
      <Notice tone="danger" title="The escrow does not match the trade terms">
        Do not pay. This browser rebuilt the contract from the terms and got a different result. Open a dispute or
        contact the arbiter.
      </Notice>
    );
  }
  if (check.funding === 'missing') {
    return (
      <Notice tone="warn" title="The deposit is not visible on-chain yet">
        Do not pay until it appears. This browser looks for it at the escrow address every 15 seconds.
      </Notice>
    );
  }
  return null;
}

// The seller's payment details, decrypted in this browser with the session key stored when the offer was taken.
function PaymentDetails({ trade, fiat }: { trade: Trade; fiat: string }) {
  const [state, setState] = useState<{ kind: 'loading' } | { kind: 'missing' } | { kind: 'ok'; details: Record<string, unknown> }>({
    kind: 'loading',
  });
  useEffect(() => {
    let current = true;
    const key = readSessionKey(trade.id);
    if (!key || !trade.encryptedPaymentDetails || !trade.sellerSessionPk) {
      setState({ kind: 'missing' });
      return;
    }
    decryptPaymentDetails(key, trade.sellerSessionPk, trade.encryptedPaymentDetails)
      .then((text) => JSON.parse(text) as Record<string, unknown>)
      .then(
        (details) => current && setState({ kind: 'ok', details }),
        () => current && setState({ kind: 'missing' }),
      );
    return () => {
      current = false;
    };
  }, [trade.id, trade.encryptedPaymentDetails, trade.sellerSessionPk]);

  if (state.kind === 'loading') return <Skeleton height={96} />;
  if (state.kind === 'missing') return <Notice tone="warn">{NO_KEY}</Notice>;

  const { simulated, notice: _notice, method, reference, ...rest } = state.details;
  const rows = (
    <dl className="cf-dl">
      {method !== undefined && (
        <>
          <dt>Method</dt>
          <dd>{String(method)}</dd>
        </>
      )}
      {reference !== undefined && (
        <>
          <dt>Reference</dt>
          <dd>
            <span className="cf-mono">{String(reference)}</span>
          </dd>
        </>
      )}
      {Object.entries(rest).map(([label, value]) => (
        <span key={label} style={{ display: 'contents' }}>
          <dt>{label}</dt>
          <dd>{String(value)}</dd>
        </span>
      ))}
      <dt>Amount</dt>
      <dd>
        <span className="cf-mono">{fiat}</span>
      </dd>
    </dl>
  );
  // Only details the seller marked as simulated go in the violet box; the demo seller marks its own.
  return simulated === true ? (
    <SimBox label="Demo payment details. Do not send any money.">{rows}</SimBox>
  ) : (
    <div className="cf-well">{rows}</div>
  );
}

function readSessionKey(tradeId: string): string | null {
  try {
    return localStorage.getItem(`campfire.session.${tradeId}`);
  } catch {
    return null;
  }
}

// --- Endings ---

function BuyerResult({ trade, amount, payout }: { trade: Trade; amount: string; payout: string }) {
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
        <Notice tone="chain" title="Trade completed">
          {trade.status === 'Released' ? `The seller released ${amount} to your wallet.` : `The arbiter released ${amount} to your wallet.`} You can
          use them right away: on Bitcoin Cash there is no need to wait for a block.
        </Notice>
      );
      rows = (
        <>
          {settlement && (
            <>
              <dt>{trade.status === 'Released' ? 'Release' : 'Arbitrate'}</dt>
              <dd>{settlement}</dd>
            </>
          )}
          <dt>Received at</dt>
          <dd>
            <HashLink value={payout} kind="address" />
          </dd>
          <dt>Completed</dt>
          <dd>{formatDateTime(ended)}</dd>
        </>
      );
      break;
    case 'ResolvedSeller': {
      const minutes = trade.paymentDeadline && trade.fundedAt ? Math.round((trade.paymentDeadline - trade.fundedAt) / 60) : null;
      notice = trade.disputedAt ? (
        <Notice tone="warn" title="The arbiter decided for the seller">
          The funds went back to the seller.
        </Notice>
      ) : (
        <Notice tone="warn" title="The payment window ended">
          The trade was not marked as paid{minutes ? ` within ${minutes} minutes` : ' in time'}, so the arbiter returned the funds to the
          seller. You were not charged.
        </Notice>
      );
      rows = (
        <>
          {settlement && (
            <>
              <dt>Arbitrate</dt>
              <dd>{settlement}</dd>
            </>
          )}
          <dt>Verdict</dt>
          <dd>{trade.disputedAt ? 'For the seller' : 'For the seller, issued automatically'}</dd>
          <dt>Ended</dt>
          <dd>{formatDateTime(ended)}</dd>
        </>
      );
      break;
    }
    case 'Dropped':
      notice = (
        <Notice title="The trade was dropped">The seller did not accept and fund the escrow in time. Nothing was charged.</Notice>
      );
      rows = (
        <>
          <dt>Ended</dt>
          <dd>{formatDateTime(ended)}</dd>
        </>
      );
      break;
    default: {
      const cancelled = trade.status === 'Cancelled';
      notice = cancelled ? (
        // Invented copy: the design has no screen for a cancelled trade.
        <Notice title="Trade cancelled">You cancelled the trade. The escrow returned the funds to the seller. You were not charged.</Notice>
      ) : (
        <Notice title="The funds went back to the seller">The escrow returned the funds to the seller.</Notice>
      );
      rows = (
        <>
          {settlement && (
            <>
              <dt>{cancelled ? 'Cancel' : 'Refund'}</dt>
              <dd>{settlement}</dd>
            </>
          )}
          <dt>Ended</dt>
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
            Back to offers
          </Button>
          {(trade.status === 'Released' || trade.status === 'ResolvedBuyer') && <Button to="/transparency">See all contract paths</Button>}
        </div>
      </div>
    </section>
  );
}

function VisitorCard({ trade, sellerViewing }: { trade: Trade; sellerViewing: boolean }) {
  const ended = trade.completedAt ?? trade.verdictIssuedAt;
  return (
    <section className="cf-card" data-flush>
      <div className="cf-card__section">
        <div className="cf-stack">
          {sellerViewing ? (
            <Notice title="You are the seller in this trade.">
              The seller's view of this page is not built yet. Everything on-chain is public and linked below.
            </Notice>
          ) : (
            <Notice title="You are viewing this trade as a visitor.">
              Payment details and chat are visible only to the buyer and the seller. Everything on-chain is public and linked below.
            </Notice>
          )}
          {isFinal(trade) && (
            <dl className="cf-dl">
              {trade.settlementTxid && (
                <>
                  <dt>{trade.status === 'Released' ? 'Release' : 'Settlement'}</dt>
                  <dd>
                    <HashLink value={trade.settlementTxid} kind="transaction" /> · <ProvenanceTag kind="chain" />
                  </dd>
                </>
              )}
              {ended && (
                <>
                  <dt>{trade.status === 'Released' ? 'Completed' : 'Ended'}</dt>
                  <dd>{formatDateTime(ended)}</dd>
                </>
              )}
            </dl>
          )}
        </div>
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
  payout: string;
  check: EscrowCheck | null | 'error';
  ds: DoubleSpendState;
  view: Role;
}) {
  const { trade, asset } = props;
  const reputation = usePoll(() => apiGet<Reputation>(`/api/identities/${trade.sellerIdentity}/reputation`), trade.sellerIdentity);
  const expected = expectedEscrowFunding({ asset: trade.asset, amount: trade.amount });
  const holds = expected.token
    ? `${formatAmount(expected.satoshis, { symbol: 'BCH', decimals: 8, isBch: true })} + ${props.amount}`
    : `${formatAmount(expected.satoshis, asset)}`;
  const quoteOk = trade.quote && trade.oraclePk ? verifyPriceQuote(trade.quote, trade.oraclePk) : false;
  const check = props.check && props.check !== 'error' ? props.check : null;
  const rep = reputation.data;

  return (
    <Details>
      <p className="cf-small cf-muted">For checking the trade yourself: the contract address, the transactions, the price quote and the other person.</p>

      {trade.escrowAddress && (
        <section className="cf-card" data-flush>
          <div className="cf-card__section">
            <div className="cf-row" data-between style={{ marginBottom: 'var(--space-3)' }}>
              <h2 className="cf-heading">Escrow contract</h2>
              <ProvenanceTag kind="chain" />
            </div>
            <dl className="cf-dl">
              <dt>Address</dt>
              <dd>
                <HashLink value={trade.escrowAddress} kind="address" /> <CopyButton value={trade.escrowAddress} />
              </dd>
              <dt>{isFinal(trade) ? 'Held' : 'Holds'}</dt>
              <dd>
                <span className="cf-mono">
                  {holds}
                  {!expected.token && <span className="cf-subtle"> ({props.amount.replace(' sats', '')} + 1,000 fee budget)</span>}
                </span>
              </dd>
              {trade.fundingTxid && (
                <>
                  <dt>Deposit</dt>
                  <dd>
                    <HashLink value={trade.fundingTxid} kind="transaction" />
                    {trade.fundingConfirmations !== undefined && ` · ${confirmationsText(trade.fundingConfirmations)}`}
                  </dd>
                </>
              )}
              {trade.tradeId && (
                <>
                  <dt>Trade ID</dt>
                  <dd>
                    <HashLink value={trade.tradeId} kind="plain" /> <CopyButton value={trade.tradeId} />
                  </dd>
                </>
              )}
              {trade.refundTime && (
                <>
                  <dt>Refund path</dt>
                  <dd>
                    <span className="cf-small">Seller can recover the funds after {formatDateTime(trade.refundTime)}</span>
                  </dd>
                </>
              )}
            </dl>
            <p className="cf-small cf-subtle" style={{ marginTop: 'var(--space-3)' }}>
              The address is derived from the trade terms. Anyone with the terms can recompute it.
            </p>
            {check && (
              <div className="cf-stack" data-gap="2" style={{ marginTop: 'var(--space-3)' }}>
                <span className="cf-label">Checked by this browser</span>
                {check.termsMatch && <span className="s-check">The trade ID is the hash of the published terms.</span>}
                {check.addressMatch && <span className="s-check">The address is the contract built from those terms.</span>}
                {check.payoutIsMine && <span className="s-check">The contract pays the buyer at an address of your wallet.</span>}
                {check.funding === 'match' && <span className="s-check">The deposit holds exactly {holds}.</span>}
                {props.ds.phase === 'clear' && (
                  <span className="s-check">No double-spend proof for the deposit (checked at {formatClock(props.ds.checkedAt)}).</span>
                )}
              </div>
            )}
          </div>
        </section>
      )}

      <section className="cf-card" data-flush>
        <div className="cf-card__section">
          <h2 className="cf-heading" style={{ marginBottom: 'var(--space-3)' }}>
            Trade terms
          </h2>
          <dl className="cf-dl">
            <dt>Amount</dt>
            <dd>
              <span className="cf-mono">{props.amount}</span>
            </dd>
            {trade.quote && (
              <>
                <dt>Price</dt>
                <dd>
                  <span className="cf-mono">
                    {formatFiat(applyMargin(trade.quote.price, trade.marginBps ?? 0), trade.fiat)}/{asset.symbol}
                  </span>
                  <br />
                  <span className="cf-small cf-muted">
                    Floating, {describeMargin(trade.marginBps ?? 0).replace('Market price', 'market price')}.
                    {quoteOk && trade.oraclePk && (
                      <>
                        {' '}
                        Quote signed by oracle <HashLink value={trade.oraclePk} kind="plain" />
                      </>
                    )}
                  </span>
                </dd>
              </>
            )}
            <dt>Fiat amount</dt>
            <dd>
              <span className="cf-mono">{props.fiat}</span>
            </dd>
            <dt>Paid to</dt>
            <dd>
              <HashLink value={props.payout} kind="address" />
              {props.view === 'buyer' && check?.payoutIsMine && (
                <>
                  <br />
                  <span className="cf-small cf-muted">An address of your wallet</span>
                </>
              )}
            </dd>
            <dt>Arbiter</dt>
            <dd>
              <HashLink value={trade.arbiterPk} kind="plain" />
            </dd>
            <dt>Offer</dt>
            <dd>
              <HashLink value={trade.offerTxid} kind="transaction" />
            </dd>
          </dl>
        </div>
      </section>

      <section className="cf-card" data-flush>
        <div className="cf-card__section">
          <div className="cf-row" data-between style={{ marginBottom: 'var(--space-2)' }}>
            <h2 className="cf-heading">Seller</h2>
            {trade.isDemo && <ProvenanceTag kind="sim">Simulated fiat</ProvenanceTag>}
          </div>
          <div className="cf-stack" data-gap="1">
            <span>
              {trade.isDemo && <strong>Demo seller </strong>}
              <HashLink value={trade.sellerIdentity} kind="plain" />
            </span>
            {rep && (
              <span className="cf-small">
                <strong>{rep.completedAsSeller}</strong> completed as seller
                {rep.firstCompletedAt !== null && ` · since ${formatDate(rep.firstCompletedAt)}`}
              </span>
            )}
            <span className="cf-small cf-subtle">Counted by Campfire. It cannot be verified on-chain and can be inflated with a second wallet.</span>
          </div>
        </div>
      </section>
    </Details>
  );
}

// --- Loading and errors (Trade-Loading, Trade-Error) ---

function TradeLoading() {
  return (
    <main className="s-main">
      <div className="s-trade">
        <div className="s-pagehead" aria-busy="true">
          <span className="cf-small cf-muted">Loading trade…</span>
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
  return (
    <main className="s-main">
      <div className="s-pagehead">
        <Link className="s-back" to="/offers">
          ← Offers
        </Link>
        <h1 className="cf-title">Trade</h1>
      </div>
      <section className="cf-card" data-flush>
        <div className="cf-card__section">
          {notFound ? (
            <EmptyState title="Trade not found" action={<Button to="/offers">Back to offers</Button>}>
              No trade has the ID <span className="cf-mono">{id.length > 12 ? `${id.slice(0, 6)}…${id.slice(-4)}` : id}</span>. Check the link,
              or find your trades in the wallet menu.
            </EmptyState>
          ) : (
            <div className="cf-stack">
              <Notice tone="danger" title="We could not load this trade">
                {error instanceof ApiError && error.status >= 400 && error.status < 500
                  ? error.message
                  : 'The server did not answer. Your funds are not affected: the escrow lives on-chain, not on this server.'}
              </Notice>
              <div className="s-actions">
                <Button variant="primary" onClick={onRetry}>
                  Try again
                </Button>
                <Button to="/offers">Back to offers</Button>
              </div>
            </div>
          )}
        </div>
      </section>
    </main>
  );
}
