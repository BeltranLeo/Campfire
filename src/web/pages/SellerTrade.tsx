import { useState, type ReactNode } from 'react';
import { expectedEscrowFunding } from '../../protocol/escrow.js';
import { pkhToCashAddress } from '../../protocol/keys.js';
import { apiGet, apiPost, type Offer, type Reputation, type Trade } from '../api';
import { ActionCard } from '../components/ActionCard';
import { Button } from '../components/Button';
import { DisputeForm } from '../components/DisputeForm';
import { HashLink, ProvenanceTag } from '../components/Provenance';
import { Notice, Skeleton } from '../components/States';
import { Countdown } from '../components/Timeline';
import { describeScan, loadWalletCoins, spendableBch } from '../coins';
import { keptElectrum } from '../electrum';
import { applyMargin, describeMargin, formatAmount, formatDate, formatDateTime, formatFiat } from '../format';
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
  depositNeeds,
  findDeposit,
  loadSavedDeposit,
  saveDeposit,
} from '../seller';
import { browserStore, commitSession, generateSessionKeyPair, loadPendingSession, payoutAddress, readSessionKey, savePendingSession } from '../take';
import { TradeActionError, disputeKeyHex, signedPayoutPkh } from '../trade';
import { refreshWalletCoins, useWalletCoins } from '../walletCoins';
import { WalletDeclined, useWallet } from '../wallet';

// The seller's side of one trade (Sell-Accept-*, Trade-Seller-* screens): accept a request and deposit into the
// escrow, wait for the buyer, release after checking the payment, or open a dispute. The wallet signs the deposit
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

type Action = 'accept' | 'decline' | 'deposit' | 'release' | 'dispute';

export function SellerAction(props: { trade: Trade; amount: string; fiat: string; onUpdate: (t: Trade) => void }) {
  const { trade } = props;
  const wallet = useWallet();
  const { identity, xpubs } = wallet;
  const { busy, error, run } = useTradeAction<Action>(trade, identity, props.onUpdate);
  const [details, setDetails] = useState('');
  const [disputing, setDisputing] = useState(false);
  const now = useNow(1000);

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
    assertCanDeposit(trade, await loadWalletCoins(await keptElectrum(), xpubs));
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
    if (!xpubs) throw new WalletDeclined();
    const provider = await keptElectrum();
    const store = browserStore();
    const { offer } = await apiGet<{ offer: Offer }>(`/api/offers/${t.offerTxid}`);
    const checked = checkAcceptedTrade(t, {
      provider,
      defiXpub: xpubs.defi,
      receiveXpub: xpubs.receive,
      sessionPrivateKey: readSessionKey(t.id),
      offer: offer.document,
      now: Math.floor(Date.now() / 1000),
    });
    const record = (hex?: string) => apiPost<{ trade: Trade }>(`/api/trades/${t.id}/funding`, hex ? { fundingTxHex: hex } : {}).then((r) => r.trade);

    if (await findDeposit(checked.contract, checked.terms)) return record();

    // The same signed transaction is sent again, never a new one: a second deposit to the same escrow would stay
    // locked until the refund time. If it cannot be recorded the trade simply ends when the funding window does,
    // with nothing locked twice.
    const saved = store && loadSavedDeposit(store, t.id);
    if (saved) {
      const recorded = await record(saved);
      if (store) clearSavedDeposit(store, t.id);
      return recorded;
    }

    const owned = await loadWalletCoins(provider, xpubs);
    const changeIndex = prep.data?.change ?? null;
    const changeAddress =
      xpubs.change && changeIndex !== null
        ? payoutAddress(xpubs.change, changeIndex, false)
        : payoutAddress(xpubs.receive, t.sellerReceiveIndex ?? 0, false);
    const tx = buildDeposit({ trade: t, checked, coins: owned, changeAddress });
    const signedTxHex = await wallet.sign(tx.request, tx.inputPaths);
    if (store) saveDeposit(store, t.id, signedTxHex);
    const recorded = await record(signedTxHex);
    if (store) clearSavedDeposit(store, t.id);
    void refreshWalletCoins();
    return recorded;
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
    await run('deposit', 'The deposit was not made', () => makeDeposit(accepted), accepted);
  }

  const depositOnly = () => run('deposit', 'The deposit was not made', () => makeDeposit(trade));

  const decline = () =>
    run('decline', 'The request was not declined', () =>
      apiPost<{ trade: Trade }>(`/api/trades/${trade.id}/decline`, { sellerIdentity: identity }).then((r) => r.trade),
    );

  // The wallet signs the escrow's `release` path; the service checks it and broadcasts.
  const release = () =>
    run('release', 'The coins were not released', async () => {
      if (!xpubs) throw new WalletDeclined();
      const built = await buildSellerRelease(trade, await keptElectrum(), xpubs.defi);
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
    <Button disabled={busy !== null} onClick={() => setDisputing(true)}>
      Open dispute
    </Button>
  );
  const disputeForm = disputing && (
    <DisputeForm reasons={DISPUTE_REASONS} busy={busy === 'dispute'} locked={busy !== null} onSend={openDispute} onBack={() => setDisputing(false)} />
  );
  const walletNotices = (
    <>
      {short && coins.data && (
        <Notice tone="warn" title="Your wallet does not have enough BCH">
          The deposit needs about {depositNeeds(trade).toLocaleString('en-US')} sats and Campfire can see{' '}
          {spendableBch(coins.data.coins).toLocaleString('en-US')} in this wallet. {describeScan(coins.data)} Send some BCH to it: this page checks
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
        <Notice tone="warn" title="Depositing PUSD is not available yet">
          This trade is for a token. Only BCH trades can be funded from this page for now.
        </Notice>
      )}
    </>
  );

  switch (trade.status) {
    case 'Requested':
      return (
        <>
          <ActionCard
            step="Step 2 of 4 · Your turn"
            title="Accept and deposit into escrow"
            deadline={
              trade.quoteExpiresAt && (
                <>
                  <Countdown deadline={trade.quoteExpiresAt} windowSec={600} />
                  <span className="cf-small cf-muted">left on the signed quote. After that the request is dropped.</span>
                </>
              )
            }
          >
            <div className="cf-field">
              <label htmlFor="details">Payment details for this buyer</label>
              <textarea
                id="details"
                className="cf-textarea"
                rows={4}
                maxLength={500}
                placeholder="Bank, account number or alias, reference"
                value={details}
                onChange={(e) => setDetails(e.target.value)}
              />
              <span className="cf-hint">
                Encrypted in your browser for this buyer only. Shown to them once your deposit is seen on the network. Campfire cannot read it.
              </span>
            </div>
            {deposit && (
              <Notice title={`You will deposit ${deposit}.`}>
                {formatAmount(trade.amount, BCH)} for the buyer plus a 1,000-sat fee budget for the closing transaction. The contract can only pay the
                buyer or return to you.
              </Notice>
            )}
            {expired && (
              <Notice tone="warn" title="This request expired">
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
                disabled={!isBch || expired || details.trim() === '' || !prep.data || short || (busy !== null && busy !== 'accept' && busy !== 'deposit')}
                onClick={acceptAndDeposit}
              >
                {deposit ? `Accept and deposit ${deposit}` : 'Accept and deposit'}
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
          step="Step 2 of 4 · Your turn"
          title={deposit ? `Deposit ${deposit} into the escrow` : 'Deposit into the escrow'}
          reassurance="The contract can only pay the buyer or return the coins to you. Campfire cannot move them."
          deadline={
            trade.fundingDeadline && (
              <>
                <Countdown deadline={trade.fundingDeadline} windowSec={1800} />
                <span className="cf-small cf-muted">left to fund. If you do not deposit in time the trade is dropped and nothing is charged.</span>
              </>
            )
          }
        >
          <p className="cf-muted">
            {formatAmount(trade.amount, BCH)} for the buyer plus a 1,000-sat fee budget for the closing transaction. Your payment details are shown to the
            buyer once this deposit is seen on the network.
          </p>
          {walletNotices}
          {failure}
          <div className="s-actions">
            <Button variant="primary" signs busy={busy === 'deposit'} disabled={!isBch || short || (busy !== null && busy !== 'deposit')} onClick={depositOnly}>
              {deposit ? `Deposit ${deposit}` : 'Deposit'}
            </Button>
          </div>
        </ActionCard>
      );
    case 'Funded': {
      const windowSec = trade.paymentDeadline && trade.fundedAt ? trade.paymentDeadline - trade.fundedAt : 0;
      return (
        <ActionCard
          step="Step 3 of 4 · Waiting"
          title="Waiting for the buyer's payment"
          reassurance="Your coins are locked in the escrow. They can only go to the buyer or back to you."
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
            When the buyer marks the payment as sent, check your account and release. Do not release before the money is there.
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
          step="Step 4 of 4 · Your turn"
          title="The buyer says the payment was sent. Check, then release."
          reassurance="Your coins stay locked until you release them. Take the time to check your account."
        >
          <Notice tone="warn" title="Release only after the money is in your account">
            Check your bank for {props.fiat}. A release cannot be undone.
          </Notice>
          {failure}
          {disputeForm}
          <div className="s-actions">
            <Button
              variant="primary"
              signs
              busy={busy === 'release'}
              disabled={busy !== null && busy !== 'release'}
              onClick={release}
            >
              {`Release ${props.amount} to buyer`}
            </Button>
            {disputeButton}
          </div>
        </ActionCard>
      );
    case 'Disputed': {
      const opened = trade.disputedAt !== undefined ? formatDateTime(trade.disputedAt) : null;
      return (
        <ActionCard step="Paused · In dispute" title="The arbiter is reviewing this trade">
          <p className="cf-muted">
            {trade.disputedBy === 'seller' ? 'You opened a dispute' : 'The buyer opened a dispute'}
            {opened ? ` on ${opened}` : ''}. The arbiter can now read the chat and will decide for the buyer or the seller. If you receive the payment
            meanwhile, you can still release.
          </p>
          {failure}
          <div className="s-actions">
            <Button signs busy={busy === 'release'} disabled={busy !== null && busy !== 'release'} onClick={release}>
              {`Release ${props.amount} to buyer`}
            </Button>
          </div>
        </ActionCard>
      );
    }
    default:
      return null;
  }
}

/** What was asked, for the seller deciding on a request (Sell-Accept-*). */
function RequestCard({ trade, fiat }: { trade: Trade; fiat: string }) {
  const reputation = usePoll(() => apiGet<Reputation>(`/api/identities/${trade.buyerIdentity}/reputation`), trade.buyerIdentity);
  const rep = reputation.data;
  return (
    <section className="cf-card" data-flush>
      <div className="cf-card__section">
        <h2 className="cf-heading" style={{ marginBottom: 'var(--space-3)' }}>
          Request
        </h2>
        <dl className="cf-dl">
          <dt>Buyer</dt>
          <dd>
            <HashLink value={trade.buyerIdentity} kind="plain" />
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
          </dd>
          <dt>Amount</dt>
          <dd>
            <span className="cf-mono">{formatAmount(trade.amount, BCH)}</span>
          </dd>
          <dt>Price</dt>
          <dd>
            {trade.quote ? (
              <>
                <span className="cf-mono">
                  {formatFiat(applyMargin(trade.quote.price, trade.marginBps ?? 0), trade.fiat)}/BCH
                </span>
                <br />
                <span className="cf-small cf-muted">
                  Oracle price {formatFiat(Number(trade.quote.price), trade.fiat)} · {describeMargin(trade.marginBps ?? 0)}. The signature is checked
                  before you deposit.
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
          <dt>Pays to</dt>
          <dd>
            <HashLink value={pkhToCashAddress(trade.buyerPayoutPkh)} kind="address" />
          </dd>
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
        <Notice tone="chain" title="Trade completed">
          You released {amount} to the buyer. The fiat payment happened off-chain: it is between you and the buyer.
        </Notice>
      );
      rows = row('Release');
      break;
    case 'ResolvedBuyer':
      notice = (
        <Notice tone="warn" title="The arbiter decided for the buyer">
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
      notice = <Notice title="The buyer cancelled the trade">The escrow returned the {amount} to you.</Notice>;
      rows = (
        <>
          {row('Cancel')}
          {returned}
        </>
      );
      break;
    case 'Refunded':
      notice = <Notice title="The coins came back to you">The escrow returned the {amount} after the refund time.</Notice>;
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
