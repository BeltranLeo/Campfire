// Bitcoin Cash Metadata Registry (BCMR) for the Campfire offer category (protocol section 3.5): what wallets show
// for a marker NFT, and the genesis transaction that creates the category and publishes the registry on-chain.

import { binToHex, sha256, utf8ToBin, type MetadataRegistry } from '@bitauth/libauth';
import { TransactionBuilder, type NetworkProvider } from 'cashscript';
import { formatWalletTransactionRequest, toUnlockableWalletUtxo, type WalletSpendableUtxo, type WalletTransactionRequest } from './keys.js';
import { offerMinter } from './marker.js';

export const CAMPFIRE_WEB = 'https://campfire.cash/';
export const CAMPFIRE_SOURCE = 'https://github.com/BeltranLeo/Campfire';
/** Where the registry is served: the publication output names only the domain, which means this well-known path. */
export const REGISTRY_DOMAIN = 'campfire.cash';
export const REGISTRY_PATH = '/.well-known/bitcoin-cash-metadata-registry.json';
export const OFFER_ICON_URI = 'https://campfire.cash/bcmr/campfire-offer.png';

/**
 * Splits a marker's commitment after its first byte: the side byte becomes the NFT type (bottom of the altstack) and
 * the offer hash its one field. OP_0 OP_UTXOTOKENCOMMITMENT OP_1 OP_SPLIT OP_SWAP OP_TOALTSTACK OP_TOALTSTACK.
 * The example with this mnemonic in libauth's BCMR types, `00d2517f7c6b`, does not match it: 0xd2 is
 * OP_OUTPUTTOKENCOMMITMENT (it reads the parsing transaction's OP_RETURN output, which has no commitment) and the
 * second OP_TOALTSTACK is missing. test/bcmr.test.ts runs both.
 */
export const MARKER_PARSE_BYTECODE = '00cf517f7c6b6b';

/** The registry for one offer category. Every text is in English: wallets show it to people in any country. */
export function buildOfferRegistry(params: { category: string; revision: string }): MetadataRegistry {
  const { category, revision } = params;
  const uris = { icon: OFFER_ICON_URI, web: CAMPFIRE_WEB, source: CAMPFIRE_SOURCE };
  return {
    $schema: 'https://cashtokens.org/bcmr-v2.schema.json',
    version: { major: 1, minor: 0, patch: 0 },
    latestRevision: revision,
    registryIdentity: {
      name: 'Campfire',
      description: 'Non-custodial peer-to-peer exchange of Bitcoin Cash and PUSD for cash, with an on-chain escrow.',
      uris,
    },
    identities: {
      [category]: {
        [revision]: {
          name: 'Campfire offer',
          description:
            'A ticket for an offer on Campfire, the non-custodial P2P exchange for Bitcoin Cash. The offer is open while this NFT exists; burning it closes the offer.',
          token: {
            category,
            symbol: 'CAMPFIRE',
            decimals: 0,
            nfts: {
              description: 'Each NFT marks one offer. Its commitment holds the side of the offer and the SHA-256 hash of the offer document.',
              fields: {
                offerHash: {
                  name: 'Offer hash',
                  description: 'SHA-256 of the offer document, which is also the digest of its IPFS CID.',
                  encoding: { type: 'hex' },
                },
              },
              parse: {
                bytecode: MARKER_PARSE_BYTECODE,
                types: {
                  '01': {
                    name: 'Sell offer',
                    description: 'The holder sells coins for cash. Burn this NFT to close the offer.',
                    fields: ['offerHash'],
                    uris: { icon: OFFER_ICON_URI },
                  },
                  '02': {
                    name: 'Buy offer',
                    description: 'The holder buys coins with cash. Burn this NFT to close the offer.',
                    fields: ['offerHash'],
                    uris: { icon: OFFER_ICON_URI },
                  },
                },
              },
            },
          },
          uris,
        },
      },
    },
  };
}

/** The exact bytes that are hashed, published and served. */
export const registryBytes = (registry: MetadataRegistry) => utf8ToBin(`${JSON.stringify(registry, null, 2)}\n`);

/**
 * A BCMR publication output: OP_RETURN <'BCMR'> <SHA-256 of the registry, in OP_SHA256 byte order> <uri>…
 * URIs without a protocol are HTTPS; a bare domain means the well-known path.
 */
export function encodeBcmrPublication(registry: Uint8Array, uris: string[] = [REGISTRY_DOMAIN]): Uint8Array {
  const pushes = [utf8ToBin('BCMR'), sha256.hash(registry), ...uris.map((u) => utf8ToBin(u))];
  const bytes = [0x6a];
  for (const p of pushes) {
    if (p.length > 75) throw new Error('BCMR publication push too long');
    bytes.push(p.length, ...p);
  }
  if (bytes.length > 223) throw new Error('BCMR publication exceeds the OP_RETURN limit');
  return Uint8Array.from(bytes);
}

/**
 * The genesis transaction of the offer category. Spending output 0 of the authbase transaction creates the category
 * (its id is the authbase txid) and continues its authchain:
 * output 0 = identity output (BCH back to the funder, keep it unspent: it carries the registry's authority),
 * outputs 1…N = minting NFTs at the minter covenant, then the BCMR publication, then optional change.
 */
export function buildOfferGenesisTransaction(params: {
  provider: NetworkProvider;
  /** A coin at output 0 of its transaction: its txid becomes the category. */
  authbase: WalletSpendableUtxo;
  /** More coins to pay for the outputs, if the authbase coin is small. */
  extra?: WalletSpendableUtxo[];
  identityAddress: string;
  changeAddress: string;
  registry: Uint8Array;
  minters?: number;
  feeRate?: number;
}): WalletTransactionRequest & { category: string } {
  if (params.authbase.vout !== 0) throw new Error('The authbase coin must be output 0 of its transaction');
  const category = params.authbase.txid;
  const minters = params.minters ?? 4;
  const contract = offerMinter(params.provider);
  const inputs = [params.authbase, ...(params.extra ?? [])];
  let builder = new TransactionBuilder({ provider: params.provider })
    .addInputs(inputs.map(toUnlockableWalletUtxo))
    .addOutput({ to: params.identityAddress, amount: 1000n });
  for (let i = 0; i < minters; i++) {
    // A one-byte commitment numbers each minter, so that every minter UTXO is told apart in explorers.
    builder = builder.addOutput({
      to: contract.tokenAddress,
      amount: 1000n,
      token: { category, amount: 0n, nft: { capability: 'minting', commitment: binToHex(Uint8Array.of(i)) } },
    });
  }
  builder = builder
    .addOutput({ to: encodeBcmrPublication(params.registry), amount: 0n })
    .addBchChangeOutputIfNeeded({ to: params.changeAddress, feeRate: params.feeRate ?? 1.0 });
  return { ...formatWalletTransactionRequest(builder, inputs, 'Campfire: create the offer category'), category };
}
