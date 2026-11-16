import type { AssetInfo } from '../assets';

/** The coin's logo in the 24px circle of the design (.s-coin), or its short name when it has no logo. */
export function CoinIcon({ asset }: { asset: Pick<AssetInfo, 'coin' | 'logo'> }) {
  if (asset.logo) return <img className="s-coin" src={asset.logo} alt="" aria-hidden="true" width={24} height={24} />;
  return (
    <span className="s-coin" aria-hidden="true">
      {asset.coin}
    </span>
  );
}
