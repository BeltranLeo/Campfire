import type { ReactNode } from 'react';
import { Link } from 'react-router';
import { PROTOCOL_SPEC_URL, REPO_URL } from '../links';

// What comes after the beta. Nothing listed here works yet, and every row says "Planned", so the page is never read as
// a list of features. What works today is on About and Transparency.

export function Roadmap() {
  return (
    <main className="s-main" data-site data-narrow>
      <div className="s-pagehead">
        <h1 className="cf-display">Roadmap</h1>
        <p className="cf-muted">
          Campfire is in beta. Expect big changes, and expect some of them to break things you are used to. This page lists
          what we plan to build next. None of it works yet.
        </p>
        <p className="cf-small cf-muted">
          What works today is explained on <Link to="/about">How it works</Link>, and every real transaction is on the{' '}
          <Link to="/transparency">transparency page</Link>.
        </p>
      </div>

      <Section title="Offers and disputes">
        <Item title="Offer documents on public IPFS">
          Today the service stores each offer’s document and serves it by its hash. Pinning it to IPFS keeps it available
          even if the service goes away.
        </Item>
        <Item title="Independent arbiters and price oracles">
          An offer can already name any arbiter and any oracle by its key. A place to find them and choose one is missing;
          for now Campfire is both.
        </Item>
        <Item title="Split verdicts">
          Today the arbiter can only give all the coins to one side. A split would fit disputes where both are partly
          right.
        </Item>
      </Section>

      <Section title="Fees and reputation">
        <Item title="Lower fees for good traders">
          The more trades you complete, the lower your fees. Trades between two wallets of the same person will not count.
        </Item>
        <Item title="A fuller reputation">
          Today Campfire counts completed trades, and a second wallet can inflate that count. Next: ratings, volume and the
          number of different people someone has traded with.
        </Item>
        <Item title="Choose your own name">
          A name you pick, signed by your wallet and unique across Campfire, instead of the one made from your identity.
        </Item>
      </Section>

      <Section title="More ways to trade">
        <Item title="More currencies">
          Offers are priced in Argentine pesos or US dollars today. More local currencies, with a market price from the
          oracle or a fixed price set by the seller.
        </Item>
        <Item title="Notifications when Campfire is closed">
          Today you are told about a new request or message only while the page is open. A buyer should also hear when a
          seller takes their offer, and have longer to accept it.
        </Item>
        <Item title="Campfire in more languages">
          Today only the front page, the menus and the welcome screen can be read in Spanish, and the rest is in English.
          Next: every page, and more languages.
        </Item>
      </Section>

      <Section title="Privacy">
        <Item title="More privacy tools">
          Each trade already uses a new key and a new address of your wallet. Further tools would make trades harder to link
          together.
        </Item>
      </Section>

      <p className="cf-small cf-subtle">
        The design behind these plans is in the <a href={PROTOCOL_SPEC_URL}>protocol spec</a>. Campfire is open source:{' '}
        <a href={REPO_URL}>github.com/BeltranLeo/Campfire</a>.
      </p>
    </main>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="cf-card cf-stack" data-pad>
      <h2 className="cf-heading">{title}</h2>
      <ul className="cf-stack" data-gap="4" style={{ margin: 0, padding: 0, listStyle: 'none' }}>
        {children}
      </ul>
    </section>
  );
}

function Item({ title, children }: { title: string; children: ReactNode }) {
  return (
    <li className="cf-stack" data-gap="1">
      {/* The tag stays beside the title, even when a long title wraps on a phone. */}
      <div className="cf-row" data-between data-nowrap style={{ alignItems: 'flex-start' }}>
        <strong>{title}</strong>
        <span className="cf-pill">Planned</span>
      </div>
      <p className="cf-small cf-muted" style={{ margin: 0 }}>
        {children}
      </p>
    </li>
  );
}
