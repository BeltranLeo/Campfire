# Campfire

A peer-to-peer, non-custodial exchange of BCH and PUSD for fiat money. Sellers lock coins in an escrow contract, buyers pay in fiat outside the app, and the seller releases. If there is a dispute, an arbiter picks between buyer and seller by signing a decision. The arbiter never holds funds.

Built by Leo and Aye Anto for BCH BLAZE 2026 (Mainnet category).

The protocol, including the contract, the offer format and the trade states, is in [docs/protocol.md](docs/protocol.md). Work done before the build window (November 14–22, 2026) is in [preparation/](preparation/).

## What the service stores about you

Please read this before connecting a wallet.

- **Your wallet's three extended public keys** (`defi`, `receive` and `change`). Connecting a wallet sends them to the service, which stores them unencrypted and does not delete them. It needs them to check the keys and payout addresses of each trade.
- **What that allows.** Whoever can read the service's database can derive every address of your wallet on those paths, see their balances and history, and link all your trades together. They cannot spend your coins: no private key ever reaches the service.
- **Who else sees them.** No endpoint returns your keys to other users. Your counterparty receives only the keys derived for the trade you share.
- **What the network sees.** The browser reads balances from a public Electrum server, which sees the addresses it is asked about and your IP address.

Details are in [Identity and sign-in](docs/protocol.md#identity-and-sign-in).

## Your name in the app

The app does not show your identity hash. It shows a name made from it, such as «Quiet Cedar», the same on every screen. Nobody chooses it. It helps to recognise someone, but it is not proof of who they are: two people can share a name, and anyone can generate wallets until one lands on a name they want to imitate. Judge a counterparty by their completed trades, which Campfire counts and which can be inflated with a second wallet. Choosing your own name is planned and not built yet.

## Run it

```bash
npm install
npm run dev     # web app
npm test        # type checks and tests
```

The escrow contract and its tests are in [contracts/](contracts/).
