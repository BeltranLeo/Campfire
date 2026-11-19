import { describe, expect, it } from 'vitest';
import { CHAT_IMAGE_PREFIX, MAX_CHAT_IMAGE_BYTES, chatImageBytes, encodeChatImage, parseChatImage } from '../src/protocol/chatImage.js';
import { MAX_CHAT_CIPHERTEXT_LENGTH, encryptChatMessage, MAX_CHAT_MESSAGE_CHARS, signChatMessage } from '../src/protocol/crypto.js';
import type { ChatMessage } from '../src/web/api.js';
import {
  ChatSendError,
  chatKeyHex,
  chatState,
  createChatFeed,
  createChatReader,
  lastRead,
  markChatRead,
  markMessagesRead,
  mergeById,
  onChatRead,
  sendChatImage,
  sendChatMessage,
  sinceFor,
  unreadCount,
  type ChatTrade,
} from '../src/web/chat.js';
import { generateSessionKeyPair } from '../src/web/take.js';

const buyerSession = generateSessionKeyPair();
const sellerSession = generateSessionKeyPair();
const TRADE_ID = 'ab'.repeat(32);

const trade: ChatTrade = {
  id: 'rec1',
  tradeId: TRADE_ID,
  status: 'Funded',
  buyerSessionPk: buyerSession.publicKey,
  sellerSessionPk: sellerSession.publicKey,
};

// Sends as one party through a fake service that stores what it receives, the way POST /api/trades/:id/chat does.
function relay() {
  const stored: ChatMessage[] = [];
  let n = 0;
  const post = async (path: string, body: unknown) => {
    expect(path).toBe('/api/trades/rec1/chat');
    const b = body as { senderIdentity: string; ciphertext: string; signature: string };
    const message: ChatMessage = { id: `m${n}`, tradeRecordId: 'rec1', ...b, createdAt: 1000 + n++ };
    stored.push(message);
    return { message };
  };
  return { stored, post };
}

function memoryStore() {
  const map = new Map<string, string>();
  return { getItem: (k: string) => map.get(k) ?? null, setItem: (k: string, v: string) => void map.set(k, v) };
}

describe('Trade chat in the browser (protocol section 6)', () => {
  it('derives the same key on both sides', () => {
    expect(chatKeyHex(trade, 'buyer', buyerSession.privateKey)).toBe(chatKeyHex(trade, 'seller', sellerSession.privateKey));
  });

  it('round-trips a message and labels it by the signature, not by the identity', async () => {
    const { stored, post } = relay();
    await sendChatMessage({ trade, role: 'buyer', identity: 'buyer-id', sessionPrivateKey: buyerSession.privateKey, text: '  Sent the transfer  ', post });
    await sendChatMessage({ trade, role: 'seller', identity: 'seller-id', sessionPrivateKey: sellerSession.privateKey, text: 'Checking now', post });

    const asBuyer = await createChatReader(trade, 'buyer', buyerSession.privateKey).read(stored);
    expect(asBuyer.map((l) => [l.author, l.role, l.text])).toEqual([
      ['me', 'buyer', 'Sent the transfer'],
      ['peer', 'seller', 'Checking now'],
    ]);
    const asSeller = await createChatReader(trade, 'seller', sellerSession.privateKey).read(stored);
    expect(asSeller.map((l) => l.author)).toEqual(['peer', 'me']);
  });

  it('marks a message nobody in the trade signed as unverified, even with a valid key', async () => {
    const key = chatKeyHex(trade, 'buyer', buyerSession.privateKey)!;
    const ciphertext = await encryptChatMessage(key, 'Payment received');
    const outsider = generateSessionKeyPair();
    const forged: ChatMessage = {
      id: 'x',
      tradeRecordId: 'rec1',
      senderIdentity: 'seller-id',
      senderRole: 'seller',
      ciphertext,
      signature: signChatMessage(outsider.privateKey, TRADE_ID, ciphertext),
      createdAt: 5,
    };
    const [line] = await createChatReader(trade, 'buyer', buyerSession.privateKey).read([forged]);
    expect(line.author).toBe('unverified');
    expect(line.role).toBeUndefined();
    expect(line.text).toBe('Payment received');
  });

  it('keeps decrypted messages, so a poll does not decrypt them again', async () => {
    const { stored, post } = relay();
    await sendChatMessage({ trade, role: 'buyer', identity: 'b', sessionPrivateKey: buyerSession.privateKey, text: 'hi', post });
    const reader = createChatReader(trade, 'seller', sellerSession.privateKey);
    const [first] = await reader.read(stored);
    const [again] = await reader.read(stored);
    expect(again).toBe(first);
  });

  it('says what the chat can do from the trade and the key this browser holds', () => {
    expect(chatState(trade, 'visitor', null)).toBe('visitor');
    expect(chatState({ ...trade, sellerSessionPk: undefined }, 'buyer', buyerSession.privateKey)).toBe('not-open');
    expect(chatState({ ...trade, tradeId: undefined }, 'buyer', buyerSession.privateKey)).toBe('not-open');
    expect(chatState(trade, 'buyer', null)).toBe('no-key');
    // One browser playing both roles stores the seller's key where the buyer's was: it reads nothing as the buyer.
    expect(chatState(trade, 'buyer', sellerSession.privateKey)).toBe('no-key');
    expect(chatState(trade, 'buyer', buyerSession.privateKey)).toBe('open');
    expect(chatState({ ...trade, status: 'Released' }, 'seller', sellerSession.privateKey)).toBe('closed');
  });

  it('refuses to send what the service would refuse', async () => {
    const { post } = relay();
    const send = (text: string, t: ChatTrade = trade, key: string | null = buyerSession.privateKey) =>
      sendChatMessage({ trade: t, role: 'buyer', identity: 'b', sessionPrivateKey: key, text, post });
    await expect(send('   ')).rejects.toBeInstanceOf(ChatSendError);
    await expect(send('x'.repeat(MAX_CHAT_MESSAGE_CHARS + 1))).rejects.toThrow(/at most 2000/);
    await expect(send('hi', { ...trade, status: 'Cancelled' })).rejects.toThrow(/closed/);
    await expect(send('hi', trade, null)).rejects.toThrow(/does not have the key/);
    await expect(send('x'.repeat(MAX_CHAT_MESSAGE_CHARS))).resolves.toBeDefined();
  });

  it('counts the other party\'s messages newer than the last one shown', () => {
    const messages = [
      { senderRole: 'buyer' as const, createdAt: 10 },
      { senderRole: 'seller' as const, createdAt: 11 },
      { senderRole: 'seller' as const, createdAt: 12 },
      { createdAt: 13 },
    ];
    expect(unreadCount(messages, 'buyer', 0)).toBe(2);
    expect(unreadCount(messages, 'buyer', 11)).toBe(1);
    expect(unreadCount(messages, 'seller', 0)).toBe(1);
  });

  it('stores the last message shown per trade, never moving backwards, and tells the counters', () => {
    const store = memoryStore();
    const heard: [string, number][] = [];
    const off = onChatRead((id, at) => heard.push([id, at]));
    expect(lastRead('rec1', store)).toBe(0);
    markMessagesRead('rec1', [{ createdAt: 20 }, { createdAt: 25 }], store);
    expect(lastRead('rec1', store)).toBe(25);
    markChatRead('rec1', 21, store);
    expect(lastRead('rec1', store)).toBe(25);
    expect(lastRead('rec2', store)).toBe(0);
    off();
    markChatRead('rec1', 30, store);
    expect(heard).toEqual([['rec1', 25]]);
    // No storage at all (blocked): nothing breaks, everything is unread.
    expect(lastRead('rec1', null)).toBe(0);
    markChatRead('rec1', 40, null);
  });

  describe('receipt images', () => {
    const bytes = Uint8Array.from({ length: 5000 }, (_, i) => (i * 7) % 256);
    const sendAs = (role: 'buyer' | 'seller', image: { bytes: Uint8Array; mime: string }, post: ReturnType<typeof relay>['post'], t: ChatTrade = trade) =>
      sendChatImage({
        trade: t,
        role,
        identity: `${role}-id`,
        sessionPrivateKey: role === 'buyer' ? buyerSession.privateKey : sellerSession.privateKey,
        image,
        post,
      });

    it('goes through the same encrypted, signed message and reaches the peer as an image', async () => {
      const { stored, post } = relay();
      await sendAs('buyer', { bytes, mime: 'image/jpeg' }, post);
      expect(stored[0].ciphertext).not.toContain(CHAT_IMAGE_PREFIX);
      expect(stored[0].ciphertext.length).toBeLessThanOrEqual(MAX_CHAT_CIPHERTEXT_LENGTH);

      const [seen] = await createChatReader(trade, 'seller', sellerSession.privateKey).read(stored);
      expect(seen.author).toBe('peer');
      expect(seen.text).toBeNull();
      expect(seen.image?.mime).toBe('image/jpeg');
      expect(chatImageBytes(seen.image!)).toEqual(bytes);
    });

    it('fits the service cap at the largest size, and not beyond', async () => {
      const { stored, post } = relay();
      await sendAs('seller', { bytes: new Uint8Array(MAX_CHAT_IMAGE_BYTES).fill(255), mime: 'image/png' }, post);
      expect(stored[0].ciphertext.length).toBeLessThanOrEqual(MAX_CHAT_CIPHERTEXT_LENGTH);
      await expect(sendAs('seller', { bytes: new Uint8Array(MAX_CHAT_IMAGE_BYTES + 1), mime: 'image/png' }, post)).rejects.toThrow(ChatSendError);
    });

    it('refuses other file types, an empty image and a closed chat', async () => {
      const { post } = relay();
      await expect(sendAs('buyer', { bytes, mime: 'application/pdf' }, post)).rejects.toThrow('Only JPEG, PNG and WebP');
      await expect(sendAs('buyer', { bytes: new Uint8Array(0), mime: 'image/png' }, post)).rejects.toThrow(ChatSendError);
      await expect(sendAs('buyer', { bytes, mime: 'image/png' }, post, { ...trade, status: 'Released' })).rejects.toThrow('closed');
    });

    it('does not let typed text pose as an image, and shows a malformed image as unreadable', async () => {
      const { stored, post } = relay();
      await expect(
        sendChatMessage({ trade, role: 'buyer', identity: 'b', sessionPrivateKey: buyerSession.privateKey, text: `${CHAT_IMAGE_PREFIX}image/png:AAAA`, post }),
      ).rejects.toThrow(ChatSendError);

      // Someone with the key (so, a party) crafts one anyway: the reader does not render it, nor print its text.
      const key = chatKeyHex(trade, 'buyer', buyerSession.privateKey)!;
      const ciphertext = await encryptChatMessage(key, `${CHAT_IMAGE_PREFIX}image/svg+xml:PHN2Zz48L3N2Zz4=`);
      stored.push({
        id: 'bad',
        tradeRecordId: 'rec1',
        senderIdentity: 'buyer-id',
        ciphertext,
        signature: signChatMessage(buyerSession.privateKey, TRADE_ID, ciphertext),
        createdAt: 9,
      });
      const [line] = await createChatReader(trade, 'seller', sellerSession.privateKey).read(stored);
      expect(line.image).toBeUndefined();
      expect(line.text).toBeNull();
      expect(parseChatImage(`${CHAT_IMAGE_PREFIX}image/png:not base64!`)).toBeNull();
      expect(parseChatImage(encodeChatImage(bytes, 'image/webp'))?.mime).toBe('image/webp');
    });
  });

  describe('asking only for new messages', () => {
    const msg = (id: string, createdAt: number): ChatMessage => ({ id, tradeRecordId: 'rec1', senderIdentity: 'x', ciphertext: 'aa:bb', createdAt });

    it('asks from a few seconds before the newest message held, and for everything when it holds none', () => {
      expect(sinceFor([])).toBeUndefined();
      expect(sinceFor([msg('a', 1000), msg('b', 1030), msg('c', 1020)])).toBe(1025);
      // Near the start of the clock the cursor never goes below zero; "from 0" is the same as asking for all.
      expect(sinceFor([msg('a', 3)])).toBeUndefined();
    });

    it('keeps what it has, adds only what is new, and orders by time', () => {
      const known = [msg('a', 10), msg('b', 20)];
      expect(mergeById(known, [msg('b', 20)])).toBe(known);
      expect(mergeById(known, []).map((m) => m.id)).toEqual(['a', 'b']);
      expect(mergeById(known, [msg('b', 20), msg('c', 20), msg('z', 15)]).map((m) => m.id)).toEqual(['a', 'z', 'b', 'c']);
    });

    it('fetches everything once, then only from the newest message, without losing one of the same second', async () => {
      const service = [msg('a', 100), msg('b', 110)];
      const asked: (number | undefined)[] = [];
      // Like the service: messages created at or after `since`.
      const fetch = async (_id: string, since?: number) => {
        asked.push(since);
        return service.filter((m) => m.createdAt >= (since ?? 0));
      };
      const feed = createChatFeed('rec1', fetch);
      const first = await feed.load();
      expect(first.map((m) => m.id)).toEqual(['a', 'b']);
      // Nothing new: the very same array, so the screen has nothing to read again.
      expect(await feed.load()).toBe(first);
      // Another message in the same second as the newest one, posted after the last poll.
      service.push(msg('c', 110));
      const third = await feed.load();
      expect(third.map((m) => m.id)).toEqual(['a', 'b', 'c']);
      expect(asked).toEqual([undefined, 105, 105]);
    });

    it('keeps what it holds when a poll fails', async () => {
      let fail = false;
      const feed = createChatFeed('rec1', async () => {
        if (fail) throw new Error('offline');
        return [msg('a', 100)];
      });
      await feed.load();
      fail = true;
      await expect(feed.load()).rejects.toThrow('offline');
      expect(feed.messages.map((m) => m.id)).toEqual(['a']);
    });
  });
});
