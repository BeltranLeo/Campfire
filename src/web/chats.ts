// The /chats list: which trades have a chat to list, what each row says, and in what order. No DOM here, so
// test/chats.test.ts can check every case; Chats.tsx fetches the messages and draws the rows.

import { isFinalState, type ChatMessage, type Trade } from './api';
import { unreadCount, type ChatLine, type ChatRole, type ChatState } from './chat';
import { formatDayMonth, formatHourMinute } from './format';
import { MESSAGES, text } from './messages';

/** Longest message preview, in characters, before it is cut with an ellipsis. */
export const PREVIEW_CHARS = 60;

// The notes shown instead of a message preview, in English; chatRow words them in the chosen language.
const EN = MESSAGES.en.chats;
export const NO_MESSAGES = EN.noMessages;
// Invented copy: the other notes shown instead of a message preview.
export const OPENS_ON_ACCEPT = EN.opensOnAccept;
export const KEY_ELSEWHERE = EN.keyElsewhere;
export const UNREADABLE_MESSAGE = EN.unreadable;
/** The Chats row for a receipt image: the preview is text, so it says what was sent. A marker, worded by chatRow. */
export const IMAGE_PREVIEW = EN.imagePreview;
export const NOT_LOADED = EN.notLoaded;

/**
 * Whether a trade gets a row: every trade whose chat exists or existed. A request not yet accepted is listed too
 * while it lasts, since its chat opens on acceptance; any other trade without a chat (one that ended before
 * acceptance, or an old one without session keys) never had one.
 */
export function listsChat(trade: Pick<Trade, 'status'>, state: ChatState): boolean {
  if (state === 'visitor') return false;
  if (state === 'not-open') return trade.status === 'Requested';
  return true;
}

/** One trade's chat as loaded for the list. */
export interface ChatEntry {
  trade: Trade;
  role: ChatRole;
  state: Exclude<ChatState, 'visitor'>;
  /** Every message's role and time, for the unread count; null when they could not be loaded. */
  messages: Pick<ChatMessage, 'senderRole' | 'createdAt'>[] | null;
  /** The newest message as this browser read it; absent when there is none. */
  last?: Pick<ChatLine, 'text' | 'createdAt'>;
}

export interface ChatRow {
  id: string;
  href: string;
  /** "Buying" or "Selling", "Bought" or "Sold" once the buyer has the coins. */
  verb: string;
  /** A quoted message, or a short note when there is no message to show. */
  preview: string;
  /** True when `preview` is a message rather than a note. */
  quoted: boolean;
  unread: number;
  /** Unix seconds of the last message, or of the trade's last change without one. Shown and sorted by. */
  at: number;
  active: boolean;
}

/** One line of text at most `max` characters long, cut with an ellipsis. Counts characters, not UTF-16 units. */
export function previewText(text: string, max = PREVIEW_CHARS): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  const chars = Array.from(flat);
  return chars.length > max ? `${chars.slice(0, max - 1).join('').trimEnd()}…` : flat;
}

function verbOf(trade: Pick<Trade, 'status'>, role: ChatRole): string {
  const done = trade.status === 'Released' || trade.status === 'ResolvedBuyer';
  return text().chats.verb(role === 'seller', done);
}

/**
 * The row for one chat. `lastReadAt` is `lastRead(trade.id)`. Without this browser's key the chat card cannot show
 * the messages, so it never marks them read: those rows show no unread count rather than one that never clears.
 */
export function chatRow(entry: ChatEntry, lastReadAt: number): ChatRow {
  const { trade, role, state, messages, last } = entry;
  const t = text().chats;
  let preview: string;
  let quoted = false;
  if (state === 'not-open') preview = t.opensOnAccept;
  else if (messages === null) preview = t.notLoaded;
  else if (!last) preview = t.noMessages;
  else if (state === 'no-key') preview = t.keyElsewhere;
  else if (last.text === null) preview = t.unreadable;
  else {
    preview = previewText(last.text === IMAGE_PREVIEW ? t.imagePreview : last.text);
    quoted = true;
  }
  const readable = state === 'open' || state === 'closed';
  return {
    id: trade.id,
    // The chat card exists once the chat opens; before that the trade page itself is the place to go.
    href: state === 'not-open' ? `/trade/${trade.id}` : `/trade/${trade.id}?chat`,
    verb: verbOf(trade, role),
    preview,
    quoted,
    unread: readable && messages ? unreadCount(messages, role, lastReadAt) : 0,
    at: last?.createdAt ?? trade.updatedAt,
    active: !isFinalState(trade.status),
  };
}

/** Unread chats first, then the most recent activity. */
export const sortChatRows = <T extends Pick<ChatRow, 'unread' | 'at'>>(rows: T[]): T[] =>
  [...rows].sort((a, b) => Number(b.unread > 0) - Number(a.unread > 0) || b.at - a.at);

/** "14:22" for a time today, "16 Nov" before. `now` is milliseconds, like `Date.now()`. */
export function formatChatTime(seconds: number, now = Date.now()): string {
  const date = new Date(seconds * 1000);
  const today = new Date(now);
  const sameDay =
    date.getFullYear() === today.getFullYear() && date.getMonth() === today.getMonth() && date.getDate() === today.getDate();
  return sameDay ? formatHourMinute(date) : formatDayMonth(seconds);
}

/**
 * `fn` over every item with at most `limit` running at once, results in input order. A long history then does not
 * fire dozens of requests together. `fn` should handle its own errors: one rejection rejects the whole map.
 */
export async function mapLimit<T, R>(items: readonly T[], limit: number, fn: (item: T, index: number) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const index = next++;
      results[index] = await fn(items[index], index);
    }
  };
  await Promise.all(Array.from({ length: Math.min(Math.max(1, limit), items.length) }, worker));
  return results;
}
