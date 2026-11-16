import { Route, Routes } from 'react-router';
import { Shell } from './components/Shell';
import { NotBuilt } from './pages/NotBuilt';

// Every route from the design handoff. Pages that are not built yet say so instead of showing a mock-up.
export function App() {
  return (
    <Routes>
      <Route element={<Shell />}>
        <Route index element={<NotBuilt title="Campfire" />} />
        <Route path="welcome" element={<NotBuilt title="Welcome" />} />
        <Route path="offers" element={<NotBuilt title="Offers" />} />
        <Route path="offers/new" element={<NotBuilt title="New offer" />} />
        <Route path="offers/:offerTxid" element={<NotBuilt title="Offer" />} />
        <Route path="trade/:id" element={<NotBuilt title="Trade" />} />
        <Route path="trade/:id/arbiter" element={<NotBuilt title="Arbiter console" />} />
        <Route path="trades" element={<NotBuilt title="My trades" />} />
        <Route path="chats" element={<NotBuilt title="Chats" />} />
        <Route path="help" element={<NotBuilt title="Help" />} />
        <Route path="transparency" element={<NotBuilt title="Transparency" />} />
        <Route path="*" element={<NotBuilt title="Page not found" />} />
      </Route>
    </Routes>
  );
}
