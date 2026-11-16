import type { ReactNode } from 'react';
import { ProvenanceTag } from './Provenance';

// Technical information folded away (design principle 1). The summary keeps its provenance tag,
// so what is on-chain stays labelled even while the block is closed.
export function Details({
  summary = 'On-chain details',
  tag = <ProvenanceTag kind="chain" />,
  open,
  children,
}: {
  summary?: ReactNode;
  tag?: ReactNode;
  open?: boolean;
  children: ReactNode;
}) {
  return (
    <details className="cf-details" open={open}>
      <summary>
        <span className="cf-row">
          {summary} {tag}
        </span>
      </summary>
      <div className="cf-details__body">{children}</div>
    </details>
  );
}
