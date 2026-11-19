import { useState } from 'react';
import { looksLikeChatImage, parseChatImage, type ChatImage as Image } from '../../protocol/chatImage.js';

// A receipt in a chat: small in the list, the full width of the card once tapped. Used by the trade chat and by
// the arbiter's console (the styles are in chat.css).
export function ChatImageView({ image }: { image: Image }) {
  const [expanded, setExpanded] = useState(false);
  return (
    <button
      type="button"
      className="tr-chat__image"
      data-expanded={expanded || undefined}
      aria-label={expanded ? 'Shrink receipt' : 'Enlarge receipt'}
      onClick={() => setExpanded(!expanded)}
    >
      <img src={`data:${image.mime};base64,${image.base64}`} alt="Receipt sent in the chat" />
    </button>
  );
}

/**
 * A decrypted message as the arbiter reads it: the receipt as an image, other text as it is. A message that starts
 * like an image but is not a valid one is not printed (it would be a wall of base64, or something crafted).
 * Invented copy for the malformed case.
 */
export function ChatPlaintext({ plaintext }: { plaintext: string }) {
  if (!looksLikeChatImage(plaintext)) return <>{plaintext}</>;
  const image = parseChatImage(plaintext);
  return image ? <ChatImageView image={image} /> : <em>An image that could not be shown.</em>;
}
