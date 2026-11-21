import { useState } from 'react';
import { Link, NavLink, Outlet, useLocation } from 'react-router';
import { BANNER_LINKS, PROTOCOL_SPEC_URL, REPO_URL, VOTING_ADDRESS } from '../links';
import { setLang, useLang, useMessages } from '../lang';
import type { Lang, Messages } from '../messages';
import { alertsOn, askToNotify, canAskToNotify, setAlertsOn } from '../alerts';
import { useWalletCoinsSync } from '../walletCoins';
import { useWallet } from '../wallet';
import logoDark from '../logos/logo-dark.svg';
import logoSymbol from '../logos/symbol-64.png';
import { AdvancedSwitch } from './AdvancedSwitch';
import { CopyButton } from './CopyButton';
import { Icon, type IconName } from './Icon';
import { NavBadge, NotificationsProvider } from './Notifications';
import { BottomNav, WalletButton, WalletError } from './Wallet';

// One nav with and without a wallet, so connecting only adds the `app` pages and a judge keeps How it works and
// Transparency while trading. Without a wallet the logo leads to the landing page at "/"; with one, "/" is Home.
// Trades counts the trades waiting for this person, Chats the unread messages (components/Notifications.tsx).
// Below 720px, with a wallet, this nav is hidden: BottomNav takes over and the wallet menu links the two site pages.
const NAV: { to: string; label: keyof Messages['nav']; app?: boolean }[] = [
  { to: '/', label: 'home', app: true },
  { to: '/offers', label: 'offers' },
  { to: '/trades', label: 'trades', app: true },
  { to: '/chats', label: 'chats', app: true },
  // The page is About, but a newcomer looks for how it works.
  { to: '/about', label: 'about' },
  { to: '/transparency', label: 'transparency' },
];

export function Shell() {
  const wallet = useWallet();
  const connected = wallet.status === 'connected';
  // One read of the wallet's coins feeds the balance in the header and the pages that need the coins.
  useWalletCoinsSync();
  const nav = NAV.filter((item) => connected || !item.app);
  const t = useMessages().nav;
  // The landing page (a visitor at "/") brings its own header and footer: only the hackathon banner stays above it.
  const landing = useLocation().pathname === '/' && wallet.status !== 'connected' && wallet.status !== 'connecting';

  // The provider is always there, so connecting or disconnecting never remounts the page; it is idle without a wallet.
  return (
    <NotificationsProvider identity={connected ? wallet.identity : null}>
      <Banner />
      {!landing && (
        <header className="cf-header">
          <div className="s-headerbar">
            {/* The logo is a file, never the word set in a font: the version for the night-blue header. */}
            <Link className="cf-logo" to="/" aria-label={t.logo}>
              <img src={logoDark} alt="" data-wordmark />
              {/* On a phone only the symbol shows, so the logo, the nav and the wallet button share one row. */}
              <img src={logoSymbol} alt="" data-symbol />
            </Link>
            <nav className="cf-nav" data-app={connected || undefined} aria-label={t.label}>
              {nav.map((item) => (
                // `end` keeps "/" from matching every route.
                <NavLink key={item.to} to={item.to} end={item.to === '/'}>
                  {t[item.label]}
                  {connected && <NavBadge to={item.to} />}
                </NavLink>
              ))}
            </nav>
            <span className="cf-grow" />
            <WalletButton />
          </div>
        </header>
      )}
      <WalletError />
      <Outlet />
      {!landing && <Footer />}
      {connected && <BottomNav />}
    </NotificationsProvider>
  );
}

// The hackathon banner is on every page, in English in both languages: it is for the judges. On a phone the four
// links fold behind one line, so the banner takes one row instead of four; it never disappears. The CashTokens
// address for the vote has a row of its own, in full and with a copy button, on every screen size.
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
    <>
      <div className="cf-banner">
        <strong>BCH BLAZE 2026 · Mainnet track</strong>
        <span className="s-desktoponly">{links}</span>
        <details className="s-bannerfold">
          <summary>Code &amp; demo</summary>
          {links}
        </details>
      </div>
      {VOTING_ADDRESS && (
        <div className="cf-banner s-bannervote">
          <span>Vote with CashTokens:</span>
          <span className="cf-mono s-bannervote__address">{VOTING_ADDRESS}</span>
          <CopyButton value={VOTING_ADDRESS} label="Copy" copiedLabel="Copied" />
        </div>
      )}
    </>
  );
}

// The hackathon banner above stays in English in both languages: it is for the judges.
function Footer() {
  const t = useMessages().footer;
  return (
    <footer className="cf-footer">
      <div className="s-footer">
        <div className="s-vote">
          <span className="cf-label">{t.vote}</span>
          <span className="cf-row" data-nowrap>
            <span className="cf-mono" style={{ overflowWrap: 'anywhere' }}>
              {VOTING_ADDRESS ?? 'bitcoincash:z[VOTING ADDRESS]'}
            </span>
            {VOTING_ADDRESS && <CopyButton value={VOTING_ADDRESS} />}
          </span>
        </div>
        <div className="cf-row" style={{ gap: 'var(--space-4)' }}>
          <a href={REPO_URL}>GitHub</a>
          <a href={PROTOCOL_SPEC_URL}>{t.spec}</a>
          <Link to="/roadmap">{t.roadmap}</Link>
          <span>{t.mainnet}</span>
        </div>
        {/* Display settings stay in view in one compact row, so nothing opens and the footer never shifts. The
            technical-details switch is here too, so a visitor without a wallet (a judge, say) sees it right away and
            can open every technical detail at once. */}
        <div className="s-footsettings">
          <LangSwitch />
          <AlertsSwitch />
          <AdvancedSwitch compact />
        </div>
      </div>
    </footer>
  );
}

// Sound and system notifications when a trade waits for this person (alerts.ts). Turning them on is a click, so it
// can ask for the browser's permission and play the sound once as a sample.
function AlertsSwitch() {
  const [on, setOn] = useState(alertsOn);
  // Sound is on by default; the browser's permission for system notifications is asked on the first click.
  const [askable, setAskable] = useState(canAskToNotify);
  const t = useMessages().footer;
  const label = !on ? t.alertsOff : askable ? t.alertsAsk : t.alertsOn;
  return (
    <div className="cf-seg" role="group" aria-label={t.alerts}>
      <button
        type="button"
        aria-pressed={on}
        aria-label={label}
        title={label}
        onClick={() => {
          if (on && askable) {
            void askToNotify().finally(() => setAskable(canAskToNotify()));
            return;
          }
          setOn(!on);
          void setAlertsOn(!on).finally(() => setAskable(canAskToNotify()));
        }}
      >
        <Icon name={on ? 'bell' : 'bellSlash'} />
      </button>
    </div>
  );
}

// Each language is named in itself, so someone who reads only one of them still finds theirs.
const LANG_OPTIONS: { value: Lang; short: string; name: string }[] = [
  { value: 'en', short: 'EN', name: 'English' },
  { value: 'es', short: 'ES', name: 'Español' },
];

function LangSwitch() {
  const lang = useLang();
  const t = useMessages().footer;
  return (
    <div className="cf-seg" role="group" aria-label={t.language}>
      {LANG_OPTIONS.map((option) => (
        <button
          key={option.value}
          type="button"
          lang={option.value}
          aria-pressed={lang === option.value}
          aria-label={option.name}
          title={option.name}
          onClick={() => setLang(option.value)}
        >
          {option.short}
        </button>
      ))}
    </div>
  );
}
