import type { TradeState } from '../api';

// A trade's state as a short label. The text depends on who is looking: the party whose turn it is
// reads "your …" in the active tone, the other party waits in the idle tone, and a visitor sees
// the neutral wording. Written for sell offers; buy offers swap who accepts (handled with them).

export type TradeRole = 'buyer' | 'seller' | 'visitor';
type Tone = 'active' | 'done' | 'warn' | 'danger' | 'idle' | undefined;

function pill(state: TradeState, role: TradeRole): [string, Tone] {
  const turn = (who: TradeRole, mine: string, theirs: string): [string, Tone] =>
    role === who ? [mine, 'active'] : [theirs, role === 'visitor' ? 'active' : 'idle'];

  switch (state) {
    case 'Requested':
      return turn('seller', 'Waiting for you', 'Waiting for seller');
    case 'Accepted':
      return turn('seller', 'Waiting for your deposit', 'Waiting for deposit');
    case 'Funded':
      return turn('buyer', 'Waiting for your payment', 'Waiting for payment');
    case 'Paid':
      return turn('seller', 'Paid, waiting for your release', 'Paid, waiting for release');
    case 'Disputed':
      return ['In dispute', 'danger'];
    case 'Released':
      return ['Completed', 'done'];
    case 'ResolvedBuyer':
      return ['Resolved for buyer', 'done'];
    case 'ResolvedSeller':
      return ['Resolved for seller', undefined];
    case 'Refunded':
      return ['Returned to seller', undefined];
    case 'Cancelled':
    case 'Dropped':
      return ['Cancelled', undefined];
  }
}

export function StatusPill({ state, role }: { state: TradeState; role: TradeRole }) {
  const [text, tone] = pill(state, role);
  return (
    <span className="cf-pill" data-tone={tone}>
      {text}
    </span>
  );
}
