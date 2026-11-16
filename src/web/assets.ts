// How an offer's asset is named and drawn: BCH, PUSD (only the category the service names),
// or another CashToken shown by its shortened category id.

import type { ApiConfig } from './api';
import { shorten } from './components/Provenance';

export interface AssetInfo {
  symbol: string;
  coin: string;
  decimals: number;
  isBch: boolean;
}

/** BCH, PUSD (only the category the service names), or another CashToken shown by its category. */
export function assetInfo(asset: string, decimals: number, config: ApiConfig | null): AssetInfo {
  if (asset === 'BCH') return { symbol: 'BCH', coin: 'BCH', decimals, isBch: true };
  if (config && asset === config.pusdCategory) return { symbol: 'PUSD', coin: '$', decimals, isBch: false };
  return { symbol: shorten(asset), coin: 'CT', decimals, isBch: false };
}
