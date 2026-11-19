import { useEffect, useLayoutEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { useSearchParams } from 'react-router';
import { ApiError, isFinalState, type Trade } from '../api';
import {
  ChatSendError,
  MAX_CHAT_MESSAGE_CHARS,
  NO_CHAT_KEY,
  chatState,
  createChatReader,
  fetchChat,
  markMessagesRead,
  sendChatMessage,
  type ChatLine,
  type ChatRole,
} from '../chat';
import { formatHourMinute } from '../format';
import { usePoll } from '../hooks/usePoll';
import { readSessionKey } from '../take';
import { useWallet } from '../wallet';
import { Button } from './Button';
import { Notice, Skeleton } from './States';

// The chat card on /trade/:id (Trade-* screens), for the buyer and the seller only. Messages are encrypted and
// signed in this browser and decrypted and checked here (src/web/chat.ts); the service only relays ciphertext.
// `/trade/:id?chat` scrolls the card into view once (the /chats rows link there).

const POLL_MS = 3000;
const INTRO = 'End-to-end encrypted. Campfire relays ciphertext it cannot read. The arbiter can read this chat only if a dispute is opened.';
// Within this many pixels of the end the list counts as scrolled to the newest message.
const BOTTOM_SLACK = 24;

export function TradeChat({ trade, role }: { trade: Trade; role: ChatRole }) {
  const sessionKey = readSessionKey(trade.id);
  const state = chatState(trade, role, sessionKey);
  const sectionRef = useRef<HTMLElement>(null);
  const [params] = useSearchParams();
  const wantsChat = params.has('chat');

  // Once, on load: the page mounts this card only after the trade has loaded, so the card is in place.
  const scrolled = useRef(false);
  useEffect(() => {
    if (!wantsChat || scrolled.current) return;
    scrolled.current = true;
    sectionRef.current?.scrollIntoView({ block: 'start' });
  }, [wantsChat]);

  let body: ReactNode;
  if (state === 'open' || state === 'closed') {
    // A new key when the trade ends: the closed chat fetches once and stops polling.
    body = <ChatThread key={state} trade={trade} role={role} sessionKey={sessionKey} open={state === 'open'} />;
  } else if (state === 'no-key') {
    body = <Notice tone="attention">{NO_CHAT_KEY}</Notice>;
  } else {
    body = (
      <div className="cf-chat">
        <div className="cf-msg" data-system>
          {notOpenText(trade, role)}
        </div>
      </div>
    );
  }

  return (
    <section ref={sectionRef} id="chat" className="cf-card tr-chat" data-flush>
      <div className="cf-card__section">
        <div className="cf-row" data-between style={{ marginBottom: 'var(--space-3)' }}>
          <h2 className="cf-heading">Chat</h2>
          <span className="cf-small cf-muted">Encrypted</span>
        </div>
        {body}
      </div>
    </section>
  );
}

// Invented copy: the design only shows an open chat. The chat opens when the trade is accepted, which on a sell
// offer is the seller's step and on a buy offer the buyer's.
function notOpenText(trade: Trade, role: ChatRole): string {
  if (isFinalState(trade.status)) return 'There is no chat: the trade ended before it was accepted.';
  const accepter: ChatRole = trade.side === 'buy' ? 'buyer' : 'seller';
  return accepter === role ? 'The chat opens once you accept the trade.' : `The chat opens once the ${accepter} accepts the trade.`;
}

function ChatThread({ trade, role, sessionKey, open }: { trade: Trade; role: ChatRole; sessionKey: string | null; open: boolean }) {
  const { identity } = useWallet();
  const poll = usePoll(() => fetchChat(trade.id), trade.id, open ? POLL_MS : undefined);

  // One reader per trade, role and key, so each message is decrypted and verified once, not on every poll. Keyed
  // on the fields it reads: the page hands down a new trade object on every poll.
  const reader = useMemo(
    () => createChatReader(trade, role, sessionKey),
    [trade.id, trade.tradeId, trade.buyerSessionPk, trade.sellerSessionPk, role, sessionKey],
  );

  const [lines, setLines] = useState<ChatLine[]>();
  useEffect(() => {
    const messages = poll.data;
    if (!messages) return;
    let current = true;
    reader.read(messages).then((read) => {
      if (!current) return;
      setLines(read);
      // Shown now, so read: the counters in the header drop at once.
      markMessagesRead(trade.id, messages);
    });
    return () => {
      current = false;
    };
  }, [poll.data, reader, trade.id]);

  // The list follows new messages only when the reader was already at the newest one, or just sent one; someone
  // scrolled up to read history is left where they are. Only the list scrolls, never the page.
  const listRef = useRef<HTMLDivElement>(null);
  const atBottom = useRef(true);
  const justSent = useRef(false);
  useLayoutEffect(() => {
    const list = listRef.current;
    if (!list || !(atBottom.current || justSent.current)) return;
    list.scrollTop = list.scrollHeight;
    atBottom.current = true;
    justSent.current = false;
  }, [lines]);
  const onScroll = () => {
    const list = listRef.current;
    if (list) atBottom.current = list.scrollHeight - list.scrollTop - list.clientHeight <= BOTTOM_SLACK;
  };

  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const send = async (event: FormEvent) => {
    event.preventDefault();
    // A busy button still lets Enter submit the form.
    if (sending || !identity) return;
    setSending(true);
    setSendError(null);
    try {
      await sendChatMessage({ trade, role, identity, sessionPrivateKey: sessionKey, text });
      setText('');
      justSent.current = true;
      poll.reload();
    } catch (err) {
      // Invented copy for anything other than the module's and the service's own messages.
      setSendError(err instanceof ChatSendError || err instanceof ApiError ? err.message : 'The message could not be sent. Try again.');
    } finally {
      setSending(false);
    }
  };

  let messages: ReactNode;
  if (!lines) {
    // Invented copy for the error.
    messages =
      poll.error && !poll.loading ? (
        <Notice tone="danger" title="The chat could not be loaded">
          {poll.error instanceof Error ? poll.error.message : String(poll.error)}
        </Notice>
      ) : (
        <Skeleton height={20} />
      );
  } else if (lines.length === 0) {
    // "No messages yet." is from the design; the closed variant is invented copy.
    messages = (
      <div className="cf-msg" data-system>
        {open ? 'No messages yet.' : 'No messages were sent in this trade.'}
      </div>
    );
  } else {
    messages = lines.map((line) => (
      <div key={line.id} className="cf-msg" data-own={line.author === 'me' || undefined}>
        {/* Invented copy: the author comes from the signature checked in this browser, and the design has no
            message that neither session key signed, nor one this browser cannot decrypt. */}
        {line.author === 'unverified' && <strong>Not signed by either party. </strong>}
        {line.text ?? <em>This message could not be decrypted.</em>}
        <small>{formatHourMinute(new Date(line.createdAt * 1000))}</small>
      </div>
    ));
  }

  return (
    <>
      <div ref={listRef} className="cf-chat" onScroll={onScroll}>
        <div className="cf-msg" data-system>
          {INTRO}
        </div>
        {messages}
        {!open && (
          // Invented copy.
          <div className="cf-msg" data-system>
            The chat closed when the trade ended.
          </div>
        )}
      </div>
      {open && (
        <form className="cf-stack" data-gap="2" style={{ marginTop: 'var(--space-3)' }} onSubmit={send}>
          <div className="cf-row" data-nowrap>
            <input
              id="chat-input"
              className="cf-input cf-grow"
              aria-label="Message"
              placeholder="Write a message"
              autoComplete="off"
              maxLength={MAX_CHAT_MESSAGE_CHARS}
              value={text}
              readOnly={sending}
              disabled={!identity}
              onChange={(e) => {
                setText(e.target.value);
                if (sendError) setSendError(null);
              }}
            />
            <Button type="submit" busy={sending} disabled={!identity || !text.trim()}>
              Send
            </Button>
          </div>
          {sendError && <Notice tone="danger">{sendError}</Notice>}
        </form>
      )}
    </>
  );
}
