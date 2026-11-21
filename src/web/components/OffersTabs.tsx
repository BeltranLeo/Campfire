import { Link } from 'react-router';
import { useMessages } from '../lang';

// The two lists of the Offers section: every open offer, and the ones this wallet published. Shown only with a
// connected wallet, since a visitor has no offers of their own.

export function OffersTabs({ current, openCount }: { current: 'all' | 'mine'; openCount?: number }) {
  const t = useMessages().myoffers;
  return (
    <nav className="s-tabs" aria-label={t.sections}>
      <Link to="/offers" aria-current={current === 'all' ? 'page' : undefined}>
        {t.allOffers}
      </Link>
      <Link to="/offers/mine" aria-current={current === 'mine' ? 'page' : undefined}>
        {t.myOffers}
        {openCount ? <span className="cf-badge">{openCount}</span> : null}
      </Link>
    </nav>
  );
}
