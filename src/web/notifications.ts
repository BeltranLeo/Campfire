// In-app notifications while the page is open: which trades need this person, which chats have unread messages,
// and what changed between two reads of the trades (a new request, a turn, a dispute or an ending, a new message).
// No DOM here; the provider in components/Notifications.tsx polls and shows the toasts. See test/notifications.test.ts.

import { isFinalState, type ChatMessage, type Trade } from './api';
import { unreadCount, type ChatRole } from './chat';
import { nextStep } from './mytrades';
import { roleOf } from './trade';

const nowSeconds = () => Math.floor(Date.now() / 1000);

/**
 * Whether the trade waits for this person: the same rule as the "your turn" rows on My trades, so the counter and the
 * list always agree. A request or deposit window that already ended is no longer a turn.
 */
export function needsAction(trade: Trade, identity: string | null, now = nowSeconds()): boolean {
  const role = roleOf(trade, identity);
  if (role === 'visitor' || isFinalState(trade.status)) return false;
  return nextStep(trade, role, now).turn;
}

/** One chat as the counters see it: how many messages are unread, and when the other party last wrote. */
export interface ChatSnapshot {
  unread: number;
  /** `createdAt` of the other party's newest message, 0 if they have not written. */
  latestPeerAt: number;
}

/** One read of this person's trades, and of the chats that could be read in this browser, keyed by `trade.id`. */
export interface Snapshot {
  trades: Record<string, Trade>;
  chats: Record<string, ChatSnapshot>;
}

export function chatSnapshot(messages: Pick<ChatMessage, 'senderRole' | 'createdAt'>[], myRole: ChatRole, lastReadAt: number): ChatSnapshot {
  const latestPeerAt = messages.reduce(
    (max, m) => (m.senderRole !== undefined && m.senderRole !== myRole ? Math.max(max, m.createdAt) : max),
    0,
  );
  return { unread: unreadCount(messages, myRole, lastReadAt), latestPeerAt };
}

/**
 * Builds a snapshot. `chats` holds the messages of the chats that were read (open chats only); `lastRead` gives the
 * newest `createdAt` this browser has shown for a trade.
 */
export function makeSnapshot(
  trades: Trade[],
  chats: ReadonlyMap<string, ChatMessage[]>,
  identity: string,
  lastRead: (tradeRecordId: string) => number,
): Snapshot {
  const snapshot: Snapshot = { trades: {}, chats: {} };
  for (const trade of trades) {
    snapshot.trades[trade.id] = trade;
    const role = roleOf(trade, identity);
    const messages = chats.get(trade.id);
    if (messages && role !== 'visitor') snapshot.chats[trade.id] = chatSnapshot(messages, role, lastRead(trade.id));
  }
  return snapshot;
}

export interface Counts {
  /** Trades waiting for this person. */
  trades: number;
  /** Unread messages across the open chats. */
  chats: number;
}

export function countsOf(snapshot: Snapshot | null, identity: string | null, now = nowSeconds()): Counts {
  if (!snapshot || !identity) return { trades: 0, chats: 0 };
  const trades = Object.values(snapshot.trades).filter((t) => needsAction(t, identity, now)).length;
  const chats = Object.values(snapshot.chats).reduce((sum, c) => sum + c.unread, 0);
  return { trades, chats };
}

/** "(3) Campfire" while something waits for this person, the plain title otherwise. */
export function documentTitle(base: string, counts: Counts): string {
  const n = counts.trades + counts.chats;
  return n > 0 ? `(${n}) ${base}` : base;
}

export type NotificationEvent =
  /** A trade this person has to accept or decline appeared. */
  | { kind: 'request'; trade: Trade }
  /** A trade moved to a state where this person has to act. */
  | { kind: 'turn'; trade: Trade }
  /** The other party opened a dispute. */
  | { kind: 'disputed'; trade: Trade }
  /** The trade reached a final state. */
  | { kind: 'ended'; trade: Trade }
  /** The other party wrote in the chat; `unread` is how many messages are unread now. */
  | { kind: 'message'; trade: Trade; unread: number };

/**
 * What changed between two snapshots, from this person's point of view. With no previous snapshot (the first read
 * after connecting or reloading) nothing is reported, so a reload does not replay every trade.
 *
 * - A trade seen for the first time is reported only as a request this person has to answer; any other new trade
 *   was started by them (taking a demo offer returns it already funded).
 * - A trade whose state changed gives at most one event: a dispute, an ending, or a turn.
 * - A chat is reported when the other party's newest message is newer than both the previous read and what this
 *   browser has already shown (`lastRead`), and is still unread. Comparing times rather than counts means a chat
 *   read in between does not hide the next message.
 */
export function diff(
  previous: Snapshot | null,
  current: Snapshot,
  identity: string,
  lastRead: (tradeRecordId: string) => number = () => 0,
  now = nowSeconds(),
): NotificationEvent[] {
  if (!previous) return [];
  const events: NotificationEvent[] = [];
  const messages: NotificationEvent[] = [];

  for (const trade of Object.values(current.trades)) {
    const role = roleOf(trade, identity);
    if (role === 'visitor') continue;
    const before = previous.trades[trade.id];

    if (!before) {
      if (trade.status === 'Requested' && needsAction(trade, identity, now)) events.push({ kind: 'request', trade });
    } else if (before.status !== trade.status) {
      if (trade.status === 'Disputed') {
        // Whoever opened the dispute did it from the trade page and knows.
        if (trade.disputedBy !== role) events.push({ kind: 'disputed', trade });
      } else if (isFinalState(trade.status)) {
        // Only the buyer cancels, from the trade page.
        if (!(trade.status === 'Cancelled' && role === 'buyer')) events.push({ kind: 'ended', trade });
      } else if (needsAction(trade, identity, now)) {
        events.push({ kind: 'turn', trade });
      }
    }

    const chat = current.chats[trade.id];
    if (chat && chat.unread > 0 && before) {
      const seen = Math.max(previous.chats[trade.id]?.latestPeerAt ?? 0, lastRead(trade.id));
      if (chat.latestPeerAt > seen) messages.push({ kind: 'message', trade, unread: chat.unread });
    }
  }
  // State changes first: they usually ask for something, a message can wait a few seconds.
  return [...events, ...messages];
}

/** The trade an event points to: its page, scrolled to the chat for a message. */
export const eventHref = (event: NotificationEvent) => `/trade/${event.trade.id}${event.kind === 'message' ? '?chat' : ''}`;

export interface Toast {
  /** Short label above the title. */
  label: string;
  title: string;
  /** Which trade: "Selling 0.0015 BCH for 0.70 USD". */
  body: string;
  href: string;
  tone: 'attention' | 'arbiter' | 'verified' | 'escrow' | 'neutral';
}

/**
 * The toast for an event. `what` names the trade ("Selling 0.0015 BCH for 0.70 USD", from `rowTitle`). The turn
 * copy is the step My trades shows; a message toast never carries the message itself, which stays encrypted until
 * the chat opens it.
 */
export function toastFor(event: NotificationEvent, identity: string, what: string, now = nowSeconds()): Toast {
  const { trade } = event;
  const role = roleOf(trade, identity);
  const href = eventHref(event);
  const other = role === 'buyer' ? 'seller' : 'buyer';
  const step = role === 'visitor' ? '' : nextStep(trade, role, now).step;
  // Invented copy: the design has no notifications; every label and title below is ours.
  switch (event.kind) {
    case 'request':
      return { label: 'New request', title: step, body: what, href, tone: 'attention' };
    case 'turn':
      return { label: 'Your turn', title: step, body: what, href, tone: 'attention' };
    case 'disputed':
      return { label: 'Dispute', title: `The ${other} opened a dispute`, body: what, href, tone: 'arbiter' };
    case 'message':
      return {
        label: 'New message',
        title: event.unread > 1 ? `${event.unread} unread messages from the ${other}` : `The ${other} sent you a message`,
        body: what,
        href,
        tone: 'escrow',
      };
    case 'ended':
      return { label: 'Trade ended', title: endedTitle(trade), body: what, href, tone: trade.status === 'Released' || trade.status === 'ResolvedBuyer' || trade.status === 'ResolvedSeller' ? 'verified' : 'neutral' };
  }
}

// Invented copy.
function endedTitle(trade: Trade): string {
  switch (trade.status) {
    case 'Released':
      return 'Completed: the coins were released to the buyer';
    case 'ResolvedBuyer':
      return 'The arbiter decided for the buyer';
    case 'ResolvedSeller':
      return trade.disputedAt ? 'The arbiter decided for the seller' : 'The payment window ended; the coins went back to the seller';
    case 'Refunded':
      return 'The coins went back to the seller after the refund time';
    case 'Cancelled':
      return 'The buyer cancelled the trade';
    default:
      return 'The trade ended before the coins were locked';
  }
}

/** The record id of the trade whose page is open, from a route path such as "/trade/abc" or "/trade/abc/arbiter". */
export function openTradeId(pathname: string): string | null {
  return pathname.match(/^\/trade\/([^/?#]+)/)?.[1] ?? null;
}
