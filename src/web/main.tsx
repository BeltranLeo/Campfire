import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { HashRouter } from 'react-router';
import { App } from './App';
import { readLang } from './lang';
import { startWallet, walletPageShown } from './wallet';
import './styles/tokens.css';
import './styles/components.css';
import './styles/screens.css';
import './styles/offers.css';
import './styles/take.css';
import './styles/create.css';
import './styles/welcome.css';
import './styles/pairing.css';
import './styles/home.css';
import './styles/chat.css';
import './styles/chats.css';
import './styles/notifications.css';
import './styles/app.css';
import './styles/lang.css';
import './styles/brand.css';

// Resume a wallet paired on an earlier visit before the first render.
startWallet();
// A phone pauses a hidden page; a pairing that waited while the wallet app was open resumes when the page is back.
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') walletPageShown();
});
// Pick the interface language (a ?lang= link, then this browser's choice, then English) before the first render.
readLang();

// Hash routing keeps every page under index.html, so Vercel needs no rewrites besides /api.
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <HashRouter>
      <App />
    </HashRouter>
  </StrictMode>,
);
