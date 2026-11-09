import { Gem, Lock, Trophy } from 'lucide-react';
import { ACHIEVEMENTS } from '../../config/gameBalance';
import { useT } from '../../i18n';
import { useGameShallow } from '../../store/useGameStore';
import { cn } from '../../utils/cn';
import { formatDuration, formatHashrate } from '../../utils/formatters';

export function AchievementsPanel() {
  const t = useT();
  const s = useGameShallow((st) => ({ achievements: st.achievements, stats: st.stats }));
  const done = new Set(s.achievements);
  return (
    <div className="flex flex-col gap-3">
      <div className="grid grid-cols-2 gap-2 bg-panel-2 p-2 text-[16px] leading-tight">
        <span className="text-dim">{t('Play time')}</span>
        <span>{formatDuration(s.stats.playTimeSec)}</span>
        <span className="text-dim">{t('Peak hashrate')}</span>
        <span className="text-lime">{formatHashrate(s.stats.maxHashrate)}</span>
        <span className="text-dim">{t('Devices bought')}</span>
        <span>{s.stats.gpusBought}</span>
        <span className="text-dim">{t('BSODs')}</span>
        <span className="text-neon">{s.stats.bsods}</span>
      </div>
      <h3 className="flex items-center gap-2 font-pixel text-[9px] text-gold">
        <Trophy size={14} /> {t('ACHIEVEMENTS {done}/{total}', { done: done.size, total: ACHIEVEMENTS.length })}
      </h3>
      <div className="flex flex-col gap-1">
        {ACHIEVEMENTS.map((a) => {
          const ok = done.has(a.id);
          return (
            <div key={a.id} className={cn('flex items-center gap-2 p-1.5 text-[16px] leading-tight', ok ? 'bg-[#1f1503]' : 'bg-panel-2 opacity-70')}>
              <span className={ok ? 'text-gold' : 'text-dim'}>{ok ? <Trophy size={16} /> : <Lock size={16} />}</span>
              <span className="flex-1">
                <span className={cn('font-silk text-[10px]', ok ? 'text-gold' : 'text-ink')}>{t(a.name)}</span>
                <span className="block text-dim">{t(a.description)}</span>
              </span>
              <span className="flex items-center gap-1 font-pixel text-[9px] text-magenta">
                <Gem size={11} /> {a.gems}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
