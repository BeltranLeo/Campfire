import type { ReactNode } from 'react';
import { Link } from 'react-router';
import type { AssetInfo } from '../assets';
import { CoinIcon } from './CoinIcon';
import { ProvenanceTag } from './Provenance';
import { Skeleton } from './States';

// The offer list as a table: who, price, limits, payment, action. The same columns on both sides of the market, so
// a buyer and a seller read one layout. On a computer one header names the columns; on a phone each row becomes a
// card and every value carries its own label. Keys, hashes and the arbiter live on the offer page.

export interface OfferColumns {
  /** "Seller" on the buy side, "Buyer" on the sell side: the person on the other end of the trade. */
  party: string;
  /** "Limits": the range, or the visitor's answer within it. */
  limits: string;
  /** "Pay by" when the visitor pays, "Paid by" when the visitor gets paid. */
  payment: string;
}

export interface OfferRowProps {
  to: string;
  columns: OfferColumns;
  party: {
    initials: string;
    name: string;
    /** "21 trades", "No trades yet", "Run by Campfire". Null while the reputation loads. */
    detail: string | null;
    /** The service's demo seller: its trades are practice, so it shows no reputation. */
    demo: boolean;
  };
  /** The coin on offer, named with its logo in the price's detail line so BCH and PUSD rows tell apart at a glance. */
  asset: Pick<AssetInfo, 'symbol' | 'coin' | 'logo'>;
  /** "353,926.47 ARS", or null while the market price loads. */
  price: string | null;
  /** "market +2%" or "at market": shown after "per BCH". */
  priceKind: string;
  /** The main line of the limits column: the range in fiat, the visitor's answer, or the limit they crossed. */
  limits: string;
  limitsTone?: 'answer' | 'outside';
  /** The range in the coin, under the main line. */
  limitsDetail: string | null;
  /** Payment methods as people read them; the simulated one is shown as a tag instead. */
  methods: string[];
  simulated: boolean;
  /** "60 min to pay". */
  paymentWindow: string;
  action: string;
}

/** The column names, shown once above the rows on a computer. Hidden from screen readers: each cell says it. */
export function OfferHeader({ columns }: { columns: OfferColumns }) {
  return (
    <div className="o-thead" aria-hidden="true">
      <span>{columns.party}</span>
      <span>Price</span>
      <span>{columns.limits}</span>
      <span>{columns.payment}</span>
      <span />
    </div>
  );
}

export function OfferRow(props: OfferRowProps) {
  return (
    <li>
      {/* The whole row is the link: a bigger target on a phone, and one stop per offer for the keyboard. */}
      <Link className="o-row" to={props.to}>
        <span className="o-cell o-party">
          <span className="o-avatar" data-demo={props.party.demo || undefined} aria-hidden="true">
            {props.party.initials}
          </span>
          <span className="o-who">
            <span className="o-name">{props.party.name}</span>
            {/* "Seller · 1 trade" on a phone; on a computer the header says "Seller" and the line keeps the count. */}
            <span className="o-sub">
              <Label>{props.columns.party}</Label>
              {props.party.detail !== null && <span>{props.party.detail}</span>}
            </span>
          </span>
        </span>
        <Cell label="Price">
          <span className="o-value">{props.price ?? '—'}</span>
          <span className="o-sub">
            per{' '}
            <span className="o-coin">
              <CoinIcon asset={props.asset} />
              {props.asset.symbol}
            </span>{' '}
            · {props.priceKind}
          </span>
        </Cell>
        <Cell label={props.columns.limits}>
          <span className="o-value" data-tone={props.limitsTone}>
            {props.limits}
          </span>
          {props.limitsDetail && <span className="o-sub">{props.limitsDetail}</span>}
        </Cell>
        <Cell label={props.columns.payment}>
          <span className="o-methods">
            {props.methods.length > 0 && <span>{props.methods.join(', ')}</span>}
            {props.simulated && <ProvenanceTag kind="sim" />}
          </span>
          <span className="o-sub">{props.paymentWindow}</span>
        </Cell>
        <span className="o-cta">
          <span className="cf-btn" data-size="sm">
            {props.action}
          </span>
        </span>
      </Link>
    </li>
  );
}

function Cell({ label, children }: { label: string; children: ReactNode }) {
  return (
    <span className="o-cell">
      <Label>{label}</Label>
      <span className="o-stack">{children}</span>
    </span>
  );
}

/** A column name inside the cell: visible on a phone, read aloud everywhere. */
function Label({ children }: { children: ReactNode }) {
  return <span className="o-k">{children}</span>;
}

/** Placeholder row while offers load (Offers-Loading). */
export function OfferRowSkeleton() {
  return (
    <li>
      <span className="o-row" data-skeleton>
        <span className="o-cell o-party">
          <Skeleton width={36} height={36} style={{ borderRadius: '50%', flex: 'none' }} />
          <span className="o-who">
            <Skeleton width={96} />
            <Skeleton width={56} />
          </span>
        </span>
        <span className="o-cell">
          <span className="o-stack">
            <Skeleton width="80%" />
            <Skeleton width="50%" />
          </span>
        </span>
        <span className="o-cell">
          <span className="o-stack">
            <Skeleton width="85%" />
            <Skeleton width="60%" />
          </span>
        </span>
        <span className="o-cell">
          <span className="o-stack">
            <Skeleton width="70%" />
            <Skeleton width="45%" />
          </span>
        </span>
        <Skeleton width={56} height={32} style={{ borderRadius: 'var(--radius-md)' }} />
      </span>
    </li>
  );
}
