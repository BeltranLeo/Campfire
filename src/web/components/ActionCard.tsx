import type { ReactNode } from 'react';
import type { Progress } from '../trade';
import { Icon } from './Icon';

/**
 * The card at the top of a trade page, the only part that changes with the state and the viewer. `step` says whose
 * turn it is ("Your turn", "Waiting"); `progress` draws the four named steps above it, so nobody reads "Step 2 of 4"
 * without knowing what the steps are.
 */
export function ActionCard(props: {
  step: string;
  progress?: Progress | null;
  title: string;
  reassurance?: ReactNode;
  deadline?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <section className="cf-card s-action" data-flush>
      <div className="cf-card__section">
        {props.progress && <Steps progress={props.progress} />}
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

function Steps({ progress }: { progress: Progress }) {
  return (
    <ol className="cf-steps" aria-label="Trade progress">
      {progress.labels.map((label, i) => (
        <li
          key={label}
          data-state={i < progress.current ? 'done' : i === progress.current ? 'current' : undefined}
          aria-current={i === progress.current ? 'step' : undefined}
        >
          {label}
        </li>
      ))}
    </ol>
  );
}
