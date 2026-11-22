import { useEffect, useState } from 'react';
import { useMessages } from '../lang';

// Copies a value to the clipboard and confirms for a moment. Small by default (.cf-copy);
// pass `block` for a full-width button. `label` and `copiedLabel` fix the words, for text that never changes language.
export function CopyButton({
  value,
  label,
  copiedLabel,
  block = false,
}: {
  value: string;
  label?: string;
  copiedLabel?: string;
  block?: boolean;
}) {
  const [copied, setCopied] = useState(false);
  const t = useMessages().common;

  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 1500);
    return () => clearTimeout(timer);
  }, [copied]);

  return (
    <button
      type="button"
      className={block ? 'cf-btn' : 'cf-copy'}
      data-block={block || undefined}
      onClick={() => {
        navigator.clipboard.writeText(value).then(
          () => setCopied(true),
          () => {},
        );
      }}
    >
      {copied ? (copiedLabel ?? t.copied) : (label ?? t.copy)}
    </button>
  );
}
