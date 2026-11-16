import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { HashRouter } from 'react-router';
import { App } from './App';
import './styles/tokens.css';
import './styles/components.css';
import './styles/screens.css';
import './styles/app.css';

// Hash routing keeps every page under index.html, so Vercel needs no rewrites besides /api.
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <HashRouter>
      <App />
    </HashRouter>
  </StrictMode>,
);
