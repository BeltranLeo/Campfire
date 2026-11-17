import { apiGet, type Trade } from '../api';
import { setArbiterToken, useArbiterToken } from '../arbiterToken';
import { assetInfo } from '../assets';
import { ArbiterTokenForm } from '../components/ArbiterTokenForm';
import { Button } from '../components/Button';
import { ProvenanceTag } from '../components/Provenance';
import { EmptyState, Notice, Skeleton } from '../components/States';
import { useConfig } from '../config';
import { formatAmount, formatDateTime, formatFiatAmount } from '../format';
import { usePoll } from '../hooks/usePoll';
import { signedTerms } from '../trade';

// Disputes waiting for a verdict (invented page: the design only has the demo console for one trade).
// The list is public data filtered in the browser; deciding needs the admin token, which is asked for
// before the list is shown and kept in memory only (arbiterToken.ts).

const REFRESH_MS = 10_000;

export function ArbiterList() {
  const token = useArbiterToken();
  return (
    <main className="s-main" data-narrow>
      <div className="s-pagehead">
        <h1 className="cf-title">Arbiter console</h1>
        <p className="cf-muted">
          Disputes between two wallets that name Campfire's arbiter key. Trades against the demo seller are decided by anyone, from their
          own trade page.
        </p>
      </div>
      {token ? (
        <Disputes />
      ) : (
        <section className="cf-card" data-flush>
          <div className="cf-card__section cf-stack">
            <h2 className="cf-heading">Enter the arbiter token</h2>
            <ArbiterTokenForm />
          </div>
        </section>
      )}
    </main>
  );
}

function Disputes() {
  const config = useConfig();
  const disputes = usePoll(
    () =>
      apiGet<{ trades: Trade[] }>('/api/trades').then((r) =>
        r.trades.filter((t) => t.status === 'Disputed').sort((a, b) => (a.disputedAt ?? 0) - (b.disputedAt ?? 0)),
      ),
    'disputes',
    REFRESH_MS,
  );

  return (
    <div className="cf-stack">
      <div className="cf-row" data-between>
        <h2 className="cf-heading">Waiting for a verdict</h2>
        <Button size="sm" variant="ghost" onClick={() => setArbiterToken(null)}>
          Forget token
        </Button>
      </div>
      {disputes.error && !disputes.data ? (
        <Notice tone="danger" title="The disputes could not be loaded">
          Campfire did not answer. Try again in a moment.
          <div className="s-actions">
            <Button onClick={disputes.reload}>Try again</Button>
          </div>
        </Notice>
      ) : !disputes.data ? (
        <Skeleton height={72} />
      ) : disputes.data.length === 0 ? (
        <section className="cf-card" data-flush>
          <div className="cf-card__section">
            <EmptyState title="No open disputes">
              When a buyer or a seller opens one, it shows up here. The list refreshes every 10 seconds. The token is checked when you open a
              trade.
            </EmptyState>
          </div>
        </section>
      ) : (
        disputes.data.map((trade) => {
          const terms = signedTerms(trade);
          const asset = assetInfo(trade.asset, trade.assetDecimals, config);
          const ours = !config || config.arbiterPk.toLowerCase() === trade.arbiterPk.toLowerCase();
          return (
            <section key={trade.id} className="cf-card" data-flush>
              <div className="cf-card__section">
                <div className="cf-row" data-between>
                  <div className="cf-stack" data-gap="1">
                    <strong>
                      {formatAmount(terms.amount, asset)} for {formatFiatAmount(terms.fiatAmount, trade.fiat)}
                    </strong>
                    <span className="cf-small cf-muted">
                      Opened by the {trade.disputedBy ?? 'buyer or seller'}
                      {trade.disputedAt !== undefined && `, ${formatDateTime(trade.disputedAt)}`}
                    </span>
                    {trade.disputeReason && <span className="cf-small">{trade.disputeReason}</span>}
                    <span className="cf-row">
                      {trade.isDemo ? <ProvenanceTag kind="sim">Demo seller</ProvenanceTag> : <ProvenanceTag kind="chain">Between two wallets</ProvenanceTag>}
                      {!ours && <span className="cf-small cf-subtle">Another arbiter decides this one</span>}
                    </span>
                  </div>
                  {ours && (
                    <Button variant="primary" to={`/trade/${trade.id}/arbiter`}>
                      Review
                    </Button>
                  )}
                </div>
              </div>
            </section>
          );
        })
      )}
    </div>
  );
}
