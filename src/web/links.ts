// External links shown on every page. A null URL is rendered as plain text, never as a dead link.

export const REPO_URL = 'https://github.com/BeltranLeo/Campfire';
export const PROTOCOL_SPEC_URL = `${REPO_URL}/blob/master/docs/protocol.md`;

// Hackathon banner: the code and demo at the start of the judged window and at the end.
// The first commit (Nov 15) holds only the pre-hackathon notes; no demo existed yet,
// so the Nov 14 demo link points to those notes.
const FIRST_COMMIT_URL = `${REPO_URL}/tree/80fdb03d5f7f3be1c96d7f33796865b85838a10d`;
export const BANNER_LINKS: { label: string; url: string | null }[] = [
  { label: 'Code at Nov 14', url: FIRST_COMMIT_URL },
  { label: 'Demo at Nov 14', url: `${FIRST_COMMIT_URL}/preparation` },
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
