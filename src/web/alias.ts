// A friendly name for an identity, so a list of offers reads as people instead of hex. It is derived from the
// identity key itself: nobody picks it, it cannot be impersonated by choice, and it is the same on every screen.
// Pure, no DOM; see test/alias.test.ts.
//
// Provisional: for the hackathon the name is derived, not chosen. It is a label to recognise someone, not a proof of
// who they are: there are only 1,024 names, so two people can share one and a determined user could generate wallets
// until one lands on a name they want to imitate. Letting people pick a personal name (signed by their wallet, unique
// across the service) is planned; see "Names" under Identity and sign-in in docs/protocol.md.

const ADJECTIVES = [
  'Quiet', 'Swift', 'Amber', 'Gentle', 'Bright', 'Hidden', 'Golden', 'Calm',
  'Wild', 'Warm', 'Silver', 'Mossy', 'Sunny', 'Misty', 'Brave', 'Cozy',
  'Dusty', 'Frosty', 'Humble', 'Lucky', 'Merry', 'Nimble', 'Patient', 'Rustic',
  'Smoky', 'Steady', 'Stormy', 'Tawny', 'Vivid', 'Windy', 'Wise', 'Crimson',
];

const NOUNS = [
  'Ember', 'Lantern', 'Birch', 'Fern', 'Cedar', 'Brook', 'Meadow', 'Pine',
  'Spark', 'Willow', 'Falcon', 'Otter', 'Maple', 'Pebble', 'Ridge', 'Harbor',
  'Acorn', 'Aspen', 'Canyon', 'Cinder', 'Clover', 'Comet', 'Dune', 'Fox',
  'Glade', 'Heron', 'Juniper', 'Marsh', 'Owl', 'River', 'Thistle', 'Wolf',
];

export interface Alias {
  name: string;
  /** Two uppercase letters for the avatar. */
  initials: string;
  /** 0-359, for the avatar colour. */
  hue: number;
}

// FNV-1a, 32 bits: tiny, stable across browsers and Node, good enough to spread names.
function fnv1a(text: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  // Final avalanche (murmur3): FNV's low bits barely depend on the last characters, and we take them modulo 32.
  hash ^= hash >>> 16;
  hash = Math.imul(hash, 0x85ebca6b) >>> 0;
  hash ^= hash >>> 13;
  hash = Math.imul(hash, 0xc2b2ae35) >>> 0;
  hash ^= hash >>> 16;
  return hash >>> 0;
}

export function aliasFor(identity: string): Alias {
  const key = String(identity ?? '').toLowerCase();
  // Two independent hashes so the words and the colour do not move together.
  const a = fnv1a(key);
  const b = fnv1a(`${key}#campfire`);
  const adjective = ADJECTIVES[a % ADJECTIVES.length];
  const noun = NOUNS[b % NOUNS.length];
  return {
    name: `${adjective} ${noun}`,
    initials: `${adjective[0]}${noun[0]}`,
    hue: (a >>> 8) % 360,
  };
}
