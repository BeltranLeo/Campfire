import { useState } from 'react';
import { Link, NavLink, Outlet } from 'react-router';
import { BANNER_LINKS, PROTOCOL_SPEC_URL, REPO_URL, VOTING_ADDRESS } from '../links';
import { getThemePref, setThemePref, type ThemePref } from '../theme';
import { useWalletCoinsSync } from '../walletCoins';
import { useWallet } from '../wallet';
import { CopyButton } from './CopyButton';
import { BottomNav, WalletButton, WalletError } from './Wallet';

// Visitors without a wallet see the public pages; the logo leads back to the landing page at "/".
const PUBLIC_NAV = [
  { to: '/offers', label: 'Offers' },
  { to: '/about', label: 'About' },
  { to: '/transparency', label: 'Transparency' },
];

// With a wallet, "/" becomes Home. Below 720px this nav is hidden and BottomNav takes over.
const APP_NAV = [
  { to: '/', label: 'Home' },
  { to: '/offers', label: 'Offers' },
  { to: '/trades', label: 'Trades' },
  { to: '/chats', label: 'Chats' },
];

export function Shell() {
  const connected = useWallet().status === 'connected';
  // One read of the wallet's coins feeds the balance in the header and the pages that need the coins.
  useWalletCoinsSync();
  const nav = connected ? APP_NAV : PUBLIC_NAV;

  return (
    <>
      <Banner />
      <header className="cf-header">
        <div className="s-headerbar">
          <Link className="cf-logo" to="/">
            Campfire
          </Link>
          <nav className="cf-nav" data-app={connected || undefined} aria-label="Main">
            {nav.map((item) => (
              // `end` keeps "/" from matching every route.
              <NavLink key={item.to} to={item.to} end={item.to === '/'}>
                {item.label}
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
    </>
  );
}

function Banner() {
  return (
    <div className="cf-banner">
      <strong>BCH BLAZE 2026 · Mainnet track</strong>
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
          <ThemeSwitch />
        </div>
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
