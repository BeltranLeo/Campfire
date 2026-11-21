import type { ReactNode } from 'react';
import { Link } from 'react-router';
import { PROTOCOL_SPEC_URL, REPO_URL } from '../links';
import { useMessages } from '../lang';

// What comes after the beta. Nothing listed here works yet, and every row says "Planned" (in the chosen language), so the page is never read as
// a list of features. What works today is on About and Transparency.

export function Roadmap() {
  const t = useMessages().roadmap;
  return (
    <main className="s-main" data-site data-narrow>
      <div className="s-pagehead">
        <h1 className="cf-display">{t.title}</h1>
        <p className="cf-muted">{t.lead}</p>
        <p className="cf-small cf-muted">
          {t.todayBefore}
          <Link to="/about">{t.howItWorks}</Link>
          {t.todayMiddle}
          <Link to="/transparency">{t.transparencyPage}</Link>
          {t.todayAfter}
        </p>
      </div>

      {t.sections.map((section) => (
        <Section key={section.title} title={section.title}>
          {section.items.map((item) => (
            <Item key={item.title} title={item.title} planned={t.planned}>
              {item.body}
            </Item>
          ))}
        </Section>
      ))}

      <p className="cf-small cf-subtle">
        {t.designBefore}
        <a href={PROTOCOL_SPEC_URL}>{t.spec}</a>
        {t.designAfter}
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

function Item({ title, planned, children }: { title: string; planned: string; children: ReactNode }) {
  return (
    <li className="cf-stack" data-gap="1">
      {/* The tag stays beside the title, even when a long title wraps on a phone. */}
      <div className="cf-row" data-between data-nowrap style={{ alignItems: 'flex-start' }}>
        <strong>{title}</strong>
        <span className="cf-pill">{planned}</span>
      </div>
      <p className="cf-small cf-muted" style={{ margin: 0 }}>
        {children}
      </p>
    </li>
  );
}
