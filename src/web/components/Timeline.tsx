import { formatCountdown, formatHourMinute } from '../format';
import { useNow } from '../hooks/useNow';
import type { Step } from '../trade';
import { HashLink, ProvenanceTag } from './Provenance';

/** The trade's progress: four fixed steps, or the ending that replaced the last ones. */
export function Timeline({ steps }: { steps: Step[] }) {
  return (
    <ol className="cf-timeline">
      {steps.map((step, i) => (
        <li key={i} className="cf-step" data-state={step.state}>
          <span className="cf-step__dot" aria-hidden="true">
            {step.state === 'done' ? '✓' : step.state === 'failed' ? '×' : i + 1}
          </span>
          <div>
            <div className="cf-step__title">{step.title}</div>
            <StepMeta step={step} />
          </div>
        </li>
      ))}
    </ol>
  );
}

function StepMeta({ step }: { step: Step }) {
  const parts = [
    step.at !== undefined && formatHourMinute(new Date(step.at * 1000)),
    step.txid && <HashLink value={step.txid} kind="transaction" />,
    step.txid && step.confirmations !== undefined && confirmationsText(step.confirmations),
    step.offchain && <ProvenanceTag kind="offchain" />,
    step.simulated && <ProvenanceTag kind="sim">Simulated fiat</ProvenanceTag>,
    step.note,
  ].filter(Boolean);
  if (parts.length === 0) return null;
  return (
    <div className="cf-step__meta">
      {parts.map((part, i) => (
        <span key={i} style={{ display: 'contents' }}>
          {i > 0 && ' · '}
          {part}
        </span>
      ))}
    </div>
  );
}

export const confirmationsText = (n: number) =>
  n === 0 ? 'in the mempool (0-conf)' : `${n} confirmation${n === 1 ? '' : 's'}`;

/** Time left until `deadline` (Unix seconds), turning amber under 20 % of the window. Stops at 00:00. */
export function Countdown({ deadline, windowSec }: { deadline: number; windowSec: number }) {
  const now = useNow(1000);
  const left = Math.max(0, deadline - now / 1000);
  return (
    <span className="cf-countdown" data-low={left < windowSec * 0.2 || undefined} role="timer">
      {formatCountdown(left)}
    </span>
  );
}
