import type { CSSProperties, ReactNode } from 'react';

// Loading, empty and error states. Every screen has all three (the *-Loading, *-Empty and
// *-Error screens of the design).

/** A message box. Every API error is shown in one, with the server's message as written. */
export function Notice({
  tone,
  title,
  children,
}: {
  tone?: 'warn' | 'danger' | 'chain';
  title?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <div className="cf-notice" data-tone={tone} role={tone === 'danger' ? 'alert' : undefined}>
      <div>
        {title && <strong>{title}</strong>}
        {children}
      </div>
    </div>
  );
}

/** A grey placeholder bar while data loads. Sizes are CSS lengths or pixels. */
export function Skeleton({ width = '100%', height = 14, style }: { width?: CSSProperties['width']; height?: CSSProperties['height']; style?: CSSProperties }) {
  return <span className="cf-skel" aria-hidden="true" style={{ width, height, ...style }} />;
}

/** Nothing to show yet: a title, one sentence and at most one way forward. */
export function EmptyState({ title, children, action }: { title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="cf-empty">
      <strong>{title}</strong>
      {children && <span>{children}</span>}
      {action}
    </div>
  );
}
