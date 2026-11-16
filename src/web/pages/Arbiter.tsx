import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { Link, useParams } from 'react-router';
import { expectedEscrowFunding } from '../../protocol/escrow.js';
import { pkhToCashAddress } from '../../protocol/keys.js';
import { VERDICT_BUYER, VERDICT_SELLER, type VerdictHex } from '../../protocol/trades.js';
import { ApiError, apiGet, apiPost, type ArbiterChat, type Offer, type Trade } from '../api';
import { assetInfo } from '../assets';
import { Button } from '../components/Button';
import { HashLink, ProvenanceTag, SimBox } from '../components/Provenance';
import { EmptyState, Notice, Skeleton } from '../components/States';
import { StatusPill } from '../components/StatusPill';
import { useConfig } from '../config';
import { electrum } from '../electrum';
import { formatAmount, formatClock, formatDateTime, formatFiatAmount, formatHourMinute } from '../format';
import { usePoll } from '../hooks/usePoll';
import { checkEscrow, checkForArbiter, isFinal, newerTrade, signedTerms, type EscrowCheck } from '../trade';

// The demo arbiter console (Arbiter-* screens). Any visitor may decide a disputed trade against the demo seller;
// the service signs the verdict with the real arbiter key and settles the real escrow. Who decides is simulated.
//
// The page reads the trade the ordinary way, not with ?arbiter=true: that view only adds the chat key, which the
// console never shows, and the service refuses it once a verdict is out, when this page still has to load.
// Only the decrypted chat needs the arbiter view, and only while the trade is disputed.

const POLL_MS = 3000;

export function Arbiter() {
  const { id = '' } = useParams();
  // A new id is a new page: nothing from the previous trade may carry over.
  return <ArbiterLoader key={id} id={id} />;
}

function ArbiterLoader({ id }: { id: string }) {
  const [trade, setTrade] = useState<Trade>();
  const accept = useCallback((incoming: Trade) => setTrade((current) => newerTrade(current, incoming)), []);
  const final = trade !== undefined && isFinal(trade);
  const load = usePoll(
    () =>
      apiGet<{ trade: Trade }>(`/api/trades/${id}`).then((r) => {
        accept(r.trade);
        return r.trade;
      }),
    id,
    final ? undefined : POLL_MS,
  );

  if (!trade) {
    if (load.error) return <ConsoleError error={load.error} id={id} onRetry={load.reload} />;
    return <ConsoleLoading />;
  }
  return <Console trade={trade} onUpdate={accept} />;
}

function Console({ trade, onUpdate }: { trade: Trade; onUpdate: (t: Trade) => void }) {
  const config = useConfig();
  const asset = assetInfo(trade.asset, trade.assetDecimals, config);
  // What the arbiter reads is what the parties signed, not the service's copy.
  const terms = signedTerms(trade);
  const amount = formatAmount(terms.amount, asset);
  const fiat = formatFiatAmount(terms.fiatAmount, trade.fiat);
  const [chat, setChat] = useState<ArbiterChat>();

  const decided = (trade.status === 'ResolvedBuyer' || trade.status === 'ResolvedSeller') && trade.verdict !== undefined;
  const disputed = trade.status === 'Disputed';

  if (!trade.isDemo) {
    return (
      <ConsoleFrame trade={trade}>
        <Denied tradeId={trade.id} title="This console only decides trades against the demo seller">
          Trades between two wallets are decided by the arbiter named in their offer.
        </Denied>
      </ConsoleFrame>
    );
  }
  if (!decided && !disputed) {
    const ended = isFinal(trade);
    return (
      <ConsoleFrame trade={trade}>
        {/* The first line of the ended variant is invented; the design only has the "not in dispute" notice. */}
        <Denied tradeId={trade.id} title={ended ? 'This trade has already ended' : 'This trade is not in dispute'}>
          The demo arbiter can only decide a disputed trade. Its state is "{trade.status}".
          {!ended && ' Open a dispute from the trade page first.'}
        </Denied>
      </ConsoleFrame>
    );
  }

  return (
    <ConsoleFrame trade={trade} playing>
      {disputed && <ChatFeed id={trade.id} onData={setChat} />}
      <div className="s-cols">
        <div className="s-col">
          {decided ? <DecidedCard trade={trade} amount={amount} /> : <DecisionCard trade={trade} amount={amount} onUpdate={onUpdate} />}
          <DisputeCard trade={trade} />
          <ChatCard trade={trade} chat={chat} />
        </div>
        <div className="s-col">
          <VerificationCard trade={trade} amount={amount} symbol={asset.symbol} />
          <TermsCard trade={trade} amount={amount} fiat={fiat} tokenAware={!asset.isBch} />
        </div>
      </div>
    </ConsoleFrame>
  );
}

// Title, state and the violet box that says the arbiter is simulated.
function ConsoleFrame({ trade, playing, children }: { trade: Trade; playing?: boolean; children: ReactNode }) {
  return (
    <main className="s-main">
      <div className="s-pagehead">
        <Link className="s-back" to={`/trade/${trade.id}`}>
          ← Trade
        </Link>
        <h1 className="cf-title">Demo arbiter console</h1>
        {playing && (
          <div className="cf-row">
            <StatusPill state={trade.status} role="visitor" />
            <ProvenanceTag kind="sim">Simulated arbiter</ProvenanceTag>
            {trade.fundingTxid && <ProvenanceTag kind="chain">Real escrow on mainnet</ProvenanceTag>}
          </div>
        )}
      </div>
      {playing && (
        <SimBox tag="Simulated arbiter" label="You are playing the arbiter for this demo trade.">
          <p className="cf-small">
            On a real trade only the arbiter named in the offer sees this page. Here any visitor may decide a disputed trade against
            the demo seller. Who decides is simulated. The verdict is signed with the real arbiter key and settles the real escrow on
            mainnet.
          </p>
        </SimBox>
      )}
      {children}
    </main>
  );
}

function Denied({ tradeId, title, children }: { tradeId: string; title: string; children: ReactNode }) {
  return (
    <section className="cf-card" data-flush>
      <div className="cf-card__section">
        <div className="cf-stack">
          <Notice tone={title.startsWith('This console') ? 'danger' : undefined} title={title}>
            {children}
          </Notice>
          <div className="s-actions">
            <Button variant="primary" to={`/trade/${tradeId}`}>
              Back to the trade
            </Button>
          </div>
        </div>
      </div>
    </section>
  );
}

// --- The decision ---

function DecisionCard({ trade, amount, onUpdate }: { trade: Trade; amount: string; onUpdate: (t: Trade) => void }) {
  const [busy, setBusy] = useState<VerdictHex | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function decide(verdict: VerdictHex) {
    setBusy(verdict);
    setError(null);
    try {
      const { trade: decided } = await apiPost<{ trade: Trade }>(`/api/demo/trades/${trade.id}/verdict`, { verdict });
      onUpdate(decided);
    } catch (err) {
      // The verdict is broadcast inside the request, so its answer can be lost after the escrow was settled.
      try {
        const { trade: latest } = await apiGet<{ trade: Trade }>(`/api/trades/${trade.id}`);
        onUpdate(latest);
        if (latest.status !== 'Disputed') return;
      } catch {
        // Fall through to the original error.
      }
      setError(err instanceof ApiError ? err.message : 'Something went wrong. Try again.');
    } finally {
      setBusy(null);
    }
  }

  return (
    <section className="cf-card s-action" data-pad>
      <div className="cf-stack">
        <span className="cf-label">Your decision</span>
        <h2 className="cf-heading">Who should receive the {amount}?</h2>
        <div className="s-verdict">
          <Button busy={busy === VERDICT_BUYER} disabled={busy !== null} onClick={() => decide(VERDICT_BUYER)}>
            Decide for the buyer
            <small>Pays {amount} to the buyer</small>
          </Button>
          <Button busy={busy === VERDICT_SELLER} disabled={busy !== null} onClick={() => decide(VERDICT_SELLER)}>
            Decide for the seller
            <small>Returns {amount} to the seller</small>
          </Button>
        </div>
        {busy && (
          // Invented copy: the design shows no waiting state.
          <p className="cf-small cf-muted">Signing the verdict and settling the escrow on-chain. This can take a few seconds.</p>
        )}
        {error && (
          <Notice tone="danger" title="The verdict was not issued">
            {error}
          </Notice>
        )}
        <p className="cf-small cf-muted">
          The verdict cannot be changed. The arbiter can only choose one of the two parties: no path of the contract pays anyone else.
        </p>
      </div>
    </section>
  );
}

function DecidedCard({ trade, amount }: { trade: Trade; amount: string }) {
  const forBuyer = trade.status === 'ResolvedBuyer';
  return (
    <section className="cf-card" data-flush>
      <div className="cf-card__section">
        <div className="cf-stack">
          {/* The seller's wording is invented; the design only shows a verdict for the buyer. */}
          <Notice tone={forBuyer ? 'chain' : undefined} title={forBuyer ? 'Decided for the buyer' : 'Decided for the seller'}>
            {forBuyer ? `${amount} were paid to the buyer by the contract.` : `${amount} were returned to the seller by the contract.`}
          </Notice>
          <dl className="cf-dl">
            {trade.settlementTxid && (
              <>
                <dt>Arbitrate</dt>
                <dd>
                  <HashLink value={trade.settlementTxid} kind="transaction" /> · <ProvenanceTag kind="chain" />
                </dd>
              </>
            )}
            <dt>Verdict</dt>
            <dd>
              <span className="cf-mono">{trade.verdict}</span> ({forBuyer ? 'buyer' : 'seller'}), signed by arbiter{' '}
              <HashLink value={trade.arbiterPk} kind="plain" />
            </dd>
            <dt>Decided by</dt>
            <dd>
              <ProvenanceTag kind="sim">Simulated arbiter</ProvenanceTag> A demo visitor
            </dd>
          </dl>
          <div className="s-actions">
            <Button variant="primary" to={`/trade/${trade.id}`}>
              Back to the trade
            </Button>
          </div>
        </div>
      </div>
    </section>
  );
}

// --- What the arbiter reads ---

function DisputeCard({ trade }: { trade: Trade }) {
  return (
    <section className="cf-card" data-flush>
      <div className="cf-card__section">
        <h2 className="cf-heading" style={{ marginBottom: 'var(--space-3)' }}>
          Dispute
        </h2>
        <dl className="cf-dl">
          {trade.disputedBy && (
            <>
              <dt>Opened by</dt>
              <dd>
                {trade.disputedBy === 'seller' ? 'Seller' : 'Buyer'}
                {trade.disputedAt !== undefined && `, ${formatHourMinute(new Date(trade.disputedAt * 1000))}`}
              </dd>
            </>
          )}
          {trade.disputeReason && (
            <>
              <dt>Reason</dt>
              <dd>{trade.disputeReason}</dd>
            </>
          )}
          <dt>Payment</dt>
          <dd>
            <ProvenanceTag kind="sim">Simulated fiat</ProvenanceTag> No money was sent in this demo.
          </dd>
        </dl>
      </div>
    </section>
  );
}

// Polls the decrypted chat while the trade is disputed; the service refuses it after the verdict, so the
// last messages are kept by the console. Renders nothing.
function ChatFeed({ id, onData }: { id: string; onData: (chat: ArbiterChat) => void }) {
  usePoll(() => apiGet<ArbiterChat>(`/api/trades/${id}/chat?arbiter=true`).then((c) => (onData(c), c)), id, POLL_MS);
  return null;
}

function ChatCard({ trade, chat }: { trade: Trade; chat: ArbiterChat | undefined }) {
  // Without a chat we could read (already decided, or not loaded yet) there is nothing honest to show.
  if (!chat && trade.status !== 'Disputed') return null;
  const messages = chat?.decrypted;
  let body: ReactNode;
  if (!chat) body = <Skeleton height={48} />;
  else if (!messages) {
    // Invented copy: the design only shows a chat the key was handed over for.
    body = <p className="cf-small cf-muted">Nobody handed over the chat key, so the messages stay encrypted.</p>;
  } else if (messages.length === 0) {
    body = <p className="cf-small cf-muted">There are no messages in this trade.</p>;
  } else {
    body = (
      <div className="cf-chat">
        {messages.map((m) => (
          <div key={m.id} className="cf-msg">
            <strong>{m.senderIdentity === trade.sellerIdentity ? 'Seller' : 'Buyer'}</strong> {m.plaintext}
            <small>{formatHourMinute(new Date(m.createdAt * 1000))}</small>
          </div>
        ))}
      </div>
    );
  }
  return (
    <section className="cf-card" data-flush>
      <div className="cf-card__section">
        <div className="cf-row" data-between style={{ marginBottom: 'var(--space-3)' }}>
          <h2 className="cf-heading">Chat, decrypted for the arbiter</h2>
          {messages && trade.disputedBy && <span className="cf-small cf-muted">Key handed over by the {trade.disputedBy}</span>}
        </div>
        {body}
      </div>
    </section>
  );
}

// The checks the arbiter can make without trusting the service (protocol section 7.2), done in this browser.
function VerificationCard({ trade, amount, symbol }: { trade: Trade; amount: string; symbol: string }) {
  const offer = usePoll(() => apiGet<{ offer: Offer }>(`/api/offers/${trade.offerTxid}`).then((r) => r.offer.document), trade.offerTxid);
  const [escrow, setEscrow] = useState<EscrowCheck | null | 'error'>(null);
  useEffect(() => {
    let current = true;
    checkEscrow(trade, electrum(), null).then(
      (result) => current && setEscrow(result),
      () => current && setEscrow('error'),
    );
    return () => {
      current = false;
    };
    // The terms and the deposit do not change while the page is open.
  }, [trade.tradeId, trade.fundingTxid, trade.status]);

  // Without the offer the quote is still checked, but nothing can be said about which oracle the offer names.
  const checks = offer.loading && !offer.data ? null : checkForArbiter(trade, offer.data);
  const terms = signedTerms(trade);
  const quote = terms.quote;
  const margin = (terms.marginBps ?? 0) / 100;

  return (
    <section className="cf-card" data-flush>
      <div className="cf-card__section">
        <h2 className="cf-heading" style={{ marginBottom: 'var(--space-3)' }}>
          Verification
        </h2>
        <div className="cf-stack" data-gap="3">
          {!checks ? (
            <Skeleton height={36} />
          ) : (
            <>
              {checks.quote === 'none' && (
                <p className="cf-small cf-muted">This offer has a fixed price, so there is no oracle quote to check.</p>
              )}
              {(checks.quote === 'valid' || checks.quote === 'signature-only') && quote && terms.oraclePk && (
                <div className="s-check">
                  <span>
                    <strong>Quote signature is valid.</strong> {quote.price} {trade.fiat}/{symbol} at{' '}
                    {formatClock(new Date(quote.timestamp * 1000))}, signed by oracle <HashLink value={terms.oraclePk} kind="plain" />
                    {checks.quote === 'valid' && ', the oracle named in the offer'}.
                  </span>
                </div>
              )}
              {checks.quote === 'wrong-signature' && (
                <Notice tone="danger" title="Quote signature is not valid">
                  The oracle's signature does not match the price in the trade. Do not rely on this price.
                </Notice>
              )}
              {checks.quote === 'other-oracle' && (
                <Notice tone="danger" title="The quote is signed by another oracle">
                  The offer names a different oracle than the one that signed this quote.
                </Notice>
              )}
              {checks.fiat?.ok && (
                <div className="s-check">
                  <span>
                    <strong>Fiat amount matches.</strong> {amount} × {checks.fiat.price} {trade.fiat}/{symbol} × (1 + {margin}%) ={' '}
                    {formatFiatAmount(terms.fiatAmount, trade.fiat)}.
                  </span>
                </div>
              )}
              {checks.fiat && !checks.fiat.ok && (
                <Notice tone="danger" title="Fiat amount does not match">
                  Recomputed from the amount, price and margin it is {formatFiatAmount(checks.fiat.expected, trade.fiat)}, but the trade says{' '}
                  {formatFiatAmount(terms.fiatAmount, trade.fiat)}.
                </Notice>
              )}
            </>
          )}
          <EscrowVerification trade={trade} escrow={escrow} />
        </div>
      </div>
    </section>
  );
}

function EscrowVerification({ trade, escrow }: { trade: Trade; escrow: EscrowCheck | null | 'error' }) {
  if (escrow === null) return <Skeleton height={36} />;
  if (escrow === 'error') {
    return <p className="cf-small cf-muted">This browser could not check the escrow on-chain right now. Reload the page to try again.</p>;
  }
  if (!escrow.termsMatch || !escrow.addressMatch) {
    return (
      <Notice tone="danger" title="The escrow does not match the terms">
        Rebuilt from the trade terms, the contract is not the one the service reports. Do not decide this trade.
      </Notice>
    );
  }
  return (
    <>
      <div className="s-check">
        <span>
          <strong>Escrow address matches the terms.</strong> Recomputed from the trade terms
          {escrow.funding === 'match' ? ' and equal to the funded address' : ' and equal to the escrow address'}.
          {trade.fundingTxid && (
            <>
              {' '}
              Funding <HashLink value={trade.fundingTxid} kind="transaction" />.
            </>
          )}
        </span>
      </div>
      {escrow.funding === 'missing' && (
        <Notice tone="warn" title="The deposit is not visible at the escrow address">
          This browser did not find the funding coin there. The verdict can only be paid out if it exists.
        </Notice>
      )}
    </>
  );
}

function TermsCard(props: { trade: Trade; amount: string; fiat: string; tokenAware: boolean }) {
  const { trade } = props;
  const expected = expectedEscrowFunding({ asset: trade.asset, amount: signedTerms(trade).amount });
  const holds = expected.token
    ? `${formatAmount(expected.satoshis, { symbol: 'BCH', decimals: 8, isBch: true })} + ${props.amount}`
    : formatAmount(expected.satoshis, { symbol: 'BCH', decimals: 8, isBch: true });
  const payout = (pkh: string | undefined) => pkh && <HashLink value={pkhToCashAddress(pkh, { tokenAware: props.tokenAware })} kind="address" />;
  return (
    <section className="cf-card" data-flush>
      <div className="cf-card__section">
        <h2 className="cf-heading" style={{ marginBottom: 'var(--space-3)' }}>
          Trade terms
        </h2>
        <dl className="cf-dl">
          {trade.tradeId && (
            <>
              <dt>Trade ID</dt>
              <dd>
                <HashLink value={trade.tradeId} kind="plain" />
              </dd>
            </>
          )}
          <dt>Amount</dt>
          <dd>
            <span className="cf-mono">{props.amount}</span>
          </dd>
          <dt>Fiat amount</dt>
          <dd>
            <span className="cf-mono">{props.fiat}</span>
          </dd>
          <dt>Buyer</dt>
          <dd>
            <HashLink value={trade.buyerIdentity} kind="plain" /> → {payout(trade.buyerPayoutPkh)}
          </dd>
          <dt>Seller</dt>
          <dd>
            <HashLink value={trade.sellerIdentity} kind="plain" /> → {payout(trade.sellerPayoutPkh)}
          </dd>
          {trade.escrowAddress && (
            <>
              <dt>Escrow</dt>
              <dd>
                <HashLink value={trade.escrowAddress} kind="address" /> · <span className="cf-mono">{holds}</span>
              </dd>
            </>
          )}
          {trade.refundTime && (
            <>
              <dt>Refund time</dt>
              <dd>{formatDateTime(trade.refundTime)}</dd>
            </>
          )}
        </dl>
      </div>
    </section>
  );
}

// --- Loading and errors ---

function ConsoleLoading() {
  return (
    <main className="s-main">
      <div className="s-pagehead" aria-busy="true">
        <span className="cf-small cf-muted">Loading trade…</span>
        <Skeleton width="55%" height={30} />
        <Skeleton width="35%" height={24} />
      </div>
      <section className="cf-card" data-flush>
        <div className="cf-card__section">
          <div className="cf-stack" data-gap="3">
            <Skeleton width="30%" height={12} />
            <Skeleton width="70%" height={24} />
            <Skeleton height={44} />
          </div>
        </div>
      </section>
    </main>
  );
}

function ConsoleError({ error, id, onRetry }: { error: unknown; id: string; onRetry: () => void }) {
  const notFound = error instanceof ApiError && error.status === 404;
  return (
    <main className="s-main">
      <div className="s-pagehead">
        <Link className="s-back" to="/offers">
          ← Offers
        </Link>
        <h1 className="cf-title">Demo arbiter console</h1>
      </div>
      <section className="cf-card" data-flush>
        <div className="cf-card__section">
          {notFound ? (
            <EmptyState title="Trade not found" action={<Button to="/offers">Back to offers</Button>}>
              No trade has the ID <span className="cf-mono">{id.length > 12 ? `${id.slice(0, 6)}…${id.slice(-4)}` : id}</span>.
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
