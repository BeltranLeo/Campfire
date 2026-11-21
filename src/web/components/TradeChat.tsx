import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ChangeEvent, type FormEvent, type ReactNode } from 'react';
import { useSearchParams } from 'react-router';
import { ApiError, isFinalState, type Trade } from '../api';
import {
  ChatSendError,
  MAX_CHAT_MESSAGE_CHARS,
  noChatKey,
  chatState,
  createChatFeed,
  createChatReader,
  markMessagesRead,
  sendChatImage,
  sendChatMessage,
  type ChatLine,
  type ChatRole,
} from '../chat';
import { CHAT_IMAGE_ACCEPT, prepareChatImage } from '../chatImage';
import { formatHourMinute } from '../format';
import { usePoll } from '../hooks/usePoll';
import { readSessionKey } from '../take';
import { useWallet } from '../wallet';
import { useMessages } from '../lang';
import type { Messages } from '../messages';
import { Button } from './Button';
import { ChatImageView } from './ChatImage';
import { Notice, Skeleton } from './States';

// The chat card on /trade/:id (Trade-* screens), for the buyer and the seller only. Messages are encrypted and
// signed in this browser and decrypted and checked here (src/web/chat.ts); the service only relays ciphertext.
// `/trade/:id?chat` scrolls the card into view once (the /chats rows link there).

const POLL_MS = 3000;
// Within this many pixels of the end the list counts as scrolled to the newest message.
const BOTTOM_SLACK = 24;

export function TradeChat({ trade, role }: { trade: Trade; role: ChatRole }) {
  const t = useMessages().chat;
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
    body = <Notice tone="attention">{noChatKey()}</Notice>;
  } else {
    body = (
      <div className="cf-chat">
        <div className="cf-msg" data-system>
          {notOpenText(t, trade, role)}
        </div>
      </div>
    );
  }

  return (
    <section ref={sectionRef} id="chat" className="cf-card tr-chat" data-flush>
      <div className="cf-card__section">
        <div className="cf-row" data-between style={{ marginBottom: 'var(--space-3)' }}>
          <h2 className="cf-heading">{t.title}</h2>
          <span className="cf-small cf-muted">{t.encrypted}</span>
        </div>
        {body}
      </div>
    </section>
  );
}

// Invented copy: the design only shows an open chat. The chat opens when the trade is accepted, which on a sell
// offer is the seller's step and on a buy offer the buyer's.
function notOpenText(t: Messages['chat'], trade: Trade, role: ChatRole): string {
  if (isFinalState(trade.status)) return t.endedBeforeAccept;
  const accepter: ChatRole = trade.side === 'buy' ? 'buyer' : 'seller';
  return accepter === role ? t.opensOnYourAccept : t.opensOnTheirAccept(accepter);
}

function ChatThread({ trade, role, sessionKey, open }: { trade: Trade; role: ChatRole; sessionKey: string | null; open: boolean }) {
  const { identity } = useWallet();
  const t = useMessages().chat;
  // The feed holds what was received, so each poll asks only for the messages it has not seen.
  const feed = useMemo(() => createChatFeed(trade.id), [trade.id]);
  const poll = usePoll(() => feed.load(), trade.id, open ? POLL_MS : undefined);

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
      setSendError(err instanceof ChatSendError || err instanceof ApiError ? err.message : t.notSent);
    } finally {
      setSending(false);
    }
  };

  // A receipt: shrunk in this browser, then sent like any message (encrypted, signed). Invented copy for the errors.
  const fileRef = useRef<HTMLInputElement>(null);
  const attach = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file || sending || !identity) return;
    setSending(true);
    setSendError(null);
    try {
      const image = await prepareChatImage(file);
      await sendChatImage({ trade, role, identity, sessionPrivateKey: sessionKey, image });
      justSent.current = true;
      poll.reload();
    } catch (err) {
      setSendError(err instanceof ChatSendError || err instanceof ApiError ? err.message : t.imageNotSent);
    } finally {
      setSending(false);
    }
  };

  let messages: ReactNode;
  if (!lines) {
    // Invented copy for the error.
    messages =
      poll.error && !poll.loading ? (
        <Notice tone="danger" title={t.loadError}>
          {poll.error instanceof Error ? poll.error.message : String(poll.error)}
        </Notice>
      ) : (
        <Skeleton height={20} />
      );
  } else if (lines.length === 0) {
    // "No messages yet." is from the design; the closed variant is invented copy.
    messages = (
      <div className="cf-msg" data-system>
        {open ? t.noMessages : t.noMessagesClosed}
      </div>
    );
  } else {
    messages = lines.map((line) => (
      <div key={line.id} className="cf-msg" data-own={line.author === 'me' || undefined}>
        {/* Invented copy: the author comes from the signature checked in this browser, and the design has no
            message that neither session key signed, nor one this browser cannot decrypt. */}
        {line.author === 'unverified' && <strong>{t.unsigned}</strong>}
        {line.image ? (
          <ChatImageView image={line.image} />
        ) : (
          (line.text ?? <em>{t.undecryptable}</em>)
        )}
        <small>{formatHourMinute(new Date(line.createdAt * 1000))}</small>
      </div>
    ));
  }

  return (
    <>
      <div ref={listRef} className="cf-chat" onScroll={onScroll}>
        <div className="cf-msg" data-system>
          {t.intro}
        </div>
        {messages}
        {!open && (
          // Invented copy.
          <div className="cf-msg" data-system>
            {t.closed}
          </div>
        )}
      </div>
      {open && (
        <form className="cf-stack" data-gap="2" style={{ marginTop: 'var(--space-3)' }} onSubmit={send}>
          <div className="cf-row" data-nowrap>
            <input
              id="chat-input"
              className="cf-input cf-grow"
              aria-label={t.message}
              placeholder={t.placeholder}
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
            <input ref={fileRef} type="file" accept={CHAT_IMAGE_ACCEPT} hidden aria-label={t.receiptImage} onChange={attach} />
            <Button variant="ghost" disabled={!identity || sending} onClick={() => fileRef.current?.click()}>
              {t.attach}
            </Button>
            <Button type="submit" busy={sending} disabled={!identity || !text.trim()}>
              {t.send}
            </Button>
          </div>
          {sendError && <Notice tone="danger">{sendError}</Notice>}
        </form>
      )}
    </>
  );
}
