import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { Link, useLocation, useNavigate } from 'react-router';
import { alertsOn, notifySystem, onAlertsChange, ping } from '../alerts';
import { apiGet, type ChatMessage, type Trade } from '../api';
import { assetInfo } from '../assets';
import { chatState, createChatFeed, lastRead, onChatRead, type ChatFeed } from '../chat';
import { useConfig } from '../config';
import { formatAmount, formatFiatAmount } from '../format';
import { rowTitle } from '../mytrades';
import {
  chatSnapshot,
  countsOf,
  diff,
  documentTitle,
  makeSnapshot,
  openTradeId,
  toastFor,
  type Counts,
  type NotificationEvent,
  type Snapshot,
} from '../notifications';
import { readSessionKey } from '../take';
import { roleOf } from '../trade';

// In-app notifications while the page is open and a wallet is connected: the counters on Trades and Chats, the
// count in the tab title, and a short toast when something happens. Nothing is pushed: this page polls the service,
// so nothing arrives once the tab is closed.

const POLL_MS = 10_000;
/** A hidden tab still updates the title, just less often. */
const HIDDEN_POLL_MS = 60_000;
/** With alerts on, a hidden tab is the one that should ping, so it reads more often. */
const HIDDEN_ALERT_POLL_MS = 15_000;
/** The events that ask this person to do something: these ping and raise a system notification. */
const ALERT_KINDS = new Set<NotificationEvent['kind']>(['request', 'turn', 'disputed']);
const TOAST_MS = 6_000;
const CHAT_CONCURRENCY = 4;
/** Toasts waiting their turn; older ones are dropped, the counters still show them. */
const MAX_QUEUE = 3;
/** The title in index.html. */
const BASE_TITLE = 'Campfire';

const CountsContext = createContext<Counts>({ trades: 0, chats: 0 });

/** Trades waiting for this person and unread chat messages, for the nav counters. Zero without a wallet. */
export const useNotificationCounts = () => useContext(CountsContext);

/**
 * Always mounted in Shell, so connecting or disconnecting does not remount the page under it; without an identity it
 * does nothing and the counters read zero.
 */
export function NotificationsProvider({ identity, children }: { identity: string | null; children: ReactNode }) {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [queue, setQueue] = useState<NotificationEvent[]>([]);
  // The poll reads these without restarting: the last snapshot to compare against, the messages behind its chat
  // counts (so a chat marked read updates its count at once), and the trade whose page is open.
  const snapshotRef = useRef<Snapshot | null>(null);
  const messagesRef = useRef(new Map<string, ChatMessage[]>());
  // One feed per chat, so each poll asks only for the messages it has not seen.
  const feedsRef = useRef(new Map<string, ChatFeed>());
  const openTrade = openTradeId(useLocation().pathname);
  const openTradeRef = useRef(openTrade);
  openTradeRef.current = openTrade;
  const navigate = useNavigate();
  const navigateRef = useRef(navigate);
  navigateRef.current = navigate;
  const config = useConfig();
  const configRef = useRef(config);
  configRef.current = config;

  useEffect(() => {
    snapshotRef.current = null;
    messagesRef.current = new Map();
    feedsRef.current = new Map();
    setSnapshot(null);
    setQueue([]);
    if (!identity) return;

    let stopped = false;
    let running = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const schedule = () => {
      clearTimeout(timer);
      if (!stopped) timer = setTimeout(tick, document.hidden ? (alertsOn() ? HIDDEN_ALERT_POLL_MS : HIDDEN_POLL_MS) : POLL_MS);
    };

    async function tick() {
      if (running || stopped) return;
      running = true;
      try {
        const { trades } = await apiGet<{ trades: Trade[] }>(`/api/trades?identity=${identity}`);
        if (stopped) return;
        // Only chats this browser can read: they are the ones the person can open and mark read here.
        const open = trades.filter((t) => {
          const role = roleOf(t, identity);
          return role !== 'visitor' && chatState(t, role, readSessionKey(t.id)) === 'open';
        });
        const messages = new Map<string, ChatMessage[]>();
        await forEachLimited(open, CHAT_CONCURRENCY, async (t) => {
          try {
            let feed = feedsRef.current.get(t.id);
            if (!feed) feedsRef.current.set(t.id, (feed = createChatFeed(t.id)));
            messages.set(t.id, await feed.load());
          } catch {
            // Keep what the last read found, or the next good read would look like a burst of new messages.
            const kept = messagesRef.current.get(t.id);
            if (kept) messages.set(t.id, kept);
          }
        });
        if (stopped) return;
        const next = makeSnapshot(trades, messages, identity!, (id) => lastRead(id));
        const events = diff(snapshotRef.current, next, identity!, (id) => lastRead(id));
        messagesRef.current = messages;
        snapshotRef.current = next;
        setSnapshot(next);
        // The open trade's page already shows its changes and its chat, unless the tab is in the background.
        const shown = events.filter((e) => e.trade.id !== openTradeRef.current);
        if (shown.length > 0) setQueue((q) => enqueue(q, shown));
        const alerts = (document.hidden ? events : shown).filter((e) => ALERT_KINDS.has(e.kind));
        if (alerts.length > 0 && alertsOn()) {
          ping();
          for (const event of alerts) {
            const toast = toastFor(event, identity!, describe(event.trade, identity!, configRef.current));
            notifySystem({
              tag: event.trade.id,
              title: toast.title || toast.label,
              body: toast.body,
              onClick: () => navigateRef.current(toast.href),
            });
          }
        }
      } catch {
        // The counters keep the last good read; the next poll tries again.
      } finally {
        running = false;
        schedule();
      }
    }

    // Back on the tab: read now rather than wait for the slow hidden timer.
    const onVisibility = () => {
      if (!document.hidden) void tick();
    };
    document.addEventListener('visibilitychange', onVisibility);
    const stopAlerts = onAlertsChange(() => {
      if (!running) schedule();
    });
    void tick();
    return () => {
      stopped = true;
      clearTimeout(timer);
      document.removeEventListener('visibilitychange', onVisibility);
      stopAlerts();
    };
  }, [identity]);

  // A chat shown on its trade page drops its count at once instead of on the next poll.
  useEffect(
    () =>
      onChatRead((id, at) => {
        const current = snapshotRef.current;
        const trade = current?.trades[id];
        const messages = messagesRef.current.get(id);
        if (!current || !trade || !messages) return;
        const role = roleOf(trade, identity);
        if (role === 'visitor') return;
        const next = { ...current, chats: { ...current.chats, [id]: chatSnapshot(messages, role, at) } };
        snapshotRef.current = next;
        setSnapshot(next);
        setQueue((q) => q.filter((e) => !(e.kind === 'message' && e.trade.id === id)));
      }),
    [identity],
  );

  // Opening a trade makes its waiting toasts redundant.
  useEffect(() => {
    if (openTrade) setQueue((q) => (q.some((e) => e.trade.id === openTrade) ? q.filter((e) => e.trade.id !== openTrade) : q));
  }, [openTrade]);

  const counts = countsOf(snapshot, identity);
  useEffect(() => {
    document.title = documentTitle(BASE_TITLE, counts);
  }, [counts.trades, counts.chats]);
  useEffect(
    () => () => {
      document.title = BASE_TITLE;
    },
    [],
  );

  const dismiss = useCallback(() => setQueue((q) => q.slice(1)), []);
  const value = useStableCounts(counts);

  return (
    <CountsContext.Provider value={value}>
      {children}
      {identity && <ToastHost event={queue[0]} identity={identity} onDismiss={dismiss} />}
    </CountsContext.Provider>
  );
}

/**
 * The counter on Trades (trades waiting for this person) or Chats (unread messages), shared by the header nav and
 * BottomNav. Nothing at zero. The hidden words give screen readers more than a bare number.
 */
export function NavBadge({ to }: { to: string }) {
  const counts = useNotificationCounts();
  const n = to === '/trades' ? counts.trades : to === '/chats' ? counts.chats : 0;
  if (n === 0) return null;
  return (
    <span className="cf-badge">
      {n}
      {/* Invented copy. */}
      <span className="nt-sronly">{to === '/trades' ? ' waiting for you' : ' unread'}</span>
    </span>
  );
}

/** The same object while the numbers stay the same, so the navs do not re-render on every poll. */
function useStableCounts(counts: Counts): Counts {
  const ref = useRef(counts);
  if (ref.current.trades !== counts.trades || ref.current.chats !== counts.chats) ref.current = counts;
  return ref.current;
}

/**
 * Adds new events behind the waiting ones. A newer event about the same trade replaces the older one of its kind (a
 * second message, or a state that moved on), and only the last few are kept.
 */
function enqueue(queue: NotificationEvent[], events: NotificationEvent[]): NotificationEvent[] {
  const isChat = (e: NotificationEvent) => e.kind === 'message';
  const superseded = (old: NotificationEvent) => events.some((e) => e.trade.id === old.trade.id && isChat(e) === isChat(old));
  return [...queue.filter((old) => !superseded(old)), ...events].slice(-MAX_QUEUE);
}

async function forEachLimited<T>(items: T[], limit: number, run: (item: T) => Promise<void>): Promise<void> {
  let next = 0;
  const worker = async () => {
    while (next < items.length) await run(items[next++]);
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
}

// One toast at a time, at the bottom of the screen (above the tab bar on a phone). The live region stays in the page
// and only its content changes, so screen readers announce each toast. It waits while the pointer or focus is on it
// and while the tab is hidden, so nobody misses one by looking away.
/** Which trade, as My trades names it: "Selling 0.0015 BCH for 0.70 USD". */
function describe(trade: Trade, identity: string, config: ReturnType<typeof useConfig>): string {
  const role = roleOf(trade, identity);
  if (role === 'visitor') return '';
  const asset = assetInfo(trade.asset, trade.assetDecimals, config);
  return rowTitle(trade, role, formatAmount(trade.amount, asset), formatFiatAmount(trade.fiatAmount, trade.fiat));
}

function ToastHost({ event, identity, onDismiss }: { event: NotificationEvent | undefined; identity: string; onDismiss: () => void }) {
  const config = useConfig();
  const [held, setHeld] = useState(false);
  const [hidden, setHidden] = useState(() => document.hidden);

  useEffect(() => {
    const onVisibility = () => setHidden(document.hidden);
    document.addEventListener('visibilitychange', onVisibility);
    return () => document.removeEventListener('visibilitychange', onVisibility);
  }, []);

  useEffect(() => {
    if (!event || held || hidden) return;
    const timer = setTimeout(onDismiss, TOAST_MS);
    return () => clearTimeout(timer);
  }, [event, held, hidden, onDismiss]);

  // A new toast starts unheld, even if the pointer stayed where the last one was.
  useEffect(() => setHeld(false), [event]);

  let toast = null;
  if (event) {
    toast = toastFor(event, identity, describe(event.trade, identity, config));
  }

  return (
    <div className="nt-host" role="status" aria-live="polite" aria-atomic="true">
      {toast && (
        <div
          className="nt-toast"
          data-tone={toast.tone}
          onPointerEnter={() => setHeld(true)}
          onPointerLeave={() => setHeld(false)}
          onFocus={() => setHeld(true)}
          onBlur={() => setHeld(false)}
        >
          <Link className="nt-toast__link" to={toast.href} onClick={onDismiss}>
            <span className="nt-toast__label">{toast.label}</span>
            <strong className="nt-toast__title">{toast.title}</strong>
            {toast.body && <span className="nt-toast__body">{toast.body}</span>}
          </Link>
          {/* Invented copy. */}
          <button type="button" className="nt-toast__close" aria-label="Dismiss" onClick={onDismiss}>
            <span aria-hidden="true">×</span>
          </button>
        </div>
      )}
    </div>
  );
}
