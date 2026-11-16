// Development-only gallery of the base components, to check them against the design in both themes.
// The route exists only on the dev server (see App.tsx); it is never part of the deployed app.

import type { ReactNode } from 'react';
import type { TradeState } from '../api';
import { Button } from '../components/Button';
import { Details } from '../components/Details';
import { Icon, type IconName } from '../components/Icon';
import { HashLink, ProvenanceTag, SimBox } from '../components/Provenance';
import { EmptyState, Notice, Skeleton } from '../components/States';
import { StatusPill, type TradeRole } from '../components/StatusPill';

const STATES: TradeState[] = [
  'Requested',
  'Accepted',
  'Funded',
  'Paid',
  'Disputed',
  'Released',
  'ResolvedBuyer',
  'ResolvedSeller',
  'Refunded',
  'Cancelled',
  'Dropped',
];
const ROLES: TradeRole[] = ['buyer', 'seller', 'visitor'];
const ICONS: IconName[] = ['home', 'offers', 'trades', 'chats', 'shield', 'buy', 'sell', 'help'];

// Sample values only for this page; they are not real transactions.
const SAMPLE_TX = '4f1c9a0000000000000000000000000000000000000000000000000000e07b';
const SAMPLE_ADDRESS = 'bitcoincash:qz8k4n0000000000000000000000000000w3ue';
const SAMPLE_ID = 'a3f9c20000000000000000000000000000000000000000000000000000c21e';

export function DevComponents() {
  return (
    <main className="s-main">
      <div className="s-pagehead">
        <h1 className="cf-display">Components</h1>
        <p className="cf-muted">Development gallery. Sample values, not real data.</p>
      </div>

      <Section title="Provenance">
        <div className="cf-row">
          <ProvenanceTag kind="chain" />
          <ProvenanceTag kind="sim" />
          <ProvenanceTag kind="offchain" />
          <ProvenanceTag kind="chain">Real escrow on mainnet</ProvenanceTag>
          <ProvenanceTag kind="sim">Demo seller · simulated fiat</ProvenanceTag>
        </div>
        <div className="cf-row">
          <HashLink value={SAMPLE_TX} kind="transaction" />
          <HashLink value={SAMPLE_ADDRESS} kind="address" />
          <HashLink value={SAMPLE_ID} kind="plain" />
        </div>
        <SimBox label="Demo payment details. Do not send any money.">
          <dl className="cf-dl">
            <dt>Method</dt>
            <dd>simulated</dd>
            <dt>Reference</dt>
            <dd>
              <span className="cf-mono">DEMO-9F3A21C0</span>
            </dd>
          </dl>
        </SimBox>
      </Section>

      <Section title="Buttons">
        <div className="s-actions">
          <Button variant="primary" note="No signature needed. This step is off-chain.">
            Mark as paid
          </Button>
          <Button>Open dispute</Button>
          <Button variant="danger" signs="Signs in your wallet. Returns the funds to the seller.">
            Cancel trade
          </Button>
        </div>
        <div className="s-actions">
          <Button variant="primary" signs busy>
            Release 20,000 sats to buyer
          </Button>
          <Button variant="ghost">Ghost</Button>
          <Button size="sm">Small</Button>
          <Button disabled>Disabled</Button>
        </div>
      </Section>

      <Section title="Status pills">
        {ROLES.map((role) => (
          <div key={role} className="cf-row">
            <span className="cf-label" style={{ width: 64 }}>
              {role}
            </span>
            {STATES.map((state) => (
              <StatusPill key={state} state={state} role={role} />
            ))}
          </div>
        ))}
      </Section>

      <Section title="Notices">
        <Notice>Deposit seen, not confirmed yet.</Notice>
        <Notice tone="warn" title="Payment window ends soon">
          Mark the trade as paid only after sending the money.
        </Notice>
        <Notice tone="danger" title="We could not load the offers">
          The server did not answer. Offers are published on-chain, so nothing is lost.
        </Notice>
        <Notice tone="chain" title="Completed">
          The escrow paid the buyer.
        </Notice>
      </Section>

      <Section title="Loading and empty">
        <div className="cf-stack" data-gap="2">
          <Skeleton width="70%" />
          <Skeleton width="45%" />
          <Skeleton width={76} height={44} />
        </div>
        <EmptyState title="No active trades" action={<Button variant="primary" to="/offers">Browse offers</Button>}>
          When you take an offer or someone takes yours, it shows up here.
        </EmptyState>
      </Section>

      <Section title="Details and icons">
        <Details>
          <p className="cf-small cf-muted">For checking the trade yourself: the contract address and the transactions.</p>
        </Details>
        <div className="cf-row" style={{ gap: 'var(--space-4)' }}>
          {ICONS.map((name) => (
            <span key={name} className="cf-row cf-small">
              <Icon name={name} /> {name}
            </span>
          ))}
        </div>
      </Section>
    </main>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="cf-card cf-stack">
      <h2 className="cf-heading">{title}</h2>
      {children}
    </section>
  );
}
