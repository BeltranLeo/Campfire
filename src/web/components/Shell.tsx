import { useState } from 'react';
import logoNight from '../brand/logo-night.png';
import { Link, NavLink, Outlet } from 'react-router';
import { BANNER_LINKS, PROTOCOL_SPEC_URL, REPO_URL, VOTING_ADDRESS } from '../links';
import { useWalletCoinsSync } from '../walletCoins';
import { useWallet } from '../wallet';
import { AdvancedSwitch } from './AdvancedSwitch';
import { CopyButton } from './CopyButton';
import { BottomNav, WalletButton, WalletError } from './Wallet';

// Visitors without a wallet see the public pages; the logo leads back to the landing page at "/".
const PUBLIC_NAV = [
  { to: '/offers', label: 'Offers' },
  // The page is About, but a newcomer looks for how it works.
  { to: '/about', label: 'How it works' },
  { to: '/transparency', label: 'Transparency' },
];

// With a wallet, "/" becomes Home. Below 720px this nav is hidden and BottomNav takes over.
// Chats is left out until the page exists: a link to an unbuilt page reads as a hidden mock-up.
const APP_NAV = [
  { to: '/', label: 'Home' },
  { to: '/offers', label: 'Offers' },
  { to: '/trades', label: 'Trades' },
];

export function Shell() {
  const connected = useWallet().status === 'connected';
  // One read of the wallet's coins feeds the balance in the header and the pages that need the coins.
  useWalletCoinsSync();
  const nav = connected ? APP_NAV : PUBLIC_NAV;

  return (
    <>
      <Banner />
      {/* Two levels: the brand and the wallet on the logo's own night blue, then the page links on light glass. */}
      <header className="cf-header">
        <div className="s-headerbar">
          <Link className="cf-logo" to="/" aria-label="Campfire home">
            <img src={logoNight} alt="Campfire" />
          </Link>
          <span className="cf-grow" />
          <WalletButton />
        </div>
      </header>
      <div className="cf-subnav" data-app={connected || undefined}>
        <nav className="cf-nav s-headerbar" aria-label="Main">
          {nav.map((item) => (
            // `end` keeps "/" from matching every route.
            <NavLink key={item.to} to={item.to} end={item.to === '/'}>
              {item.label}
            </NavLink>
          ))}
        </nav>
      </div>
      <WalletError />
      <Outlet />
      <Footer />
      {connected && <BottomNav />}
    </>
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
          {/* Also here, so a visitor without a wallet (a judge, say) can open every technical detail at once. */}
          <AdvancedSwitch compact />
        </div>
      </div>
    </footer>
  );
}

