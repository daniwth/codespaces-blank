import { Check, Flag, Gem, Lock, Trophy, TrendingUp } from 'lucide-react';
import { ACHIEVEMENTS } from '../../config/gameBalance';
import { ROADMAP, goalProgress } from '../../config/roadmap';
import { useT } from '../../i18n';
import { roadmapContext } from '../../store/slices/progressSlice';
import type { HistoryPoint } from '../../store/storeTypes';
import { useGameShallow, useGameStore } from '../../store/useGameStore';
import { cn } from '../../utils/cn';
import { formatCash, formatDuration, formatHashrate } from '../../utils/formatters';
import { GoalReward, goalValueText } from '../ui/GoalBar';
import { PixelButton } from '../ui/PixelButton';

/** How many finished / upcoming goals the roadmap list shows around the current one. */
const ROADMAP_BEFORE = 2;
const ROADMAP_AFTER = 4;

/** Step line of one series over the session samples (SVG, stretches to its box). */
function Sparkline({ points, pick, color, label, format }: {
  points: HistoryPoint[]; pick: (p: HistoryPoint) => number; color: string; label: string; format: (v: number) => string;
}) {
  const values = points.map(pick);
  const last = values[values.length - 1] ?? 0;
  const min = Math.min(0, ...values);
  const max = Math.max(1e-9, ...values);
  const span = max - min || 1;
  const w = 100;
  const h = 28;
  const path = values.map((v, i) => `${i === 0 ? 'M' : 'L'}${((i / Math.max(1, values.length - 1)) * w).toFixed(2)},${(h - ((v - min) / span) * h).toFixed(2)}`).join(' ');
  const zero = h - ((0 - min) / span) * h;
  return (
    <div className="bg-black/40 p-1.5">
      <div className="flex items-baseline justify-between gap-2 text-[15px] leading-tight">
        <span className="text-dim">{label}</span>
        <span style={{ color }}>{format(last)}</span>
      </div>
      <svg viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" className="mt-1 block h-10 w-full" role="img" aria-label={`${label}: ${format(last)}`}>
        {min < 0 && <line x1={0} x2={w} y1={zero} y2={zero} stroke="#3a3470" strokeWidth={1} vectorEffect="non-scaling-stroke" strokeDasharray="2 2" />}
        {values.length > 1 && <path d={path} fill="none" stroke={color} strokeWidth={2} vectorEffect="non-scaling-stroke" strokeLinejoin="round" />}
      </svg>
      <div className="flex justify-between text-[13px] leading-none text-dim">
        <span>{format(Math.min(...values, last))}</span>
        <span>{format(Math.max(...values, last))}</span>
      </div>
    </div>
  );
}

/** Progress: roadmap goals, session charts, career stats and achievements. */
export function AchievementsPanel() {
  const t = useT();
  const s = useGameShallow((st) => ({
    achievements: st.achievements,
    stats: st.stats,
    roadmap: st.roadmap,
    history: st.history,
  }));
  // `stats.playTimeSec` moves every tick, so this render always sees fresh goal facts.
  const ctx = roadmapContext(useGameStore.getState());
  const { claimRoadmap, setSideTab } = useGameStore.getState();
  const done = new Set(s.achievements);
  const step = s.roadmap.step;
  const from = Math.max(0, Math.min(step - ROADMAP_BEFORE, ROADMAP.length - ROADMAP_BEFORE - ROADMAP_AFTER - 1));
  const shown = ROADMAP.slice(from, from + ROADMAP_BEFORE + ROADMAP_AFTER + 1);
  const span = s.history.length > 1 ? (s.history[s.history.length - 1].t - s.history[0].t) / 1000 : 0;

  return (
    <div className="flex flex-col gap-3" data-testid="progress-panel">
      <section>
        <h3 className="mb-1 flex items-center gap-2 font-pixel text-[9px] text-lime">
          <Flag size={14} /> {t('ROADMAP {done}/{total}', { done: Math.min(step, ROADMAP.length), total: ROADMAP.length })}
        </h3>
        <div className="mb-1.5 h-2 bg-[#1b1838]">
          <div className="h-full bg-lime" style={{ width: `${(Math.min(step, ROADMAP.length) / ROADMAP.length) * 100}%` }} />
        </div>
        <div className="flex flex-col gap-1">
          {shown.map((goal, i) => {
            const index = from + i;
            const past = index < step;
            const current = index === step;
            const progress = past ? 1 : goalProgress(goal, ctx);
            const ready = current && (s.roadmap.ready || progress >= 1);
            return (
              <div
                key={goal.id}
                className={cn('flex items-center gap-2 p-1.5 text-[16px] leading-tight', past ? 'bg-[#0f1f05]' : 'bg-panel-2', !past && !current && 'opacity-60')}
                style={{ boxShadow: current ? 'inset 0 0 0 2px #a3e635' : undefined }}
                data-testid={current ? 'roadmap-current' : undefined}
              >
                <span className={cn('grid size-6 shrink-0 place-items-center font-pixel text-[8px]', past ? 'bg-lime text-void' : 'bg-[#1b1838] text-dim')}>
                  {past ? <Check size={14} /> : index + 1}
                </span>
                <span className="min-w-0 flex-1">
                  <span className={past ? 'text-lime' : 'text-ink'}>{t(goal.title)}</span>
                  {current && <span className="ml-2 text-[15px] text-dim">{goalValueText(goal, goal.value(ctx))}</span>}
                  {!past && <span className="block text-dim">{t(goal.hint)}</span>}
                </span>
                <GoalReward goal={goal} />
                {ready && (
                  <PixelButton size="xs" variant="success" onClick={() => claimRoadmap()} silent>
                    {t('Claim')}
                  </PixelButton>
                )}
                {current && !ready && goal.tab && (
                  <PixelButton size="xs" variant="ghost" onClick={() => setSideTab(goal.tab ?? 'shop')}>
                    {t('Go')}
                  </PixelButton>
                )}
              </div>
            );
          })}
        </div>
      </section>

      <section>
        <h3 className="mb-1 flex items-center gap-2 font-pixel text-[9px] text-neon">
          <TrendingUp size={14} /> {t('THIS SESSION')}
          {span > 0 && <span className="font-term text-[14px] normal-case text-dim">{t('last {time}', { time: formatDuration(Math.round(span)) })}</span>}
        </h3>
        {s.history.length < 2 ? (
          <p className="bg-panel-2 p-2 text-[16px] text-dim">{t('Collecting data: the charts fill in as the farm runs.')}</p>
        ) : (
          <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
            <Sparkline points={s.history} pick={(p) => p.hash} color="#a3e635" label={t('Hashrate')} format={formatHashrate} />
            <Sparkline points={s.history} pick={(p) => p.net} color="#facc15" label={t('Net income')} format={(v) => `${v < 0 ? '-' : ''}${formatCash(Math.abs(v))}/s`} />
          </div>
        )}
      </section>

      <div className="grid grid-cols-2 gap-x-2 gap-y-1 bg-panel-2 p-2 text-[16px] leading-tight">
        <span className="text-dim">{t('Play time')}</span>
        <span>{formatDuration(s.stats.playTimeSec)}</span>
        <span className="text-dim">{t('Peak hashrate')}</span>
        <span className="text-lime">{formatHashrate(s.stats.maxHashrate)}</span>
        <span className="text-dim">{t('Devices bought')}</span>
        <span>{s.stats.gpusBought}</span>
        <span className="text-dim">{t('Halvings')}</span>
        <span className="text-amber">{s.stats.halvings}</span>
        <span className="text-dim">{t('Solo blocks')}</span>
        <span>{s.stats.blocksFound}</span>
        <span className="text-dim">{t('Contracts completed')}</span>
        <span>{s.stats.contractsCompleted}</span>
        <span className="text-dim">{t('Research levels')}</span>
        <span>{s.stats.researchDone}</span>
        <span className="text-dim">{t('Drones caught')}</span>
        <span>{s.stats.airdrops}</span>
        <span className="text-dim">{t('Forge fusions')}</span>
        <span>{s.stats.fusions}</span>
        <span className="text-dim">{t('Best daily streak')}</span>
        <span>{s.stats.bestStreak}</span>
        <span className="text-dim">{t('Best trade')}</span>
        <span className="text-gold">{formatCash(s.stats.bestTrade)}</span>
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
