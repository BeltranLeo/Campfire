import type { ReactNode } from 'react';
import { Link } from 'react-router';
import { useWallet } from '../wallet';
import { useMessages } from '../lang';

// Design principle 3: a button says whether it opens the wallet. A signing button carries
// "Signs in your wallet" under its label; others may say "No signature needed" with `note`.
// Only one `primary` button per screen.

export interface ButtonProps {
  children: ReactNode;
  /** primary: the one next step (Brasa). danger: irreversible. arbiter: opens a dispute. ghost: quiet. None: secondary. */
  variant?: 'primary' | 'danger' | 'arbiter' | 'ghost';
  size?: 'sm';
  block?: boolean;
  /** The action asks the wallet for a signature. A string replaces the default line. */
  signs?: boolean | string;
  /** A line under the button for actions that do not sign, e.g. "No signature needed." */
  note?: ReactNode;
  /** Working on it. A signing button reads "Preparing…" until the wallet has the request, then "Waiting for wallet…". */
  busy?: boolean;
  /** What a busy button is doing ("Reading your balance… 25%"), shown until the wallet has a request. */
  busyLabel?: string | null;
  disabled?: boolean;
  onClick?: () => void;
  /** Navigate inside the app instead of running an action. */
  to?: string;
  type?: 'button' | 'submit';
}

export function Button({
  children,
  variant,
  size,
  block,
  signs,
  note,
  busy = false,
  busyLabel,
  disabled = false,
  onClick,
  to,
  type = 'button',
}: ButtonProps) {
  // "Waiting for wallet…" is true only once the request is out. Before that the page is still preparing it
  // (reading coins), and a visitor who switches to the wallet app then leaves the page with nothing to approve.
  const { signing } = useWallet();
  const t = useMessages().trade;
  const common = {
    className: 'cf-btn',
    'data-variant': variant,
    'data-size': size,
    'data-block': block || undefined,
  };

  const control = to ? (
    <Link {...common} to={to} onClick={onClick}>
      {children}
    </Link>
  ) : (
    // A busy button keeps its full colour (as in the design) but ignores further clicks.
    <button {...common} type={type} onClick={busy ? undefined : onClick} disabled={disabled} aria-busy={busy || undefined}>
      {busy && signs && signing ? t.waitingWallet : busy && busyLabel ? busyLabel : busy && signs ? t.preparing : children}
    </button>
  );

  if (!signs && !note) return control;
  return (
    <div className="s-primary">
      {control}
      {signs ? (
        <span className="cf-signs">
          {busy && signing ? t.openWallet : typeof signs === 'string' ? signs : t.signsInWallet}
        </span>
      ) : (
        <span className="cf-small cf-subtle">{note}</span>
      )}
    </div>
  );
}
