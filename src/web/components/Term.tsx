import type { ReactNode } from 'react';

// A word that cannot be avoided, with a "?" that unfolds one plain sentence about it. Native <details>, so it opens
// with a tap, a key or a screen reader, and needs no state.

import { useMessages } from '../lang';
import type { Messages } from '../messages';

export type GlossaryWord = keyof Messages['common']['glossary'];

export function Term({ word, children }: { word: GlossaryWord; children?: ReactNode }) {
  const t = useMessages().common;
  return (
    <span className="s-term">
      {children ?? word}
      <details>
        <summary aria-label={t.whatIs(typeof children === 'string' ? children : word)}>?</summary>
        <span className="s-term__text">{t.glossary[word]}</span>
      </details>
    </span>
  );
}
