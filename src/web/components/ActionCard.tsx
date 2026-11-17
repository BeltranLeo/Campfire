import type { ReactNode } from 'react';
import { Icon } from './Icon';

/** The card at the top of a trade page, the only part that changes with the state and the viewer. */
export function ActionCard(props: { step: string; title: string; reassurance?: ReactNode; deadline?: ReactNode; children?: ReactNode }) {
  return (
    <section className="cf-card s-action" data-flush>
      <div className="cf-card__section">
        <span className="cf-stepper">{props.step}</span>
        <h2 className="cf-heading">{props.title}</h2>
        {props.reassurance && (
          <p className="cf-row cf-small" data-nowrap style={{ color: 'var(--chain)', alignItems: 'flex-start' }}>
            <Icon name="shield" />
            <span>{props.reassurance}</span>
          </p>
        )}
        {props.deadline && <div className="s-deadline">{props.deadline}</div>}
        {props.children}
      </div>
    </section>
  );
}
