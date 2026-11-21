import type { ReactNode } from 'react';
import { useAdvanced } from '../advanced';
import { useMessages } from '../lang';
import { ProvenanceTag } from './Provenance';

// Technical information folded away (design principle 1). The summary keeps its provenance tag,
// so what is on-chain stays labelled even while the block is closed. With "Show technical details" on, the
// technical folds (the ones with a tag) start open; a fold without a tag, such as "Something wrong?", never does.
export function Details({
  summary,
  tag = <ProvenanceTag kind="chain" />,
  open,
  children,
}: {
  summary?: ReactNode;
  tag?: ReactNode;
  open?: boolean;
  children: ReactNode;
}) {
  const advanced = useAdvanced();
  const t = useMessages().common;
  return (
    <details className="cf-details" open={open ?? (tag !== null && advanced)}>
      <summary>
        <span className="cf-row">
          {summary ?? t.onChainDetails} {tag}
        </span>
      </summary>
      <div className="cf-details__body">{children}</div>
    </details>
  );
}
