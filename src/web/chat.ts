// The trade chat as the browser sees it (docs/protocol.md, section 6): who may read it, sending a message encrypted
// and signed in this browser, reading messages back with the signatures checked here rather than trusting the
// service, and which messages are unread. No DOM here; see test/chat.test.ts.

import { binToHex, hexToBin, secp256k1 } from '@bitauth/libauth';
import {
  decryptChatMessage,
  encryptChatMessage,
  MAX_CHAT_MESSAGE_CHARS,
  signChatMessage,
  verifyChatMessageSignature,
} from '../protocol/crypto.js';
import { apiGet, apiPost, isFinalState, type ChatMessage, type Trade } from './api';
import { disputeKeyHex, type Role } from './trade';

export { MAX_CHAT_MESSAGE_CHARS };

export type ChatRole = 'buyer' | 'seller';

/** The fields of a trade the chat needs. */
export type ChatTrade = Pick<Trade, 'id' | 'tradeId' | 'status' | 'buyerSessionPk' | 'sellerSessionPk'>;

/**
 * - `visitor`: not a party to the trade; there is no chat to show.
 * - `not-open`: the chat opens once the trade is accepted and both session keys are in the terms.
 * - `no-key`: this browser does not hold this party's session key (another device, cleared storage).
 * - `closed`: the trade ended; the history can be read, nothing new can be sent.
 * - `open`: read and write.
 */
export type ChatState = 'visitor' | 'not-open' | 'no-key' | 'closed' | 'open';

export const NO_CHAT_KEY = 'This browser does not have the key for this trade. Open it on the device where you started it.';

const sessionPkOf = (trade: ChatTrade, role: ChatRole) => (role === 'buyer' ? trade.buyerSessionPk : trade.sellerSessionPk);
const peerOf = (role: ChatRole): ChatRole => (role === 'buyer' ? 'seller' : 'buyer');

function publicKeyOf(sessionPrivateKey: string): string | null {
  try {
    const pk = secp256k1.derivePublicKeyCompressed(hexToBin(sessionPrivateKey));
    return typeof pk === 'string' ? null : binToHex(pk);
  } catch {
    return null;
  }
}

/**
 * Whether this browser holds `role`'s session key: the stored key must match the one in the terms. A key from
 * another trade or the other role (one browser playing both sides overwrites it) reads nothing, so it counts as none.
 */
export function holdsSessionKey(trade: ChatTrade, role: ChatRole, sessionPrivateKey: string | null): boolean {
  const expected = sessionPkOf(trade, role);
  if (!sessionPrivateKey || !expected) return false;
  return publicKeyOf(sessionPrivateKey) === expected.toLowerCase();
}

export function chatState(trade: ChatTrade, role: Role, sessionPrivateKey: string | null): ChatState {
  if (role === 'visitor') return 'visitor';
  if (!trade.tradeId || !trade.buyerSessionPk || !trade.sellerSessionPk) return 'not-open';
  if (!holdsSessionKey(trade, role, sessionPrivateKey)) return 'no-key';
  return isFinalState(trade.status) ? 'closed' : 'open';
}

/** The AES key both parties derive for the chat: this party's session key with the other party's public one. */
export function chatKeyHex(trade: ChatTrade, role: ChatRole, sessionPrivateKey: string | null): string | undefined {
  return disputeKeyHex(sessionPrivateKey, sessionPkOf(trade, peerOf(role)));
}

// --- Reading ---

/**
 * One message as this browser shows it. `author` comes from the signature checked here, never from the identity
 * the service recorded: `unverified` means no session key of the trade signed it. `text` is null when the message
 * could not be decrypted with this browser's key.
 */
export interface ChatLine {
  id: string;
  author: 'me' | 'peer' | 'unverified';
  role?: ChatRole;
  text: string | null;
  createdAt: number;
}

/** The role whose session key signed the message, checked in this browser. */
export function signedRole(trade: ChatTrade, message: Pick<ChatMessage, 'ciphertext' | 'signature'>): ChatRole | undefined {
  if (!trade.tradeId || !message.signature) return undefined;
  return (['buyer', 'seller'] as const).find((role) => {
    const pk = sessionPkOf(trade, role);
    try {
      return Boolean(pk) && verifyChatMessageSignature(pk!, trade.tradeId!, message.ciphertext, message.signature!);
    } catch {
      return false;
    }
  });
}

/**
 * Decrypts and checks messages for one trade and role, keeping each result by message id: the chat is polled every
 * few seconds, and messages never change once posted, so each one is decrypted and verified only once.
 */
export function createChatReader(trade: ChatTrade, role: ChatRole, sessionPrivateKey: string | null) {
  const key = chatKeyHex(trade, role, sessionPrivateKey);
  const cache = new Map<string, ChatLine>();
  return {
    async read(messages: ChatMessage[]): Promise<ChatLine[]> {
      const lines: ChatLine[] = [];
      for (const m of messages) {
        let line = cache.get(m.id);
        if (!line) {
          const signer = signedRole(trade, m);
          let text: string | null = null;
          if (key) {
            try {
              text = await decryptChatMessage(key, m.ciphertext);
            } catch {
              text = null;
            }
          }
          line = {
            id: m.id,
            author: signer === role ? 'me' : signer ? 'peer' : 'unverified',
            ...(signer ? { role: signer } : {}),
            text,
            createdAt: m.createdAt,
          };
          cache.set(m.id, line);
        }
        lines.push(line);
      }
      return lines;
    },
  };
}

export const fetchChat = (tradeRecordId: string) =>
  apiGet<{ messages: ChatMessage[] }>(`/api/trades/${tradeRecordId}/chat`).then((r) => r.messages);

// --- Sending ---

export class ChatSendError extends Error {}

type Post = (path: string, body: unknown) => Promise<{ message: ChatMessage }>;

/**
 * Encrypts the text with the chat key and signs the ciphertext with this party's session key, so the service
 * stores only ciphertext and nobody can post in the other party's name. The signature covers the contract's trade
 * id (`trade.tradeId`); the URL uses the record id (`trade.id`).
 */
export async function sendChatMessage(params: {
  trade: ChatTrade;
  role: ChatRole;
  identity: string;
  sessionPrivateKey: string | null;
  text: string;
  post?: Post;
}): Promise<ChatMessage> {
  const { trade, role, sessionPrivateKey } = params;
  const text = params.text.trim();
  if (!text) throw new ChatSendError('Write a message first.');
  if (text.length > MAX_CHAT_MESSAGE_CHARS) throw new ChatSendError(`Messages can be at most ${MAX_CHAT_MESSAGE_CHARS} characters long.`);
  const state = chatState(trade, role, sessionPrivateKey);
  if (state === 'not-open') throw new ChatSendError('The chat opens once the trade is accepted.');
  if (state === 'no-key') throw new ChatSendError(NO_CHAT_KEY);
  if (state === 'closed') throw new ChatSendError('The chat closed when the trade ended.');
  const key = chatKeyHex(trade, role, sessionPrivateKey);
  if (!key || !sessionPrivateKey || !trade.tradeId) throw new ChatSendError(NO_CHAT_KEY);
  const ciphertext = await encryptChatMessage(key, text);
  const post: Post = params.post ?? ((path, body) => apiPost(path, body));
  const { message } = await post(`/api/trades/${trade.id}/chat`, {
    senderIdentity: params.identity,
    ciphertext,
    signature: signChatMessage(sessionPrivateKey, trade.tradeId, ciphertext),
  });
  return message;
}

// --- Unread ---
// One shared contract for the chat card, /chats and the counters: `campfire.chatRead.<trade record id>` holds the
// `createdAt` (Unix seconds, the service's clock) of the newest message this browser has shown. The service's time
// is used rather than this device's, so a clock that runs behind does not leave messages unread forever.

export interface ReadStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

const readKey = (tradeRecordId: string) => `campfire.chatRead.${tradeRecordId}`;

// localStorage can be blocked (private windows) or missing (tests); everything is then simply unread.
function defaultStore(): ReadStore | null {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

export function lastRead(tradeRecordId: string, store: ReadStore | null = defaultStore()): number {
  try {
    const value = Number(store?.getItem(readKey(tradeRecordId)) ?? 0);
    return Number.isFinite(value) ? value : 0;
  } catch {
    return 0;
  }
}

type ReadListener = (tradeRecordId: string, at: number) => void;
const readListeners = new Set<ReadListener>();

/** Called when a chat is marked read, so the counters drop at once instead of on their next poll. */
export function onChatRead(listener: ReadListener): () => void {
  readListeners.add(listener);
  return () => readListeners.delete(listener);
}

/** Records that every message up to `at` (a message's `createdAt`) was shown. Never moves backwards. */
export function markChatRead(tradeRecordId: string, at: number, store: ReadStore | null = defaultStore()): void {
  if (!(at > lastRead(tradeRecordId, store))) return;
  try {
    store?.setItem(readKey(tradeRecordId), String(at));
  } catch {
    // Storage blocked: the counter stays as it was.
  }
  for (const listener of readListeners) listener(tradeRecordId, at);
}

/** Marks read everything in `messages`, as the open chat does after showing them. */
export function markMessagesRead(tradeRecordId: string, messages: Pick<ChatMessage, 'createdAt'>[], store: ReadStore | null = defaultStore()): void {
  const newest = messages.reduce((max, m) => Math.max(max, m.createdAt), 0);
  if (newest > 0) markChatRead(tradeRecordId, newest, store);
}

/**
 * Messages from the other party newer than `lastReadAt`. Uses the role the service recorded, which it accepts only
 * with a valid signature; good enough for a counter, while the chat itself checks every signature again here.
 */
export function unreadCount(messages: Pick<ChatMessage, 'senderRole' | 'createdAt'>[], myRole: ChatRole, lastReadAt: number): number {
  return messages.filter((m) => m.senderRole !== undefined && m.senderRole !== myRole && m.createdAt > lastReadAt).length;
}
