// Gets a photo or screenshot ready to send as a receipt: decoded, scaled down and re-encoded as JPEG until it fits
// MAX_CHAT_IMAGE_BYTES. Needs a browser (canvas), so it is not covered by the unit tests; the message format is
// (src/protocol/chatImage.ts, test/chat.test.ts).

import { CHAT_IMAGE_MIMES, MAX_CHAT_IMAGE_BYTES } from '../protocol/chatImage.js';
import { ChatSendError } from './chat';
import { text } from './messages';

/** What the file picker offers; a phone's camera or gallery can supply any of these. */
export const CHAT_IMAGE_ACCEPT = CHAT_IMAGE_MIMES.join(',');
// A longer side than this adds weight, not legibility: bank receipts are mostly text.
const MAX_SIDE = 1600;
const MIN_SIDE = 640;
const QUALITIES = [0.85, 0.7, 0.55, 0.4];

const toBlob = (canvas: HTMLCanvasElement, quality: number) =>
  new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', quality));

export async function prepareChatImage(file: File): Promise<{ bytes: Uint8Array; mime: string }> {
  if (!(CHAT_IMAGE_MIMES as readonly string[]).includes(file.type)) {
    throw new ChatSendError(text().chat.imageTypes);
  }
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    throw new ChatSendError(text().chat.notAnImage);
  }
  try {
    const longest = Math.min(MAX_SIDE, Math.max(bitmap.width, bitmap.height));
    // An image already smaller than the floor (a logo, an icon) is encoded once at its own size: with a fixed floor
    // the loop never ran for it, and a 1 KB PNG was reported as too large.
    const floor = Math.min(MIN_SIDE / 2, longest);
    for (let side = longest; side >= floor; side = Math.floor(side * 0.75)) {
      const scale = Math.min(1, side / Math.max(bitmap.width, bitmap.height));
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.round(bitmap.width * scale));
      canvas.height = Math.max(1, Math.round(bitmap.height * scale));
      const ctx = canvas.getContext('2d');
      if (!ctx) break;
      // JPEG has no transparency: a transparent PNG would turn black without this.
      ctx.fillStyle = '#fff';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
      for (const quality of QUALITIES) {
        const blob = await toBlob(canvas, quality);
        if (blob && blob.size <= MAX_CHAT_IMAGE_BYTES) return { bytes: new Uint8Array(await blob.arrayBuffer()), mime: 'image/jpeg' };
      }
    }
  } finally {
    bitmap.close();
  }
  throw new ChatSendError(text().chat.imageTooLarge(Math.floor(MAX_CHAT_IMAGE_BYTES / 1000)));
}
