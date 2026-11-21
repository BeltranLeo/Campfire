import type { ReactNode } from 'react';
import type { Progress, Turn } from '../trade';
import { Icon } from './Icon';
import { useMessages } from '../lang';

/**
 * The card at the top of a trade page, the only part that changes with the state and the viewer. `turn` says whose
 * move it is, in words ("Your turn", "Waiting") and in the colour of the current step: Brasa when it is yours, blue
 * while the other party or the contract works, violet in a dispute. `progress` draws the four named steps above it,
 * so nobody reads "Step 2 of 4" without knowing what the steps are.
 */
const TURN_LABEL = { you: 'turnYou', other: 'turnOther', arbiter: 'turnArbiter' } as const satisfies Record<Turn, string>;

export function ActionCard(props: {
  turn: Turn;
  progress?: Progress | null;
  title: string;
  reassurance?: ReactNode;
  deadline?: ReactNode;
  children?: ReactNode;
}) {
  const t = useMessages().trade;
  return (
    <section className="cf-card s-action" data-flush>
      <div className="cf-card__section">
        {props.progress && <Steps progress={props.progress} turn={props.turn} />}
        <span className="cf-stepper">{t[TURN_LABEL[props.turn]]}</span>
        <h2 className="cf-heading">{props.title}</h2>
        {props.reassurance && (
          <p className="cf-row cf-small" data-nowrap style={{ color: 'var(--escrow)', alignItems: 'flex-start' }}>
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

function Steps({ progress, turn }: { progress: Progress; turn: Turn }) {
  const t = useMessages().trade;
  return (
    <ol className="cf-steps" aria-label={t.progressLabel} data-turn={turn}>
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
