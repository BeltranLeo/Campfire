import { formatCountdown, formatHourMinute } from '../format';
import { useAdvanced } from '../advanced';
import { useMessages } from '../lang';
import { text } from '../messages';
import { useNow } from '../hooks/useNow';
import type { Step } from '../trade';
import { HashLink, ProvenanceTag } from './Provenance';

/** The trade's progress: four fixed steps, or the ending that replaced the last ones. */
export function Timeline({ steps }: { steps: Step[] }) {
  return (
    <ol className="cf-timeline">
      {steps.map((step, i) => (
        // A step with a transaction is on the network: green. Other done steps are blue.
        <li key={i} className="cf-step" data-state={step.state} data-chain={step.txid ? '' : undefined} data-turn={step.turn}>
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

// The time and a tick are enough to follow the story; the transaction and its confirmations show with technical
// details on. An on-chain step keeps its On-chain tag either way.
function StepMeta({ step }: { step: Step }) {
  const advanced = useAdvanced();
  const t = useMessages().trade;
  const parts = [
    step.at !== undefined && formatHourMinute(new Date(step.at * 1000)),
    step.txid && (advanced ? <HashLink value={step.txid} kind="transaction" /> : <ProvenanceTag kind="chain" />),
    advanced && step.txid && step.confirmations !== undefined && confirmationsText(step.confirmations),
    step.offchain && <ProvenanceTag kind="offchain" />,
    step.simulated && <ProvenanceTag kind="sim">{t.simulatedFiat}</ProvenanceTag>,
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

export const confirmationsText = (n: number) => text().trade.confirmations(n);

/** Time left until `deadline` (Unix seconds), in amber; `data-low` marks the last 20 % of the window. Stops at 00:00. */
export function Countdown({ deadline, windowSec }: { deadline: number; windowSec: number }) {
  const now = useNow(1000);
  const left = Math.max(0, deadline - now / 1000);
  return (
    <span className="cf-countdown" data-low={left < windowSec * 0.2 || undefined} role="timer">
      {formatCountdown(left)}
    </span>
  );
}
