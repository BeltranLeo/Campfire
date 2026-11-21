import { setAdvanced, useAdvanced } from '../advanced';

// The switch for technical details, in the footer, where a visitor without a wallet (a judge, say) finds it too.
// A real checkbox with role="switch", so keyboards and screen readers get it for free.
export function AdvancedSwitch({ compact }: { compact?: boolean }) {
  const on = useAdvanced();
  return (
    <label className="s-switch">
      <span className="s-switch__text">
        <strong>Show technical details</strong>
        {!compact && <span className="cf-small cf-muted">Transactions, keys and addresses, open on every screen</span>}
      </span>
      <input type="checkbox" role="switch" checked={on} onChange={(e) => setAdvanced(e.target.checked)} />
    </label>
  );
}
