// Inline SVG icons drawn on a 24px grid with the strokes from the design (.cf-icon sets the stroke).
// The wallet glyph under signing buttons is not here: components.css draws it as a CSS mask.

const PATHS = {
  home: 'M4 11l8-7 8 7v8a1 1 0 0 1-1 1h-4v-6h-6v6H5a1 1 0 0 1-1-1z',
  offers: 'M4 6h16M4 12h16M4 18h10',
  trades: 'M7 4v14m0 0l-3-3m3 3l3-3M17 20V6m0 0l-3 3m3-3l3 3',
  chats: 'M5 5h14a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1h-7l-4 4v-4H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1z',
  /** Reassurance lines on action cards. */
  shield: 'M12 3l7 3v5c0 4.5-3 8-7 10-4-2-7-5.5-7-10V6z',
  /** Arrow into a tray: buying, receiving. */
  buy: 'M12 4v10m0 0l-4-4m4 4l4-4M5 19h14',
  /** Arrow out of a tray: selling, sending. */
  sell: 'M12 15V5m0 0l-4 4m4-4l4 4M5 19h14',
  help: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM9.5 9.5a2.5 2.5 0 1 1 3.5 2.3c-.6.3-1 .8-1 1.7M12 17h.01',
} as const;

export type IconName = keyof typeof PATHS;

export function Icon({ name }: { name: IconName }) {
  return (
    <svg className="cf-icon" viewBox="0 0 24 24" aria-hidden="true">
      <path d={PATHS[name]} />
    </svg>
  );
}
