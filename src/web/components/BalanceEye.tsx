import { setHideBalance, useHideBalance } from '../hideBalance';
import { Icon } from './Icon';
import { useMessages } from '../lang';

// A toggle, not two buttons: screen readers hear "Hide balance, pressed" while the amounts are dots.
// The icon shows the current state: an open eye while the balance shows, a crossed one while it is hidden.
export function BalanceEye() {
  const hidden = useHideBalance();
  const t = useMessages().wallet;
  return (
    <button
      type="button"
      className="s-eye"
      aria-label={t.hideBalance}
      aria-pressed={hidden}
      title={hidden ? t.showBalance : t.hideBalance}
      onClick={() => setHideBalance(!hidden)}
    >
      <Icon name={hidden ? 'eyeSlash' : 'eye'} />
    </button>
  );
}
