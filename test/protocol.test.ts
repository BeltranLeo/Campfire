import { describe, expect, it } from 'vitest';
import {
  MockNetworkProvider,
  Network,
  SignatureTemplate,
  TransactionBuilder,
  randomUtxo,
} from 'cashscript';
import {
  binToHex,
  decodeTransactionUnsafe,
  deriveHdPath,
  deriveHdPrivateNodeChild,
  deriveHdPrivateNodeFromSeed,
  deriveHdPublicNode,
  encodeCashAddress,
  encodeHdPublicKey,
  hash160,
  hexToBin,
  secp256k1,
  sha256,
  stringify,
  utf8ToBin,
} from '@bitauth/libauth';
import {
  BCH_ASSET,
  BCH_DECIMALS,
  ESCROW_FEE_BUDGET,
  MARKER_SATOSHIS,
  PUSD_CATEGORY,
  PUSD_DECIMALS,
  TOKEN_ESCROW_FUNDING_SATS,
  VERDICT_BUYER,
  VERDICT_SELLER,
  buildArbitrateSpend,
  buildCancelRequest,
  buildCloseOfferTransaction,
  buildFundEscrowTransaction,
  buildPublishOfferTransaction,
  buildPublishNftOfferTransaction,
  buildCloseNftOfferTransaction,
  findMinterUtxos,
  isMarkerUtxo,
  markerCommitment,
  offerMinter,
  parseMarkerCommitment,
  FORMAT_VERSION_NFT,
  buildRefundSpend,
  buildReleaseRequest,
  cashAddressToPkh,
  computeFiatAmount,
  computeTradeId,
  createEscrowContract,
  decodeOfferOpReturn,
  decryptChatMessage,
  decryptPaymentDetails,
  derivePayoutPkhFromXpub,
  derivePubkeyFromXpub,
  deriveSharedTradeKey,
  deriveWalletAddressMap,
  encodeOfferOpReturn,
  encryptChatMessage,
  encryptPaymentDetails,
  expectedEscrowFunding,
  generateSessionKeyPair,
  hashOfferJson,
  identityFromDefiXpub,
  matchesEscrowFunding,
  offerHashToCidV1Bytes,
  pkhToCashAddress,
  pkhToLockingBytecode,
  signPriceQuote,
  signVerdict,
  tagWalletUtxos,
  validateOfferDocument,
  validateTradeTerms,
  verifyDerivedPayoutPkh,
  verifyDerivedPubkey,
  verifyOfferAgainstOpReturn,
  verifyPriceQuote,
  verifySignedContractSpend,
  verifyVerdict,
  type OfferDocument,
  type TradeTerms,
} from '../src/protocol/index.js';
import {
  buildSignInRequest,
  signInCoinTxid,
  signInNonce,
  verifySignInTransaction,
} from '../src/protocol/signin.js';
import { signSignInLocally } from './signin-helper.js';

function makeWalletFixture(seedLabel: string) {
  const seed = new Uint8Array(64);
  seed.set(sha256.hash(utf8ToBin(seedLabel)), 0);
  const master = deriveHdPrivateNodeFromSeed(seed);
  const accountPath = "m/44'/145'/0'";
  const receivePriv = deriveHdPath(master, `${accountPath}/0`);
  const defiPriv = deriveHdPath(master, `${accountPath}/7`);
  if (typeof receivePriv === 'string' || typeof defiPriv === 'string') {
    throw new Error('Failed to derive fixture HD paths');
  }
  const receiveXpub = encodeHdPublicKey({
    network: 'mainnet',
    node: deriveHdPublicNode(receivePriv),
  }).hdPublicKey;
  const defiXpub = encodeHdPublicKey({
    network: 'mainnet',
    node: deriveHdPublicNode(defiPriv),
  }).hdPublicKey;

  const childPrivKey = (branch: typeof receivePriv, index: number) => {
    const child = deriveHdPrivateNodeChild(branch, index);
    if (typeof child === 'string') throw new Error(child);
    return child.privateKey;
  };

  return {
    receiveXpub,
    defiXpub,
    defiPrivKey: (index: number) => childPrivKey(defiPriv, index),
    receivePrivKey: (index: number) => childPrivKey(receivePriv, index),
  };
}

const sellerWallet = makeWalletFixture('seller-wallet');
const buyerWallet = makeWalletFixture('buyer-wallet');

const arbiterSk = sha256.hash(utf8ToBin('campfire-arbiter-key'));
const arbiterPk = binToHex(secp256k1.derivePublicKeyCompressed(arbiterSk) as Uint8Array);

const oracleSk = sha256.hash(utf8ToBin('campfire-oracle-key'));
const oraclePk = binToHex(secp256k1.derivePublicKeyCompressed(oracleSk) as Uint8Array);

describe('keys and identity (section 1 & 5)', () => {
  it('computes a deterministic 64-char hex identity from the defi xpub and rejects invalid xpubs', () => {
    const id1 = identityFromDefiXpub(sellerWallet.defiXpub);
    const id2 = identityFromDefiXpub(`  ${sellerWallet.defiXpub}\n`);
    expect(id1).toBe(id2);
    expect(id1).toMatch(/^[0-9a-f]{64}$/);
    expect(id1).not.toBe(identityFromDefiXpub(buyerWallet.defiXpub));
    expect(() => identityFromDefiXpub('not-an-xpub')).toThrow(/Invalid extended public key/);
  });

  it('derives public keys and payout hashes matching the wallet private keys', () => {
    const sk = sellerWallet.defiPrivKey(3);
    const expectedPk = secp256k1.derivePublicKeyCompressed(sk) as Uint8Array;
    const derivedPk = derivePubkeyFromXpub(sellerWallet.defiXpub, 3);
    expect(binToHex(derivedPk)).toBe(binToHex(expectedPk));

    expect(verifyDerivedPubkey(sellerWallet.defiXpub, 3, derivedPk)).toBe(true);
    expect(verifyDerivedPubkey(sellerWallet.defiXpub, 4, derivedPk)).toBe(false);
    expect(verifyDerivedPubkey(buyerWallet.defiXpub, 3, derivedPk)).toBe(false);

    const receiveSk = sellerWallet.receivePrivKey(2);
    const expectedPkh = hash160(secp256k1.derivePublicKeyCompressed(receiveSk) as Uint8Array);
    const derivedPkh = derivePayoutPkhFromXpub(sellerWallet.receiveXpub, 2);
    expect(binToHex(derivedPkh)).toBe(binToHex(expectedPkh));
    expect(verifyDerivedPayoutPkh(sellerWallet.receiveXpub, 2, derivedPkh)).toBe(true);
    expect(verifyDerivedPayoutPkh(sellerWallet.receiveXpub, 1, derivedPkh)).toBe(false);
  });

  it('rejects negative or hardened derivation indices', () => {
    expect(() => derivePubkeyFromXpub(sellerWallet.defiXpub, -1)).toThrow(/Invalid derivation index/);
    expect(() => derivePubkeyFromXpub(sellerWallet.defiXpub, 0x80000000)).toThrow(/Invalid derivation index/);
  });

  it('converts between 20-byte payout hashes, CashAddresses (q/z) and P2PKH locking bytecode', () => {
    const pkh = derivePayoutPkhFromXpub(buyerWallet.receiveXpub, 0);
    const qAddr = pkhToCashAddress(pkh);
    const zAddr = pkhToCashAddress(pkh, { tokenAware: true });

    expect(qAddr.startsWith('bitcoincash:q')).toBe(true);
    expect(zAddr.startsWith('bitcoincash:z')).toBe(true);
    expect(binToHex(cashAddressToPkh(qAddr))).toBe(binToHex(pkh));
    expect(binToHex(cashAddressToPkh(zAddr))).toBe(binToHex(pkh));

    const lock = pkhToLockingBytecode(pkh);
    expect(binToHex(lock)).toBe(`76a914${binToHex(pkh)}88ac`);

    const p2shAddr = encodeCashAddress({
      prefix: 'bitcoincash',
      type: 'p2sh',
      payload: pkh,
    });
    if (typeof p2shAddr === 'string') throw new Error(p2shAddr);
    expect(() => cashAddressToPkh(p2shAddr.address)).toThrow(/Expected P2PKH address/);
    expect(() => cashAddressToPkh(qAddr, 'bchtest')).toThrow(/Expected network prefix/);
  });
});

describe('sign-in challenge (section 1)', () => {
  const secret = sha256.hash(utf8ToBin('signin-test-secret'));
  const nonceFor = (receiveXpub: string) =>
    signInNonce(secret, { identity: 'ab'.repeat(32), receiveXpub, expiresAt: 1_800_000_000, salt: 'cd'.repeat(16) });

  it('binds the nonce to the receive key, the expiry and the salt', () => {
    const base = { identity: 'ab'.repeat(32), receiveXpub: buyerWallet.receiveXpub, expiresAt: 1_800_000_000, salt: 'cd'.repeat(16) };
    const nonce = signInNonce(secret, base);
    expect(nonce).toMatch(/^[0-9a-f]{64}$/);
    expect(signInNonce(secret, { ...base, receiveXpub: sellerWallet.receiveXpub })).not.toBe(nonce);
    expect(signInNonce(secret, { ...base, expiresAt: base.expiresAt + 1 })).not.toBe(nonce);
    expect(signInNonce(secret, { ...base, salt: 'ce'.repeat(16) })).not.toBe(nonce);
  });

  it('asks the wallet to sign with defi/0 the same transaction the check accepts once signed', () => {
    const provider = new MockNetworkProvider();
    provider.network = Network.MAINNET;
    const nonce = nonceFor(buyerWallet.receiveXpub);
    const defiPubkey = derivePubkeyFromXpub(buyerWallet.defiXpub, 0);
    const { hex, request, inputPaths } = buildSignInRequest(provider, { nonce, defiPubkey });
    expect(inputPaths).toEqual([[0, 'defi', 0]]);
    expect(request.transaction).toBe(hex);
    expect(request.broadcast).toBe(false);

    const unsigned = decodeTransactionUnsafe(hexToBin(hex));
    const signedHex = signSignInLocally(nonce, buyerWallet.defiPrivKey(0));
    const signed = decodeTransactionUnsafe(hexToBin(signedHex));
    // The wallet only fills in the unlocking bytecode: everything it signs is what the dapp asked for.
    expect(binToHex(unsigned.inputs[0].outpointTransactionHash)).toBe(signInCoinTxid(nonce));
    expect(unsigned.inputs[0].unlockingBytecode.length).toBe(0);
    expect(stringify(signed.outputs)).toBe(stringify(unsigned.outputs));
    expect(signed.locktime).toBe(unsigned.locktime);

    expect(verifySignInTransaction(signedHex, { nonce, defiPubkey })).toBe(true);
    expect(verifySignInTransaction(hex, { nonce, defiPubkey })).toMatch(/does not match/);
    expect(verifySignInTransaction(signedHex, { nonce: nonceFor(sellerWallet.receiveXpub), defiPubkey })).toMatch(/does not answer/);
    expect(verifySignInTransaction(signedHex, { nonce, defiPubkey: derivePubkeyFromXpub(sellerWallet.defiXpub, 0) })).toMatch(/does not match/);
  });
});

describe('offers: JSON validation and OP_RETURN encoding (section 3.1 & 3.2)', () => {
  const floatingOffer: OfferDocument = {
    v: 1,
    side: 'sell',
    asset: BCH_ASSET,
    assetDecimals: BCH_DECIMALS,
    fiat: 'ARS',
    price: { type: 'floating', pair: 'BCH/ARS', marginBps: 250 },
    min: '100000',
    max: '5000000',
    paymentMethods: ['bank-transfer'],
    paymentWindowSec: 3600,
    terms: 'Instant transfer only.',
    expiresAt: 1_795_000_000,
    arbiter: arbiterPk,
    oracle: oraclePk,
  };

  const fixedTokenOffer: OfferDocument = {
    v: 1,
    side: 'sell',
    asset: PUSD_CATEGORY,
    assetDecimals: PUSD_DECIMALS,
    fiat: 'USD',
    price: { type: 'fixed', value: '1.00' },
    min: '500',
    max: '10000',
    paymentMethods: ['cash'],
    paymentWindowSec: 1800,
    expiresAt: 1_795_000_000,
    arbiter: arbiterPk,
  };

  it('encodes, decodes and verifies both floating and fixed-price offers', () => {
    const jsonString = JSON.stringify(floatingOffer);
    const contentHash = hashOfferJson(jsonString);
    expect(MARKER_SATOSHIS).toBe(1000n);

    const cidBytes = offerHashToCidV1Bytes(contentHash);
    expect(binToHex(cidBytes.slice(0, 4))).toBe('01551220');
    expect(binToHex(cidBytes.slice(4))).toBe(binToHex(contentHash));

    const opReturn = encodeOfferOpReturn({
      arbiterPk,
      oraclePk,
      contentHash,
    });
    expect(opReturn.length).toBe(111);

    const verified = verifyOfferAgainstOpReturn(jsonString, opReturn);
    expect(verified.document).toEqual(floatingOffer);
    expect(verified.onChain.arbiterPk).toBe(arbiterPk);
    expect(verified.onChain.oraclePk).toBe(oraclePk);
    expect(verified.contentHash).toBe(binToHex(contentHash));

    // Fixed-price offer uses 33 zero bytes on-chain and decodes oraclePk as null.
    const fixedJson = JSON.stringify(fixedTokenOffer);
    const fixedHash = hashOfferJson(fixedJson);
    const fixedOpReturn = encodeOfferOpReturn({
      arbiterPk,
      contentHash: fixedHash,
    });
    const decodedFixed = decodeOfferOpReturn(fixedOpReturn);
    expect(decodedFixed.oraclePk).toBeNull();
    const verifiedFixed = verifyOfferAgainstOpReturn(fixedJson, fixedOpReturn);
    expect(verifiedFixed.document).toEqual(fixedTokenOffer);
  });

  it('rejects tampered JSON or mismatched on-chain keys', () => {
    const jsonString = JSON.stringify(floatingOffer);
    const opReturn = encodeOfferOpReturn({
      arbiterPk,
      oraclePk,
      contentHash: hashOfferJson(jsonString),
    });

    const tamperedJson = JSON.stringify({ ...floatingOffer, max: '9999999' });
    expect(() => verifyOfferAgainstOpReturn(tamperedJson, opReturn)).toThrow(/SHA-256 does not match/);

    const wrongArbiterDoc = { ...floatingOffer, arbiter: oraclePk };
    const wrongArbiterJson = JSON.stringify(wrongArbiterDoc);
    const opReturnWithDifferentArbiter = encodeOfferOpReturn({
      arbiterPk,
      oraclePk,
      contentHash: hashOfferJson(wrongArbiterJson),
    });
    expect(() => verifyOfferAgainstOpReturn(wrongArbiterJson, opReturnWithDifferentArbiter)).toThrow(
      /arbiter key does not match/,
    );
  });

  it('rejects malformed offer fields', () => {
    expect(() => validateOfferDocument({ ...floatingOffer, min: '6000000', max: '5000000' })).toThrow(
      /min cannot exceed max/,
    );
    expect(() => validateOfferDocument({ ...floatingOffer, expiresAt: 499_999_999 })).toThrow(
      /Unix timestamp/,
    );
    expect(() => validateOfferDocument({ ...floatingOffer, oracle: undefined })).toThrow(
      /require a valid compressed oracle public key/,
    );
    expect(() => validateOfferDocument({ ...fixedTokenOffer, oracle: oraclePk })).toThrow(
      /must omit the oracle field/,
    );
    expect(() => validateOfferDocument({ ...fixedTokenOffer, assetDecimals: 8 })).toThrow(
      /PUSD offers must use assetDecimals = 2/,
    );
  });
});

describe('oracle quotes, trade terms, tradeId and arbiter verdicts (section 3.3 & 4.3)', () => {
  it('signs and verifies oracle price quotes and rejects tampering', () => {
    const quote = signPriceQuote(oracleSk, {
      pair: 'BCH/ARS',
      price: '485000.50',
      timestamp: 1_794_900_000,
    });
    expect(verifyPriceQuote(quote, oraclePk)).toBe(true);
    expect(verifyPriceQuote(quote, arbiterPk)).toBe(false);
    expect(verifyPriceQuote({ ...quote, price: '485000.51' }, oraclePk)).toBe(false);
    expect(verifyPriceQuote({ ...quote, pair: 'BCH/USD' }, oraclePk)).toBe(false);
    expect(verifyPriceQuote({ ...quote, timestamp: 1_794_900_001 }, oraclePk)).toBe(false);
  });

  it('computes fiat amounts for BCH and PUSD with positive and negative margins', () => {
    // 0.0025 BCH (250,000 sats) at 400,000 ARS/BCH = 1,000.00 ARS; +250 bps (+2.5%) = 1,025.00 ARS
    expect(
      computeFiatAmount({
        amount: '250000',
        assetDecimals: BCH_DECIMALS,
        unitPrice: '400000',
        marginBps: 250,
      }),
    ).toBe('1025.00');

    // 12.34 PUSD (1,234 units) at 1.00 USD with -100 bps (-1%) = 12.22 USD
    expect(
      computeFiatAmount({
        amount: 1234n,
        assetDecimals: PUSD_DECIMALS,
        unitPrice: '1.00',
        marginBps: -100,
      }),
    ).toBe('12.22');
  });

  it('validates trade terms, enforces refundTime >= 500,000,000 and computes tradeId', () => {
    const sellerSession = generateSessionKeyPair();
    const buyerSession = generateSessionKeyPair();
    const quote = signPriceQuote(oracleSk, {
      pair: 'BCH/ARS',
      price: '400000',
      timestamp: 1_794_900_000,
    });

    const terms: TradeTerms = {
      v: 1,
      offerTxid: 'aa'.repeat(32),
      asset: BCH_ASSET,
      amount: '250000',
      fiat: 'ARS',
      fiatAmount: '1025.00',
      quote,
      marginBps: 250,
      sellerPk: binToHex(derivePubkeyFromXpub(sellerWallet.defiXpub, 0)),
      buyerPk: binToHex(derivePubkeyFromXpub(buyerWallet.defiXpub, 0)),
      arbiterPk,
      oraclePk,
      sellerPayoutPkh: binToHex(derivePayoutPkhFromXpub(sellerWallet.receiveXpub, 0)),
      buyerPayoutPkh: binToHex(derivePayoutPkhFromXpub(buyerWallet.receiveXpub, 0)),
      sellerSessionPk: sellerSession.publicKey,
      buyerSessionPk: buyerSession.publicKey,
      refundTime: 1_796_109_600,
      nonce: '0102030405060708',
    };

    const json = JSON.stringify(terms);
    const tradeId = computeTradeId(json);
    expect(tradeId.length).toBe(32);

    // Block-height refundTime (< 500,000,000) must be rejected by the client.
    expect(() => validateTradeTerms({ ...terms, refundTime: 499_999_999 })).toThrow(/Unix timestamp/);

    // Forged oracle signature must be rejected.
    const badQuote = signPriceQuote(arbiterSk, {
      pair: 'BCH/ARS',
      price: '400000',
      timestamp: 1_794_900_000,
    });
    expect(() => validateTradeTerms({ ...terms, quote: badQuote })).toThrow(/Invalid oracle signature/);

    // Arbiter verdict signing and verification.
    const sigBuyer = signVerdict(arbiterSk, tradeId, VERDICT_BUYER);
    expect(verifyVerdict(sigBuyer, tradeId, VERDICT_BUYER, arbiterPk)).toBe(true);
    expect(verifyVerdict(sigBuyer, tradeId, VERDICT_SELLER, arbiterPk)).toBe(false);
    expect(verifyVerdict(sigBuyer, 'ff'.repeat(32), VERDICT_BUYER, arbiterPk)).toBe(false);
    expect(verifyVerdict(sigBuyer, tradeId, VERDICT_BUYER, oraclePk)).toBe(false);
  });
});

describe('session keys, payment-details encryption and chat encryption (section 6)', () => {
  it('derives identical shared trade keys on both ends and encrypts payment details and chat', async () => {
    const sellerSession = generateSessionKeyPair();
    const buyerSession = generateSessionKeyPair();

    const sellerTradeKey = deriveSharedTradeKey(sellerSession.privateKey, buyerSession.publicKey);
    const buyerTradeKey = deriveSharedTradeKey(buyerSession.privateKey, sellerSession.publicKey);
    expect(binToHex(sellerTradeKey)).toBe(binToHex(buyerTradeKey));

    // Seller encrypts payment details for buyer; buyer decrypts them.
    const paymentPlain = JSON.stringify({ bank: 'Banco Nación', alias: 'fuego.campamento.bch' });
    const paymentCipher = await encryptPaymentDetails(
      sellerSession.privateKey,
      buyerSession.publicKey,
      paymentPlain,
    );
    const decryptedPayment = await decryptPaymentDetails(
      buyerSession.privateKey,
      sellerSession.publicKey,
      paymentCipher,
    );
    expect(decryptedPayment).toBe(paymentPlain);

    // Chat message encrypted by buyer, decrypted by seller, and decrypted by arbiter when handed tradeKey.
    const chatCipher = await encryptChatMessage(buyerTradeKey, 'Transfer sent, reference #98412');
    expect(await decryptChatMessage(sellerTradeKey, chatCipher)).toBe('Transfer sent, reference #98412');
    const handedTradeKeyHex = binToHex(buyerTradeKey);
    expect(await decryptChatMessage(handedTradeKeyHex, chatCipher)).toBe('Transfer sent, reference #98412');

    // Domain separation: handing the chat tradeKey to the arbiter does not decrypt paymentCipher directly.
    await expect(decryptChatMessage(handedTradeKeyHex, paymentCipher)).rejects.toThrow();
  });
});

describe('escrow contract instantiation, funding check and spend builders (sections 4 & 5)', () => {
  const sellerDefiIndex = 1;
  const buyerDefiIndex = 2;
  const sellerPk = binToHex(derivePubkeyFromXpub(sellerWallet.defiXpub, sellerDefiIndex));
  const buyerPk = binToHex(derivePubkeyFromXpub(buyerWallet.defiXpub, buyerDefiIndex));
  const sellerPayoutPkh = binToHex(derivePayoutPkhFromXpub(sellerWallet.receiveXpub, 0));
  const buyerPayoutPkh = binToHex(derivePayoutPkhFromXpub(buyerWallet.receiveXpub, 0));
  const sellerSession = generateSessionKeyPair();
  const buyerSession = generateSessionKeyPair();

  const bchTerms: TradeTerms = {
    v: 1,
    offerTxid: '11'.repeat(32),
    asset: BCH_ASSET,
    amount: '250000',
    fiat: 'ARS',
    fiatAmount: '1000.00',
    sellerPk,
    buyerPk,
    arbiterPk,
    sellerPayoutPkh,
    buyerPayoutPkh,
    sellerSessionPk: sellerSession.publicKey,
    buyerSessionPk: buyerSession.publicKey,
    refundTime: 1_796_109_600,
    nonce: 'aabbccdd',
  };

  const pusdTerms: TradeTerms = {
    ...bchTerms,
    asset: PUSD_CATEGORY,
    amount: '5000',
  };

  it('checks exact funding for BCH and PUSD escrows', () => {
    expect(expectedEscrowFunding(bchTerms)).toEqual({ satoshis: 251_000n });
    expect(expectedEscrowFunding(pusdTerms)).toEqual({
      satoshis: TOKEN_ESCROW_FUNDING_SATS,
      token: { category: PUSD_CATEGORY, amount: 5000n },
    });

    const validBchUtxo = { ...randomUtxo({ satoshis: 251_000n }), lockingBytecode: '00' };
    expect(matchesEscrowFunding(validBchUtxo, bchTerms)).toBe(true);
    expect(matchesEscrowFunding({ ...validBchUtxo, satoshis: 250_000n }, bchTerms)).toBe(false);
    expect(
      matchesEscrowFunding(
        { ...validBchUtxo, token: { category: PUSD_CATEGORY, amount: 1n } },
        bchTerms,
      ),
    ).toBe(false);

    const validTokenUtxo = {
      ...randomUtxo({
        satoshis: 7000n,
        token: { category: PUSD_CATEGORY, amount: 5000n },
      }),
      lockingBytecode: '00',
    };
    expect(matchesEscrowFunding(validTokenUtxo, pusdTerms)).toBe(true);
    expect(matchesEscrowFunding({ ...validTokenUtxo, satoshis: 6000n }, pusdTerms)).toBe(false);
    expect(
      matchesEscrowFunding(
        { ...validTokenUtxo, token: { category: PUSD_CATEGORY, amount: 4999n } },
        pusdTerms,
      ),
    ).toBe(false);
  });

  it('builds release and cancel requests for WizardConnect and verifies wallet-signed spends', async () => {
    const provider = new MockNetworkProvider();
    const tradeId = computeTradeId(JSON.stringify(bchTerms));
    const contract = createEscrowContract(bchTerms, tradeId, provider);
    const utxo = provider.addUtxo(contract.tokenAddress, randomUtxo({ satoshis: 251_000n }));

    const releaseReq = buildReleaseRequest({
      contract,
      utxo,
      buyerPayoutPkh,
      sellerDefiIndex,
    });
    expect(releaseReq.inputPaths).toEqual([[0, 'defi', sellerDefiIndex]]);
    expect(releaseReq.request.transaction).toBe(releaseReq.unsignedHex);
    expect(releaseReq.fee).toBeLessThanOrEqual(ESCROW_FEE_BUDGET);

    // Unsigned placeholder fails VM verification.
    expect(verifySignedContractSpend(releaseReq.unsignedHex, releaseReq.sourceOutputs).valid).toBe(
      false,
    );

    // Simulate the seller wallet signing input 0 with Schnorr sighash 0x61.
    const sellerSigner = new SignatureTemplate(sellerWallet.defiPrivKey(sellerDefiIndex));
    const signedReleaseHex = new TransactionBuilder({ provider })
      .addInput(utxo, contract.unlock.release(sellerSigner))
      .addOutput({
        to: pkhToLockingBytecode(buyerPayoutPkh),
        amount: utxo.satoshis - releaseReq.fee,
      })
      .build();

    expect(verifySignedContractSpend(signedReleaseHex, releaseReq.sourceOutputs)).toEqual({
      valid: true,
    });
    await provider.sendRawTransaction(signedReleaseHex);
    const buyerReceived = await provider.getUtxosForLockingBytecode(
      pkhToLockingBytecode(buyerPayoutPkh),
    );
    expect(buyerReceived).toHaveLength(1);
    expect(buyerReceived[0].satoshis).toBe(251_000n - releaseReq.fee);

    // Cancel path on a PUSD escrow.
    const provider2 = new MockNetworkProvider();
    const pusdTradeId = computeTradeId(JSON.stringify(pusdTerms));
    const pusdContract = createEscrowContract(pusdTerms, pusdTradeId, provider2);
    const pusdUtxo = provider2.addUtxo(
      pusdContract.tokenAddress,
      randomUtxo({ satoshis: 7000n, token: { category: PUSD_CATEGORY, amount: 5000n } }),
    );
    const cancelReq = buildCancelRequest({
      contract: pusdContract,
      utxo: pusdUtxo,
      sellerPayoutPkh,
      buyerDefiIndex,
    });
    expect(cancelReq.inputPaths).toEqual([[0, 'defi', buyerDefiIndex]]);

    const buyerSigner = new SignatureTemplate(buyerWallet.defiPrivKey(buyerDefiIndex));
    const signedCancelHex = new TransactionBuilder({ provider: provider2 })
      .addInput(pusdUtxo, pusdContract.unlock.cancel(buyerSigner))
      .addOutput({
        to: pkhToLockingBytecode(sellerPayoutPkh),
        amount: pusdUtxo.satoshis - cancelReq.fee,
        token: pusdUtxo.token,
      })
      .build();

    expect(verifySignedContractSpend(signedCancelHex, cancelReq.sourceOutputs)).toEqual({
      valid: true,
    });
    await provider2.sendRawTransaction(signedCancelHex);
    const sellerReceived = await provider2.getUtxosForLockingBytecode(
      pkhToLockingBytecode(sellerPayoutPkh),
    );
    expect(sellerReceived).toHaveLength(1);
    expect(sellerReceived[0].token).toEqual({ category: PUSD_CATEGORY, amount: 5000n });
  });

  it('builds and broadcasts arbitrate (buyer or seller) and refund spends', async () => {
    const tradeId = computeTradeId(JSON.stringify(pusdTerms));

    // Arbitrate in favour of the buyer on a PUSD escrow.
    const provider1 = new MockNetworkProvider();
    const contract1 = createEscrowContract(pusdTerms, tradeId, provider1);
    const utxo1 = provider1.addUtxo(
      contract1.tokenAddress,
      randomUtxo({ satoshis: 7000n, token: { category: PUSD_CATEGORY, amount: 5000n } }),
    );
    const verdictSigBuyer = signVerdict(arbiterSk, tradeId, VERDICT_BUYER);
    const arbBuyer = buildArbitrateSpend({
      contract: contract1,
      utxo: utxo1,
      arbiterSig: verdictSigBuyer,
      verdict: VERDICT_BUYER,
      buyerPayoutPkh,
      sellerPayoutPkh,
      tradeId,
      arbiterPk,
    });
    await arbBuyer.builder.send();
    const buyerUtxos = await provider1.getUtxosForLockingBytecode(
      pkhToLockingBytecode(buyerPayoutPkh),
    );
    expect(buyerUtxos).toHaveLength(1);
    expect(buyerUtxos[0].satoshis).toBe(7000n - arbBuyer.fee);
    expect(buyerUtxos[0].token).toEqual({ category: PUSD_CATEGORY, amount: 5000n });

    // Refund on a BCH escrow after refundTime.
    const provider2 = new MockNetworkProvider();
    const bchTradeId = computeTradeId(JSON.stringify(bchTerms));
    const contract2 = createEscrowContract(bchTerms, bchTradeId, provider2);
    const utxo2 = provider2.addUtxo(contract2.tokenAddress, randomUtxo({ satoshis: 251_000n }));
    const refundSpend = buildRefundSpend({
      contract: contract2,
      utxo: utxo2,
      sellerPayoutPkh,
      refundTime: bchTerms.refundTime,
    });
    expect(refundSpend.builder.locktime).toBe(bchTerms.refundTime);
    await refundSpend.builder.send();
    const sellerUtxos = await provider2.getUtxosForLockingBytecode(
      pkhToLockingBytecode(sellerPayoutPkh),
    );
    expect(sellerUtxos).toHaveLength(1);
    expect(sellerUtxos[0].satoshis).toBe(251_000n - refundSpend.fee);
  });

  it('publishes an offer on-chain and closes it by spending the 1,000-sat marker output', async () => {
    const provider = new MockNetworkProvider();
    provider.network = Network.MAINNET;

    const addressMap = deriveWalletAddressMap({
      receiveXpub: sellerWallet.receiveXpub,
      count: 5,
    });
    const addr0 = pkhToCashAddress(derivePayoutPkhFromXpub(sellerWallet.receiveXpub, 0));
    const markerAddr = pkhToCashAddress(derivePayoutPkhFromXpub(sellerWallet.receiveXpub, 1));
    const changeAddr = pkhToCashAddress(derivePayoutPkhFromXpub(sellerWallet.receiveXpub, 2));

    const rawUtxo = provider.addUtxo(addr0, randomUtxo({ satoshis: 50_000n }));
    const tagged = tagWalletUtxos([rawUtxo], addressMap).map((u) => ({
      ...u,
      signer: new SignatureTemplate(sellerWallet.receivePrivKey(u.keyIndex)),
    }));
    expect(tagged).toHaveLength(1);
    expect(tagged[0].pathName).toBe('receive');
    expect(tagged[0].keyIndex).toBe(0);

    const doc: OfferDocument = {
      v: 1,
      side: 'sell',
      asset: BCH_ASSET,
      assetDecimals: BCH_DECIMALS,
      fiat: 'ARS',
      price: { type: 'floating', pair: 'BCH/ARS', marginBps: 100 },
      min: '100000',
      max: '1000000',
      paymentMethods: ['bank-transfer'],
      paymentWindowSec: 3600,
      expiresAt: 1_795_000_000,
      arbiter: arbiterPk,
      oracle: oraclePk,
    };

    const pubTx = buildPublishOfferTransaction({
      provider,
      document: doc,
      utxos: tagged,
      markerAddress: markerAddr,
      changeAddress: changeAddr,
    });
    expect(pubTx.inputPaths).toEqual([[0, 'receive', 0]]);
    expect(pubTx.request.transaction).toBe(pubTx.hex);

    const decodedTx = decodeTransactionUnsafe(hexToBin(pubTx.hex));
    expect(decodedTx.outputs).toHaveLength(3);
    expect(decodedTx.outputs[0].valueSatoshis).toBe(0n);
    expect(decodedTx.outputs[1].valueSatoshis).toBe(MARKER_SATOSHIS);

    const verified = verifyOfferAgainstOpReturn(pubTx.offerJson, decodedTx.outputs[0].lockingBytecode);
    expect(verified.document).toEqual(doc);

    await pubTx.builder.send();
    const markerUtxos = await provider.getUtxos(markerAddr);
    expect(markerUtxos).toHaveLength(1);
    expect(markerUtxos[0].satoshis).toBe(MARKER_SATOSHIS);

    // Close the offer by spending the 1,000-sat marker output on its own.
    const taggedMarker = tagWalletUtxos(markerUtxos, addressMap).map((u) => ({
      ...u,
      signer: new SignatureTemplate(sellerWallet.receivePrivKey(u.keyIndex)),
    }));
    const closeTx = buildCloseOfferTransaction({
      provider,
      markerUtxo: taggedMarker[0],
      destinationAddress: changeAddr,
    });
    expect(closeTx.inputPaths).toEqual([[0, 'receive', 1]]);
    await closeTx.builder.send();
    expect(await provider.getUtxos(markerAddr)).toHaveLength(0);
  });

  it('publishes a version-2 offer with an NFT marker from the minter covenant and closes it by burning the NFT', async () => {
    const provider = new MockNetworkProvider();
    provider.network = Network.MAINNET;
    const category = binToHex(sha256.hash(utf8ToBin('campfire-offer-category')));
    const minting = { category, amount: 0n, nft: { capability: 'minting' as const, commitment: '' } };
    const minterUtxo = provider.addUtxo(offerMinter(provider).tokenAddress, randomUtxo({ satoshis: 1000n, token: minting }));
    // A token that is not a minter and a minter of another category sit there too and are never picked.
    provider.addUtxo(offerMinter(provider).tokenAddress, randomUtxo({ satoshis: 1000n, token: { ...minting, category: '11'.repeat(32) } }));
    expect(await findMinterUtxos(provider, category)).toEqual([minterUtxo]);

    const addressMap = deriveWalletAddressMap({ receiveXpub: sellerWallet.receiveXpub, count: 5 });
    const addr0 = pkhToCashAddress(derivePayoutPkhFromXpub(sellerWallet.receiveXpub, 0));
    const markerAddr = pkhToCashAddress(derivePayoutPkhFromXpub(sellerWallet.receiveXpub, 1), { tokenAware: true });
    const changeAddr = pkhToCashAddress(derivePayoutPkhFromXpub(sellerWallet.receiveXpub, 2));
    const rawUtxo = provider.addUtxo(addr0, randomUtxo({ satoshis: 50_000n }));
    const tagged = tagWalletUtxos([rawUtxo], addressMap).map((u) => ({
      ...u,
      signer: new SignatureTemplate(sellerWallet.receivePrivKey(u.keyIndex)),
    }));

    const doc: OfferDocument = {
      v: 1, side: 'sell', asset: BCH_ASSET, assetDecimals: BCH_DECIMALS, fiat: 'ARS',
      price: { type: 'floating', pair: 'BCH/ARS', marginBps: 100 },
      min: '100000', max: '1000000', paymentMethods: ['bank-transfer'], paymentWindowSec: 3600,
      expiresAt: 1_795_000_000, arbiter: arbiterPk, oracle: oraclePk,
    };
    const pubTx = buildPublishNftOfferTransaction({
      provider, document: doc, utxos: tagged, minterUtxo, markerAddress: markerAddr, changeAddress: changeAddr,
    });
    // The wallet signs only its own coin, which comes after the minter.
    expect(pubTx.inputPaths).toEqual([[1, 'receive', 0]]);

    const decodedTx = decodeTransactionUnsafe(hexToBin(pubTx.hex));
    expect(decodedTx.outputs).toHaveLength(4);
    const verified = verifyOfferAgainstOpReturn(pubTx.offerJson, decodedTx.outputs[0].lockingBytecode);
    expect(verified.onChain.version).toBe(FORMAT_VERSION_NFT);
    expect(binToHex(decodedTx.outputs[1].token!.nft!.commitment)).toBe(markerCommitment('sell', verified.contentHash));
    expect(parseMarkerCommitment(markerCommitment('buy', verified.contentHash))).toEqual({ side: 'buy', contentHash: verified.contentHash });

    await pubTx.builder.send();
    const [held] = await provider.getUtxos(markerAddr);
    expect(isMarkerUtxo(held, category)).toBe(true);
    const [minterBack] = await provider.getUtxos(offerMinter(provider).tokenAddress).then((u) => u.filter((x) => x.token?.category === category));
    expect(minterBack.token).toEqual(minting);

    const taggedMarker = tagWalletUtxos([held], addressMap).map((u) => ({
      ...u,
      signer: new SignatureTemplate(sellerWallet.receivePrivKey(u.keyIndex)),
    }));
    const closeTx = buildCloseNftOfferTransaction({ provider, markerUtxo: taggedMarker[0], destinationAddress: changeAddr, category });
    expect(closeTx.inputPaths).toEqual([[0, 'receive', 1]]);
    const closed = decodeTransactionUnsafe(hexToBin(closeTx.hex));
    expect(closed.outputs).toHaveLength(1);
    expect(closed.outputs[0].token).toBeUndefined();
    await closeTx.builder.send();
    expect(await provider.getUtxos(markerAddr)).toHaveLength(0);
  });

  it('funds both a BCH escrow and a PUSD escrow with exact expected funding and change', async () => {
    const addressMap = deriveWalletAddressMap({
      receiveXpub: sellerWallet.receiveXpub,
      count: 5,
    });
    const addr0 = pkhToCashAddress(derivePayoutPkhFromXpub(sellerWallet.receiveXpub, 0));
    const tokenAddr0 = pkhToCashAddress(derivePayoutPkhFromXpub(sellerWallet.receiveXpub, 0), {
      tokenAware: true,
    });
    const changeAddr = pkhToCashAddress(derivePayoutPkhFromXpub(sellerWallet.receiveXpub, 1));
    const tokenChangeAddr = pkhToCashAddress(derivePayoutPkhFromXpub(sellerWallet.receiveXpub, 1), {
      tokenAware: true,
    });

    // 1. Fund BCH escrow.
    const provider1 = new MockNetworkProvider();
    provider1.network = Network.MAINNET;
    const bchTradeId = computeTradeId(JSON.stringify(bchTerms));
    const bchContract = createEscrowContract(bchTerms, bchTradeId, provider1);

    const bchWalletUtxo = provider1.addUtxo(addr0, randomUtxo({ satoshis: 400_000n }));
    const taggedBch = tagWalletUtxos([bchWalletUtxo], addressMap).map((u) => ({
      ...u,
      signer: new SignatureTemplate(sellerWallet.receivePrivKey(u.keyIndex)),
    }));

    const fundBch = buildFundEscrowTransaction({
      contract: bchContract,
      terms: bchTerms,
      utxos: taggedBch,
      changeAddress: changeAddr,
    });
    await fundBch.builder.send();

    const bchEscrowUtxos = await bchContract.getUtxos();
    expect(bchEscrowUtxos).toHaveLength(1);
    expect(matchesEscrowFunding(bchEscrowUtxos[0], bchTerms)).toBe(true);
    expect((await provider1.getUtxos(changeAddr)).length).toBe(1);

    // 2. Fund PUSD escrow (with token change and BCH change).
    const provider2 = new MockNetworkProvider();
    provider2.network = Network.MAINNET;
    const pusdTradeId = computeTradeId(JSON.stringify(pusdTerms));
    const pusdContract = createEscrowContract(pusdTerms, pusdTradeId, provider2);

    const rawTokenUtxo = provider2.addUtxo(
      tokenAddr0,
      randomUtxo({
        satoshis: 1000n,
        token: { category: PUSD_CATEGORY, amount: 12_000n },
      }),
    );
    const rawGasUtxo = provider2.addUtxo(addr0, randomUtxo({ satoshis: 25_000n }));
    const taggedPusd = tagWalletUtxos([rawTokenUtxo, rawGasUtxo], addressMap).map((u) => ({
      ...u,
      signer: new SignatureTemplate(sellerWallet.receivePrivKey(u.keyIndex)),
    }));

    const fundPusd = buildFundEscrowTransaction({
      contract: pusdContract,
      terms: pusdTerms,
      utxos: taggedPusd,
      changeAddress: changeAddr,
      tokenChangeAddress: tokenChangeAddr,
    });
    expect(fundPusd.inputPaths).toEqual([
      [0, 'receive', 0],
      [1, 'receive', 0],
    ]);
    await fundPusd.builder.send();

    const pusdEscrowUtxos = await pusdContract.getUtxos();
    expect(pusdEscrowUtxos).toHaveLength(1);
    expect(matchesEscrowFunding(pusdEscrowUtxos[0], pusdTerms)).toBe(true);

    const changeUtxos = await provider2.getUtxos(tokenChangeAddr);
    const tokenChangeUtxo = changeUtxos.find((u) => u.token?.category === PUSD_CATEGORY);
    expect(tokenChangeUtxo?.token?.amount).toBe(7000n); // 12,000 - 5,000
  });
});
