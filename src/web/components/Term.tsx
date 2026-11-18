import type { ReactNode } from 'react';

// A word that cannot be avoided, with a "?" that unfolds one plain sentence about it. Native <details>, so it opens
// with a tap, a key or a screen reader, and needs no state.

const GLOSSARY = {
  arbiter: 'A neutral person who decides only if there is a dispute. They can choose who gets the BCH, but can never take it.',
  'on-chain': 'Written on the Bitcoin Cash network, where anyone can check it. Campfire cannot change it.',
} as const;

export type GlossaryWord = keyof typeof GLOSSARY;

export function Term({ word, children }: { word: GlossaryWord; children?: ReactNode }) {
  return (
    <span className="s-term">
      {children ?? word}
      <details>
        <summary aria-label={`What does ${word} mean?`}>?</summary>
        <span className="s-term__text">{GLOSSARY[word]}</span>
      </details>
    </span>
  );
}
