import { apiGet, type Trade } from '../api';
import { setArbiterToken, useArbiterToken } from '../arbiterToken';
import { assetInfo } from '../assets';
import { ArbiterTokenForm } from '../components/ArbiterTokenForm';
import { Button } from '../components/Button';
import { FeeRatesForm } from '../components/FeeRatesForm';
import { ProvenanceTag } from '../components/Provenance';
import { ServiceAccounts } from '../components/ServiceAccounts';
import { EmptyState, Notice, Skeleton } from '../components/States';
import { useConfig } from '../config';
import { formatAmount, formatDateTime, formatFiatAmount } from '../format';
import { usePoll } from '../hooks/usePoll';
import { useMessages } from '../lang';
import { signedTerms } from '../trade';

// Disputes waiting for a verdict (invented page: the design only has the demo console for one trade).
// The list needs the admin token, like deciding: it shows who disputed what and why. The token is asked for
// before the list is shown and kept in memory only (arbiterToken.ts).

const REFRESH_MS = 10_000;

export function ArbiterList() {
  const token = useArbiterToken();
  const t = useMessages().arbiter;
  return (
    <main className="s-main" data-narrow>
      <div className="s-pagehead">
        <h1 className="cf-title">{t.console}</h1>
        <p className="cf-muted">{t.listLead}</p>
      </div>
      {token ? (
        <>
          <Disputes token={token} />
          <section className="cf-card" data-flush>
            <div className="cf-card__section cf-stack">
              <h2 className="cf-heading">{t.serviceFees}</h2>
              <FeeRatesForm token={token} />
            </div>
          </section>
          <section className="cf-card" data-flush>
            <div className="cf-card__section cf-stack">
              <h2 className="cf-heading">{t.serviceAccounts}</h2>
              <ServiceAccounts token={token} />
            </div>
          </section>
        </>
      ) : (
        <section className="cf-card" data-flush>
          <div className="cf-card__section cf-stack">
            <h2 className="cf-heading">{t.enterToken}</h2>
            <ArbiterTokenForm />
          </div>
        </section>
      )}
    </main>
  );
}

function Disputes({ token }: { token: string }) {
  const config = useConfig();
  const messages = useMessages();
  const t = messages.arbiter;
  const disputes = usePoll(
    () =>
      apiGet<{ trades: Trade[] }>('/api/admin/trades?status=Disputed', token).then((r) =>
        r.trades.sort((a, b) => (a.disputedAt ?? 0) - (b.disputedAt ?? 0)),
      ),
    `disputes:${token}`,
    REFRESH_MS,
  );

  return (
    <div className="cf-stack">
      <div className="cf-row" data-between>
        <h2 className="cf-heading">{t.waitingVerdict}</h2>
        <Button size="sm" variant="ghost" onClick={() => setArbiterToken(null)}>
          {t.forgetToken}
        </Button>
      </div>
      {disputes.error && !disputes.data ? (
        <Notice tone="danger" title={t.disputesError}>
          {t.disputesErrorBody}
          <div className="s-actions">
            <Button onClick={disputes.reload}>{messages.common.tryAgain}</Button>
          </div>
        </Notice>
      ) : !disputes.data ? (
        <Skeleton height={72} />
      ) : disputes.data.length === 0 ? (
        <section className="cf-card" data-flush>
          <div className="cf-card__section">
            <EmptyState title={t.noDisputes}>{t.noDisputesBody}</EmptyState>
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
                      {t.amountFor(formatAmount(terms.amount, asset), formatFiatAmount(terms.fiatAmount, trade.fiat))}
                    </strong>
                    <span className="cf-small cf-muted">
                      {t.openedByLine(trade.disputedBy)}
                      {trade.disputedAt !== undefined && `, ${formatDateTime(trade.disputedAt)}`}
                    </span>
                    {trade.disputeReason && <span className="cf-small">{trade.disputeReason}</span>}
                    <span className="cf-row">
                      {trade.isDemo ? <ProvenanceTag kind="sim">{t.demoSeller}</ProvenanceTag> : <ProvenanceTag kind="chain">{t.twoWallets}</ProvenanceTag>}
                      {!ours && <span className="cf-small cf-subtle">{t.anotherDecides}</span>}
                    </span>
                  </div>
                  {ours && (
                    <Button variant="primary" to={`/trade/${trade.id}/arbiter`}>
                      {t.review}
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
