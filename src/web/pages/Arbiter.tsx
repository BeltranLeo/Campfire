import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { Link, useParams } from 'react-router';
import { expectedEscrowFunding } from '../../protocol/escrow.js';
import { pkhToCashAddress } from '../../protocol/keys.js';
import { VERDICT_BUYER, VERDICT_SELLER, type VerdictHex } from '../../protocol/trades.js';
import { ApiError, apiGet, apiPost, type ArbiterChat, type Offer, type Trade } from '../api';
import { setArbiterToken, useArbiterToken } from '../arbiterToken';
import { assetInfo } from '../assets';
import { ArbiterTokenForm } from '../components/ArbiterTokenForm';
import { sinceFor, mergeById } from '../chat';
import { Button } from '../components/Button';
import { ChatPlaintext } from '../components/ChatImage';
import { HashLink, ProvenanceTag, SimBox } from '../components/Provenance';
import { EmptyState, Notice, Skeleton } from '../components/States';
import { StatusPill } from '../components/StatusPill';
import { useConfig } from '../config';
import { electrum } from '../electrum';
import { formatAmount, formatClock, formatDateTime, formatFiatAmount, formatHourMinute } from '../format';
import { usePoll } from '../hooks/usePoll';
import { useMessages } from '../lang';
import { checkEscrow, checkForArbiter, isFinal, newerTrade, signedPayoutPkh, signedTerms, type EscrowCheck } from '../trade';

// The arbiter console. Two kinds of trade reach it:
//  - Against the demo seller (Arbiter-* screens): any visitor may decide a disputed one; the service signs the
//    verdict with the real arbiter key and settles the real escrow. Who decides is simulated.
//  - Between two wallets: only whoever holds the admin token (arbiterToken.ts) may decide, when the offer names
//    the service's arbiter key. The design has no screens for this one; its copy is invented and marked.
//
// The page reads the trade with the admin token when there is one: without it the service sends only the public
// view, except on a disputed demo trade. Only the decrypted chat needs ?arbiter=true, and only while the trade
// is disputed.

const POLL_MS = 3000;

export function Arbiter() {
  const { id = '' } = useParams();
  // A new id is a new page: nothing from the previous trade may carry over.
  return <ArbiterLoader key={id} id={id} />;
}

function ArbiterLoader({ id }: { id: string }) {
  // With the admin token the service sends the whole record; without it, the public view, except on a demo
  // trade that went to dispute, whose console is open to every visitor.
  const token = useArbiterToken();
  const [trade, setTrade] = useState<Trade>();
  const accept = useCallback((incoming: Trade) => setTrade((current) => newerTrade(current, incoming)), []);
  const final = trade !== undefined && isFinal(trade);
  const load = usePoll(
    () =>
      apiGet<{ trade: Trade }>(`/api/trades/${id}`, token ?? undefined).then((r) => {
        accept(r.trade);
        return r.trade;
      }),
    `${id}:${token ?? ''}`,
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
  const token = useArbiterToken();
  const asset = assetInfo(trade.asset, trade.assetDecimals, config);
  // What the arbiter reads is what the parties signed, not the service's copy.
  const terms = signedTerms(trade);
  const amount = formatAmount(terms.amount, asset);
  // The public view has no fiat terms; the page then only asks for the token, before anything reads them.
  const fiat = terms.fiatAmount && trade.fiat ? formatFiatAmount(terms.fiatAmount, trade.fiat) : '';
  const [chat, setChat] = useState<ArbiterChat>();
  const [chatError, setChatError] = useState<string | null>(null);
  const t = useMessages().arbiter;

  const demo = trade.isDemo === true;
  // A resolution without a dispute is the payment window ending, which no arbiter decides.
  const decided = (trade.status === 'ResolvedBuyer' || trade.status === 'ResolvedSeller') && trade.verdict !== undefined && trade.disputedAt !== undefined;
  const disputed = trade.status === 'Disputed';

  if (!decided && !disputed) {
    const ended = isFinal(trade);
    return (
      <ConsoleFrame trade={trade}>
        {/* The first line of the ended variant is invented; the design only has the "not in dispute" notice. */}
        <Denied tradeId={trade.id} title={ended ? t.ended : t.notDisputed}>
          {t.onlyDisputed(demo, trade.status, ended)}
        </Denied>
      </ConsoleFrame>
    );
  }
  if (!demo && (!decided || trade.public)) {
    // Invented copy from here to the end of this block.
    if (config && config.arbiterPk.toLowerCase() !== trade.arbiterPk.toLowerCase()) {
      return (
        <ConsoleFrame trade={trade}>
          <Denied tradeId={trade.id} title={t.otherArbiter}>
            {t.otherArbiterBody}
          </Denied>
        </ConsoleFrame>
      );
    }
    if (!token) {
      return (
        <ConsoleFrame trade={trade}>
          <section className="cf-card" data-flush>
            <div className="cf-card__section cf-stack">
              <h2 className="cf-heading">{t.enterToken}</h2>
              <p className="cf-muted">{t.tokenNeeded}</p>
              <ArbiterTokenForm />
            </div>
          </section>
        </ConsoleFrame>
      );
    }
    // The token was just entered: the whole record is on its way.
    if (trade.public) return <ConsoleLoading />;
  }

  const real = !demo;
  return (
    <ConsoleFrame trade={trade} open>
      {disputed && <ChatFeed id={trade.id} token={real ? (token ?? undefined) : undefined} onData={setChat} onError={setChatError} />}
      <div className="s-cols">
        <div className="s-col">
          {decided ? (
            <DecidedCard trade={trade} amount={amount} />
          ) : (
            <DecisionCard trade={trade} amount={amount} tokenAware={!asset.isBch} token={real ? (token ?? undefined) : undefined} onUpdate={onUpdate} />
          )}
          <DisputeCard trade={trade} />
          <ChatCard trade={trade} chat={chat} error={chatError} />
        </div>
        <div className="s-col">
          <VerificationCard trade={trade} amount={amount} symbol={asset.symbol} />
          <TermsCard trade={trade} amount={amount} fiat={fiat} tokenAware={!asset.isBch} />
        </div>
      </div>
    </ConsoleFrame>
  );
}

// Title, state and, for the demo, the violet box that says the arbiter is simulated.
function ConsoleFrame({ trade, open, children }: { trade: Trade; open?: boolean; children: ReactNode }) {
  const demo = trade.isDemo === true;
  const token = useArbiterToken();
  const t = useMessages().arbiter;
  return (
    <main className="s-main" data-narrow={!open || undefined}>
      <div className="s-pagehead">
        <Link className="s-back" to={`/trade/${trade.id}`}>
          {t.backTrade}
        </Link>
        <h1 className="cf-title">{demo ? t.demoConsole : t.console}</h1>
        {open && (
          <div className="cf-row">
            <StatusPill state={trade.status} role="visitor" side={trade.side} />
            {demo && <ProvenanceTag kind="sim">{t.simulatedArbiter}</ProvenanceTag>}
            {trade.fundingTxid && <ProvenanceTag kind="chain">{t.realEscrow}</ProvenanceTag>}
            {!demo && token && (
              // Invented copy.
              <Button size="sm" variant="ghost" onClick={() => setArbiterToken(null)}>
                {t.forgetToken}
              </Button>
            )}
          </div>
        )}
      </div>
      {open && demo && (
        <SimBox tag={t.simulatedArbiter} label={t.playing}>
          <p className="cf-small">{t.playingBody}</p>
        </SimBox>
      )}
      {open && !demo && (
        <p className="cf-muted">{t.deciding}</p>
      )}
      {children}
    </main>
  );
}

function Denied({ tradeId, title, children }: { tradeId: string; title: string; children: ReactNode }) {
  const t = useMessages().arbiter;
  return (
    <section className="cf-card" data-flush>
      <div className="cf-card__section">
        <div className="cf-stack">
          <Notice title={title}>
            {children}
          </Notice>
          <div className="s-actions">
            <Button variant="primary" to={`/trade/${tradeId}`}>
              {t.backToTrade}
            </Button>
          </div>
        </div>
      </div>
    </section>
  );
}

// --- The decision ---

function DecisionCard(props: {
  trade: Trade;
  amount: string;
  tokenAware: boolean;
  /** The admin token for a trade between two wallets; undefined for the demo console. */
  token: string | undefined;
  onUpdate: (t: Trade) => void;
}) {
  const { trade, amount, token } = props;
  const real = token !== undefined;
  const [busy, setBusy] = useState<VerdictHex | null>(null);
  const [error, setError] = useState<string | null>(null);
  // A verdict on a real trade moves real money and cannot be undone, so it asks once more (invented copy).
  const [pending, setPending] = useState<VerdictHex | null>(null);
  const [reason, setReason] = useState('');
  const t = useMessages().arbiter;

  async function decide(verdict: VerdictHex) {
    setBusy(verdict);
    setError(null);
    try {
      const note = reason.trim();
      const { trade: decided } = real
        ? await apiPost<{ trade: Trade }>(`/api/trades/${trade.id}/verdict`, { verdict, ...(note && { reason: note }) }, token)
        : await apiPost<{ trade: Trade }>(`/api/demo/trades/${trade.id}/verdict`, { verdict });
      props.onUpdate(decided);
    } catch (err) {
      // The verdict is broadcast inside the request, so its answer can be lost after the escrow was settled.
      try {
        const { trade: latest } = await apiGet<{ trade: Trade }>(`/api/trades/${trade.id}`, token);
        props.onUpdate(latest);
        if (latest.status !== 'Disputed') return;
      } catch {
        // Fall through to the original error.
      }
      setError(err instanceof ApiError ? err.message : t.somethingWrong);
    } finally {
      setBusy(null);
    }
  }

  const choose = (verdict: VerdictHex) => (real ? setPending(verdict) : decide(verdict));
  const toBuyer = pending === VERDICT_BUYER;
  const payout = pending && signedPayoutPkh(trade, toBuyer ? 'buyer' : 'seller');

  return (
    <section className="cf-card s-action" data-pad>
      <div className="cf-stack">
        <span className="cf-label">{t.yourDecision}</span>
        <h2 className="cf-heading">{t.whoReceives(amount)}</h2>
        {pending ? (
          <div className="cf-well cf-stack" data-gap="3">
            <strong>{t.confirmFor(toBuyer ? 'buyer' : 'seller')}</strong>
            <p className="cf-small">
              {t.sendsBefore(amount)}
              {payout ? (
                <HashLink value={pkhToCashAddress(payout, { tokenAware: props.tokenAware })} kind="address" />
              ) : (
                t.theParty(toBuyer ? 'buyer' : 'seller')
              )}
              {t.sendsAfter}
            </p>
            <div className="cf-field">
              <label htmlFor="verdict-reason">{t.reason}</label>
              <textarea id="verdict-reason" className="cf-textarea" rows={3} maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} />
              <span className="cf-hint">{t.reasonHint}</span>
            </div>
            <div className="s-actions">
              <Button variant="primary" busy={busy !== null} onClick={() => decide(pending)}>
                {t.confirm}
              </Button>
              <Button variant="ghost" disabled={busy !== null} onClick={() => setPending(null)}>
                {t.back}
              </Button>
            </div>
          </div>
        ) : (
          <div className="s-verdict">
            <Button busy={busy === VERDICT_BUYER} disabled={busy !== null} onClick={() => choose(VERDICT_BUYER)}>
              {t.forBuyer}
              <small>{t.paysBuyer(amount)}</small>
            </Button>
            <Button busy={busy === VERDICT_SELLER} disabled={busy !== null} onClick={() => choose(VERDICT_SELLER)}>
              {t.forSeller}
              <small>{t.returnsSeller(amount)}</small>
            </Button>
          </div>
        )}
        {busy && (
          // Invented copy: the design shows no waiting state.
          <p className="cf-small cf-muted">{t.signing}</p>
        )}
        {error && (
          <Notice tone="danger" title={t.notIssued}>
            {error}
          </Notice>
        )}
        <p className="cf-small cf-muted">{t.final}</p>
      </div>
    </section>
  );
}

function DecidedCard({ trade, amount }: { trade: Trade; amount: string }) {
  const forBuyer = trade.status === 'ResolvedBuyer';
  const demo = trade.isDemo === true;
  const t = useMessages().arbiter;
  return (
    <section className="cf-card" data-flush>
      <div className="cf-card__section">
        <div className="cf-stack">
          {/* The seller's wording is invented; the design only shows a verdict for the buyer. */}
          <Notice tone="verified" title={t.decidedFor(forBuyer ? 'buyer' : 'seller')}>
            {forBuyer ? t.paidBuyer(amount) : t.returnedSeller(amount)}
          </Notice>
          <dl className="cf-dl">
            {trade.settlementTxid && (
              <>
                <dt>{t.arbitrate}</dt>
                <dd>
                  <HashLink value={trade.settlementTxid} kind="transaction" /> · <ProvenanceTag kind="chain" />
                </dd>
              </>
            )}
            <dt>{t.verdict}</dt>
            <dd>
              <span className="cf-mono">{trade.verdict}</span>
              {t.verdictLine(forBuyer ? 'buyer' : 'seller')}
              <HashLink value={trade.arbiterPk} kind="plain" />
            </dd>
            <dt>{t.decidedBy}</dt>
            <dd>
              {demo ? (
                <>
                  <ProvenanceTag kind="sim">{t.simulatedArbiter}</ProvenanceTag>
                  {t.demoVisitor}
                </>
              ) : (
                // Invented copy.
                t.campfireKey
              )}
            </dd>
            {!demo && trade.verdictReason && (
              <>
                <dt>{t.reasonLabel}</dt>
                <dd>{trade.verdictReason}</dd>
              </>
            )}
          </dl>
          <div className="s-actions">
            <Button variant="primary" to={`/trade/${trade.id}`}>
              {t.backToTrade}
            </Button>
          </div>
        </div>
      </div>
    </section>
  );
}

// --- What the arbiter reads ---

function DisputeCard({ trade }: { trade: Trade }) {
  const t = useMessages().arbiter;
  return (
    <section className="cf-card" data-flush>
      <div className="cf-card__section">
        <h2 className="cf-heading" style={{ marginBottom: 'var(--space-3)' }}>
          {t.dispute}
        </h2>
        <dl className="cf-dl">
          {trade.disputedBy && (
            <>
              <dt>{t.openedBy}</dt>
              <dd>
                {t.party(trade.disputedBy)}
                {trade.disputedAt !== undefined && `, ${formatHourMinute(new Date(trade.disputedAt * 1000))}`}
              </dd>
            </>
          )}
          {trade.disputeReason && (
            <>
              <dt>{t.reasonLabel}</dt>
              <dd>{trade.disputeReason}</dd>
            </>
          )}
          {/* Whether the buyer said the payment was sent is the first thing an arbiter needs to know. */}
          <dt>{t.markedSent}</dt>
          <dd>{trade.paidAt !== undefined ? t.markedYes(formatHourMinute(new Date(trade.paidAt * 1000))) : t.markedNo}
          </dd>
          {trade.isDemo && (
            <>
              <dt>{t.fiat}</dt>
              <dd>
                <ProvenanceTag kind="sim">{t.simulatedFiat}</ProvenanceTag>
                {t.noMoney}
              </dd>
            </>
          )}
        </dl>
      </div>
    </section>
  );
}

// Polls the decrypted chat while the trade is disputed; the service refuses it after the verdict, so the
// last messages are kept by the console. Renders nothing.
function ChatFeed(props: {
  id: string;
  token: string | undefined;
  onData: (chat: ArbiterChat) => void;
  onError: (message: string | null) => void;
}) {
  const { id, token, onData, onError } = props;
  // What was decrypted so far: each poll asks only for newer messages (a receipt weighs hundreds of KB).
  const held = useRef<NonNullable<ArbiterChat['decrypted']>>([]);
  const t = useMessages().arbiter;
  const feed = usePoll(
    () => {
      const since = sinceFor(held.current);
      return apiGet<ArbiterChat>(`/api/trades/${id}/chat?arbiter=true${since ? `&since=${since}` : ''}`, token).then((c) => {
        // Without the key there is nothing decrypted to keep, and a later handover must bring the whole chat.
        held.current = c.decrypted ? mergeById(held.current, c.decrypted) : [];
        onData(c.decrypted ? { ...c, decrypted: held.current } : c);
        onError(null);
        return c;
      });
    },
    `${id}:${token ?? ''}`,
    POLL_MS,
  );
  useEffect(() => {
    if (feed.error) onError(feed.error instanceof ApiError ? feed.error.message : t.chatError);
  }, [feed.error, onError, t.chatError]);
  return null;
}

function ChatCard({ trade, chat, error }: { trade: Trade; chat: ArbiterChat | undefined; error: string | null }) {
  // Without a chat we could read (already decided, or not loaded yet) there is nothing honest to show.
  const t = useMessages().arbiter;
  if (!chat && trade.status !== 'Disputed') return null;
  const messages = chat?.decrypted;
  let body: ReactNode;
  // Invented copy for the error.
  if (!chat && error) body = <Notice tone="danger" title={t.chatUnreadable}>
        {error}
      </Notice>;
  else if (!chat) body = <Skeleton height={48} />;
  else if (!messages) {
    // Invented copy: the design only shows a chat the key was handed over for.
    body = <p className="cf-small cf-muted">{t.noKey}</p>;
  } else if (messages.length === 0) {
    body = <p className="cf-small cf-muted">{t.noMessages}</p>;
  } else {
    body = (
      <div className="cf-chat">
        {messages.map((m) => (
          <div key={m.id} className="cf-msg">
            {/* The author is the role whose session key signed the message, not the identity the request named.
                "Not signed" is invented copy: the design has no unsigned messages. */}
            <strong>{t.sender(m.senderRole ?? null)}</strong>{' '}
            {m.plaintext === null ? (
              // Invented copy: the design has no message the shared key cannot open.
              <em>{t.wrongKey}</em>
            ) : (
              <ChatPlaintext plaintext={m.plaintext} />
            )}
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
          <h2 className="cf-heading">{t.chatTitle}</h2>
          {messages && trade.disputedBy && <span className="cf-small cf-muted">{t.keyBy(trade.disputedBy)}</span>}
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
  const t = useMessages().arbiter;

  return (
    <section className="cf-card" data-flush>
      <div className="cf-card__section">
        <h2 className="cf-heading" style={{ marginBottom: 'var(--space-3)' }}>
          {t.verification}
        </h2>
        <div className="cf-stack" data-gap="3">
          {!checks ? (
            <Skeleton height={36} />
          ) : (
            <>
              {checks.quote === 'none' && (
                <p className="cf-small cf-muted">{t.fixedPrice}</p>
              )}
              {(checks.quote === 'valid' || checks.quote === 'signature-only') && quote && terms.oraclePk && (
                <div className="s-check">
                  <span>
                    <strong>{t.quoteValid}</strong> {quote.price} {trade.fiat}/{symbol} · {formatClock(new Date(quote.timestamp * 1000))}
                    {t.signedByOracle}
                    <HashLink value={terms.oraclePk} kind="plain" />
                    {checks.quote === 'valid' && t.namedOracle}.
                  </span>
                </div>
              )}
              {checks.quote === 'wrong-signature' && (
                <Notice tone="danger" title={t.quoteInvalid}>
                  {t.quoteInvalidBody}
                </Notice>
              )}
              {checks.quote === 'other-oracle' && (
                <Notice tone="danger" title={t.otherOracle}>
                  {t.otherOracleBody}
                </Notice>
              )}
              {checks.fiat?.ok && (
                <div className="s-check">
                  <span>
                    <strong>{t.fiatMatches}</strong> {amount} × {checks.fiat.price} {trade.fiat}/{symbol} × (1 + {margin}%) ={' '}
                    {formatFiatAmount(terms.fiatAmount, trade.fiat)}.
                  </span>
                </div>
              )}
              {checks.fiat && !checks.fiat.ok && (
                <Notice tone="danger" title={t.fiatMismatch}>
                  {t.fiatMismatchBody(formatFiatAmount(checks.fiat.expected, trade.fiat), formatFiatAmount(terms.fiatAmount, trade.fiat))}
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
  const t = useMessages().arbiter;
  if (escrow === null) return <Skeleton height={36} />;
  if (escrow === 'error') {
    return <p className="cf-small cf-muted">{t.escrowError}</p>;
  }
  if (!escrow.termsMatch || !escrow.addressMatch) {
    return (
      <Notice tone="danger" title={t.escrowMismatch}>
        {t.escrowMismatchBody}
      </Notice>
    );
  }
  return (
    <>
      <div className="s-check">
        <span>
          <strong>{t.escrowMatches}</strong>
          {t.recomputed(escrow.funding === 'match')}
          {trade.fundingTxid && (
            <>
              {' '}
              {t.funding} <HashLink value={trade.fundingTxid} kind="transaction" />.
            </>
          )}
        </span>
      </div>
      {escrow.funding === 'missing' && (
        <Notice tone="attention" title={t.depositMissing}>
          {t.depositMissingBody}
        </Notice>
      )}
    </>
  );
}

function TermsCard(props: { trade: Trade; amount: string; fiat: string; tokenAware: boolean }) {
  const { trade } = props;
  const t = useMessages().arbiter;
  const expected = expectedEscrowFunding({ asset: trade.asset, amount: signedTerms(trade).amount });
  const holds = expected.token
    ? `${formatAmount(expected.satoshis, { symbol: 'BCH', decimals: 8, isBch: true })} + ${props.amount}`
    : formatAmount(expected.satoshis, { symbol: 'BCH', decimals: 8, isBch: true });
  const payout = (party: 'buyer' | 'seller') => {
    const pkh = signedPayoutPkh(trade, party);
    return pkh && <HashLink value={pkhToCashAddress(pkh, { tokenAware: props.tokenAware })} kind="address" />;
  };
  return (
    <section className="cf-card" data-flush>
      <div className="cf-card__section">
        <h2 className="cf-heading" style={{ marginBottom: 'var(--space-3)' }}>
          {t.terms}
        </h2>
        <dl className="cf-dl">
          {trade.tradeId && (
            <>
              <dt>{t.tradeId}</dt>
              <dd>
                <HashLink value={trade.tradeId} kind="plain" />
              </dd>
            </>
          )}
          <dt>{t.amount}</dt>
          <dd>
            <span className="cf-mono">{props.amount}</span>
          </dd>
          <dt>{t.fiatAmount}</dt>
          <dd>
            <span className="cf-mono">{props.fiat}</span>
          </dd>
          <dt>{t.buyer}</dt>
          <dd>
            <HashLink value={trade.buyerIdentity} kind="plain" /> → {payout('buyer')}
          </dd>
          <dt>{t.seller}</dt>
          <dd>
            <HashLink value={trade.sellerIdentity} kind="plain" /> → {payout('seller')}
          </dd>
          {trade.escrowAddress && (
            <>
              <dt>{t.escrow}</dt>
              <dd>
                <HashLink value={trade.escrowAddress} kind="address" /> · <span className="cf-mono">{holds}</span>
              </dd>
            </>
          )}
          {trade.refundTime && (
            <>
              <dt>{t.refundTime}</dt>
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
  const t = useMessages().arbiter;
  return (
    <main className="s-main" data-narrow>
      <div className="s-pagehead" aria-busy="true">
        <span className="cf-small cf-muted">{t.loading}</span>
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
  const messages = useMessages();
  const t = messages.arbiter;
  return (
    <main className="s-main" data-narrow>
      <div className="s-pagehead">
        <Link className="s-back" to="/offers">
          {t.backOffers}
        </Link>
        <h1 className="cf-title">{t.demoConsole}</h1>
      </div>
      <section className="cf-card" data-flush>
        <div className="cf-card__section">
          {notFound ? (
            <EmptyState title={t.notFound} action={<Button to="/offers">{t.backToOffers}</Button>}>
              {t.noTradeWithId} <span className="cf-mono">{id.length > 12 ? `${id.slice(0, 6)}…${id.slice(-4)}` : id}</span>.
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
                  {messages.common.tryAgain}
                </Button>
                <Button to="/offers">{t.backToOffers}</Button>
              </div>
            </div>
          )}
        </div>
      </section>
    </main>
  );
}
