import { useRef } from 'react';
import type { ScanProgress } from '../coins';
import { formatBchBalance } from '../format';
import { useHideBalance } from '../hideBalance';
import { useMessages } from '../lang';
import { scanPercent } from '../walletCoins';
import { Skeleton } from './States';

/**
 * Seconds left in the coin phase, from the pace since it started on this screen. Null until the pace is known
 * (a first guess from one batch would jump around), 0 when nearly done.
 */
function useSecondsLeft(progress: ScanProgress | null): number | null {
  const start = useRef<{ at: number; done: number; total: number } | null>(null);
  if (!progress || progress.phase !== 'coins') {
    start.current = null;
    return null;
  }
  const now = performance.now();
  const s = start.current;
  // A new read starts over (fewer done, or another total): measure its pace from here.
  if (!s || progress.done < s.done || progress.total !== s.total) {
    start.current = { at: now, done: progress.done, total: progress.total };
    return null;
  }
  const elapsed = (now - s.at) / 1000;
  const read = progress.done - s.done;
  if (elapsed < 1 || read <= 0) return null;
  const left = (progress.total - progress.done) / (read / elapsed);
  return left < 3 ? 0 : left;
}

/**
 * The balance while the wallet's coins are read: what is happening in plain words, a bar that fills as the
 * addresses are read, and the BCH found so far in the place the balance will take. `card` is Home's wallet card,
 * which also says why it takes a while; `menu` is the wallet menu, with less room.
 */
export function BalanceLoading({ progress, variant }: { progress: ScanProgress | null; variant: 'card' | 'menu' }) {
  const t = useMessages().balanceLoading;
  const hidden = useHideBalance();
  const secondsLeft = useSecondsLeft(progress);
  const percent = scanPercent(progress);
  const reading = progress?.phase === 'coins';
  // A running total only once something is found: "0 BCH so far" would read as an empty wallet.
  const found = reading && !hidden && progress.found !== undefined && progress.found > 0n ? progress.found : null;
  const amountHeight = variant === 'card' ? 44 : 34;

  const title = reading ? t.readingTitle : t.findingTitle;
  const detail = reading
    ? [t.readingCount(progress.done, progress.total), secondsLeft === null ? null : secondsLeft === 0 ? t.almostDone : t.left(secondsLeft)]
        .filter(Boolean)
        .join(' · ')
    : t.findingCount(progress?.done ?? 0);

  return (
    <>
      {found !== null ? (
        <span className="s-partial">
          <strong className={variant === 'card' ? 's-partial__card' : 's-menu__bch'}>{formatBchBalance(found)} BCH</strong>
          <span className="cf-small cf-subtle">{t.soFar}</span>
        </span>
      ) : (
        <Skeleton width={variant === 'card' ? 200 : 160} height={amountHeight} />
      )}
      <div className="s-scan">
        <span className="s-scan__head">
          <span className="cf-small">{title}</span>
          {percent !== null && <span className="cf-small cf-num">{t.percent(percent)}</span>}
        </span>
        <span
          className="s-scan__bar"
          role="progressbar"
          aria-label={title}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={percent ?? undefined}
          data-indeterminate={percent === null || undefined}
        >
          <i style={percent === null ? undefined : { width: `${percent}%` }} />
        </span>
        {detail && <span className="cf-small cf-subtle cf-num">{detail}</span>}
        {variant === 'card' && <span className="cf-small cf-subtle">{t.why}</span>}
      </div>
    </>
  );
}
