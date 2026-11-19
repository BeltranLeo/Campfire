import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router';
import { ApiError, apiGet, isFinalState, type Trade } from '../api';
import { assetInfo } from '../assets';
import { chatState, createChatFeed, createChatReader, lastRead, onChatRead, type ChatFeed, type ChatRole } from '../chat';
import { IMAGE_PREVIEW, chatRow, formatChatTime, listsChat, mapLimit, sortChatRows, type ChatEntry, type ChatRow } from '../chats';
import { Button } from '../components/Button';
import { shorten } from '../components/Provenance';
import { EmptyState, Notice, Skeleton } from '../components/States';
import { useConfig } from '../config';
import { formatAmount } from '../format';
import { usePoll } from '../hooks/usePoll';
import { readSessionKey } from '../take';
import { roleOf } from '../trade';
import { useWallet } from '../wallet';

// Chats (Chats-* screens): one row per trade whose chat is open or was, with the newest message decrypted in this
// browser, the unread count and when it was written. The list refreshes every few seconds; reading a chat on the
// trade page clears its badge here at once.

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
  const identity = wallet.status === 'connected' ? wallet.identity : null;
  const chats = useChatEntries(identity);

  return (
    <main className="s-main">
      <div className="s-pagehead">
        <h1 className="cf-title">Chats</h1>
        <p className="cf-small cf-muted">One conversation per trade, encrypted end to end.</p>
      </div>

      {!identity ? (
        <section className="cf-card">
          {/* Invented copy: adapted from My trades. */}
          <EmptyState
            title="Connect your wallet"
            action={
              <Button variant="primary" busy={wallet.status === 'pairing' || wallet.status === 'connecting'} onClick={wallet.connect}>
                Connect wallet
              </Button>
            }
          >
            Your chats are found through your wallet. Connecting needs no signature.
          </EmptyState>
        </section>
      ) : chats.data ? (
        <ChatList entries={chats.data} />
      ) : chats.error ? (
        <section className="cf-card">
          <div className="cf-stack">
            {/* Invented copy */}
            <Notice tone="danger" title="We could not load your chats">
              {chats.error instanceof ApiError ? chats.error.message : 'The server did not answer.'}
            </Notice>
            <div className="s-actions">
              <Button variant="primary" onClick={chats.reload}>
                Try again
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

function ChatList({ entries }: { entries: ChatEntry[] }) {
  // Reading a chat on the trade page records it at once; render again so its badge goes.
  const [, setReads] = useState(0);
  useEffect(() => {
    const off = onChatRead(() => setReads((n) => n + 1));
    return () => {
      off();
    };
  }, []);

  if (entries.length === 0) {
    return (
      <section className="cf-card">
        <EmptyState title="No conversations yet" action={<Button variant="primary" to="/offers">Browse offers</Button>}>
          A chat opens with every trade, so you can talk to the other person.
        </EmptyState>
      </section>
    );
  }

  const rows: Row[] = entries.map((entry) => ({ ...chatRow(entry, lastRead(entry.trade.id)), entry }));
  const active = sortChatRows(rows.filter((r) => r.active));
  const history = sortChatRows(rows.filter((r) => !r.active));
  const now = Date.now();

  return (
    <>
      {active.length > 0 && (
        <section className="cf-card" data-flush>
          {active.map((row) => (
            <ChatItem key={row.id} row={row} now={now} />
          ))}
        </section>
      )}
      {history.length > 0 && (
        <section className="cf-card" data-flush>
          <div className="s-sechead">
            {/* Invented copy: the name of the finished trades' tab on My trades. */}
            <h2 className="cf-heading">History</h2>
          </div>
          {history.map((row) => (
            <ChatItem key={row.id} row={row} now={now} />
          ))}
        </section>
      )}
      <Notice>Chats can only be read on the device that started the trade: the key never leaves it.</Notice>
    </>
  );
}

function ChatItem({ row, now }: { row: Row; now: number }) {
  const config = useConfig();
  const { trade, role } = row.entry;
  const asset = assetInfo(trade.asset, trade.assetDecimals, config);
  // The demo bot is shown by what it is; anyone else by the other side's role and shortened identity.
  const other = trade.isDemo
    ? role === 'buyer'
      ? 'Demo seller'
      : 'Demo buyer' // Invented copy
    : role === 'buyer'
      ? `Seller ${shorten(trade.sellerIdentity)}`
      : `Buyer ${shorten(trade.buyerIdentity)}`; // Invented copy: mirrors the design's "Seller …"
  return (
    <Link className="s-item" to={row.href}>
      <span className="s-cell">
        <strong>{other}</strong>
        <span className="cf-small cf-muted">
          {row.verb} {formatAmount(trade.amount, asset)} · {row.quoted ? `“${row.preview}”` : row.preview}
        </span>
      </span>
      <span className="cf-small cf-muted s-chat-time">{formatChatTime(row.at, now)}</span>
      {row.unread > 0 && (
        // Invented copy: the badge's spoken label.
        <span className="cf-badge" aria-label={`${row.unread} unread`}>
          {row.unread}
        </span>
      )}
    </Link>
  );
}
