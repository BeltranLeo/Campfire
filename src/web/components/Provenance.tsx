import type { ReactNode } from 'react';

// The honesty rule (design principle 2): on-chain and simulated must never be confused.
// On-chain is solid, green and links to the explorer; simulated is dashed, violet and striped.

export type Provenance = 'chain' | 'sim' | 'offchain';

const DEFAULT_LABEL: Record<Provenance, string> = {
  chain: 'On-chain',
  sim: 'Simulated',
  offchain: 'Off-chain',
};

/** Says where a piece of data comes from. Stays visible even when the technical details are folded. */
export function ProvenanceTag({ kind, children }: { kind: Provenance; children?: ReactNode }) {
  return (
    <span className="cf-tag" data-kind={kind}>
      {children ?? DEFAULT_LABEL[kind]}
    </span>
  );
}

/** Wraps every simulated block of the demo: payment details, the demo arbiter, and so on. */
export function SimBox({
  tag = 'Simulated',
  label,
  children,
  bodyGap,
}: {
  /** Text of the tag, e.g. "Simulated arbiter". */
  tag?: string;
  /** One line saying what is simulated. */
  label: ReactNode;
  children: ReactNode;
  /** Stack the body's children with this gap (as `.cf-stack[data-gap]`). */
  bodyGap?: 2 | 3;
}) {
  return (
    <div className="cf-simbox">
      <div className="cf-simbox__label">
        <ProvenanceTag kind="sim">{tag}</ProvenanceTag>
        <span>{label}</span>
      </div>
      <div className={bodyGap ? 'cf-simbox__body cf-stack' : 'cf-simbox__body'} data-gap={bodyGap}>
        {children}
      </div>
    </div>
  );
}

const EXPLORER = 'https://blockchair.com/bitcoin-cash';

/**
 * A chain reference: a transaction id or an address, shortened in the middle and linked to the
 * block explorer in a new tab. `plain` shows a value that is not on-chain (an identity, a key) without a link.
 */
export function HashLink({ value, kind }: { value: string; kind: 'transaction' | 'address' | 'plain' }) {
  const text = shorten(value);
  if (kind === 'plain') {
    return (
      <span className="cf-hash" data-plain title={value}>
        {text}
      </span>
    );
  }
  return (
    <a
      className="cf-hash"
      href={`${EXPLORER}/${kind}/${value}`}
      target="_blank"
      rel="noreferrer"
      title={value}
      aria-label={`${value}, open in block explorer`}
    >
      {text}
    </a>
  );
}

/** First 6 and last 4 characters. An address keeps its prefix: "bitcoincash:qz8k4n…w3ue". */
export function shorten(value: string): string {
  const colon = value.indexOf(':');
  const prefix = colon >= 0 ? value.slice(0, colon + 1) : '';
  const body = value.slice(prefix.length);
  return body.length > 12 ? `${prefix}${body.slice(0, 6)}…${body.slice(-4)}` : value;
}
