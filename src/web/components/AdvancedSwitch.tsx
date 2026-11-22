import { setAdvanced, useAdvanced } from '../advanced';
import { useMessages } from '../lang';

// The switch for technical details, in the footer, where a visitor without a wallet (a judge, say) finds it too.
// A real checkbox with role="switch", so keyboards and screen readers get it for free.
export function AdvancedSwitch({ compact }: { compact?: boolean }) {
  const on = useAdvanced();
  const t = useMessages().footer;
  return (
    <label className="s-switch">
      <span className="s-switch__text">
        <strong>{t.advanced}</strong>
        {!compact && <span className="cf-small cf-muted">{t.advancedHint}</span>}
      </span>
      <input type="checkbox" role="switch" checked={on} onChange={(e) => setAdvanced(e.target.checked)} />
    </label>
  );
}
