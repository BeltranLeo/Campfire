import { useState } from 'react';
import { Link, NavLink, Outlet } from 'react-router';
import { BANNER_LINKS, PROTOCOL_SPEC_URL, REPO_URL, VOTING_ADDRESS } from '../links';
import { getThemePref, setThemePref, type ThemePref } from '../theme';
import { useWalletCoinsSync } from '../walletCoins';
import { useWallet } from '../wallet';
import logoDark from '../logos/logo-dark.svg';
import logoLight from '../logos/logo-light.png';
import logoSymbol from '../logos/symbol-64.png';
import { AdvancedSwitch } from './AdvancedSwitch';
import { CopyButton } from './CopyButton';
import { NavBadge, NotificationsProvider } from './Notifications';
import { BottomNav, WalletButton, WalletError } from './Wallet';

// Visitors without a wallet see the public pages; the logo leads back to the landing page at "/".
const PUBLIC_NAV = [
  { to: '/offers', label: 'Offers' },
  // The page is About, but a newcomer looks for how it works.
  { to: '/about', label: 'How it works' },
  { to: '/transparency', label: 'Transparency' },
];

// With a wallet, "/" becomes Home. Below 720px this nav is hidden and BottomNav takes over. Trades counts the trades
// waiting for this person, Chats the unread messages (components/Notifications.tsx).
const APP_NAV = [
  { to: '/', label: 'Home' },
  { to: '/offers', label: 'Offers' },
  { to: '/trades', label: 'Trades' },
  { to: '/chats', label: 'Chats' },
];

export function Shell() {
  const wallet = useWallet();
  const connected = wallet.status === 'connected';
  // One read of the wallet's coins feeds the balance in the header and the pages that need the coins.
  useWalletCoinsSync();
  const nav = connected ? APP_NAV : PUBLIC_NAV;

  // The provider is always there, so connecting or disconnecting never remounts the page; it is idle without a wallet.
  return (
    <NotificationsProvider identity={connected ? wallet.identity : null}>
      <Banner />
      <header className="cf-header">
        <div className="s-headerbar">
          {/* The logo is a file, never the word set in a font. CSS shows the one that matches the theme. */}
          <Link className="cf-logo" to="/" aria-label="Campfire, home">
            <img src={logoLight} alt="" data-theme-only="light" />
            <img src={logoDark} alt="" data-theme-only="dark" />
            {/* On a phone only the symbol shows, so the logo, the nav and the wallet button share one row. */}
            <img src={logoSymbol} alt="" data-symbol />
          </Link>
          <nav className="cf-nav" data-app={connected || undefined} aria-label="Main">
            {nav.map((item) => (
              // `end` keeps "/" from matching every route.
              <NavLink key={item.to} to={item.to} end={item.to === '/'}>
                {item.label}
                {connected && <NavBadge to={item.to} />}
              </NavLink>
            ))}
          </nav>
          <span className="cf-grow" />
          <WalletButton />
        </div>
      </header>
      <WalletError />
      <Outlet />
      <Footer />
      {connected && <BottomNav />}
    </NotificationsProvider>
  );
}

// The hackathon banner is on every page. On a phone the four links fold behind one line, so the banner takes one
// row instead of four; it never disappears.
function Banner() {
  const links = (
    <span className="cf-banner__links">
      {BANNER_LINKS.map((link) =>
        link.url ? (
          <a key={link.label} href={link.url} target="_blank" rel="noreferrer">
            {link.label}
          </a>
        ) : (
          <span key={link.label}>{link.label}</span>
        ),
      )}
    </span>
  );
  return (
    <div className="cf-banner">
      <strong>BCH BLAZE 2026 · Mainnet track</strong>
      <span className="s-desktoponly">{links}</span>
      <details className="s-bannerfold">
        <summary>Code &amp; demo</summary>
        {links}
      </details>
    </div>
  );
}

function Footer() {
  return (
    <footer className="cf-footer">
      <div className="s-footer">
        <div className="s-vote">
          <span className="cf-label">Vote for Campfire with CashTokens</span>
          <span className="cf-row" data-nowrap>
            <span className="cf-mono" style={{ overflowWrap: 'anywhere' }}>
              {VOTING_ADDRESS ?? 'bitcoincash:z[VOTING ADDRESS]'}
            </span>
            {VOTING_ADDRESS && <CopyButton value={VOTING_ADDRESS} />}
          </span>
        </div>
        <div className="cf-row" style={{ gap: 'var(--space-4)' }}>
          <a href={REPO_URL}>GitHub</a>
          <a href={PROTOCOL_SPEC_URL}>Protocol spec</a>
          <span>Mainnet. Real funds.</span>
        </div>
        {/* Display settings fold into one line so the footer stays short on a phone. The technical-details switch is
            also here, so a visitor without a wallet (a judge, say) can open every technical detail at once. */}
        <details className="s-footsettings">
          <summary>Display settings</summary>
          <div className="s-footsettings__body">
            <ThemeSwitch />
            <AdvancedSwitch compact />
          </div>
        </details>
      </div>
    </footer>
  );
}

const THEME_OPTIONS: { value: ThemePref; label: string }[] = [
  { value: 'system', label: 'System' },
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' },
];

function ThemeSwitch() {
  const [pref, setPref] = useState(getThemePref);
  return (
    <div className="cf-seg" role="group" aria-label="Theme">
      {THEME_OPTIONS.map((option) => (
        <button
          key={option.value}
          type="button"
          aria-pressed={pref === option.value}
          onClick={() => {
            setThemePref(option.value);
            setPref(option.value);
          }}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}
