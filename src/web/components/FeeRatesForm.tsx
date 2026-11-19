import { useEffect, useState } from 'react';
import { ApiError, apiGet, apiPost, type FeeRatesInfo } from '../api';
import { formatBch } from '../format';
import { Button } from './Button';
import { Notice, Skeleton } from './States';

// Invented copy: the design has no administration screen. The fee rates live in the arbiter console because
// the admin token that opens it is the only administration credential the service has.

/** "0.25" (percent) to 25 (basis points); null when it is not a percentage with at most two decimals. */
export function percentToBps(text: string): number | null {
  const value = text.trim().replace(',', '.');
  if (!/^\d{1,2}(\.\d{1,2})?$/.test(value)) return null;
  const [whole, frac = ''] = value.split('.');
  return Number(whole) * 100 + Number(frac.padEnd(2, '0'));
}

export const bpsToPercent = (bps: number) => String(bps / 100);

/** Shows the fee rates new trades use and lets whoever holds the admin token change them. */
export function FeeRatesForm({ token }: { token: string }) {
  const [current, setCurrent] = useState<FeeRatesInfo | null>(null);
  const [arbiter, setArbiter] = useState('');
  const [oracle, setOracle] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);

  const show = (info: FeeRatesInfo) => {
    setCurrent(info);
    setArbiter(bpsToPercent(info.arbiterBps));
    setOracle(bpsToPercent(info.oracleBps));
  };

  useEffect(() => {
    apiGet<FeeRatesInfo>('/api/fees').then(show, (err) => setError(err instanceof ApiError ? err.message : String(err)));
  }, []);

  if (!current) {
    return error ? <Notice tone="danger" title="The fee rates could not be loaded">{error}</Notice> : <Skeleton height={72} />;
  }

  const arbiterBps = percentToBps(arbiter);
  const oracleBps = percentToBps(oracle);
  const max = current.maxBps;
  const valid = arbiterBps !== null && oracleBps !== null && arbiterBps <= max && oracleBps <= max;
  const changed = valid && (arbiterBps !== current.arbiterBps || oracleBps !== current.oracleBps);

  async function save() {
    if (!valid) return;
    setBusy(true);
    setError(null);
    setSaved(false);
    try {
      show(await apiPost<FeeRatesInfo>('/api/admin/fees', { arbiterBps, oracleBps }, token));
      setSaved(true);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form
      className="cf-stack"
      onSubmit={(e) => {
        e.preventDefault();
        void save();
      }}
    >
      <p className="cf-small cf-muted">
        Percent of each trade's value, paid by the seller in BCH in the deposit transaction. A fee below {formatBch(BigInt(current.dustLimitSats))} is left out,
        and the oracle is only paid on offers that follow the market price. New trades use the new rates; trades already requested keep theirs.
      </p>
      <div className="cf-field">
        <label htmlFor="fee-arbiter">Arbiter fee (%)</label>
        <input id="fee-arbiter" className="cf-input" inputMode="decimal" value={arbiter} onChange={(e) => setArbiter(e.target.value)} />
      </div>
      <div className="cf-field">
        <label htmlFor="fee-oracle">Price oracle fee (%)</label>
        <input id="fee-oracle" className="cf-input" inputMode="decimal" value={oracle} onChange={(e) => setOracle(e.target.value)} />
        <span className="cf-hint">Up to {bpsToPercent(max)}% each, with at most two decimals.</span>
      </div>
      {error && <Notice tone="danger" title="The fee rates were not changed">{error}</Notice>}
      {saved && !changed && <Notice tone="verified" title="Fee rates saved">New trades use them from now on.</Notice>}
      <div className="s-actions">
        <Button variant="primary" type="submit" busy={busy} disabled={!changed || busy}>
          Save fee rates
        </Button>
      </div>
    </form>
  );
}
