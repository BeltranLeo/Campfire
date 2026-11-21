import { setHideBalance, useHideBalance } from '../hideBalance';
import { Icon } from './Icon';

// A toggle, not two buttons: screen readers hear "Hide balance, pressed" while the amounts are dots.
// The icon shows the current state: an open eye while the balance shows, a crossed one while it is hidden.
export function BalanceEye() {
  const hidden = useHideBalance();
  return (
    <button
      type="button"
      className="s-eye"
      aria-label="Hide balance"
      aria-pressed={hidden}
      title={hidden ? 'Show balance' : 'Hide balance'}
      onClick={() => setHideBalance(!hidden)}
    >
      <Icon name={hidden ? 'eyeSlash' : 'eye'} />
    </button>
  );
}
