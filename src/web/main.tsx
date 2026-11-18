import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { HashRouter } from 'react-router';
import { App } from './App';
import { startWallet } from './wallet';
import './styles/tokens.css';
import './styles/components.css';
import './styles/screens.css';
import './styles/offers.css';
import './styles/take.css';
import './styles/create.css';
import './styles/welcome.css';
import './styles/app.css';

// Resume a wallet paired on an earlier visit before the first render.
startWallet();

// Hash routing keeps every page under index.html, so Vercel needs no rewrites besides /api.
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <HashRouter>
      <App />
    </HashRouter>
  </StrictMode>,
);
