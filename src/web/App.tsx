import { Navigate, Route, Routes } from 'react-router';
import { Shell } from './components/Shell';
import { About } from './pages/About';
import { DevComponents } from './pages/DevComponents';
import { Landing } from './pages/Landing';
import { NotBuilt } from './pages/NotBuilt';
import { Offers } from './pages/Offers';
import { Take } from './pages/Take';
import { TradePage } from './pages/TradePage';
import { Transparency } from './pages/Transparency';

// Every route from the design handoff. Pages that are not built yet say so instead of showing a mock-up.
export function App() {
  return (
    <Routes>
      <Route element={<Shell />}>
        <Route index element={<Landing />} />
        <Route path="welcome" element={<NotBuilt title="Welcome" />} />
        <Route path="offers" element={<Offers />} />
        <Route path="offers/new" element={<NotBuilt title="New offer" />} />
        <Route path="offers/:offerTxid" element={<Take />} />
        <Route path="trade/:id" element={<TradePage />} />
        <Route path="trade/:id/arbiter" element={<NotBuilt title="Arbiter console" />} />
        <Route path="trades" element={<NotBuilt title="My trades" />} />
        <Route path="chats" element={<NotBuilt title="Chats" />} />
        <Route path="about" element={<About />} />
        {/* The design's Help FAQ lives at the end of About. */}
        <Route path="help" element={<Navigate to="/about" replace />} />
        <Route path="transparency" element={<Transparency />} />
        {import.meta.env.DEV && <Route path="dev/components" element={<DevComponents />} />}
        <Route path="*" element={<NotBuilt title="Page not found" />} />
      </Route>
    </Routes>
  );
}
