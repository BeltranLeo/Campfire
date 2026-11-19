import { describe, expect, it } from 'vitest';
import { encryptChatMessage, MAX_CHAT_MESSAGE_CHARS, signChatMessage } from '../src/protocol/crypto.js';
import type { ChatMessage } from '../src/web/api.js';
import {
  ChatSendError,
  chatKeyHex,
  chatState,
  createChatReader,
  lastRead,
  markChatRead,
  markMessagesRead,
  onChatRead,
  sendChatMessage,
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
});
