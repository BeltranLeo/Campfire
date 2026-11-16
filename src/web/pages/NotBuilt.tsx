// Temporary stand-in for pages still in progress. It states plainly that nothing works here yet.
export function NotBuilt({ title }: { title: string }) {
  return (
    <main className="s-main" data-narrow>
      <div className="s-pagehead">
        <h1 className="cf-display">{title}</h1>
        <p className="cf-muted">This page is not built yet. The API is available under /api.</p>
      </div>
    </main>
  );
}
