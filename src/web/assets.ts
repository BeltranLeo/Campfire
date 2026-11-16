// How an offer's asset is named and drawn: BCH, PUSD (only the category the service names),
// or another CashToken shown by its shortened category id.

import type { ApiConfig } from './api';
import bchLogo from './coins/bch.svg';
import pusdLogo from './coins/pusd.png';
import { shorten } from './components/Provenance';

export interface AssetInfo {
  symbol: string;
  /** Short text drawn in the coin circle when there is no logo. */
  coin: string;
  /** URL of the coin's logo, for BCH and PUSD. */
  logo?: string;
  decimals: number;
  isBch: boolean;
}

/** BCH, PUSD (only the category the service names), or another CashToken shown by its category. */
export function assetInfo(asset: string, decimals: number, config: ApiConfig | null): AssetInfo {
  if (asset === 'BCH') return { symbol: 'BCH', coin: 'BCH', logo: bchLogo, decimals, isBch: true };
  if (config && asset === config.pusdCategory) return { symbol: 'PUSD', coin: '$', logo: pusdLogo, decimals, isBch: false };
  return { symbol: shorten(asset), coin: 'CT', decimals, isBch: false };
}
