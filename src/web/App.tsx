import { Navigate, Route, Routes } from 'react-router';
import { Shell } from './components/Shell';
import { About } from './pages/About';
import { Arbiter } from './pages/Arbiter';
import { ArbiterList } from './pages/ArbiterList';
import { Chats } from './pages/Chats';
import { CreateOffer } from './pages/CreateOffer';
import { DevComponents } from './pages/DevComponents';
import { Home } from './pages/Home';
import { Landing } from './pages/Landing';
import { MyTrades } from './pages/MyTrades';
import { NotBuilt } from './pages/NotBuilt';
import { Offers } from './pages/Offers';
import { Take } from './pages/Take';
import { TradePage } from './pages/TradePage';
import { Welcome } from './pages/Welcome';
import { Transparency } from './pages/Transparency';
import { Skeleton } from './components/States';
import { useWallet } from './wallet';

// "/" is the front page for a visitor and Home for a connected wallet. While a saved wallet reconnects, neither
// is drawn, so a returning person does not see the front page for a moment first.
function Front() {
  const { status } = useWallet();
  if (status === 'connected') return <Home />;
  if (status === 'connecting') {
    return (
      <main className="s-main" aria-busy="true">
        <div className="s-pagehead">
          <Skeleton width={180} height={36} />
        </div>
        <section className="cf-card" data-pad>
          <div className="cf-stack" data-gap="2">
            <Skeleton width="35%" height={18} />
            <Skeleton width="55%" height={36} />
          </div>
        </section>
      </main>
    );
  }
  return <Landing />;
}

// Every route from the design handoff. Pages that are not built yet say so instead of showing a mock-up.
export function App() {
  return (
    <Routes>
      <Route element={<Shell />}>
        <Route index element={<Front />} />
        <Route path="welcome" element={<Welcome />} />
        <Route path="offers" element={<Offers />} />
        <Route path="offers/new" element={<CreateOffer />} />
        <Route path="offers/:offerTxid" element={<Take />} />
        <Route path="trade/:id" element={<TradePage />} />
        <Route path="trade/:id/arbiter" element={<Arbiter />} />
        <Route path="arbiter" element={<ArbiterList />} />
        <Route path="trades" element={<MyTrades />} />
        <Route path="chats" element={<Chats />} />
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
