import { describe, expect, it } from 'vitest';
import {
  MockNetworkProvider,
  SignatureTemplate,
  TransactionBuilder,
  randomUtxo,
} from 'cashscript';
import {
  binToHex,
  deriveHdPath,
  deriveHdPrivateNodeChild,
  deriveHdPrivateNodeFromSeed,
  deriveHdPublicNode,
  encodeCashAddress,
  encodeHdPublicKey,
  hash160,
  secp256k1,
  sha256,
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
});
