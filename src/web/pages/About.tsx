import type { ReactNode } from 'react';
import { Link } from 'react-router';
import { apiGet, type Offer } from '../api';
import { Icon } from '../components/Icon';
import { ProvenanceTag } from '../components/Provenance';
import { DSPROOF_WATCH_SEC } from '../dsproof';
import { usePoll } from '../hooks/usePoll';
import { PROTOCOL_SPEC_URL, REPO_URL } from '../links';

// How Campfire works, in plain words: the steps of a trade, what the contract allows, the arbiter,
// zero-confirmation deposits, privacy and what the demo simulates. The FAQ from the Help screens closes it.

export function About() {
  const offers = usePoll(() => apiGet<{ offers: Offer[] }>('/api/offers?onlyOpen=true').then((r) => r.offers), 'offers');
  const demo = offers.data?.find((o) => o.isDemo && o.document.asset === 'BCH') ?? offers.data?.find((o) => o.isDemo);

  return (
    <main className="s-main" data-narrow>
      <div className="s-pagehead">
        <h1 className="cf-display">About Campfire</h1>
        <p className="cf-muted">
          Campfire lets two people trade Bitcoin Cash or PUSD for pesos, dollars or any other money, with no exchange in the
          middle. This page explains how, step by step. Nothing here needs crypto experience.
        </p>
      </div>

      <Section title="A trade, step by step">
        <ol className="cf-timeline">
          <Step n={1} title="The seller publishes an offer">
            The offer says what is sold, the price (fixed, or the market price plus a margin), the range, how to pay and who
            the arbiter is. It is written on the Bitcoin Cash chain, so anyone can list it.
          </Step>
          <Step n={2} title="A buyer takes it">
            The buyer picks an amount. The price is locked with a quote signed by the price oracle. Taking an offer is free
            and needs no signature, and the buyer does not need any BCH.
          </Step>
          <Step n={3} title="The seller locks the coins">
            The coins go into a contract made for this trade only: the escrow. The buyer’s browser rebuilds the contract from
            the trade terms and checks the deposit itself, instead of trusting Campfire.
          </Step>
          <Step n={4} title="The buyer pays and marks it as paid">
            The buyer pays the seller directly, by bank transfer or any method in the offer. The seller’s payment details are
            encrypted so that only this buyer can read them.
          </Step>
          <Step n={5} title="The seller releases the coins">
            When the money arrives, the seller signs the release and the contract pays the buyer’s wallet.
          </Step>
        </ol>
      </Section>

      <Section title="What the contract allows" tag={<ProvenanceTag kind="chain" />}>
        <p className="cf-muted">
          The escrow is a small program on Bitcoin Cash. It has four ways out, and none of them pays anyone but the buyer or
          the seller. Campfire never holds the coins and cannot move them.
        </p>
        <dl className="cf-dl">
          <dt>
            <span className="cf-mono">release</span>
          </dt>
          <dd>The seller signs: the coins go to the buyer. The normal ending.</dd>
          <dt>
            <span className="cf-mono">cancel</span>
          </dt>
          <dd>The buyer signs: the coins go back to the seller. For when the buyer will not pay.</dd>
          <dt>
            <span className="cf-mono">arbitrate</span>
          </dt>
          <dd>The arbiter’s signed verdict sends the coins to the buyer or to the seller, nobody else.</dd>
          <dt>
            <span className="cf-mono">refund</span>
          </dt>
          <dd>14 days after accepting the trade, the seller can take the coins back alone, in case everyone else disappears.</dd>
        </dl>
        <p className="cf-small">
          Every path that has run on mainnet is linked on the <Link to="/transparency">transparency page</Link>.
        </p>
      </Section>

      <Section title="If something goes wrong">
        <p>
          Each offer names an arbiter, and the buyer accepts it when taking the offer. In this demo, Campfire is the arbiter.
          The arbiter only steps in if one of the two opens a dispute, and can only choose between them: it signs a decision,
          never a transaction, and can never keep the coins.
        </p>
        <p className="cf-muted">
          If the buyer does not mark the trade as paid before the payment window ends, the arbiter returns the coins to the
          seller automatically.
        </p>
      </Section>

      <Section title="No waiting for blocks" tag={<ProvenanceTag kind="chain">0-conf with DSProofs</ProvenanceTag>}>
        <p>
          On Bitcoin Cash a payment can be trusted seconds after it reaches the network. When the seller locks the coins, the
          deposit is in every node’s memory almost at once, before it is in a block: zero confirmations, or 0-conf.
        </p>
        <p>
          If anyone tries to spend the same coins twice, Bitcoin Cash nodes broadcast a double-spend proof (DSProof) within
          seconds. The buyer’s browser asks for one. {`After ${DSPROOF_WATCH_SEC} quiet seconds the deposit is safe to act on, so the buyer can pay right away.`}{' '}
          If a proof appears, the page says not to pay. The coins the buyer receives are usable right away too.
        </p>
      </Section>

      <Section title="Privacy">
        <ul className="cf-stack" data-gap="2" style={{ margin: 0, paddingLeft: 'var(--space-5)' }}>
          <li>Connecting a wallet is the only sign-in. There are no accounts, passwords or e-mail addresses.</li>
          <li>Each trade uses a new key and a new address of your wallet, so trades are not linked on-chain.</li>
          <li>Payment details are encrypted in the browser and revealed only to the other person in the trade.</li>
          <li>
            Campfire can link the trades of one wallet, because it counts the reputation. That count is not on-chain and can
            be inflated with a second wallet.
          </li>
        </ul>
      </Section>

      <Section title="What is real and what is simulated">
        <p>Two labels appear across the site and stay visible even when the technical details are folded:</p>
        <dl className="cf-dl">
          <dt>
            <ProvenanceTag kind="chain" />
          </dt>
          <dd>A real Bitcoin Cash transaction on mainnet. It links to a block explorer, so you can check it.</dd>
          <dt>
            <ProvenanceTag kind="sim" />
          </dt>
          <dd>Part of the demo. Only two things are: the fiat payment, and who decides a demo dispute.</dd>
        </dl>
        <p className="cf-muted">
          In a demo trade, a demo seller run by Campfire sends a few cents of real BCH through the real contract. You send no
          money.
        </p>
      </Section>

      <Section title="Questions">
        <div className="s-faq">
          <Faq q="Do I need BCH to buy?" open>
            No. The seller locks the coins first. You only need a wallet to receive them.
          </Faq>
          <Faq q="Who holds the coins during a trade?">
            A contract on the Bitcoin Cash network. It can only pay the buyer or return the coins to the seller. Campfire
            cannot move them.
          </Faq>
          <Faq q="What if the other person disappears?">
            Either of you can open a dispute. An arbiter named in the offer then decides who gets the coins. The arbiter can
            never keep them.
          </Faq>
          <Faq q="When does my wallet ask me to sign?">
            Only when coins move: publishing a sell offer, locking coins, releasing them, or cancelling. Buttons that open your
            wallet say so.
          </Faq>
          <Faq q="What does “Simulated” mean?">
            In demo trades the bank payment is not real. Everything marked “On-chain” is a real transaction you can check.
          </Faq>
          <Faq q="What is PUSD?">A dollar token that lives on Bitcoin Cash. 1 PUSD stays close to 1 US dollar.</Faq>
        </div>
      </Section>

      <div className="s-3">
        <Link className="cf-quick" to={demo ? `/offers/${demo.offerTxid}` : '/offers'}>
          <Icon name="buy" />
          Try the demo<small>A real trade with simulated fiat</small>
        </Link>
        <Link className="cf-quick" to="/transparency">
          <Icon name="shield" />
          Transparency<small>Every contract path on mainnet</small>
        </Link>
        <a className="cf-quick" href={PROTOCOL_SPEC_URL}>
          <Icon name="help" />
          Protocol spec<small>The details, for developers</small>
        </a>
      </div>
      <p className="cf-small cf-subtle">
        Campfire is open source: <a href={REPO_URL}>github.com/BeltranLeo/Campfire</a>. Built for BCH BLAZE 2026.
      </p>
    </main>
  );
}

function Section({ title, tag, children }: { title: string; tag?: ReactNode; children: ReactNode }) {
  return (
    <section className="cf-card cf-stack" data-pad>
      <div className="cf-row" data-between>
        <h2 className="cf-heading">{title}</h2>
        {tag}
      </div>
      {children}
    </section>
  );
}

function Step({ n, title, children }: { n: number; title: string; children: ReactNode }) {
  return (
    <li className="cf-step" data-state="todo">
      <span className="cf-step__dot" aria-hidden="true">
        {n}
      </span>
      <div>
        <div className="cf-step__title" style={{ color: 'var(--ink)', fontWeight: 600 }}>
          {title}
        </div>
        <div className="cf-small cf-muted">{children}</div>
      </div>
    </li>
  );
}

function Faq({ q, open, children }: { q: string; open?: boolean; children: ReactNode }) {
  return (
    <details open={open}>
      <summary>{q}</summary>
      <p>{children}</p>
    </details>
  );
}
