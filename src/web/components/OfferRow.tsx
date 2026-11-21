import type { ReactNode } from 'react';
import { ProvenanceTag } from './Provenance';
import { Skeleton } from './States';

// One offer in the list: avatar, a main column of three short lines, one button. The same row on a phone and a
// computer, so offers can be compared by scanning down one line. Keys, hashes and the arbiter live on the offer page.

export interface OfferRowProps {
  initials: string;
  /** Line 1: what the visitor gets (the amount, or the price). */
  headline: string;
  /** The headline is a hint, not a result (no price, or the amount is outside the range). */
  headlineMuted?: boolean;
  alias: string;
  /** Completed trades in this role, or null while the reputation loads. */
  trades: number | null;
  /** Payment methods, already labelled. */
  methods: string;
  /** "5 min to pay". */
  paymentWindow: string;
  /** "0.001 – 0.02 BCH", shown only when no amount is typed or it does not fit. */
  range: string | null;
  /** The fiat payment is simulated (a demo offer, or one that asked for a demo answer): it keeps a visible tag. */
  simulated: boolean;
  action: ReactNode;
}

export function OfferRow(props: OfferRowProps) {
  const trades = props.trades === null ? '' : ` · ${props.trades} ${props.trades === 1 ? 'trade' : 'trades'}`;
  return (
    <div className="o-row">
      {/* Colour comes from the identity hash; the initials carry the meaning, so it is decoration only. */}
      <span className="o-avatar" aria-hidden="true">
        {props.initials}
      </span>
      <div className="o-main">
        {/* Three lines at most: what you get (with the Simulated tag), who and how fast, how and how much. */}
        <span className="o-top">
          <span className="o-headline" data-muted={props.headlineMuted || undefined}>
            {props.headline}
          </span>
          {props.simulated && <ProvenanceTag kind="sim" />}
        </span>
        <span className="o-line">
          {props.alias}
          {trades} · {props.paymentWindow}
        </span>
        <span className="o-line">
          {props.methods}
          {props.range && ` · ${props.range}`}
        </span>
      </div>
      <div className="o-cta">{props.action}</div>
    </div>
  );
}

/** Placeholder row while offers load (Offers-Loading). */
export function OfferRowSkeleton() {
  return (
    <div className="o-row">
      <span className="o-avatar" aria-hidden="true">
        <Skeleton width={34} height={34} style={{ borderRadius: '50%' }} />
      </span>
      <div className="o-main">
        <Skeleton width="55%" />
        <Skeleton width="40%" />
        <Skeleton width="70%" />
      </div>
      <Skeleton width={56} height={32} style={{ borderRadius: 'var(--radius-md)' }} />
    </div>
  );
}
