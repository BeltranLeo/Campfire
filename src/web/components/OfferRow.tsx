import type { ReactNode } from 'react';
import { HashLink, ProvenanceTag } from './Provenance';
import { Skeleton } from './States';

// One offer in the list: a five-column row on a computer, a card on a phone (screens.css switches at 720px,
// and the labels inside each cell appear only on the phone).

export interface OfferRowProps {
  coin: string;
  symbol: string;
  /** The price as text, or null when the quote is not available (no number is shown then). */
  price: string | null;
  priceNote: string;
  isDemo: boolean;
  range: string;
  paymentMethods: string[];
  paymentWindow: string;
  /** "Seller" on sell offers, "Buyer" on buy offers. */
  partyLabel: string;
  partyIdentity: string;
  /** "212 completed · since 14 Nov", or null while the reputation loads. */
  reputation: string | null;
  arbiter: string;
  offerTxid: string;
  action: ReactNode;
}

export function OfferRow(props: OfferRowProps) {
  return (
    <div className="s-offer">
      <div className="s-cell">
        <span className="s-asset">
          <span className="s-coin" aria-hidden="true">
            {props.coin}
          </span>
          {props.symbol}
        </span>
        <span className="cf-mono">{props.price ?? '—'}</span>
        <span className="cf-small cf-muted">{props.priceNote}</span>
        {props.isDemo && (
          <div>
            <ProvenanceTag kind="sim">Demo seller · simulated fiat</ProvenanceTag>
          </div>
        )}
      </div>
      <div className="s-cell">
        <span className="cf-label">Range</span>
        <span className="cf-mono">{props.range}</span>
      </div>
      <div className="s-cell">
        <span className="cf-label">Payment</span>
        <span className="s-chips">
          {props.paymentMethods.map((method) => (
            <span key={method} className="s-chip">
              {method}
            </span>
          ))}
        </span>
        <span className="cf-small cf-muted">{props.paymentWindow}</span>
      </div>
      <div className="s-cell">
        <span className="cf-label">{props.partyLabel}</span>
        <span>
          <HashLink value={props.partyIdentity} kind="plain" />
        </span>
        {props.reputation && <span className="cf-small cf-muted">{props.reputation}</span>}
        <span className="cf-small cf-muted">
          Arbiter <HashLink value={props.arbiter} kind="plain" /> · Offer <HashLink value={props.offerTxid} kind="transaction" />
        </span>
      </div>
      <div className="s-cta">{props.action}</div>
    </div>
  );
}

/** Placeholder row while offers load (Offers-Loading). */
export function OfferRowSkeleton() {
  const cell = (
    <div className="s-cell">
      <Skeleton width="70%" />
      <Skeleton width="45%" />
    </div>
  );
  return (
    <div className="s-offer">
      {cell}
      {cell}
      {cell}
      {cell}
      <div className="s-cta">
        <Skeleton width={76} height={44} />
      </div>
    </div>
  );
}

/** Column titles above the rows, shown only on wide screens. */
export function OfferHead({ first, party }: { first: string; party: string }) {
  return (
    <div className="s-offerhead">
      <span className="cf-label">{first}</span>
      <span className="cf-label">Range</span>
      <span className="cf-label">Payment</span>
      <span className="cf-label">{party}, arbiter, offer</span>
      <span />
    </div>
  );
}
