import type { ReactNode } from 'react';
import { apiGet, type AccountBalance, type AccountError, type ServiceAccounts as Accounts } from '../api';
import { useConfig } from '../config';
import { formatAmount, formatBch } from '../format';
import { usePoll } from '../hooks/usePoll';
import { Button } from './Button';
import { CopyButton } from './CopyButton';
import { HashLink } from './Provenance';
import { Notice, Skeleton } from './States';

// Invented copy: the design has no administration screen. The balances live in the arbiter console next to the
// fee rates because the admin token that opens it is the only administration credential the service has.
// Loaded once and on demand, not polled: each load is a lookup on mainnet.

const isError = (a: AccountBalance | AccountError): a is AccountError => 'error' in a;

/** Addresses and balances of the demo seller bot and of the addresses the oracle and arbiter fees are paid to. */
export function ServiceAccounts({ token }: { token: string }) {
  const config = useConfig();
  const accounts = usePoll(() => apiGet<Accounts>('/api/admin/accounts', token), `accounts:${token}`);
  const pusd = (units: string | bigint) => formatAmount(units, { symbol: 'PUSD', decimals: config?.pusdDecimals ?? 2, isBch: false });

  if (!accounts.data) {
    return accounts.error ? (
      <Notice tone="danger" title="The balances could not be loaded">
        {accounts.error instanceof Error ? accounts.error.message : 'Campfire did not answer. Try again in a moment.'}
        <div className="s-actions">
          <Button onClick={accounts.reload}>Try again</Button>
        </div>
      </Notice>
    ) : (
      <Skeleton height={160} />
    );
  }

  const { bot, oracle, arbiter, bchUsd } = accounts.data;
  return (
    <div className="cf-stack">
      <div className="cf-row" data-between>
        <span className="cf-small cf-muted">
          {bchUsd ? `1 BCH = ${bchUsd} USD, from the oracle's price feed.` : "The oracle's price feed did not answer."}
        </span>
        <Button size="sm" variant="ghost" onClick={accounts.reload} disabled={accounts.loading}>
          {accounts.loading ? 'Loading…' : 'Refresh'}
        </Button>
      </div>

      {bot === null ? (
        <p className="cf-small cf-muted">The demo seller is not enabled on this deployment.</p>
      ) : (
        <Account
          title="Demo seller bot"
          note="Funds the demo trades and pays for publishing offers. Send BCH to its address and PUSD to its token address."
          account={bot}
          pusd={pusd}
        >
          {!isError(bot) && (
            <>
              {bot.addressCount > 1 && (
                <p className="cf-small cf-muted">
                  The balance adds up {bot.addressCount} addresses: the main one and the payout addresses of trades that returned coins to the bot.
                </p>
              )}
              <FundingCheck ok={bot.canFundMax.BCH} amount={formatBch(bot.maxBchSats)} />
              <FundingCheck ok={bot.canFundMax.PUSD} amount={pusd(bot.maxPusdUnits)} pusd />
            </>
          )}
        </Account>
      )}
      <Account
        title="Oracle"
        note="Receives the oracle fee of market-price trades that use Campfire's oracle. It needs no funds: the oracle only signs prices."
        account={oracle}
        pusd={pusd}
      />
      <Account
        title="Arbiter"
        note="Receives the arbiter fee of trades that name Campfire's arbiter. It needs no funds: the arbiter signs decisions, never transactions."
        account={arbiter}
        pusd={pusd}
      />
    </div>
  );
}

function Account(props: {
  title: string;
  note: string;
  account: AccountBalance | AccountError;
  pusd: (units: string) => string;
  children?: ReactNode;
}) {
  const { account } = props;
  return (
    <div className="cf-stack" data-gap="2">
      <h3 className="cf-heading">{props.title}</h3>
      <p className="cf-small cf-muted">{props.note}</p>
      <dl className="cf-dl">
        <dt>Address</dt>
        <dd>
          <HashLink value={account.address} kind="address" /> <CopyButton value={account.address} />
        </dd>
        {isError(account) ? (
          <>
            <dt>Balance</dt>
            <dd className="cf-small">Could not be read: {account.error}</dd>
          </>
        ) : (
          <>
            <dt>Token address</dt>
            <dd>
              <HashLink value={account.tokenAddress} kind="address" /> <CopyButton value={account.tokenAddress} />
            </dd>
            <dt>BCH</dt>
            <dd>
              <span className="cf-mono">{formatBch(account.bchSats)}</span>
            </dd>
            <dt>PUSD</dt>
            <dd>
              <span className="cf-mono">{props.pusd(account.pusdUnits)}</span>
            </dd>
          </>
        )}
      </dl>
      {props.children}
    </div>
  );
}

/** Whether the bot can fund one trade at its maximum, by the same rule it decides with. */
function FundingCheck({ ok, amount, pusd }: { ok: boolean | null; amount: string; pusd?: boolean }) {
  if (ok === true) return null;
  if (ok === null) {
    return (
      <Notice title={`Could not check a ${amount} trade`}>
        The fees of a PUSD trade need the BCH price, and the price feed did not answer. Refresh in a moment.
      </Notice>
    );
  }
  return (
    <Notice tone="attention" title={`Not enough for a ${amount} trade`}>
      {pusd
        ? 'A PUSD trade needs the tokens, plus about 0.0001 BCH for the escrow, the fees and the network fee. Send what is missing.'
        : 'A BCH trade needs the amount, the fees and about 0.00003 BCH for the network fee. Send BCH to the address above.'}
    </Notice>
  );
}
