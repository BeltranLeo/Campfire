import type { TradeState } from '../api';
import { useLang } from '../lang';
import { text } from '../messages';

// A trade's state as a short label, tinted by meaning. The party whose turn it is reads "your …" in amber (it depends
// on them and has a deadline); the other party and visitors see blue (someone else or the contract is working).
// Green for an ending that went the reader's way (a release; a verdict for their side), violet for a dispute, grey for
// an ending without a trade or one that went against the reader.
// On a buy offer the buyer accepts the request, so `Requested` is the buyer's turn.

export type TradeRole = 'buyer' | 'seller' | 'visitor';
type Tone = 'attention' | 'escrow' | 'verified' | 'arbiter' | undefined;

function pill(state: TradeState, role: TradeRole, side: 'sell' | 'buy'): [string, Tone] {
  const t = text().trade.pill;
  const turn = (who: TradeRole, mine: string, theirs: string): [string, Tone] =>
    role === who ? [mine, 'attention'] : [theirs, 'escrow'];

  switch (state) {
    case 'Requested':
      return side === 'buy' ? turn('buyer', t.waitingYou, t.waitingBuyer) : turn('seller', t.waitingYou, t.waitingSeller);
    case 'Accepted':
      return turn('seller', t.waitingYourDeposit, t.waitingDeposit);
    case 'Funded':
      return turn('buyer', t.waitingYourPayment, t.waitingPayment);
    case 'Paid':
      return turn('seller', t.waitingYourRelease, t.waitingRelease);
    case 'Disputed':
      return [t.inDispute, 'arbiter'];
    case 'Released':
      return [t.completed, 'verified'];
    // A verdict is good news only for the side it favours: the buyer who lost does not read it in green.
    case 'ResolvedBuyer':
      return [t.resolvedBuyer, role === 'seller' ? undefined : 'verified'];
    case 'ResolvedSeller':
      return [t.resolvedSeller, role === 'buyer' ? undefined : 'verified'];
    case 'Refunded':
      return [t.returned, undefined];
    case 'Cancelled':
      return [t.cancelled, undefined];
    // Dropped is not a cancellation: nobody locked anything, so the trade never began.
    case 'Dropped':
      return [t.neverStarted, undefined];
  }
}

export function StatusPill({ state, role, side = 'sell' }: { state: TradeState; role: TradeRole; side?: 'sell' | 'buy' }) {
  useLang(); // re-render on a language switch
  const [label, tone] = pill(state, role, side);
  return (
    <span className="cf-pill" data-tone={tone}>
      {label}
    </span>
  );
}
