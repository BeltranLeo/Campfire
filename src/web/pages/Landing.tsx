import type { ReactNode } from 'react';
import { Link } from 'react-router';
import { apiGet, type Offer, type Trade } from '../api';
import { assetInfo } from '../assets';
import { Button } from '../components/Button';
import { Details } from '../components/Details';
import { Icon } from '../components/Icon';
import { ProvenanceTag, SimBox } from '../components/Provenance';
import { Skeleton } from '../components/States';
import { useConfig } from '../config';
import { DSPROOF_WATCH_SEC } from '../dsproof';
import { formatRange, fromBaseUnits, paymentMethodLabel } from '../format';
import { usePoll } from '../hooks/usePoll';

// The front page (Landing-* screens): the two intentions and where to get a wallet, the demo, how a trade works
// (with why nobody waits for blocks folded under it), the latest offers and Campfire's numbers. Every number is real.

export function Landing() {
  const config = useConfig();
  const offers = usePoll(() => apiGet<{ offers: Offer[] }>('/api/offers?onlyOpen=true').then((r) => r.offers), 'offers');
  const trades = usePoll(() => apiGet<{ trades: Trade[] }>('/api/trades').then((r) => r.trades), 'trades');
  const demoOffer = offers.data?.find((o) => o.isDemo && o.document.asset === 'BCH') ?? offers.data?.find((o) => o.isDemo);

  return (
    <main className="s-main">
      <section className="s-hero">
        <div className="cf-stack">
          <h1>Buy or sell Bitcoin Cash directly with another person</h1>
          <p className="cf-muted" style={{ fontSize: 17, lineHeight: '26px', maxWidth: 520 }}>
            No exchange holds your money. A contract on the Bitcoin Cash network locks the seller’s coins until the payment
            is done.
          </p>
        </div>
        <div className="s-intents">
          <Link className="cf-quick" to="/offers?side=buy" data-variant="primary">
            <Icon name="buy" />
            I want to buy BCH<small>You don’t need any BCH to start</small>
          </Link>
          <Link className="cf-quick" to="/offers?side=sell">
            <Icon name="sell" />
            I want to sell BCH<small>Get pesos or dollars for your coins</small>
          </Link>
          <p className="s-walletlink">
            {/* Welcome asks what the person wants first, then shows how to get a wallet, then connects it. */}
            New to Bitcoin Cash? <Link to="/welcome">Get a free wallet in 2 minutes →</Link>
          </p>
        </div>
      </section>

      {/* The demo is the safest way to try, so it comes right after the two intentions. */}
      <SimBox tag="Simulated fiat" label="Try a trade without spending anything" bodyGap={3}>
        <p>
          A demo seller sends a few cents of real BCH to your wallet. The payment step is simulated: you send no money. It
          takes about three minutes.
        </p>
        <div>
          <Button to={demoOffer ? `/offers/${demoOffer.offerTxid}` : '/offers'}>Try the demo trade</Button>
        </div>
      </SimBox>

      <section className="cf-stack">
        <h2 className="cf-title">How it works</h2>
        <ol className="s-howto">
          <HowStep n={1} title="Pick an offer, or post your own">
            Choose how much, and how you want to pay or get paid.
          </HowStep>
          <HowStep n={2} title="The seller’s coins get locked">
            A contract holds them. They can only go to the buyer or back to the seller. Campfire cannot touch them.
          </HowStep>
          <HowStep n={3} title="Pay, then receive">
            The buyer pays the seller directly. When the seller confirms, the coins go to the buyer’s wallet.
          </HowStep>
        </ol>
        {/* The 0-conf explanation does not help a newcomer decide, so it is folded; its On-chain tag stays on the summary. */}
        <Details summary="Why it’s safe and fast" tag={<ProvenanceTag kind="chain">0-conf with DSProofs</ProvenanceTag>}>
          <p className="cf-muted">
            On Bitcoin Cash a payment can be trusted seconds after it reaches the network, not ten minutes later. Campfire
            relies on that for every trade, and checks it in your browser.
          </p>
          <ol className="s-howto">
            <HowStep n={1} title="The deposit is seen in seconds">
              When the seller locks the coins, the transaction reaches every node almost at once. It is not in a block yet:
              that is zero confirmations, or 0-conf.
            </HowStep>
            <HowStep n={2} title="Double spends are caught">
              If anyone tries to spend the same coins twice, Bitcoin Cash nodes broadcast a double-spend proof (DSProof)
              within seconds. Your browser asks for one.
            </HowStep>
            <HowStep n={3} title="No proof, go ahead">
              {`After ${DSPROOF_WATCH_SEC} quiet seconds the deposit is safe to act on, so you can pay. The coins you receive are usable right away too.`}
            </HowStep>
          </ol>
        </Details>
      </section>

      <section className="cf-card" data-flush>
        <div className="s-sechead">
          <h2 className="cf-heading">Latest offers</h2>
          <Link to="/offers">See all offers</Link>
        </div>
        {offers.data ? (
          offers.data.slice(0, 3).map((offer) => {
            const doc = offer.document;
            const asset = assetInfo(doc.asset, doc.assetDecimals, config);
            // Say what the visitor does: a buy offer is where *you* sell.
            const verb = doc.side === 'sell' ? 'Buy' : 'Sell';
            const deal = doc.side === 'sell' ? `pay ${doc.fiat}` : `get ${doc.fiat}`;
            return (
              <Link key={offer.offerTxid} className="s-item" to={`/offers/${offer.offerTxid}`}>
                <span className="s-cell">
                  <span>
                    <strong>
                      You {verb.toLowerCase()} {asset.symbol}
                    </strong>{' '}
                    · {deal}
                    {offer.isDemo && ' · demo'}
                  </span>
                  <span className="cf-small cf-muted">
                    {formatRange(doc.min, doc.max, asset)} · {doc.paymentMethods.map(paymentMethodLabel).join(', ')}
                  </span>
                </span>
                <span className="cf-btn" data-size="sm">
                  {verb}
                </span>
              </Link>
            );
          })
        ) : (
          <div className="s-item">
            <Skeleton width="60%" />
          </div>
        )}
      </section>

      <section className="cf-card" data-pad>
        <div className="cf-stack">
          <div className="cf-row" data-between>
            <h2 className="cf-heading">Campfire so far</h2>
            <ProvenanceTag kind="chain">Counted from mainnet</ProvenanceTag>
          </div>
          <Stats trades={trades.data} openOffers={offers.data?.length} />
          <p className="cf-small cf-subtle">
            Every number comes from real transactions you can <Link to="/transparency">check yourself</Link>.
            {trades.data && trades.data.some((t) => t.isDemo) && ' Most trades so far are demo trades, where the payment is simulated.'}
          </p>
        </div>
      </section>
    </main>
  );
}

function HowStep({ n, title, children }: { n: number; title: string; children: ReactNode }) {
  return (
    <li>
      <i>{n}</i>
      <span>
        <strong>{title}</strong>
        <span className="cf-small cf-muted">{children}</span>
      </span>
    </li>
  );
}

function Stats({ trades, openOffers }: { trades?: Trade[]; openOffers?: number }) {
  const completed = trades?.filter((t) => t.status === 'Released' || t.status === 'ResolvedBuyer');
  const sats = completed?.filter((t) => t.asset === 'BCH').reduce((sum, t) => sum + BigInt(t.amount), 0n);
  const value = (v: string | undefined) => (v === undefined ? <Skeleton width={64} height={28} /> : v);
  return (
    <div className="s-3">
      <div className="s-stat">
        <strong>{value(completed?.length.toString())}</strong>
        <span className="cf-small cf-muted">{completed?.length === 1 ? 'trade completed' : 'trades completed'}</span>
      </div>
      <div className="s-stat">
        <strong>{value(sats === undefined ? undefined : `${trimZeros(fromBaseUnits(sats, 8))} BCH`)}</strong>
        <span className="cf-small cf-muted">traded through the contract</span>
      </div>
      <div className="s-stat">
        <strong>{value(openOffers?.toString())}</strong>
        <span className="cf-small cf-muted">offers open now</span>
      </div>
    </div>
  );
}

// "0.00005000" → "0.00005"; "1.84000000" → "1.84".
const trimZeros = (decimal: string) => decimal.replace(/\.?0+$/, '');
