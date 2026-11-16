import { useEffect, useState } from 'react';

// Copies a value to the clipboard and confirms for a moment. Small by default (.cf-copy);
// pass `block` for a full-width button.
export function CopyButton({ value, label = 'Copy', block = false }: { value: string; label?: string; block?: boolean }) {
  const [copied, setCopied] = useState(false);

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
      {copied ? 'Copied' : label}
    </button>
  );
}
