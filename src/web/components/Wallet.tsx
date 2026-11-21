import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Link, NavLink } from 'react-router';
import QRCode from 'qrcode';
import { aliasFor } from '../alias';
import { spendableBch, tokenBalance } from '../coins';
import { useConfig } from '../config';
import { formatBchBalance, fromBaseUnits } from '../format';
import { HIDDEN_AMOUNT, useHideBalance } from '../hideBalance';
import { refreshWalletCoins, scanPercent, useWalletCoins } from '../walletCoins';
import { useWallet } from '../wallet';
import { CopyButton } from './CopyButton';
import { Icon, type IconName } from './Icon';
import { HashLink } from './Provenance';
import { Notice, Skeleton } from './States';
import { NavBadge } from './Notifications';
import { useMessages } from '../lang';
import { BalanceEye } from './BalanceEye';
import { BalanceLoading } from './BalanceLoading';

// The WizardConnect button at the top right, in its four states (Shell-* screens):
// disconnected, pairing, connecting and connected with its menu.
export function WalletButton() {
  const wallet = useWallet();
  const [menuOpen, setMenuOpen] = useState(false);
  const closeMenu = useCallback(() => setMenuOpen(false), []);
  const msgs = useMessages();
  const t = msgs.wallet;

  if (wallet.status === 'disconnected') {
    return (
      <button type="button" className="cf-btn" onClick={wallet.connect}>
        {/* Spanish runs longer, and on a phone the button shares one row with the nav: there it says less. */}
        <span className="s-connect__long">{t.connect}</span>
        <span className="s-connect__short">{t.connectShort}</span>
      </button>
    );
  }

  if (wallet.status !== 'connected' || !wallet.identity) {
    const ts = msgs.signIn;
    return (
      <>
        <button type="button" className="cf-btn" aria-busy={!wallet.signInFailed}>
          {wallet.status === 'pairing'
            ? ts.pairing
            : wallet.signing
              ? ts.approving
              : wallet.signInFailed
                ? ts.needed
                : ts.connecting}
        </button>
        {/* A portal, because the header's backdrop-filter makes it the containing block of any fixed
            descendant: inside it the overlay shrinks to the header's height and the dialog cannot be reached. */}
        {wallet.pairing &&
          createPortal(
            <PairingDialog uri={wallet.pairing.uri} qrUri={wallet.pairing.qrUri} onClose={wallet.disconnect} />,
            document.body,
          )}
        {wallet.status === 'connecting' &&
          (wallet.signing || wallet.signInFailed) &&
          createPortal(
            <SignInDialog failed={!wallet.signing && wallet.signInFailed} onRetry={wallet.retrySignIn} onCancel={wallet.disconnect} />,
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

/** The wallet's BCH and PUSD as the shared scan reads them: "0.0412 BCH · 12.50 PUSD", or dots when hidden. */
function useBalanceText() {
  const coins = useWalletCoins();
  const config = useConfig();
  const hidden = useHideBalance();
  if (!coins.data) return { bch: null, pusd: null, failed: coins.error !== null };
  if (hidden) return { bch: HIDDEN_AMOUNT, pusd: config ? HIDDEN_AMOUNT : null, failed: false };
  const sats = spendableBch(coins.data.coins);
  const pusd = config ? fromBaseUnits(tokenBalance(coins.data.coins, config.pusdCategory), config.pusdDecimals) : null;
  return { bch: formatBchBalance(sats), pusd, failed: false };
}

function PillBalance() {
  const { bch, pusd, failed } = useBalanceText();
  const percent = scanPercent(useWalletCoins().progress);
  const percentText = useMessages().balanceLoading.percent;
  if (bch === null) {
    // Without a balance the wallet still works: the dash says it could not be read, the percent (or the bar,
    // until the scan knows how many addresses there are) says it is loading.
    if (failed) return <span className="cf-subtle cf-wallet__bal">— BCH</span>;
    if (percent !== null) return <span className="cf-subtle cf-wallet__bal cf-num">{percentText(percent)}</span>;
    return <Skeleton width={84} height={12} style={{ display: 'inline-block' }} />;
  }
  return (
    <span className="cf-wallet__bal">
      {bch} BCH{pusd !== null && <span className="cf-subtle"> · {pusd} PUSD</span>}
    </span>
  );
}

// The balance leads the menu: it is what people open it for. The explanation of where it comes from stays on Home.
function MenuBalance() {
  const { bch, pusd, failed } = useBalanceText();
  const { progress } = useWalletCoins();
  return (
    <div className="cf-well s-menu__balance">
      <span className="s-balancehead">
        <span className="cf-label">Balance</span>
        <BalanceEye />
      </span>
      {bch === null ? (
        failed ? (
          <>
            <strong className="s-menu__bch cf-muted">— BCH</strong>
            <span className="cf-small cf-muted">
              Could not read it. Trading still works.{' '}
              <button type="button" className="cf-copy" onClick={() => void refreshWalletCoins()}>
                Try again
              </button>
            </span>
          </>
        ) : (
          <BalanceLoading progress={progress} variant="menu" />
        )
      ) : (
        <>
          <strong className="s-menu__bch">{bch} BCH</strong>
          {pusd !== null && <span className="s-menu__pusd">{pusd} PUSD</span>}
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

  // Order: who you are (one row), what you hold, your record, your trades. Explanations fold behind a "?" or live on
  // About. How it works and Transparency are in the header nav (and here on a phone), the technical-details switch in the footer.
  return (
    <div className="s-menu" role="menu" ref={ref}>
      <div className="s-menu__id">
        <span className="o-avatar" aria-hidden="true">
          {alias.initials}
        </span>
        <span className="s-menu__who">
          <span className="s-term">
            <strong>{alias.name}</strong>
            <details>
              <summary aria-label="Where does this name come from?">?</summary>
              <span className="s-term__text">
                The name others see on your offers and trades. It comes from your wallet, so it never changes and nobody
                can pick it.
              </span>
            </details>
          </span>
          <span className="cf-row" data-nowrap>
            <HashLink value={wallet.identity} kind="plain" />
            <CopyButton value={wallet.identity} />
          </span>
        </span>
      </div>
      <MenuBalance />
      {rep && (
        <div className="cf-stack" data-gap="1">
          {rep.completedAsBuyer + rep.completedAsSeller > 0 ? (
            <span className="cf-small">
              <strong>{rep.completedAsBuyer}</strong> bought · <strong>{rep.completedAsSeller}</strong> sold
              {rep.firstCompletedAt !== null && ` · since ${formatDate(rep.firstCompletedAt)}`}
            </span>
          ) : (
            <span className="cf-small">No trades yet</span>
          )}
          {/* The count is not on-chain, so it must never read as proof (About explains how it can be inflated). */}
          <span className="cf-small cf-subtle">Counted by Campfire, not verifiable on-chain.</span>
        </div>
      )}
      <Link className="cf-btn" data-block to="/trades" onClick={onClose}>
        {wallet.activeTrades ? `My trades · ${wallet.activeTrades} active` : 'My trades'}
      </Link>
      {/* On a phone the header nav gives way to the balance and BottomNav, so these two pages are linked here. */}
      <div className="s-mobileonly s-menu__links">
        <Link to="/about" onClick={onClose}>
          How it works
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
// On a computer the QR code is the way in, with the same link in plain view below it: some wallets take it pasted,
// and a wallet on this computer opens it directly (a BCH Blaze judge asked for it).
function PairingDialog({ uri, qrUri, onClose }: { uri: string; qrUri: string; onClose: () => void }) {
  const titleId = useId();
  const dialogRef = useRef<HTMLDivElement>(null);
  const [onPhone] = useState(() => window.matchMedia('(hover: none) and (pointer: coarse)').matches);
  const [slow, setSlow] = useState(false);
  const t = useMessages().pairing;

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
            {t.title}
          </h2>
          <button type="button" className="cf-copy" aria-label={t.close} onClick={onClose}>
            {t.close}
          </button>
        </div>
        {onPhone ? (
          <>
            {/* The phone may pause this page while the wallet is open; coming back lets it finish the pairing. */}
            <p className="cf-small cf-muted">{t.phoneHint}</p>
            <a className="cf-btn" data-variant="primary" data-block href={uri}>
              {t.openInWallet}
            </a>
            <CopyButton value={uri} label={t.copyPairingLink} block />
            <details>
              <summary className="cf-small" style={{ cursor: 'pointer', fontWeight: 600 }}>
                {t.showQr}
              </summary>
              <div style={{ display: 'grid', placeItems: 'center', paddingTop: 'var(--space-3)' }}>
                <PairingQr value={qrUri} label={t.qrLabel} />
              </div>
            </details>
          </>
        ) : (
          <>
            <div className="pr-scan">
              <ol className="pr-steps">
                {t.steps.map((step, i) => (
                  <li key={step} className="pr-step">
                    <span className="pr-dot" aria-hidden="true">
                      {i + 1}
                    </span>{' '}
                    <span>{step}</span>
                  </li>
                ))}
              </ol>
              <PairingQr value={qrUri} label={t.qrLabel} />
            </div>
            {/* The whole string is shown, not shortened: people check what they paste, and it wraps in the well. */}
            <div className="pr-link">
              <strong className="cf-small">{t.linkTitle}</strong>
              <p className="cf-small cf-muted">{t.linkHint}</p>
              <div className="cf-well pr-link__value">
                <span className="cf-mono">{uri}</span>
              </div>
              <div className="cf-row">
                <CopyButton value={uri} label={t.copyLink} />
                <a className="cf-copy" href={uri}>
                  {t.openInWallet}
                </a>
              </div>
            </div>
          </>
        )}
        <div className="cf-row">
          <Skeleton width={10} height={10} style={{ borderRadius: '50%' }} />
          <span className="cf-small cf-muted">{t.waiting}</span>
        </div>
        {slow && <Notice>{onPhone ? t.slowPhone : t.slowDesktop}</Notice>}
        <p className="cf-small cf-subtle">{t.privacy}</p>
      </div>
    </div>
  );
}

// After pairing, the service asks the wallet to sign a challenge that proves the keys are this person's. Without this
// dialog the page only showed a skeleton and the header button, and people did not know their wallet was waiting.
// The wallet shows the request as a transaction to sign, so the text says why it is safe: the coin it spends does not
// exist, so it can never be broadcast, costs nothing and moves no funds.
function SignInDialog({ failed, onRetry, onCancel }: { failed: boolean; onRetry: () => void; onCancel: () => void }) {
  const titleId = useId();
  const dialogRef = useRef<HTMLDivElement>(null);
  const t = useMessages().signIn;

  useEffect(() => {
    dialogRef.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onCancel();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onCancel]);

  // Not closed by a click outside: one stray tap would cancel a sign-in the wallet may already be showing.
  return (
    <div className="s-overlay" data-modal>
      <div className="s-dialog" role="dialog" aria-modal="true" aria-labelledby={titleId} tabIndex={-1} ref={dialogRef}>
        <div className="cf-stack" data-gap="1">
          <span className="cf-label">{t.label}</span>
          <h2 className="cf-heading" id={titleId} style={{ margin: 0 }}>
            {failed ? t.failedTitle : t.title}
          </h2>
        </div>
        {failed ? (
          <Notice tone="attention">{t.failed}</Notice>
        ) : (
          <p className="cf-small cf-muted">{t.intro}</p>
        )}
        {!failed && (
          // flex: none, because .pr-steps grows to fill the pairing dialog's row and here it sits in a column.
          <ol className="pr-steps" style={{ flex: 'none' }}>
            {t.steps.map((step, i) => (
              <li key={step} className="pr-step">
                <span className="pr-dot" aria-hidden="true">
                  {i + 1}
                </span>{' '}
                <span>{step}</span>
              </li>
            ))}
          </ol>
        )}
        <div className="cf-well cf-stack" data-gap="1">
          <strong className="cf-small">{t.freeTitle}</strong>
          <span className="cf-small cf-muted">{t.free}</span>
        </div>
        {failed ? (
          <button type="button" className="cf-btn" data-variant="primary" data-block onClick={onRetry}>
            {t.retry}
          </button>
        ) : (
          <div className="cf-row">
            <Skeleton width={10} height={10} style={{ borderRadius: '50%' }} />
            <span className="cf-small cf-muted">{t.waiting}</span>
          </div>
        )}
        <button type="button" className="cf-btn" data-variant="ghost" data-block onClick={onCancel}>
          {t.cancel}
        </button>
        <p className="cf-small cf-subtle">{t.once}</p>
      </div>
    </div>
  );
}

function PairingQr({ value, label }: { value: string; label: string }) {
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
    <div className="cf-qr" role="img" aria-label={label}>
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
