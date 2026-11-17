import type { ReactNode } from 'react';
import { Link } from 'react-router';
import { useWallet } from '../wallet';

// Design principle 3: a button says whether it opens the wallet. A signing button carries
// "Signs in your wallet" under its label; others may say "No signature needed" with `note`.
// Only one `primary` button per screen.

export interface ButtonProps {
  children: ReactNode;
  variant?: 'primary' | 'danger' | 'ghost';
  size?: 'sm';
  block?: boolean;
  /** The action asks the wallet for a signature. A string replaces the default line. */
  signs?: boolean | string;
  /** A line under the button for actions that do not sign, e.g. "No signature needed." */
  note?: ReactNode;
  /** Working on it. A signing button reads "Preparing…" until the wallet has the request, then "Waiting for wallet…". */
  busy?: boolean;
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
  disabled = false,
  onClick,
  to,
  type = 'button',
}: ButtonProps) {
  // "Waiting for wallet…" is true only once the request is out. Before that the page is still preparing it
  // (reading coins), and a visitor who switches to the wallet app then leaves the page with nothing to approve.
  const { signing } = useWallet();
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
      {busy && signs ? (signing ? 'Waiting for wallet…' : 'Preparing…') : children}
    </button>
  );

  if (!signs && !note) return control;
  return (
    <div className="s-primary">
      {control}
      {signs ? (
        <span className="cf-signs">
          {busy && signing ? 'Open your wallet to approve, then come back here.' : typeof signs === 'string' ? signs : 'Signs in your wallet'}
        </span>
      ) : (
        <span className="cf-small cf-subtle">{note}</span>
      )}
    </div>
  );
}

/** Shown when the wallet refuses a signature request. */
export const WALLET_DECLINED = 'The wallet did not sign. Nothing was sent. Try again.';
