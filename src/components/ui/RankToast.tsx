import { Medal } from 'lucide-react';
import { useEffect } from 'react';
import { RANKS } from '../../config/ranks';
import { useT } from '../../i18n';
import { useGameStore } from '../../store/useGameStore';

/** Banner for a rank just reached (click to see the ladder). */
export function RankToast() {
  const t = useT();
  const index = useGameStore((s) => s.rankToast);
  const dismiss = useGameStore((s) => s.dismissRankToast);
  const setSideTab = useGameStore((s) => s.setSideTab);
  useEffect(() => {
    if (index === null) return undefined;
    const timer = setTimeout(dismiss, 7000);
    return () => clearTimeout(timer);
  }, [index, dismiss]);
  const rank = index === null ? undefined : RANKS[index];
  if (!rank) return null;
  return (
    <div className="fixed left-1/2 top-24 z-40 w-[min(92vw,360px)] -translate-x-1/2" role="status" aria-live="polite" data-testid="rank-toast">
      <button
        type="button"
        onClick={() => {
          setSideTab('trophies');
          dismiss();
        }}
        className="pop-in flex w-full items-center gap-3 bg-[#0b0a18] px-3 py-2 text-left"
        style={{ boxShadow: `0 0 0 3px ${rank.color}, 0 0 22px ${rank.color}88` }}
      >
        <span className="grid size-9 shrink-0 place-items-center" style={{ color: rank.color, boxShadow: `inset 0 0 0 2px ${rank.color}88` }}>
          <Medal size={18} />
        </span>
        <span className="min-w-0 leading-tight">
          <span className="block font-silk text-[10px] text-dim">{t('RANK UP')}</span>
          <span className="block font-pixel text-[10px]" style={{ color: rank.color }}>{t(rank.name).toUpperCase()}</span>
          {rank.unlock && <span className="block text-[16px] text-ink">{t('New ability in the Pools tab.')}</span>}
          {(rank.hashMul > 1 || rank.electricityMul < 1) && <span className="block text-[15px] text-lime">{t('Permanent bonuses raised.')}</span>}
        </span>
      </button>
    </div>
  );
}
