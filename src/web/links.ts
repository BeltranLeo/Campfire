// External links shown on every page. A null URL is rendered as plain text, never as a dead link.

export const REPO_URL = 'https://github.com/BeltranLeo/Campfire';
export const PROTOCOL_SPEC_URL = `${REPO_URL}/blob/master/docs/protocol.md`;

// Hackathon banner: the code and demo at the start of the judged window and at the end.
// TODO: fill in the Nov 14 links before submission.
export const BANNER_LINKS: { label: string; url: string | null }[] = [
  { label: 'Code at Nov 14', url: null },
  { label: 'Demo at Nov 14', url: null },
  { label: 'Final code', url: REPO_URL },
  { label: 'Final demo', url: 'https://campfire-rosy.vercel.app/' },
];

// CashTokens-aware address for the public vote.
export const VOTING_ADDRESS: string | null = 'bitcoincash:zrkupj9hdtgk0nc3ygmjzw89e2hyfuwen5dnp77rrq';

// Where a newcomer gets a wallet: the About section that lists the wallets Campfire pairs with, and their sites.
export const GET_A_WALLET_ID = 'get-a-wallet';
export const WALLETS: { name: string; url: string; note: string }[] = [
  { name: 'Selene', url: 'https://selene.cash/', note: 'A Bitcoin Cash wallet for your phone.' },
  { name: 'Paytaca', url: 'https://www.paytaca.com/', note: 'A Bitcoin Cash wallet for your phone or browser.' },
];
