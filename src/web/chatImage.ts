// Gets a photo or screenshot ready to send as a receipt: decoded, scaled down and re-encoded as JPEG until it fits
// MAX_CHAT_IMAGE_BYTES. Needs a browser (canvas), so it is not covered by the unit tests; the message format is
// (src/protocol/chatImage.ts, test/chat.test.ts).

import { CHAT_IMAGE_MIMES, MAX_CHAT_IMAGE_BYTES } from '../protocol/chatImage.js';
import { ChatSendError } from './chat';

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
    throw new ChatSendError('Only JPEG, PNG and WebP images can be sent.');
  }
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    throw new ChatSendError('That file could not be read as an image.');
  }
  try {
    for (let side = Math.min(MAX_SIDE, Math.max(bitmap.width, bitmap.height)); side >= MIN_SIDE / 2; side = Math.floor(side * 0.75)) {
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
  throw new ChatSendError('The image is too large to send. Try a smaller one.');
}
