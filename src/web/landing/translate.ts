// Shows the landing page in Spanish without touching Aye's markup or script: every English text node (and the
// labels screen readers read) is swapped for its translation in es.ts, first for the whole page and then for
// whatever the simulated phone draws as it plays.

import { ES_PATTERNS, ES_TEXT } from './es';

const ATTRIBUTES = ['aria-label', 'alt'];

function translateText(text: string): string | undefined {
  const key = text.replace(/\s+/g, ' ').trim();
  if (!key) return undefined;
  const direct = ES_TEXT[key];
  if (direct !== undefined) return direct;
  for (const [pattern, render] of ES_PATTERNS) {
    const match = pattern.exec(key);
    if (match) return render(...match.slice(1));
  }
  return undefined;
}

function translateNode(node: Node) {
  if (node.nodeType === Node.TEXT_NODE) {
    const text = node.nodeValue ?? '';
    const spanish = translateText(text);
    if (spanish === undefined || spanish === text.trim()) return;
    // Keep the spaces around the text: they separate it from the bold or linked words next to it.
    const lead = /^\s*/.exec(text)![0];
    const trail = /\s*$/.exec(text)![0];
    node.nodeValue = lead + spanish + trail;
    return;
  }
  if (node.nodeType !== Node.ELEMENT_NODE) return;
  const element = node as Element;
  if (element.tagName === 'svg' || element.tagName === 'SCRIPT' || element.tagName === 'STYLE') return;
  for (const name of ATTRIBUTES) {
    const value = element.getAttribute(name);
    const spanish = value && translateText(value);
    if (spanish && spanish !== value) element.setAttribute(name, spanish);
  }
  element.childNodes.forEach(translateNode);
}

/** Translates `root` into Spanish now and as it changes; returns a function that stops watching. */
export function translateToSpanish(root: HTMLElement): () => void {
  translateNode(root);
  const observer = new MutationObserver((records) => {
    for (const record of records) {
      if (record.type === 'characterData') translateNode(record.target);
      else record.addedNodes.forEach(translateNode);
    }
  });
  observer.observe(root, { subtree: true, childList: true, characterData: true });
  return () => observer.disconnect();
}
