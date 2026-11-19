import { useState } from 'react';
import { describeProgress, useWalletCoins } from '../walletCoins';

/** The step that reads the wallet's coins: its label follows the scan ("Reading your coins… 120 of 480"). */
export const READING_WALLET = 'Reading your wallet…';

/**
 * What a long action is doing right now, for its busy button, so a slow wallet never looks like a frozen page.
 * `setStep` names the step; while it is READING_WALLET the label shows how far the shared scan has got.
 */
export function useBusyStep() {
  const [step, setStep] = useState<string | null>(null);
  const { progress } = useWalletCoins();
  const label = step === READING_WALLET ? (describeProgress(progress) ?? READING_WALLET) : step;
  return { label, setStep };
}

/** While a page waits for a fresh address, how far the wallet scan it waits on has got. */
export function useFindingAddressNote(): string {
  const { progress } = useWalletCoins();
  return describeProgress(progress) ?? 'Finding a fresh address of your wallet…';
}
