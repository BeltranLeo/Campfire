import { Route, Routes } from 'react-router';
import { Shell } from './components/Shell';
import { DevComponents } from './pages/DevComponents';
import { NotBuilt } from './pages/NotBuilt';
import { Offers } from './pages/Offers';
import { Take } from './pages/Take';
import { TradePage } from './pages/TradePage';

// Every route from the design handoff. Pages that are not built yet say so instead of showing a mock-up.
export function App() {
  return (
    <Routes>
      <Route element={<Shell />}>
        <Route index element={<NotBuilt title="Campfire" />} />
        <Route path="welcome" element={<NotBuilt title="Welcome" />} />
        <Route path="offers" element={<Offers />} />
        <Route path="offers/new" element={<NotBuilt title="New offer" />} />
        <Route path="offers/:offerTxid" element={<Take />} />
        <Route path="trade/:id" element={<TradePage />} />
        <Route path="trade/:id/arbiter" element={<NotBuilt title="Arbiter console" />} />
        <Route path="trades" element={<NotBuilt title="My trades" />} />
        <Route path="chats" element={<NotBuilt title="Chats" />} />
        <Route path="help" element={<NotBuilt title="Help" />} />
        <Route path="transparency" element={<NotBuilt title="Transparency" />} />
        {import.meta.env.DEV && <Route path="dev/components" element={<DevComponents />} />}
        <Route path="*" element={<NotBuilt title="Page not found" />} />
      </Route>
    </Routes>
  );
}
