import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Link, NavLink } from 'react-router';
import QRCode from 'qrcode';
import { aliasFor } from '../alias';
import { spendableBch, tokenBalance } from '../coins';
import { useConfig } from '../config';
import { formatBchBalance, fromBaseUnits } from '../format';
import { describeProgress, refreshWalletCoins, useWalletCoins } from '../walletCoins';
import { useWallet } from '../wallet';
import { CopyButton } from './CopyButton';
import { Icon, type IconName } from './Icon';
import { HashLink } from './Provenance';
import { Notice, Skeleton } from './States';
import { AdvancedSwitch } from './AdvancedSwitch';
import { NavBadge } from './Notifications';

// The WizardConnect button at the top right, in its four states (Shell-* screens):
// disconnected, pairing, connecting and connected with its menu.
export function WalletButton() {
  const wallet = useWallet();
  const [menuOpen, setMenuOpen] = useState(false);
  const closeMenu = useCallback(() => setMenuOpen(false), []);

  if (wallet.status === 'disconnected') {
    return (
      <button type="button" className="cf-btn" onClick={wallet.connect}>
        Connect wallet
      </button>
    );
  }

  if (wallet.status !== 'connected' || !wallet.identity) {
    return (
      <>
        <button type="button" className="cf-btn" aria-busy="true">
          {wallet.status === 'pairing' ? 'Pairing…' : 'Connecting…'}
        </button>
        {/* A portal, because the header's backdrop-filter makes it the containing block of any fixed
            descendant: inside it the overlay shrinks to the header's height and the dialog cannot be reached. */}
        {wallet.pairing &&
          createPortal(
            <PairingDialog uri={wallet.pairing.uri} qrUri={wallet.pairing.qrUri} onClose={wallet.disconnect} />,
            document.body,
          )}
      </>
    );
  }

  return (
    <div className="s-walletanchor">
      <button
        type="button"
        className="cf-wallet"
        aria-haspopup="menu"
        aria-expanded={menuOpen}
        onClick={() => {
          if (!menuOpen) {
            void wallet.refreshActiveTrades();
            void refreshWalletCoins();
          }
          setMenuOpen(!menuOpen);
        }}
      >
        <span className="cf-wallet__dot" aria-hidden="true" />
        {/* The same name other people see in the offer list, not the hash it comes from. */}
        <span className="cf-wallet__id">{aliasFor(wallet.identity).name}</span>
        <PillBalance />
      </button>
      {menuOpen && <WalletMenu onClose={closeMenu} />}
    </div>
  );
}

/** The wallet's BCH and PUSD as the shared scan reads them: "0.0412 BCH · 12.50 PUSD". */
function useBalanceText() {
  const coins = useWalletCoins();
  const config = useConfig();
  if (!coins.data) return { bch: null, pusd: null, sats: null, failed: coins.error !== null, loading: coins.loading };
  const sats = spendableBch(coins.data.coins);
  const pusd = config ? fromBaseUnits(tokenBalance(coins.data.coins, config.pusdCategory), config.pusdDecimals) : null;
  return { bch: formatBchBalance(sats), pusd, sats, failed: false, loading: false };
}

function PillBalance() {
  const { bch, pusd, failed } = useBalanceText();
  if (bch === null) {
    // Without a balance the wallet still works: the dash says it could not be read, the bar says it is loading.
    return failed ? <span className="cf-subtle cf-wallet__bal">— BCH</span> : <Skeleton width={84} height={12} style={{ display: 'inline-block' }} />;
  }
  return (
    <span className="cf-wallet__bal">
      {bch} BCH{pusd !== null && <span className="cf-subtle"> · {pusd} PUSD</span>}
    </span>
  );
}

function MenuBalance() {
  const { bch, pusd, failed } = useBalanceText();
  const progress = describeProgress(useWalletCoins().progress);
  return (
    <div className="cf-stack" data-gap="1">
      <span className="cf-label">Your wallet</span>
      {bch === null ? (
        failed ? (
          <>
            <strong className="cf-muted">— BCH</strong>
            <span className="cf-small cf-muted">We could not read your balance from the network. Trading still works.</span>
            <span>
              <button type="button" className="cf-copy" onClick={() => void refreshWalletCoins()}>
                Try again
              </button>
            </span>
          </>
        ) : (
          <>
            <Skeleton width={120} height={18} />
            {progress && <span className="cf-small cf-subtle">{progress}</span>}
          </>
        )
      ) : (
        <>
          <strong>{bch} BCH</strong>
          {pusd !== null && <span className="cf-small cf-muted">{pusd} PUSD</span>}
          <span className="cf-small cf-subtle">Read from the network with your wallet's public key. Campfire never sees your private keys.</span>
        </>
      )}
    </div>
  );
}

function WalletMenu({ onClose }: { onClose: () => void }) {
  const wallet = useWallet();
  const ref = useRef<HTMLDivElement>(null);

  // Close on Escape or on a click outside the menu and its button.
  useEffect(() => {
    const onPointer = (event: PointerEvent) => {
      if (!ref.current?.parentElement?.contains(event.target as Node)) onClose();
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('pointerdown', onPointer);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onPointer);
      document.removeEventListener('keydown', onKey);
    };
  }, [onClose]);

  if (!wallet.identity) return null;
  const rep = wallet.reputation;
  const alias = aliasFor(wallet.identity);

  return (
    <div className="s-menu" role="menu" ref={ref}>
      <div className="cf-stack" data-gap="1">
        <span className="cf-label">You appear as</span>
        <span className="cf-row" data-nowrap>
          <span className="o-avatar" aria-hidden="true">
            {alias.initials}
          </span>
          <strong>{alias.name}</strong>
        </span>
        <span className="cf-small cf-subtle">
          This is the name other people see on your offers and trades. It comes from your wallet, so it is the same every
          time and nobody can pick it.
        </span>
      </div>
      <div className="cf-stack" data-gap="1">
        <span className="cf-label">Your fingerprint</span>
        <span className="cf-row" data-nowrap>
          <HashLink value={wallet.identity} kind="plain" />
          <CopyButton value={wallet.identity} />
        </span>
      </div>
      <MenuBalance />
      {rep && (
        <div className="cf-stack" data-gap="1">
          <span className="cf-small">
            <strong>{rep.completedAsBuyer}</strong> completed as buyer · <strong>{rep.completedAsSeller}</strong> as seller
            {rep.firstCompletedAt !== null && ` · since ${formatDate(rep.firstCompletedAt)}`}
          </span>
          <span className="cf-small cf-subtle">
            Counted by Campfire. It cannot be verified on-chain and can be inflated with a second wallet.
          </span>
        </div>
      )}
      <Link className="cf-btn" data-block to="/trades" onClick={onClose}>
        {wallet.activeTrades ? `My trades · ${wallet.activeTrades} active` : 'My trades'}
      </Link>
      <div className="cf-stack" data-gap="1">
        <Link to="/about" onClick={onClose}>
          About
        </Link>
        <Link to="/transparency" onClick={onClose}>
          Transparency
        </Link>
      </div>
      <AdvancedSwitch />
      <button type="button" className="cf-btn" data-variant="ghost" data-block onClick={wallet.disconnect}>
        Disconnect
      </button>
    </div>
  );
}

// On a phone the wallet is usually on the same device, so the link comes first and the QR code is folded.
// On a computer the QR code is the way in.
function PairingDialog({ uri, qrUri, onClose }: { uri: string; qrUri: string; onClose: () => void }) {
  const titleId = useId();
  const dialogRef = useRef<HTMLDivElement>(null);
  const [onPhone] = useState(() => window.matchMedia('(hover: none) and (pointer: coarse)').matches);
  const [slow, setSlow] = useState(false);

  useEffect(() => {
    dialogRef.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  // If the wallet has not answered after 20 seconds, remind the user to open the app and scan again.
  useEffect(() => {
    const timer = setTimeout(() => setSlow(true), 20_000);
    return () => clearTimeout(timer);
  }, []);

  const steps = ['Open your wallet app', 'Tap Scan', 'Approve Campfire'];

  return (
    <div
      className="s-overlay"
      data-modal
      onPointerDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className="s-dialog" role="dialog" aria-modal="true" aria-labelledby={titleId} tabIndex={-1} ref={dialogRef}>
        <div className="cf-row" data-between data-nowrap>
          <h2 className="cf-heading" id={titleId}>
            Connect your wallet
          </h2>
          <button type="button" className="cf-copy" aria-label="Close" onClick={onClose}>
            Close
          </button>
        </div>
        {onPhone ? (
          <>
            {/* The phone may pause this page while the wallet is open; coming back lets it finish the pairing. */}
            <p className="cf-small cf-muted">
              Open your wallet app on this phone to pair. If it keeps saying it is connecting, come back to this tab.
            </p>
            <a className="cf-btn" data-variant="primary" data-block href={uri}>
              Open in wallet
            </a>
            <CopyButton value={uri} label="Copy pairing link" block />
            <details>
              <summary className="cf-small" style={{ cursor: 'pointer', fontWeight: 600 }}>
                Show QR code for another device
              </summary>
              <div style={{ display: 'grid', placeItems: 'center', paddingTop: 'var(--space-3)' }}>
                <PairingQr value={qrUri} />
              </div>
            </details>
          </>
        ) : (
          <>
            <div className="pr-scan">
              <ol className="pr-steps">
                {steps.map((step, i) => (
                  <li key={step} className="pr-step">
                    <span className="pr-dot" aria-hidden="true">
                      {i + 1}
                    </span>{' '}
                    <span>{step}</span>
                  </li>
                ))}
              </ol>
              <PairingQr value={qrUri} />
            </div>
            <details className="pr-fold">
              <summary className="cf-small pr-fold__summary">Can't scan?</summary>
              <div className="pr-fold__body">
                <p className="cf-small cf-muted">Copy this link into your wallet instead.</p>
                <div className="cf-well cf-row" data-between data-nowrap>
                  <span className="cf-mono" style={{ overflowWrap: 'anywhere' }} title={uri}>
                    {uri.length > 28 ? `${uri.slice(0, 20)}…${uri.slice(-4)}` : uri}
                  </span>
                  <CopyButton value={uri} />
                </div>
              </div>
            </details>
          </>
        )}
        <div className="cf-row">
          <Skeleton width={10} height={10} style={{ borderRadius: '50%' }} />
          <span className="cf-small cf-muted">Waiting for the wallet…</span>
        </div>
        {slow && <Notice>Nothing yet? Make sure the wallet app is open, then {onPhone ? 'try again' : 'scan again'}.</Notice>}
        <p className="cf-small cf-subtle">
          Connecting is your only sign-in. Campfire sees public keys, never private keys, and the wallet asks you
          before every transaction.
        </p>
      </div>
    </div>
  );
}

function PairingQr({ value }: { value: string }) {
  const [src, setSrc] = useState<string | null>(null);

  useEffect(() => {
    let current = true;
    // qrUri uses only QR alphanumeric characters, which keeps the code small and easy to scan.
    QRCode.toDataURL(value, { margin: 0, width: 352, color: { dark: '#1f1a15', light: '#ffffff' } }).then(
      (url) => current && setSrc(url),
      () => {},
    );
    return () => {
      current = false;
    };
  }, [value]);

  return (
    <div className="cf-qr" role="img" aria-label="Pairing QR code">
      {src && <img src={src} alt="" width={176} height={176} style={{ display: 'block', width: '100%', height: '100%' }} />}
    </div>
  );
}

// Shown under the header when pairing fails or the service cannot load the wallet.
export function WalletError() {
  const { error } = useWallet();
  if (!error) return null;
  return (
    <div className="s-walleterror">
      <Notice tone="danger" title={error.title}>
        {error.message}
      </Notice>
    </div>
  );
}

const BOTTOM_NAV: { to: string; label: string; icon: IconName }[] = [
  { to: '/', label: 'Home', icon: 'home' },
  { to: '/offers', label: 'Offers', icon: 'offers' },
  { to: '/trades', label: 'Trades', icon: 'trades' },
  { to: '/chats', label: 'Chats', icon: 'chats' },
];

// With a wallet and below 720px, the main sections move to a bar at the bottom (CSS hides it on wider screens).
// Trades counts the trades waiting for this person and Chats the unread messages, as in the header.
export function BottomNav() {
  return (
    <nav className="cf-bottomnav" aria-label="Main">
      {BOTTOM_NAV.map((item) => (
        <NavLink key={item.to} to={item.to} end={item.to === '/'}>
          <Icon name={item.icon} />
          {item.label}
          <NavBadge to={item.to} />
        </NavLink>
      ))}
    </nav>
  );
}


// "15 Nov 2026", as in the design. The service counts time in seconds.
const formatDate = (seconds: number) =>
  new Date(seconds * 1000).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
