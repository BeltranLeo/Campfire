import { useState } from 'react';
import { Button } from './Button';

/**
 * The small form that asks for a reason before a dispute is opened: a choice from a list and optional details
 * the arbiter reads. Invented copy: the design has no screen for it.
 */
export function DisputeForm(props: {
  reasons: string[];
  /** The dispute is being sent. */
  busy: boolean;
  /** Another action is running, so nothing else may start. */
  locked: boolean;
  onSend: (reason: string, details: string) => void;
  onBack: () => void;
}) {
  const [reason, setReason] = useState('');
  const [details, setDetails] = useState('');
  return (
    <div className="cf-well cf-stack" data-gap="3">
      <div className="cf-field">
        <label htmlFor="dispute-reason">Why are you opening a dispute?</label>
        <select id="dispute-reason" className="cf-select" value={reason} onChange={(e) => setReason(e.target.value)}>
          <option value="" disabled>
            Choose a reason
          </option>
          {props.reasons.map((r) => (
            <option key={r}>{r}</option>
          ))}
        </select>
      </div>
      <div className="cf-field">
        <label htmlFor="dispute-details">More details (optional)</label>
        <textarea id="dispute-details" className="cf-textarea" rows={3} maxLength={500} value={details} onChange={(e) => setDetails(e.target.value)} />
        <span className="cf-hint">The arbiter reads this when it decides.</span>
      </div>
      <div className="s-actions">
        <Button busy={props.busy} disabled={reason === '' || (props.locked && !props.busy)} onClick={() => props.onSend(reason, details)}>
          Send dispute
        </Button>
        <Button variant="ghost" disabled={props.locked} onClick={props.onBack}>
          Back
        </Button>
      </div>
    </div>
  );
}
