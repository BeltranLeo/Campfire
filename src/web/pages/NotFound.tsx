import { Button } from '../components/Button';
import { useMessages } from '../lang';

// Any address that matches no route, such as a mistyped link.
export function NotFound() {
  const t = useMessages().notFound;
  return (
    <main className="s-main" data-narrow>
      <div className="s-pagehead">
        <h1 className="cf-display">{t.title}</h1>
        <p className="cf-muted">{t.body}</p>
      </div>
      <div>
        <Button variant="primary" to="/">
          {t.home}
        </Button>
      </div>
    </main>
  );
}
