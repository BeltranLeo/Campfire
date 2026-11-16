// Escrow contract instantiation, funding verification and transaction builders (protocol sections 4 and 5).

import {
  Contract,
  TransactionBuilder,
  placeholderSignature,
  type Artifact,
  type NetworkProvider,
  type SpendableUtxo,
  type TokenDetails,
  type Unlocker,
} from 'cashscript';
import {
  createVirtualMachineBch2026,
  decodeTransactionUnsafe,
  hexToBin,
  stringify,
} from '@bitauth/libauth';
import artifactJson from '../../contracts/CampfireEscrow.json' with { type: 'json' };
import { pkhToLockingBytecode, toBytes } from './keys.js';
import { BCH_ASSET, MIN_UNIX_TIMESTAMP } from './offers.js';
import {
  VERDICT_BUYER,
  VERDICT_SELLER,
  validateTradeTerms,
  verifyVerdict,
  type TradeTerms,
  type VerdictHex,
} from './trades.js';

export const escrowArtifact = artifactJson as unknown as Artifact;

export const ESCROW_FEE_BUDGET = 1000n;
export const TOKEN_ESCROW_RECIPIENT_MIN_SATS = 6000n;
export const TOKEN_ESCROW_FUNDING_SATS = TOKEN_ESCROW_RECIPIENT_MIN_SATS + ESCROW_FEE_BUDGET; // 7,000 sats
export const MTP_LAG_APPROX_SEC = 3600;

export interface ExpectedEscrowFunding {
  satoshis: bigint;
  token?: TokenDetails;
}

// Computes the exact value and token fields required at the escrow address (protocol section 5).
export function expectedEscrowFunding(
  terms: Pick<TradeTerms, 'asset' | 'amount'>,
): ExpectedEscrowFunding {
  const amount = BigInt(terms.amount);
  if (amount <= 0n) {
    throw new Error('Escrow trade amount must be positive');
  }
  if (terms.asset === BCH_ASSET) {
    return { satoshis: amount + ESCROW_FEE_BUDGET };
  }
  return {
    satoshis: TOKEN_ESCROW_FUNDING_SATS,
    token: {
      category: terms.asset.toLowerCase(),
      amount,
    },
  };
}

// Checks whether a UTXO at the escrow address holds the exact value, category and token amount from the trade terms.
export function matchesEscrowFunding(
  utxo: SpendableUtxo,
  terms: Pick<TradeTerms, 'asset' | 'amount'>,
): boolean {
  try {
    const expected = expectedEscrowFunding(terms);
    if (utxo.satoshis !== expected.satoshis) return false;
    if (!expected.token) {
      return utxo.token === undefined;
    }
    if (!utxo.token) return false;
    if (utxo.token.category.toLowerCase() !== expected.token.category) return false;
    if (utxo.token.amount !== expected.token.amount) return false;
    if (utxo.token.nft !== undefined) return false;
    return true;
  } catch {
    return false;
  }
}

// Instantiates the P2SH32 CampfireEscrow contract from the trade terms and their tradeId.
export function createEscrowContract(
  terms: TradeTerms,
  tradeId: Uint8Array | string,
  provider: NetworkProvider,
): Contract {
  validateTradeTerms(terms);
  const tradeIdBytes = toBytes(tradeId, 'tradeId');
  if (tradeIdBytes.length !== 32) {
    throw new Error(`Expected 32-byte tradeId, got ${tradeIdBytes.length} bytes`);
  }
  return new Contract(
    escrowArtifact,
    [
      toBytes(terms.sellerPk, 'sellerPk'),
      toBytes(terms.buyerPk, 'buyerPk'),
      toBytes(terms.arbiterPk, 'arbiterPk'),
      toBytes(terms.sellerPayoutPkh, 'sellerPayoutPkh'),
      toBytes(terms.buyerPayoutPkh, 'buyerPayoutPkh'),
      tradeIdBytes,
      BigInt(terms.refundTime),
    ],
    { provider, contractType: 'p2sh32' },
  );
}

function buildSizedEscrowSpend(params: {
  provider: NetworkProvider;
  utxo: SpendableUtxo;
  unlocker: Unlocker;
  payoutPkh: Uint8Array | string;
  locktime?: number;
}): { builder: TransactionBuilder; fee: bigint } {
  const to = pkhToLockingBytecode(params.payoutPkh);
  const make = (fee: bigint) => {
    const b = new TransactionBuilder({ provider: params.provider })
      .addInput(params.utxo, params.unlocker)
      .addOutput({
        to,
        amount: params.utxo.satoshis - fee,
        token: params.utxo.token,
      });
    if (params.locktime !== undefined) {
      b.setLocktime(params.locktime);
    }
    return b;
  };
  const size = make(ESCROW_FEE_BUDGET).getTransactionSize();
  if (size > ESCROW_FEE_BUDGET) {
    throw new Error(`Escrow spend size (${size} bytes) exceeds ${ESCROW_FEE_BUDGET}-sat fee budget`);
  }
  return { builder: make(size), fee: size };
}

export interface WcSourceOutputSnapshot {
  lockingBytecode: Uint8Array;
  valueSatoshis: bigint;
  token?: {
    category: Uint8Array;
    amount: bigint;
    nft?: { capability: 'none' | 'mutable' | 'minting'; commitment: Uint8Array };
  };
}

export interface WalletContractSpendRequest {
  builder: TransactionBuilder;
  unsignedHex: string;
  request: Record<string, unknown>;
  inputPaths: [[number, 'defi', number]];
  sourceOutputs: WcSourceOutputSnapshot[];
  fee: bigint;
}

function toWalletContractSpendRequest(
  builder: TransactionBuilder,
  fee: bigint,
  defiIndex: number,
  userPrompt: string,
  broadcast: boolean,
): WalletContractSpendRequest {
  if (!Number.isInteger(defiIndex) || defiIndex < 0 || defiIndex >= 0x80000000) {
    throw new Error(`Invalid defi key index: ${defiIndex}`);
  }
  const unsignedHex = builder.build();
  const wc = builder.generateWcTransactionObject({ broadcast, userPrompt });
  // WizardConnect sends requests with plain JSON.stringify; serialize libauth fields first
  // and replace `transaction` with the raw hex string expected by Selene and Paytaca.
  const request = JSON.parse(stringify(wc)) as Record<string, unknown>;
  request.transaction = unsignedHex;
  const sourceOutputs: WcSourceOutputSnapshot[] = wc.sourceOutputs.map((s) => ({
    lockingBytecode: s.lockingBytecode,
    valueSatoshis: s.valueSatoshis,
    token: s.token,
  }));
  return {
    builder,
    unsignedHex,
    request,
    inputPaths: [[0, 'defi', defiIndex]],
    sourceOutputs,
    fee,
  };
}

// Builds a `release` transaction request for the seller's wallet via WizardConnect.
export function buildReleaseRequest(params: {
  contract: Contract;
  utxo: SpendableUtxo;
  buyerPayoutPkh: Uint8Array | string;
  sellerDefiIndex: number;
  broadcast?: boolean;
}): WalletContractSpendRequest {
  const { builder, fee } = buildSizedEscrowSpend({
    provider: params.contract.provider,
    utxo: params.utxo,
    unlocker: params.contract.unlock.release(placeholderSignature()),
    payoutPkh: params.buyerPayoutPkh,
  });
  return toWalletContractSpendRequest(
    builder,
    fee,
    params.sellerDefiIndex,
    'Campfire: release escrow to buyer',
    params.broadcast ?? false,
  );
}

// Builds a `cancel` transaction request for the buyer's wallet via WizardConnect.
export function buildCancelRequest(params: {
  contract: Contract;
  utxo: SpendableUtxo;
  sellerPayoutPkh: Uint8Array | string;
  buyerDefiIndex: number;
  broadcast?: boolean;
}): WalletContractSpendRequest {
  const { builder, fee } = buildSizedEscrowSpend({
    provider: params.contract.provider,
    utxo: params.utxo,
    unlocker: params.contract.unlock.cancel(placeholderSignature()),
    payoutPkh: params.sellerPayoutPkh,
  });
  return toWalletContractSpendRequest(
    builder,
    fee,
    params.buyerDefiIndex,
    'Campfire: cancel trade and return escrow to seller',
    params.broadcast ?? false,
  );
}

// Evaluates a wallet-signed transaction locally with the May 2026 BCH VM before broadcasting.
export function verifySignedContractSpend(
  signedHex: string,
  sourceOutputs: WcSourceOutputSnapshot[],
): { valid: true } | { valid: false; error: string } {
  try {
    const transaction = decodeTransactionUnsafe(hexToBin(signedHex));
    const result = createVirtualMachineBch2026().verify({ transaction, sourceOutputs });
    if (result === true) {
      return { valid: true };
    }
    return { valid: false, error: typeof result === 'string' ? result : 'VM verification failed' };
  } catch (err) {
    return { valid: false, error: err instanceof Error ? err.message : String(err) };
  }
}

export interface DirectEscrowSpend {
  builder: TransactionBuilder;
  hex: string;
  fee: bigint;
}

// Builds an `arbitrate` spend using the arbiter's signed verdict; anyone can broadcast it.
export function buildArbitrateSpend(params: {
  contract: Contract;
  utxo: SpendableUtxo;
  arbiterSig: Uint8Array | string;
  verdict: VerdictHex;
  buyerPayoutPkh: Uint8Array | string;
  sellerPayoutPkh: Uint8Array | string;
  tradeId?: Uint8Array | string;
  arbiterPk?: Uint8Array | string;
}): DirectEscrowSpend {
  if (params.verdict !== VERDICT_BUYER && params.verdict !== VERDICT_SELLER) {
    throw new Error(`Unknown verdict "${String(params.verdict)}"`);
  }
  if (params.tradeId && params.arbiterPk) {
    if (!verifyVerdict(params.arbiterSig, params.tradeId, params.verdict, params.arbiterPk)) {
      throw new Error('Invalid arbiter verdict signature');
    }
  }
  const sigBytes = toBytes(params.arbiterSig, 'arbiterSig');
  const winnerPkh = params.verdict === VERDICT_BUYER ? params.buyerPayoutPkh : params.sellerPayoutPkh;
  const { builder, fee } = buildSizedEscrowSpend({
    provider: params.contract.provider,
    utxo: params.utxo,
    unlocker: params.contract.unlock.arbitrate(sigBytes, params.verdict),
    payoutPkh: winnerPkh,
  });
  return { builder, hex: builder.build(), fee };
}

// Builds a `refund` spend with `locktime = refundTime`; anyone can broadcast it once MTP > refundTime.
export function buildRefundSpend(params: {
  contract: Contract;
  utxo: SpendableUtxo;
  sellerPayoutPkh: Uint8Array | string;
  refundTime: number;
}): DirectEscrowSpend {
  if (!Number.isInteger(params.refundTime) || params.refundTime < MIN_UNIX_TIMESTAMP) {
    throw new Error('refundTime must be a Unix timestamp (>= 500,000,000)');
  }
  const { builder, fee } = buildSizedEscrowSpend({
    provider: params.contract.provider,
    utxo: params.utxo,
    unlocker: params.contract.unlock.refund(),
    payoutPkh: params.sellerPayoutPkh,
    locktime: params.refundTime,
  });
  return { builder, hex: builder.build(), fee };
}
