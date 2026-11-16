// Inline SVG icons drawn on a 24px grid with strokes from the design (.cf-icon sets the stroke).
// Only the icons the app uses so far; more are added with the pages that need them.

const PATHS = {
  home: 'M4 11l8-7 8 7v8a1 1 0 0 1-1 1h-4v-6h-6v6H5a1 1 0 0 1-1-1z',
  offers: 'M4 6h16M4 12h16M4 18h10',
  trades: 'M7 4v14m0 0l-3-3m3 3l3-3M17 20V6m0 0l-3 3m3-3l3 3',
  chats: 'M5 5h14a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1h-7l-4 4v-4H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1z',
} as const;

export type IconName = keyof typeof PATHS;

export function Icon({ name }: { name: IconName }) {
  return (
    <svg className="cf-icon" viewBox="0 0 24 24" aria-hidden="true">
      <path d={PATHS[name]} />
    </svg>
  );
}
