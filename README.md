# Campfire

A peer-to-peer, non-custodial exchange of BCH and PUSD for fiat money. Sellers lock coins in an escrow contract, buyers pay in fiat outside the app, and the seller releases. If there is a dispute, an arbiter picks between buyer and seller by signing a decision. The arbiter never holds funds.

Built by Leo and Aye Anto for BCH BLAZE 2026 (Mainnet category). Try it at <https://campfire.cash/>.

The protocol, including the contract, the offer format and the trade states, is in [docs/protocol.md](docs/protocol.md). Work done before the build window (November 14–22, 2026) is in [preparation/](preparation/).

## Why Campfire

Peer-to-peer markets are how many people buy their first coins with local money. They used to run on a company's servers, and when LocalCryptos (2022) and LocalBitcoins (2023) closed, the offers and reputations closed with them. Campfire puts the offers and the escrow on Bitcoin Cash instead. The website is one way in.

- **Non-custodial from the first click.** The seller's coins sit in a CashScript escrow that can only pay the buyer or return to the seller. Campfire never holds them, and the arbiter signs a verdict, never a transaction. Trading means connecting your own wallet, so a newcomer starts with self-custody.
- **A buyer needs no BCH.** Taking an offer is free and needs no signature. The escrow pays its own network fee, and Campfire pays the fee to publish a buy offer.
- **Real on mainnet.** A demo seller bot trades real BCH and PUSD through the real contract, and people have traded with each other through it. Every contract path that has run is linked [below](#real-transactions-on-mainnet) and on the app's transparency page.
- **CashTokens at both levels.** Trades settle in BCH or in PUSD, a dollar token on Bitcoin Cash, with the same contract. Each offer is marked by an NFT of the Campfire offer category, whose metadata is published as a BCMR registry so wallets can show it.
- **Offers nobody can forge.** The markers are minted by a covenant with no key ([`CampfireOfferMinter`](contracts/CampfireOfferMinter.cash)): anyone may mint one marker per offer, and only if its commitment matches the offer's on-chain hash. Four parallel minting lanes let several people publish at the same moment, and each lane chains publications without waiting for blocks.
- **Verifiable offers.** An offer is an `OP_RETURN` with the hash of its terms, open while its NFT is unspent. The service indexes them to list them, but each one comes from a real wallet and can be checked on-chain: its page links to the transaction that opened it and, once closed, the one that closed it.
- **No waiting for blocks.** Trades act on 0-conf deposits, checked in the buyer's browser with double-spend proofs (DSProofs).
- **Sign-in nobody can fake.** WizardConnect is the only sign-in. The wallet signs a challenge transaction that can never be broadcast, and every action for an identity needs the session it opens, so nobody can act in someone else's name. Campfire sees public keys only, and the wallet asks before every transaction.
- **Private by design.** Payment details are encrypted for the counterparty of each trade. The chat is end-to-end encrypted and every message is signed; the arbiter can read it only after a party opens a dispute. It stays open for seven days after the trade. Each trade uses a fresh key and address. Only the two parties and the arbiter see who traded and for how much; everyone else sees what the chain shows.
- **Arbitration with a business model.** The seller pays the arbiter and, on market-price offers, the price oracle: 0.5% each today, as outputs of the funding transaction, fixed when the trade is requested.
- **An open protocol.** The contract, the offer format and every trade state are specified in [docs/protocol.md](docs/protocol.md). An offer names its arbiter and oracle by public key, so anyone can build another client or run an arbiter or an oracle. Campfire is the default for both today.
- **Made for people paying in fiat money.** A market nobody serves on Bitcoin Cash today. The app is in English and Spanish, prices follow the market with a margin above or below it, or are fixed, and each offer link shows a preview in messaging apps.
- **Honest about the rest.** Identity is a hash of the wallet's public key, and reputation is a count of completed trades kept by the service, which a second wallet can inflate. Portable identity as an NFT, a fuller reputation and independent arbiters are on the public roadmap.

## What the service stores about you

Please read this before connecting a wallet.

- **Two of your wallet's extended public keys** (`defi` and `receive`). Connecting a wallet sends them to the service, which stores them unencrypted and does not delete them. It needs them to check the keys and payout addresses of each trade. The `change` key stays in your browser: the service never receives it.
- **What that allows.** Whoever can read the service's database can derive every address of your wallet on those paths, see their balances and history, and link all your trades together. They cannot spend your coins: no private key ever reaches the service.
- **Who else sees them.** No endpoint returns your keys to other users. Your counterparty receives only the keys derived for the trade you share.
- **What the network sees.** The browser reads balances from a public Electrum server, which sees the addresses it is asked about and your IP address.

Details are in [Identity and sign-in](docs/protocol.md#identity-and-sign-in).

## Your name in the app

The app does not show your identity hash. It shows a name made from it, such as «Quiet Cedar», the same on every screen. Nobody chooses it. It helps to recognise someone, but it is not proof of who they are: two people can share a name, and anyone can generate wallets until one lands on a name they want to imitate. Judge a counterparty by their completed trades, which Campfire counts and which can be inflated with a second wallet. Choosing your own name is planned and not built yet.

## Try it

The demo opens with one click and needs no registration: <https://campfire.cash/>. You can browse without a wallet and trade with one (WizardConnect, top right).

## What is real and what is simulated

- **Real:** the escrow contract, its signatures and every transaction below. They are on Bitcoin Cash mainnet and the coins are real, in small amounts.
- **Simulated:** in the demo the seller is a bot run by the service, and the fiat payment does not happen. Every demo offer and trade carries a visible «Simulated» label in the app.
- **Not yet run on mainnet:** the `arbitrate` and `refund` paths of the contract and the closing of an offer. They are implemented, but no real transaction exists for them yet, so none is listed below.

## Real transactions on mainnet

One transaction for each contract path that has run on mainnet. The code links are pinned to commit [`1c99132`](https://github.com/BeltranLeo/Campfire/tree/1c9913240dfb9b3d494a0d9b814419b4a216d5cb), the one this table was written against, so the line numbers do not drift. The code has changed since these transactions were made, so the link points at the function that builds that kind of transaction today.

| Path | What it does | Transaction | Code that builds it |
| --- | --- | --- | --- |
| Publish an offer | Writes the offer's hash in an `OP_RETURN` and a 1,000-sat marker; locks nothing | [`48946f57…3816`](https://blockchair.com/bitcoin-cash/transaction/48946f57a8a13ee7173b8529a0b41d020f4225891a1fa4339bbf9c7cc42f3816) | [`demo.ts:363`](https://github.com/BeltranLeo/Campfire/blob/1c9913240dfb9b3d494a0d9b814419b4a216d5cb/src/server/demo.ts#L363) → [`offers.ts:347`](https://github.com/BeltranLeo/Campfire/blob/1c9913240dfb9b3d494a0d9b814419b4a216d5cb/src/protocol/offers.ts#L347) |
| Fund | The seller locks the coins in the escrow address `bitcoincash:pwsm78j96g8jyz6rpjmzaqfm64q727zgnhzrap7vux8m9v3akla8s3dxhhj5u` | [`c065c11d…09ff`](https://blockchair.com/bitcoin-cash/transaction/c065c11d078b15e4847d52611404042247f0e6ac4b3fea0c68cae3dd2b1609ff) | [`demo.ts:568`](https://github.com/BeltranLeo/Campfire/blob/1c9913240dfb9b3d494a0d9b814419b4a216d5cb/src/server/demo.ts#L568) → [`escrow.ts:317`](https://github.com/BeltranLeo/Campfire/blob/1c9913240dfb9b3d494a0d9b814419b4a216d5cb/src/protocol/escrow.ts#L317) |
| `release` | The seller's signature pays the buyer; it spends the output of the fund transaction above | [`c957a840…0a18`](https://blockchair.com/bitcoin-cash/transaction/c957a8401bdb9748010bad67da0e8ad09eaecb383b91affb8b7c055728230a18) | [`demo.ts:603`](https://github.com/BeltranLeo/Campfire/blob/1c9913240dfb9b3d494a0d9b814419b4a216d5cb/src/server/demo.ts#L603) → [`escrow.ts:198`](https://github.com/BeltranLeo/Campfire/blob/1c9913240dfb9b3d494a0d9b814419b4a216d5cb/src/protocol/escrow.ts#L198) |
| `cancel` | The buyer's wallet signs and the funds return to the seller; it spends the output of a different trade's deposit, [`59421e3c…628d`](https://blockchair.com/bitcoin-cash/transaction/59421e3c8e13bb13487204e196e727e2a6b90f01a1ca66190517e1f2fdd8628d) | [`6d3bbebd…4405`](https://blockchair.com/bitcoin-cash/transaction/6d3bbebda998b9fe9b5b9740f47e25be44c179372957214c799a35e9656e4405) | [`TradePage.tsx:267`](https://github.com/BeltranLeo/Campfire/blob/1c9913240dfb9b3d494a0d9b814419b4a216d5cb/src/web/pages/TradePage.tsx#L267) → [`trade.ts:330`](https://github.com/BeltranLeo/Campfire/blob/1c9913240dfb9b3d494a0d9b814419b4a216d5cb/src/web/trade.ts#L330) → [`escrow.ts:221`](https://github.com/BeltranLeo/Campfire/blob/1c9913240dfb9b3d494a0d9b814419b4a216d5cb/src/protocol/escrow.ts#L221) |

The same list, with dates, is on the app's transparency page (`src/web/proof.ts`). The contract paths are in [`contracts/CampfireEscrow.cash`](contracts/CampfireEscrow.cash).

## Vote for Campfire

CashTokens address for the public vote: `bitcoincash:zrkupj9hdtgk0nc3ygmjzw89e2hyfuwen5dnp77rrq`

## Run it

```bash
npm install
npm run dev     # web app
npm test        # type checks and tests
```

The escrow contract and its tests are in [contracts/](contracts/).
