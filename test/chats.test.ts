import { describe, expect, it } from 'vitest';
import type { Trade, TradeState } from '../src/web/api.js';
import {
  chatRow,
  formatChatTime,
  KEY_ELSEWHERE,
  listsChat,
  mapLimit,
  NO_MESSAGES,
  NOT_LOADED,
  OPENS_ON_ACCEPT,
  previewText,
  sortChatRows,
  UNREADABLE_MESSAGE,
  type ChatEntry,
} from '../src/web/chats.js';

const trade = (status: TradeState, extra: Partial<Trade> = {}): Trade => ({
  id: 'rec1',
  status,
  offerTxid: 'o',
  buyerIdentity: 'buyer',
  sellerIdentity: 'seller',
  asset: 'BCH',
  assetDecimals: 8,
  amount: '15000',
  fiat: 'USD',
  fiatAmount: '0.07',
  arbiterPk: '02',
  createdAt: 1000,
  updatedAt: 1100,
  ...extra,
});

const entry = (extra: Partial<ChatEntry> = {}): ChatEntry => ({
  trade: trade('Funded'),
  role: 'buyer',
  state: 'open',
  messages: [],
  ...extra,
});

describe('which trades get a row', () => {
  it('lists every chat that is open or was, and a request while it lasts', () => {
    expect(listsChat(trade('Funded'), 'open')).toBe(true);
    expect(listsChat(trade('Released'), 'closed')).toBe(true);
    expect(listsChat(trade('Paid'), 'no-key')).toBe(true);
    expect(listsChat(trade('Requested'), 'not-open')).toBe(true);
  });

  it('skips visitors and requests that ended before a chat opened', () => {
    expect(listsChat(trade('Funded'), 'visitor')).toBe(false);
    expect(listsChat(trade('Dropped'), 'not-open')).toBe(false);
    // An active trade without session keys (from before the chat) will never have one.
    expect(listsChat(trade('Accepted'), 'not-open')).toBe(false);
  });
});

describe('the message preview', () => {
  it('keeps short messages and flattens line breaks', () => {
    expect(previewText('  Thanks,\nchecking my bank now. ')).toBe('Thanks, checking my bank now.');
  });

  it('cuts long ones to the limit with an ellipsis, without splitting a character', () => {
    const cut = previewText('a'.repeat(100));
    expect(Array.from(cut)).toHaveLength(60);
    expect(cut.endsWith('…')).toBe(true);
    const emoji = previewText('😀'.repeat(70));
    expect(Array.from(emoji)).toHaveLength(60);
    expect(emoji).not.toMatch(/�/);
  });
});

describe('a row', () => {
  it('quotes the newest message and counts the other side’s unread ones', () => {
    const row = chatRow(
      entry({
        messages: [
          { senderRole: 'seller', createdAt: 1200 },
          { senderRole: 'buyer', createdAt: 1300 },
          { senderRole: 'seller', createdAt: 1400 },
        ],
        last: { text: 'Thanks, checking my bank now.', createdAt: 1400 },
      }),
      1200,
    );
    expect(row).toMatchObject({
      href: '/trade/rec1?chat',
      verb: 'Buying',
      preview: 'Thanks, checking my bank now.',
      quoted: true,
      unread: 1,
      at: 1400,
      active: true,
    });
  });

  it('says so when there are no messages and uses the trade’s time', () => {
    expect(chatRow(entry(), 0)).toMatchObject({ preview: NO_MESSAGES, quoted: false, unread: 0, at: 1100 });
  });

  it('links a request to the trade, since the chat is not open yet', () => {
    expect(chatRow(entry({ trade: trade('Requested'), state: 'not-open' }), 0)).toMatchObject({
      href: '/trade/rec1',
      preview: OPENS_ON_ACCEPT,
    });
  });

  it('shows no text and no badge without this browser’s key, which could never be cleared', () => {
    const row = chatRow(entry({ state: 'no-key', messages: [{ senderRole: 'seller', createdAt: 1400 }], last: { text: null, createdAt: 1400 } }), 0);
    expect(row).toMatchObject({ preview: KEY_ELSEWHERE, quoted: false, unread: 0, at: 1400 });
  });

  it('notes a message that could not be decrypted, and messages that could not be loaded', () => {
    expect(chatRow(entry({ messages: [{ senderRole: 'seller', createdAt: 1400 }], last: { text: null, createdAt: 1400 } }), 0).preview).toBe(UNREADABLE_MESSAGE);
    expect(chatRow(entry({ messages: null }), 0)).toMatchObject({ preview: NOT_LOADED, unread: 0 });
  });

  it('describes the trade from the viewer’s side, in the past once the buyer has the coins', () => {
    expect(chatRow(entry({ role: 'seller' }), 0).verb).toBe('Selling');
    expect(chatRow(entry({ trade: trade('Released'), state: 'closed' }), 0)).toMatchObject({ verb: 'Bought', active: false });
    expect(chatRow(entry({ trade: trade('Released'), state: 'closed', role: 'seller' }), 0).verb).toBe('Sold');
    expect(chatRow(entry({ trade: trade('Cancelled'), state: 'closed' }), 0).verb).toBe('Buying');
  });
});

describe('the order', () => {
  it('puts unread chats first, then the newest', () => {
    const rows = [
      { id: 'old', unread: 0, at: 100 },
      { id: 'new', unread: 0, at: 300 },
      { id: 'unread-old', unread: 2, at: 50 },
      { id: 'unread-new', unread: 1, at: 200 },
    ];
    expect(sortChatRows(rows).map((r) => r.id)).toEqual(['unread-new', 'unread-old', 'new', 'old']);
  });
});

describe('the time', () => {
  const now = new Date(2026, 10, 19, 18, 0).getTime();
  const at = (d: Date) => Math.floor(d.getTime() / 1000);

  it('is a clock time today and a short date before', () => {
    expect(formatChatTime(at(new Date(2026, 10, 19, 14, 22)), now)).toBe('14:22');
    expect(formatChatTime(at(new Date(2026, 10, 19, 0, 5)), now)).toBe('00:05');
    expect(formatChatTime(at(new Date(2026, 10, 18, 23, 59)), now)).toBe('18 Nov');
  });
});

describe('loading with limited concurrency', () => {
  it('keeps the input order and never runs more than the limit at once', async () => {
    let running = 0;
    let peak = 0;
    const results = await mapLimit([5, 1, 4, 2, 3, 0, 6], 3, async (n) => {
      running++;
      peak = Math.max(peak, running);
      await new Promise((r) => setTimeout(r, n));
      running--;
      return n * 10;
    });
    expect(results).toEqual([50, 10, 40, 20, 30, 0, 60]);
    expect(peak).toBe(3);
  });

  it('handles an empty list', async () => {
    expect(await mapLimit([], 4, async () => 1)).toEqual([]);
  });
});
