import { useState } from 'react';
import { Button } from './Button';
import { useMessages } from '../lang';

/**
 * The small form that asks for a reason before a dispute is opened: a choice from a list and optional details
 * the arbiter reads. Invented copy: the design has no screen for it.
 */
export function DisputeForm(props: {
  /** `value` is what the arbiter reads, kept in English so every arbiter can; `label` is shown in the chosen language. */
  reasons: { value: string; label: string }[];
  /** The dispute is being sent. */
  busy: boolean;
  /** Another action is running, so nothing else may start. */
  locked: boolean;
  onSend: (reason: string, details: string) => void;
  onBack: () => void;
}) {
  const [reason, setReason] = useState('');
  const [details, setDetails] = useState('');
  const t = useMessages().trade;
  return (
    <div className="cf-well cf-stack" data-gap="3">
      <div className="cf-field">
        <label htmlFor="dispute-reason">{t.disputeWhy}</label>
        <select id="dispute-reason" className="cf-select" value={reason} onChange={(e) => setReason(e.target.value)}>
          <option value="" disabled>
            {t.chooseReason}
          </option>
          {props.reasons.map((r) => (
            <option key={r.value} value={r.value}>
              {r.label}
            </option>
          ))}
        </select>
      </div>
      <div className="cf-field">
        <label htmlFor="dispute-details">{t.moreDetails}</label>
        <textarea id="dispute-details" className="cf-textarea" rows={3} maxLength={500} value={details} onChange={(e) => setDetails(e.target.value)} />
        <span className="cf-hint">{t.arbiterReads}</span>
      </div>
      <div className="s-actions">
        <Button busy={props.busy} disabled={reason === '' || (props.locked && !props.busy)} onClick={() => props.onSend(reason, details)}>
          {t.sendDispute}
        </Button>
        <Button variant="ghost" disabled={props.locked} onClick={props.onBack}>
          {t.back}
        </Button>
      </div>
    </div>
  );
}
