// One real mainnet transaction for each path of the escrow contract, shown on the transparency page.
// A path that has not run on mainnet yet has no transaction, and the page says so instead of showing a mock-up.

export interface ContractPath {
  path: 'offer' | 'fund' | 'release' | 'cancel' | 'arbitrate' | 'refund' | 'close';
  what: string;
  who: string;
  /** The real transaction, or null when the path has not run on mainnet yet. */
  txid: string | null;
  /** Unix seconds. */
  at: number | null;
}

export const CONTRACT_PATHS: ContractPath[] = [
  {
    path: 'offer',
    what: 'Publishes an offer (OP_RETURN + marker). Locks no funds.',
    who: 'Seller',
    txid: '48946f57a8a13ee7173b8529a0b41d020f4225891a1fa4339bbf9c7cc42f3816',
    at: 1794807937,
  },
  {
    path: 'fund',
    what: 'Seller deposits into the escrow address.',
    who: 'Seller',
    txid: 'c065c11d078b15e4847d52611404042247f0e6ac4b3fea0c68cae3dd2b1609ff',
    at: 1794855772,
  },
  {
    path: 'release',
    what: 'Pays the buyer.',
    who: 'Seller signature',
    txid: 'c957a8401bdb9748010bad67da0e8ad09eaecb383b91affb8b7c055728230a18',
    at: 1794855792,
  },
  {
    path: 'cancel',
    what: 'Returns the funds to the seller.',
    who: 'Buyer signature',
    txid: '6d3bbebda998b9fe9b5b9740f47e25be44c179372957214c799a35e9656e4405',
    at: 1794899770,
  },
  { path: 'arbitrate', what: 'Pays the party the arbiter chose.', who: 'Arbiter verdict', txid: null, at: null },
  {
    path: 'refund',
    what: 'Returns the funds to the seller 14 days after acceptance.',
    who: 'Nobody, time lock',
    txid: null,
    at: null,
  },
  { path: 'close', what: 'Seller spends the marker and closes the offer.', who: 'Seller', txid: null, at: null },
];
