import type { TradeState } from '../api';

// A trade's state as a short label, tinted by meaning. The party whose turn it is reads "your …" in amber (it depends
// on them and has a deadline); the other party and visitors see blue (someone else or the contract is working).
// Green only for a release confirmed on the network, violet for a dispute, grey for an ending without a trade.
// On a buy offer the buyer accepts the request, so `Requested` is the buyer's turn.

export type TradeRole = 'buyer' | 'seller' | 'visitor';
type Tone = 'attention' | 'escrow' | 'verified' | 'arbiter' | undefined;

function pill(state: TradeState, role: TradeRole, side: 'sell' | 'buy'): [string, Tone] {
  const turn = (who: TradeRole, mine: string, theirs: string): [string, Tone] =>
    role === who ? [mine, 'attention'] : [theirs, 'escrow'];

  switch (state) {
    case 'Requested':
      return side === 'buy' ? turn('buyer', 'Waiting for you', 'Waiting for buyer') : turn('seller', 'Waiting for you', 'Waiting for seller');
    case 'Accepted':
      return turn('seller', 'Waiting for your deposit', 'Waiting for deposit');
    case 'Funded':
      return turn('buyer', 'Waiting for your payment', 'Waiting for payment');
    case 'Paid':
      return turn('seller', 'Paid, waiting for your release', 'Paid, waiting for release');
    case 'Disputed':
      return ['In dispute', 'arbiter'];
    case 'Released':
      return ['Completed', 'verified'];
    case 'ResolvedBuyer':
      return ['Resolved for buyer', 'verified'];
    case 'ResolvedSeller':
      return ['Resolved for seller', 'verified'];
    case 'Refunded':
      return ['Returned to seller', undefined];
    case 'Cancelled':
    case 'Dropped':
      return ['Cancelled', undefined];
  }
}

export function StatusPill({ state, role, side = 'sell' }: { state: TradeState; role: TradeRole; side?: 'sell' | 'buy' }) {
  const [text, tone] = pill(state, role, side);
  return (
    <span className="cf-pill" data-tone={tone}>
      {text}
    </span>
  );
}
