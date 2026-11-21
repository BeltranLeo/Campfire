import { useEffect, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { aliasFor } from '../alias';
import { ApiError, apiGet, isFinalState, type Trade } from '../api';
import { assetInfo } from '../assets';
import { chatState, createChatFeed, createChatReader, lastRead, onChatRead, type ChatFeed, type ChatRole } from '../chat';
import { IMAGE_PREVIEW, chatRow, formatChatTime, listsChat, mapLimit, sortChatRows, type ChatEntry, type ChatRow } from '../chats';
import { Button } from '../components/Button';
import { EmptyState, Notice, Skeleton } from '../components/States';
import { StatusPill } from '../components/StatusPill';
import { TradeChat } from '../components/TradeChat';
import { useConfig } from '../config';
import { formatAmount, formatFiatAmount } from '../format';
import { DESK_QUERY, useMediaQuery } from '../hooks/useMediaQuery';
import { usePoll } from '../hooks/usePoll';
import { readSessionKey } from '../take';
import { roleOf } from '../trade';
import { useWallet } from '../wallet';
import { useMessages } from '../lang';
import type { Messages } from '../messages';

// Chats (Chats-* screens): one row per trade whose chat is open or was, with the newest message decrypted in this
// browser, the unread count and when it was written. The list refreshes every few seconds; reading a chat on the
// trade page clears its badge here at once. On a wide screen the list sits on the left and the chosen conversation
// on the right (/chats?trade=<id>), so reading several chats does not mean leaving the page each time.

const REFRESH_MS = 10_000;
/** Chats fetched at once, so a long history does not fire dozens of requests together. */
const CONCURRENCY = 4;

type Reader = ReturnType<typeof createChatReader>;

/** The trades of `identity` with a chat to list, each with its newest message. */
function useChatEntries(identity: string | null) {
  // Readers keep each decrypted message by id, so a poll decrypts only what is new.
  const readers = useRef(new Map<string, Reader>());
  // One feed per chat: a poll asks the service only for the messages it has not seen.
  const feeds = useRef(new Map<string, ChatFeed>());
  // Chats of finished trades: the service takes no message once a trade ends, so they are fetched once.
  const finished = useRef(new Map<string, ChatEntry>());
  // The last good entry of each trade, kept when one chat fails to load on a later poll.
  const previous = useRef(new Map<string, ChatEntry>());

  async function loadEntry(trade: Trade, role: ChatRole, key: string | null, state: ChatEntry['state']): Promise<ChatEntry> {
    if (state === 'not-open') return { trade, role, state, messages: [] };
    const doneKey = `${trade.id}:${state}`;
    const done = finished.current.get(doneKey);
    if (done) return done;
    try {
      let feed = feeds.current.get(trade.id);
      if (!feed) feeds.current.set(trade.id, (feed = createChatFeed(trade.id)));
      const messages = await feed.load();
      const newest = messages.reduce<(typeof messages)[number] | undefined>((a, m) => (!a || m.createdAt >= a.createdAt ? m : a), undefined);
      let last: ChatEntry['last'];
      if (newest && state === 'no-key') {
        last = { text: null, createdAt: newest.createdAt };
      } else if (newest) {
        const readerKey = `${trade.id}:${role}:${key}`;
        let reader = readers.current.get(readerKey);
        if (!reader) {
          reader = createChatReader(trade, role, key);
          readers.current.set(readerKey, reader);
        }
        const [line] = await reader.read([newest]);
        last = { text: line.image ? IMAGE_PREVIEW : line.text, createdAt: line.createdAt };
      }
      const entry: ChatEntry = { trade, role, state, messages, ...(last ? { last } : {}) };
      if (isFinalState(trade.status)) finished.current.set(doneKey, entry);
      return entry;
    } catch {
      const before = previous.current.get(trade.id);
      return before && before.state === state ? { ...before, trade, role } : { trade, role, state, messages: null };
    }
  }

  return usePoll(
    async () => {
      if (!identity) return null;
      const { trades } = await apiGet<{ trades: Trade[] }>(`/api/trades?identity=${identity}`);
      const listed = trades.flatMap((trade) => {
        const role = roleOf(trade, identity);
        if (role === 'visitor') return [];
        const key = readSessionKey(trade.id);
        const state = chatState(trade, role, key);
        return state !== 'visitor' && listsChat(trade, state) ? [{ trade, role, key, state }] : [];
      });
      const entries = await mapLimit(listed, CONCURRENCY, (c) => loadEntry(c.trade, c.role, c.key, c.state));
      previous.current = new Map(entries.map((e) => [e.trade.id, e]));
      return entries;
    },
    identity ?? 'none',
    REFRESH_MS,
  );
}

export function Chats() {
  const wallet = useWallet();
  const messages = useMessages();
  const t = messages.chats;
  const identity = wallet.status === 'connected' ? wallet.identity : null;
  const chats = useChatEntries(identity);
  const desk = useMediaQuery(DESK_QUERY);
  const split = desk && Boolean(chats.data && chats.data.length > 0);

  return (
    <main className="s-main" data-desk={split ? 'wide' : undefined}>
      <div className="s-pagehead">
        <h1 className="cf-title">{t.title}</h1>
        <p className="cf-small cf-muted">{t.lead}</p>
      </div>

      {!identity ? (
        <section className="cf-card">
          {/* Invented copy: adapted from My trades. */}
          <EmptyState
            title={t.connectTitle}
            action={
              <Button variant="primary" busy={wallet.status === 'pairing' || wallet.status === 'connecting'} onClick={wallet.connect}>
                {t.connect}
              </Button>
            }
          >
            {t.connectBody}
          </EmptyState>
        </section>
      ) : chats.data ? (
        <ChatList entries={chats.data} split={split} />
      ) : chats.error ? (
        <section className="cf-card">
          <div className="cf-stack">
            {/* Invented copy */}
            <Notice tone="danger" title={t.loadError}>
              {chats.error instanceof ApiError ? chats.error.message : t.serverSilent}
            </Notice>
            <div className="s-actions">
              <Button variant="primary" onClick={chats.reload}>
                {messages.common.tryAgain}
              </Button>
            </div>
          </div>
        </section>
      ) : (
        <ListSkeleton />
      )}
    </main>
  );
}

function ListSkeleton() {
  return (
    <section className="cf-card" data-flush aria-busy="true">
      {[0, 1].map((i) => (
        <div key={i} className="s-item">
          <span className="s-cell">
            <Skeleton width="45%" height={16} />
            <Skeleton width="70%" />
          </span>
        </div>
      ))}
    </section>
  );
}

type Row = ChatRow & { entry: ChatEntry };

function ChatList({ entries, split }: { entries: ChatEntry[]; split: boolean }) {
  // Reading a chat on the trade page records it at once; render again so its badge goes.
  const [, setReads] = useState(0);
  const t = useMessages().chats;
  useEffect(() => {
    const off = onChatRead(() => setReads((n) => n + 1));
    return () => {
      off();
    };
  }, []);

  if (entries.length === 0) {
    return (
      <section className="cf-card">
        <EmptyState
          title={t.empty}
          action={
            <Button variant="primary" to="/offers">
              {t.browseOffers}
            </Button>
          }
        >
          {t.emptyBody}
        </EmptyState>
      </section>
    );
  }

  const rows: Row[] = entries.map((entry) => ({ ...chatRow(entry, lastRead(entry.trade.id)), entry }));
  const active = sortChatRows(rows.filter((r) => r.active));
  const history = sortChatRows(rows.filter((r) => !r.active));
  const now = Date.now();
  // Side by side, the conversation shown is the one in the address, or else the first in the list.
  const [params] = useSearchParams();
  const asked = params.get('trade');
  const shown = split ? (rows.find((r) => r.id === asked) ?? active[0] ?? history[0]) : undefined;
  const item = (row: Row) => <ChatItem key={row.id} row={row} now={now} split={split} current={row === shown} />;

  const list = (
    <>
      {active.length > 0 && (
        <section className="cf-card" data-flush>
          {active.map(item)}
        </section>
      )}
      {history.length > 0 && (
        <section className="cf-card" data-flush>
          <div className="s-sechead">
            {/* Invented copy: the name of the finished trades' tab on My trades. */}
            <h2 className="cf-heading">{t.history}</h2>
          </div>
          {history.map(item)}
        </section>
      )}
      <Notice>{t.deviceOnly}</Notice>
    </>
  );

  if (!shown) return list;
  return (
    <div className="ch-split">
      <div className="ch-list">{list}</div>
      <ChatPane key={shown.id} entry={shown.entry} />
    </div>
  );
}

/** The chosen conversation beside the list: who and what the trade is, a way to the trade, and its chat. */
function ChatPane({ entry }: { entry: ChatEntry }) {
  const config = useConfig();
  const { trade, role } = entry;
  const asset = assetInfo(trade.asset, trade.assetDecimals, config);
  const t = useMessages().chats;
  return (
    <div className="ch-pane">
      <section className="cf-card" data-pad>
        <div className="ch-panehead">
          <div className="cf-stack" data-gap="1">
            <strong className="cf-heading">{otherParty(t, trade, role)}</strong>
            <span className="cf-small cf-muted">
              {/* Invented copy */}
              {t.dealing(role, formatAmount(trade.amount, asset), formatFiatAmount(trade.fiatAmount, trade.fiat))}
            </span>
            <span>
              <StatusPill state={trade.status} role={role} side={trade.side} />
            </span>
          </div>
          {/* Invented copy */}
          <Button to={`/trade/${trade.id}`}>{t.openTrade}</Button>
        </div>
      </section>
      <TradeChat trade={trade} role={role} />
    </div>
  );
}

/** The other side of the trade as the list names them: the demo bot by what it is, anyone else by role and name. */
function otherParty(t: Messages['chats'], trade: Trade, role: ChatEntry['role']): string {
  if (trade.isDemo) return role === 'buyer' ? t.demoSeller : t.demoBuyer; // Invented copy
  // Invented copy: mirrors the design's "Seller …"
  return role === 'buyer' ? t.sellerNamed(aliasFor(trade.sellerIdentity).name) : t.buyerNamed(aliasFor(trade.buyerIdentity).name);
}

function ChatItem({ row, now, split, current }: { row: Row; now: number; split: boolean; current: boolean }) {
  const config = useConfig();
  const { trade, role } = row.entry;
  const asset = assetInfo(trade.asset, trade.assetDecimals, config);
  const t = useMessages().chats;
  const other = otherParty(t, trade, role);
  // Side by side a row opens its chat on the right; otherwise it goes to the trade page.
  return (
    <Link
      className="s-item"
      to={split ? `/chats?trade=${encodeURIComponent(trade.id)}` : row.href}
      replace={split}
      aria-current={current ? 'true' : undefined}
    >
      <span className="s-cell">
        <strong>{other}</strong>
        <span className="cf-small cf-muted">
          {row.verb} {formatAmount(trade.amount, asset)} · {row.quoted ? `“${row.preview}”` : row.preview}
        </span>
      </span>
      <span className="cf-small cf-muted s-chat-time">{formatChatTime(row.at, now)}</span>
      {row.unread > 0 && (
        // Invented copy: the badge's spoken label.
        <span className="cf-badge" aria-label={t.unread(row.unread)}>
          {row.unread}
        </span>
      )}
    </Link>
  );
}
