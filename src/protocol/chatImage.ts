// A receipt sent in the trade chat (protocol section 6). It is an ordinary chat message: the plaintext is
// `cmpf-image:v1:<mime>:<base64>`, so it is encrypted with the chat key and signed with the sender's session key
// exactly like text, and the arbiter reads it the same way in a dispute.

import { base64ToBin, binToBase64 } from '@bitauth/libauth';

export const CHAT_IMAGE_PREFIX = 'cmpf-image:v1:';
export const CHAT_IMAGE_MIMES = ['image/jpeg', 'image/png', 'image/webp'] as const;
export type ChatImageMime = (typeof CHAT_IMAGE_MIMES)[number];

/** Largest image, in bytes, after the browser has shrunk it. */
export const MAX_CHAT_IMAGE_BYTES = 150_000;
/** Longest image plaintext: the prefix, the longest mime type, and the image as base64 (ASCII, so characters = bytes). */
export const MAX_CHAT_IMAGE_PLAINTEXT_CHARS = CHAT_IMAGE_PREFIX.length + 'image/jpeg:'.length + Math.ceil(MAX_CHAT_IMAGE_BYTES / 3) * 4;

export interface ChatImage {
  mime: ChatImageMime;
  base64: string;
}

const BASE64 = /^[A-Za-z0-9+/]+={0,2}$/;

/** True for text that would be read as an image, so a typed message cannot pose as one. */
export const looksLikeChatImage = (text: string): boolean => text.startsWith(CHAT_IMAGE_PREFIX);

export function encodeChatImage(bytes: Uint8Array, mime: string): string {
  if (!(CHAT_IMAGE_MIMES as readonly string[]).includes(mime)) throw new Error('Only JPEG, PNG and WebP images can be sent');
  if (bytes.length === 0 || bytes.length > MAX_CHAT_IMAGE_BYTES) throw new Error('The image is too large to send');
  return `${CHAT_IMAGE_PREFIX}${mime}:${binToBase64(bytes)}`;
}

/** The image in a decrypted message, or null when it is plain text or not a well-formed image. */
export function parseChatImage(plaintext: string): ChatImage | null {
  if (!looksLikeChatImage(plaintext) || plaintext.length > MAX_CHAT_IMAGE_PLAINTEXT_CHARS) return null;
  const rest = plaintext.slice(CHAT_IMAGE_PREFIX.length);
  const split = rest.indexOf(':');
  if (split < 0) return null;
  const mime = rest.slice(0, split);
  const base64 = rest.slice(split + 1);
  if (!(CHAT_IMAGE_MIMES as readonly string[]).includes(mime) || !BASE64.test(base64) || base64.length % 4 !== 0) return null;
  return { mime: mime as ChatImageMime, base64 };
}

/** The bytes of a parsed image. */
export const chatImageBytes = (image: ChatImage): Uint8Array => {
  const bytes = base64ToBin(image.base64);
  if (typeof bytes === 'string') throw new Error('The image is not valid base64');
  return bytes;
};
