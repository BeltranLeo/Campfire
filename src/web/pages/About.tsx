import { useEffect, type ReactNode } from 'react';
import { Link, useLocation } from 'react-router';
import { apiGet, type Offer } from '../api';
import { Icon } from '../components/Icon';
import { ProvenanceTag } from '../components/Provenance';
import { DSPROOF_WATCH_SEC } from '../dsproof';
import { usePoll } from '../hooks/usePoll';
import { GET_A_WALLET_ID, PROTOCOL_SPEC_URL, REPO_URL, WALLETS } from '../links';
import { useMessages } from '../lang';

// How Campfire works, in plain words: where to get a wallet, the steps of a trade, what the contract allows, the arbiter,
// zero-confirmation deposits, privacy and what the demo simulates. The FAQ from the Help screens closes it.

export function About() {
  const offers = usePoll(() => apiGet<{ offers: Offer[] }>('/api/offers?onlyOpen=true').then((r) => r.offers), 'offers');
  const demo = offers.data?.find((o) => o.isDemo && o.document.asset === 'BCH') ?? offers.data?.find((o) => o.isDemo);
  // The app routes with the URL hash, so the browser cannot jump to "#get-a-wallet" by itself.
  const { hash } = useLocation();
  useEffect(() => {
    if (hash) document.getElementById(hash.slice(1))?.scrollIntoView();
  }, [hash]);
  const messages = useMessages();
  const t = messages.about;

  return (
    <main className="s-main" data-site data-narrow>
      <div className="s-pagehead">
        <h1 className="cf-display">{t.title}</h1>
        <p className="cf-muted">{t.lead}</p>
      </div>

      <Section title={t.getWallet} id={GET_A_WALLET_ID}>
        <p className="cf-muted">{t.walletIntro}</p>
        <dl className="cf-dl">
          {WALLETS.map((wallet) => (
            <WalletRow key={wallet.name} {...wallet} note={messages.welcome.walletNotes[wallet.name] ?? wallet.note} />
          ))}
        </dl>
        <p className="cf-small cf-muted">{t.walletAfter}</p>
      </Section>

      <Section title={t.stepsTitle}>
        <ol className="cf-timeline">
          {t.steps.map((step, i) => (
            <Step key={step.title} n={i + 1} title={step.title}>
              {step.body}
            </Step>
          ))}
        </ol>
      </Section>

      <Section title={t.contractTitle} tag={<ProvenanceTag kind="chain" />}>
        <p className="cf-muted">{t.contractIntro}</p>
        <dl className="cf-dl">
          {(['release', 'cancel', 'arbitrate', 'refund'] as const).map((path) => (
            <span key={path} style={{ display: 'contents' }}>
              <dt>
                <span className="cf-mono">{path}</span>
              </dt>
              <dd>{t.paths[path]}</dd>
            </span>
          ))}
        </dl>
        <p className="cf-small">
          {t.everyPathBefore}
          <Link to="/transparency">{t.everyPathLink}</Link>
          {t.everyPathAfter}
        </p>
      </Section>

      <Section title={t.wrongTitle}>
        <p>{t.wrongBody}</p>
        <p className="cf-muted">{t.wrongAuto}</p>
      </Section>

      <Section title={t.zeroConfTitle} tag={<ProvenanceTag kind="chain">{t.zeroConfTag}</ProvenanceTag>}>
        <p>{t.zeroConf1}</p>
        <p>{t.zeroConf2(DSPROOF_WATCH_SEC)}</p>
      </Section>

      <Section title={t.privacyTitle}>
        <ul className="cf-stack" data-gap="2" style={{ margin: 0, paddingLeft: 'var(--space-6)' }}>
          {t.privacy.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
      </Section>

      <Section title={t.realTitle}>
        <p>{t.realIntro}</p>
        <dl className="cf-dl">
          <dt>
            <ProvenanceTag kind="chain" />
          </dt>
          <dd>{t.realChain}</dd>
          <dt>
            <ProvenanceTag kind="sim" />
          </dt>
          <dd>{t.realSim}</dd>
        </dl>
        <p className="cf-muted">{t.realDemo}</p>
      </Section>

      <Section title={t.questions}>
        <div className="s-faq">
          {t.faq.map((item, i) => (
            <Faq key={item.q} q={item.q} open={i === 0}>
              {item.a}
            </Faq>
          ))}
        </div>
      </Section>

      <div className="s-3">
        <Link className="cf-quick" to={demo ? `/offers/${demo.offerTxid}` : '/offers'}>
          <Icon name="buy" />
          {t.tryDemo}
          <small>{t.tryDemoNote}</small>
        </Link>
        <Link className="cf-quick" to="/transparency">
          <Icon name="transparency" />
          {t.transparency}
          <small>{t.transparencyNote}</small>
        </Link>
        <a className="cf-quick" href={PROTOCOL_SPEC_URL}>
          <Icon name="help" />
          {t.spec}
          <small>{t.specNote}</small>
        </a>
      </div>
      <p className="cf-small cf-subtle">
        {t.openSource}
        <a href={REPO_URL}>github.com/BeltranLeo/Campfire</a>
        {t.builtFor}
      </p>
    </main>
  );
}

function WalletRow({ name, url, note }: { name: string; url: string; note: string }) {
  return (
    <>
      <dt>
        <a href={url} target="_blank" rel="noreferrer">
          {name}
        </a>
      </dt>
      <dd>{note}</dd>
    </>
  );
}

function Section({ title, tag, id, children }: { title: string; tag?: ReactNode; id?: string; children: ReactNode }) {
  return (
    <section className="cf-card cf-stack" data-pad id={id}>
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
        <div className="cf-step__title" style={{ color: 'var(--text)', fontWeight: 600 }}>
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
