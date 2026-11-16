import { Medal } from 'lucide-react';
import { earningsForLevel, levelFromEarnings } from '../../config/gameBalance';
import { RANKS, rankIndex } from '../../config/ranks';
import { useT } from '../../i18n';
import { useGameStore } from '../../store/useGameStore';
import { bnToNumber } from '../../utils/bignum';
import { formatCash } from '../../utils/formatters';

const ABILITY_NAME = { flash: 'Flash Mining', partner: 'Pool Partner' } as const;

/** Every rank with its level, reward and permanent bonuses; the one held is highlighted. */
export function RankLadder() {
  const t = useT();
  const lifetime = useGameStore((s) => s.lifetimeEarnings);
  const level = levelFromEarnings(bnToNumber(lifetime));
  const held = rankIndex(level);
  return (
    <section data-testid="rank-ladder">
      <h3 className="mb-1 flex items-center gap-2 font-pixel text-[9px] text-amber">
        <Medal size={14} /> {t('RANKS')}
        <span className="font-term text-[14px] normal-case text-dim">{t('level {n}', { n: level })}</span>
      </h3>
      <div className="flex flex-col gap-1">
        {RANKS.map((r, i) => {
          const perks = [
            ...(r.unlock ? [t('unlocks {ability}', { ability: t(ABILITY_NAME[r.unlock]) })] : []),
            ...(r.hashMul > 1 ? [t('+{pct}% hashrate', { pct: Math.round((r.hashMul - 1) * 100) })] : []),
            ...(r.electricityMul < 1 ? [t('-{pct}% electricity', { pct: Math.round((1 - r.electricityMul) * 100) })] : []),
            ...(r.gems > 0 ? [t('{n} gems', { n: r.gems })] : []),
          ];
          return (
            <div
              key={r.id}
              className={`flex items-center gap-2 p-1.5 text-[16px] leading-tight ${i <= held ? 'bg-panel-2' : 'bg-panel-2 opacity-55'}`}
              style={{ boxShadow: i === held ? `inset 0 0 0 2px ${r.color}` : undefined }}
              data-testid={i === held ? 'rank-current' : undefined}
              data-rank={r.id}
            >
              <span className="grid h-6 w-9 shrink-0 place-items-center font-pixel text-[8px] text-void" style={{ background: r.color }}>LV{r.level}</span>
              <span className="min-w-0 flex-1">
                <span style={{ color: r.color }}>{t(r.name)}</span>
                <span className="block text-dim">{perks.length ? perks.join(' · ') : t('starting rank')}</span>
              </span>
              {i > held && <span className="shrink-0 text-[14px] text-dim">{formatCash(earningsForLevel(r.level))}</span>}
            </div>
          );
        })}
      </div>
    </section>
  );
}
