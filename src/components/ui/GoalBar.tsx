import { ArrowRight, Flag, Gem, Gift, Zap } from 'lucide-react';
import { ROADMAP, currentGoal, goalProgress, type RoadmapGoal } from '../../config/roadmap';
import { useT } from '../../i18n';
import { dailyAvailable, roadmapContext } from '../../store/slices/progressSlice';
import { useGameShallow, useGameStore } from '../../store/useGameStore';
import { formatCash, formatHashrate } from '../../utils/formatters';
import { useNow } from '../panels/LabPanel';
import { PixelButton } from './PixelButton';

/** "3/5", "$120/$2K" or "40 MH/s / 100 MH/s" for a goal. */
export function goalValueText(goal: RoadmapGoal, value: number): string {
  const v = Math.min(value, goal.target);
  if (goal.unit === 'cash') return `${formatCash(v)} / ${formatCash(goal.target)}`;
  if (goal.unit === 'hash') return `${formatHashrate(v)} / ${formatHashrate(goal.target)}`;
  return `${Math.floor(v)} / ${goal.target}`;
}

/** Reward of a goal as short text: "$300 + 2 gems". */
export function GoalReward({ goal }: { goal: RoadmapGoal }) {
  return (
    <span className="flex shrink-0 items-center gap-1.5 whitespace-nowrap">
      {goal.cash > 0 && <span className="text-gold">{formatCash(goal.cash)}</span>}
      {goal.gems > 0 && (
        <span className="flex items-center gap-0.5 text-magenta">
          <Gem size={11} /> {goal.gems}
        </span>
      )}
    </span>
  );
}

/** HUD strip: the current roadmap goal, the daily gift and the Overdrive timer. */
export function GoalBar() {
  const t = useT();
  const s = useGameShallow((st) => {
    const goal = currentGoal(st.roadmap.step);
    const ctx = goal ? roadmapContext(st) : null;
    return {
      step: st.roadmap.step,
      ready: st.roadmap.ready,
      value: goal && ctx ? goal.value(ctx) : 0,
      progress: goal && ctx ? goalProgress(goal, ctx) : 1,
      dailyDay: st.daily.lastDay,
      boostUntil: st.boost?.until ?? 0,
      boostMul: st.boost?.mul ?? 1,
    };
  });
  const { claimRoadmap, setSideTab, setDailyOpen } = useGameStore.getState();
  const now = useNow(s.boostUntil > 0 ? 250 : 5000);
  const goal = currentGoal(s.step);
  const daily = dailyAvailable({ daily: { lastDay: s.dailyDay, streak: 0 } }, now);
  const boostLeft = Math.max(0, Math.ceil((s.boostUntil - now) / 1000));
  const done = s.ready || s.progress >= 1;

  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 border-t-2 border-[#1b1838] pt-2" data-testid="goal-bar">
      <Flag size={14} className="shrink-0 text-lime" />
      {goal ? (
        <>
          <div className="min-w-0 flex-1 basis-56 leading-tight">
            <div className="flex flex-wrap items-baseline gap-x-2">
              <span className="font-silk text-[10px] uppercase text-dim">{t('Goal {n}/{total}', { n: s.step + 1, total: ROADMAP.length })}</span>
              <span className="text-[17px] text-ink" data-testid="goal-title">{t(goal.title)}</span>
              <span className="text-[15px] text-dim">{goalValueText(goal, s.value)}</span>
            </div>
            <div className="truncate text-[15px] text-dim" title={t(goal.hint)}>{t(goal.hint)}</div>
            <div className="mt-0.5 h-1.5 bg-[#1b1838]" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(s.progress * 100)}>
              <div className="h-full transition-[width] duration-500" style={{ width: `${s.progress * 100}%`, background: done ? '#a3e635' : '#22d3ee' }} />
            </div>
          </div>
          <span className="text-[16px]">
            <GoalReward goal={goal} />
          </span>
          {done ? (
            <PixelButton size="sm" variant="success" className="blink" onClick={() => claimRoadmap()} data-testid="goal-claim" silent>
              {t('Claim')}
            </PixelButton>
          ) : (
            goal.tab && (
              <PixelButton size="sm" variant="ghost" onClick={() => setSideTab(goal.tab ?? 'shop')} title={t('Open the panel for this goal')} icon={<ArrowRight size={12} />} data-testid="goal-go">
                {t('Go')}
              </PixelButton>
            )
          )}
        </>
      ) : (
        <span className="flex-1 text-[16px] text-lime">{t('Roadmap complete. The farm is yours.')}</span>
      )}
      {boostLeft > 0 && (
        <span className="flex items-center gap-1 bg-[#1a2e05] px-2 py-1 font-pixel text-[9px] text-lime shadow-[inset_0_0_0_2px_#a3e635]" data-testid="overdrive" title={t('Overdrive: every device hashes faster until the timer runs out.')}>
          <Zap size={12} className="blink" /> {t('OVERDRIVE x{mul} · {sec}s', { mul: s.boostMul, sec: boostLeft })}
        </span>
      )}
      <PixelButton
        size="sm"
        variant={daily ? 'gold' : 'ghost'}
        className={daily ? 'blink' : undefined}
        onClick={() => setDailyOpen(true)}
        icon={<Gift size={13} />}
        aria-label={t('Daily bonus')}
        title={daily ? t('Your daily bonus is ready!') : t('Daily bonus (already claimed today)')}
        data-testid="daily-open"
      >
        <span className="hidden sm:inline">{t('Daily')}</span>
      </PixelButton>
    </div>
  );
}
