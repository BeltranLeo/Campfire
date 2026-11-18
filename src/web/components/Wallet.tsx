import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { Link, NavLink } from 'react-router';
import QRCode from 'qrcode';
import { spendableBch, tokenBalance } from '../coins';
import { useConfig } from '../config';
import { formatBchBalance, fromBaseUnits } from '../format';
import { refreshWalletCoins, useWalletCoins } from '../walletCoins';
import { useWallet } from '../wallet';
import { CopyButton } from './CopyButton';
import { Icon, type IconName } from './Icon';
import { HashLink, shorten } from './Provenance';
import { Notice, Skeleton } from './States';

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
        {wallet.pairing && <PairingDialog uri={wallet.pairing.uri} qrUri={wallet.pairing.qrUri} onClose={wallet.disconnect} />}
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
        <span className="cf-mono cf-wallet__id">{shorten(wallet.identity)}</span>
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
          <Skeleton width={120} height={18} />
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

  return (
    <div className="s-menu" role="menu" ref={ref}>
      <div className="cf-stack" data-gap="1">
        <span className="cf-label">Your identity</span>
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
        <Link to="/welcome" onClick={onClose}>
          Preferences
        </Link>
        <Link to="/about" onClick={onClose}>
          About
        </Link>
        <Link to="/transparency" onClick={onClose}>
          Transparency
        </Link>
      </div>
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

  useEffect(() => {
    dialogRef.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

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
              Open Selene or Paytaca on this phone to pair. If the wallet keeps saying it is connecting, come back to
              this tab.
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
            <p className="cf-small cf-muted">Scan with Selene or Paytaca. Pairing uses WizardConnect.</p>
            <div style={{ display: 'grid', placeItems: 'center' }}>
              <PairingQr value={qrUri} />
            </div>
            <div className="cf-well cf-row" data-between data-nowrap>
              <span className="cf-mono" style={{ overflowWrap: 'anywhere' }} title={uri}>
                {uri.length > 28 ? `${uri.slice(0, 20)}…${uri.slice(-4)}` : uri}
              </span>
              <CopyButton value={uri} />
            </div>
          </>
        )}
        <div className="cf-row">
          <Skeleton width={10} height={10} style={{ borderRadius: '50%' }} />
          <span className="cf-small cf-muted">Waiting for the wallet…</span>
        </div>
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
];

// With a wallet and below 720px, the main sections move to a bar at the bottom (CSS hides it on wider screens).
export function BottomNav() {
  const { activeTrades } = useWallet();
  return (
    <nav className="cf-bottomnav" aria-label="Main">
      {BOTTOM_NAV.map((item) => (
        <NavLink key={item.to} to={item.to} end={item.to === '/'}>
          <Icon name={item.icon} />
          {item.label}
          {item.to === '/trades' && activeTrades ? <span className="cf-badge">{activeTrades}</span> : null}
        </NavLink>
      ))}
    </nav>
  );
}


// "15 Nov 2026", as in the design. The service counts time in seconds.
const formatDate = (seconds: number) =>
  new Date(seconds * 1000).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
