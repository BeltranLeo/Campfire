// Creates the Campfire offer category (protocol section 3.5): the minting NFTs at the minter covenant and the BCMR
// publication, in one transaction paid by a key you hold. Run from the repository root:
//
//   OFFER_GENESIS_KEY=<64 hex chars> npx tsx scripts/offer-genesis.ts [--network chipnet] [--broadcast]
//
// Without --broadcast nothing is sent: the script prints what it would do. The key's address must hold a coin at
// output 0 of its transaction (its txid becomes the category); if it has none, the script first sends the coins to
// the same address so that one exists, and asks you to run it again. Keep the identity output (output 0 of the
// genesis transaction) unspent: whoever spends it moves the registry's authority.

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { binToHex, hash160, secp256k1 } from '@bitauth/libauth';
import { ElectrumNetworkProvider, SignatureTemplate, TransactionBuilder, type Network } from 'cashscript';
import {
  REGISTRY_PATH,
  buildOfferGenesisTransaction,
  buildOfferRegistry,
  pkhToCashAddress,
  registryBytes,
  toBytes,
} from '../src/protocol/index.js';

const args = process.argv.slice(2);
const network = (args.includes('--network') ? args[args.indexOf('--network') + 1] : 'mainnet') as Network;
const broadcast = args.includes('--broadcast');
const raw = process.env.OFFER_GENESIS_KEY?.trim();
if (!raw || !/^[0-9a-f]{64}$/i.test(raw)) throw new Error('Set OFFER_GENESIS_KEY to a 32-byte private key in hex');
const key = toBytes(raw, 'OFFER_GENESIS_KEY');
const publicKey = secp256k1.derivePublicKeyCompressed(key);
if (typeof publicKey === 'string') throw new Error(publicKey);

const provider = new ElectrumNetworkProvider(network);
const signer = new SignatureTemplate(key);
const address = pkhToCashAddress(hash160(publicKey), { prefix: network === 'mainnet' ? 'bitcoincash' : 'bchtest' });
const coins = (await provider.getUtxos(address)).filter((u) => !u.token);
const wallet = coins.map((u) => ({ ...u, pathName: 'receive' as const, keyIndex: 0, address, signer }));
const total = coins.reduce((sum, u) => sum + u.satoshis, 0n);
console.log(`Funding address: ${address} (${total} sats in ${coins.length} coins)`);
if (total < 10_000n) throw new Error('Send at least 10,000 sats to the funding address first');

const authbase = wallet.find((u) => u.vout === 0);
if (!authbase) {
  const builder = new TransactionBuilder({ provider })
    .addInputs(wallet.map((u) => ({ ...u, unlocker: signer.unlockP2PKH() })))
    .addBchChangeOutputIfNeeded({ to: address, feeRate: 1.0 });
  console.log('No coin sits at output 0 of its transaction. Sending the coins to the same address to make one.');
  if (broadcast) console.log(`Sent ${await provider.sendRawTransaction(builder.build())}. Run the script again.`);
  else console.log('Dry run: add --broadcast to send it.');
  process.exit(0);
}

const revision = new Date().toISOString();
const registry = registryBytes(buildOfferRegistry({ category: authbase.txid, revision }));
const genesis = buildOfferGenesisTransaction({
  provider,
  authbase,
  extra: wallet.filter((u) => u !== authbase),
  identityAddress: address,
  changeAddress: address,
  registry,
});
console.log(`Category: ${genesis.category}`);
console.log(`Genesis transaction: ${genesis.hex.length / 2} bytes`);

if (!broadcast) {
  console.log('Dry run: add --broadcast to create the category and write the registry.');
  process.exit(0);
}
// The registry is written before broadcasting, so the published hash always has its file.
mkdirSync(dirname(`public${REGISTRY_PATH}`), { recursive: true });
writeFileSync(`public${REGISTRY_PATH}`, registry);
const txid = await provider.sendRawTransaction(genesis.hex);
console.log(`Broadcast ${txid}`);
console.log(`Wrote public${REGISTRY_PATH} (${binToHex(registry).length / 2} bytes): commit and deploy it unchanged.`);
console.log(`Then set CAMPFIRE_OFFER_CATEGORY=${genesis.category} on the server.`);
process.exit(0);
