// Transaction building and diagnostics for the R1 test, kept free of DOM code
// so the same logic can be exercised outside the browser.

import {
  TransactionBuilder, placeholderSignature,
  type Contract, type NetworkProvider, type SpendableUtxo,
} from 'cashscript';
import {
  binToHex, hexToBin, stringify, decodeTransactionUnsafe, createVirtualMachineBch2026,
} from '@bitauth/libauth';

export function buildSpend(contract: Contract, provider: NetworkProvider, utxos: SpendableUtxo[], to: string) {
  const total = utxos.reduce((s, u) => s + u.satoshis, 0n);
  const make = (fee: bigint) => new TransactionBuilder({ provider })
    .addInputs(utxos, contract.unlock.spend(placeholderSignature()))
    .addOutput({ to, amount: total - fee });
  // Size counts each placeholder at its signed size; pay 1 sat/byte plus a small margin.
  const builder = make(BigInt(make(1000n).getTransactionSize()) + 10n);
  const unsignedHex = builder.build();
  const wc = builder.generateWcTransactionObject({ broadcast: false, userPrompt: 'Campfire spike: spend test contract' });
  // The relay uses plain JSON.stringify, so encode bigint/Uint8Array the WalletConnect way first.
  const request = JSON.parse(stringify(wc));
  // Selene (and the WalletConnect spec) accept the transaction as hex; Selene rejects the object form.
  request.transaction = unsignedHex;
  const sourceOutputs = wc.sourceOutputs.map((s) => ({ lockingBytecode: s.lockingBytecode, valueSatoshis: s.valueSatoshis, token: s.token }));
  return { unsignedHex, request, sourceOutputs };
}

export type InputDiagnosis = { replaced: boolean; keptScript: boolean; sigLength: number; sighash: string };

// Reads the first push of the unlocking bytecode (the signature) and checks the rest is the redeem script.
export function diagnose(unsignedHex: string, signedHex: string, redeemScriptHex: string,
  sourceOutputs: ReturnType<typeof buildSpend>['sourceOutputs']) {
  const unsigned = decodeTransactionUnsafe(hexToBin(unsignedHex));
  const signed = decodeTransactionUnsafe(hexToBin(signedHex));
  const inputs: InputDiagnosis[] = signed.inputs.map((inp, i) => {
    const before = binToHex(unsigned.inputs[i]?.unlockingBytecode ?? new Uint8Array());
    const bytes = inp.unlockingBytecode;
    const after = binToHex(bytes);
    // Signatures are 65 bytes (Schnorr) or ~71-73 (ECDSA), so the first opcode is a direct push.
    const sigLength = bytes[0] >= 1 && bytes[0] <= 75 ? bytes[0] : 0;
    const sig = bytes.slice(1, 1 + sigLength);
    return {
      replaced: before !== after && sig.some((b) => b !== 0),
      keptScript: after.endsWith(redeemScriptHex),
      sigLength,
      sighash: sigLength ? binToHex(sig.slice(-1)) : '?',
    };
  });
  const verdict = createVirtualMachineBch2026().verify({ transaction: signed, sourceOutputs });
  return { inputs, verdict };
}
