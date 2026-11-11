import { Cpu, Droplets, Fan, FlaskConical, Gem, PlugZap, Truck, UtilityPole, type LucideIcon } from 'lucide-react';
import { useEffect, useState } from 'react';
import { RESEARCH, RESEARCH_BY_ID, researchCost, researchLevel, rushCost, type ResearchIcon } from '../../config/research';
import { useT } from '../../i18n';
import { activeRules } from '../../store/slices/challengesSlice';
import { researchSeconds } from '../../store/slices/researchSlice';
import { useGameShallow, useGameStore } from '../../store/useGameStore';
import { bnGte } from '../../utils/bignum';
import { cn } from '../../utils/cn';
import { formatCash, formatDuration } from '../../utils/formatters';
import { PixelButton } from '../ui/PixelButton';

const ICONS: Record<ResearchIcon, LucideIcon> = { chip: Cpu, fan: Fan, bolt: PlugZap, drop: Droplets, pylon: UtilityPole, truck: Truck };

/** Wall clock that re-renders its caller twice a second (research countdowns). */
export function useNow(intervalMs = 500): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(timer);
  }, [intervalMs]);
  return now;
}

/** Research Lab: run-scoped upgrades bought with cash that take real time (one project at a time). */
export function LabPanel() {
  const t = useT();
  const s = useGameShallow((st) => ({
    cash: st.cash,
    gems: st.gems,
    research: st.research,
    talents: st.talents,
    gridVoid: activeRules(st).powerCapMul < 1 || activeRules(st).singleRoom,
  }));
  const { startResearch, cancelResearch, rushResearch } = useGameStore.getState();
  const now = useNow();
  const active = s.research.active;
  const activeDef = active ? RESEARCH_BY_ID[active.id] : null;
  const remaining = active ? Math.max(0, (active.endsAt - now) / 1000) : 0;
  const total = active ? Math.max(1, (active.endsAt - active.startedAt) / 1000) : 1;
  const done = RESEARCH.reduce((a, r) => a + researchLevel(s.research.levels, r.id), 0);
  const max = RESEARCH.reduce((a, r) => a + r.maxLevel, 0);

  return (
    <div className="flex flex-col gap-3" data-testid="lab-panel">
      <div className="bg-[#1a0f2e] p-3 shadow-[inset_0_0_0_2px_#7c3aed]">
        <div className="flex items-center justify-between gap-2">
          <span className="flex items-center gap-2 font-pixel text-[11px] text-[#c084fc]">
            <FlaskConical size={16} /> {t('RESEARCH LAB')}
          </span>
          <span className="text-[15px] text-dim">{t('{n}/{max} levels', { n: done, max })}</span>
        </div>
        <p className="mt-1 text-[16px] leading-tight text-[#d8b4fe]/80">
          {t('Pay cash, wait, and the upgrade lasts the whole run. Projects keep running while you are away. The Halving wipes the Lab.')}
        </p>
        {active && activeDef ? (
          <div className="mt-2 bg-black/40 p-2" data-testid="lab-active">
            <div className="flex flex-wrap items-center justify-between gap-x-3 text-[16px] leading-tight">
              <span style={{ color: activeDef.color }}>
                {t('{name} Lv.{level}', { name: t(activeDef.name), level: researchLevel(s.research.levels, active.id) + 1 })}
              </span>
              <span className="text-ink">{t('{time} left', { time: formatDuration(Math.ceil(remaining)) })}</span>
            </div>
            <div className="mt-1 h-2.5 bg-black" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round((1 - remaining / total) * 100)}>
              <div className="h-full transition-[width] duration-500" style={{ width: `${Math.min(100, (1 - remaining / total) * 100)}%`, background: activeDef.color }} />
            </div>
            <div className="mt-2 flex flex-wrap gap-1">
              <PixelButton size="xs" variant="gold" icon={<Gem size={10} />} disabled={s.gems < rushCost(remaining)} onClick={() => rushResearch()} title={t('Finish the project right now.')}>
                {t('Rush ({n})', { n: rushCost(remaining) })}
              </PixelButton>
              <PixelButton size="xs" variant="ghost" onClick={() => cancelResearch()} title={t('Stop the project and get its cost back.')}>
                {t('Cancel (refund)')}
              </PixelButton>
            </div>
          </div>
        ) : (
          <div className="mt-2 text-[15px] text-dim">{t('The Lab is idle. Pick a project below.')}</div>
        )}
      </div>

      <div className="flex flex-col gap-1.5">
        {RESEARCH.map((def) => {
          const level = researchLevel(s.research.levels, def.id);
          const maxed = level >= def.maxLevel;
          const cost = researchCost(def, level);
          const affordable = bnGte(s.cash, cost);
          const isActive = active?.id === def.id;
          const Icon = ICONS[def.icon];
          const now_ = def.effectOf(level);
          const next = def.effectOf(level + 1);
          return (
            <div
              key={def.id}
              className={cn('flex items-start gap-2 bg-panel-2 p-2', maxed && 'opacity-80')}
              style={{ boxShadow: isActive ? `inset 0 0 0 2px ${def.color}` : undefined }}
              data-testid={`research-${def.id}`}
            >
              <span className="grid size-10 shrink-0 place-items-center" style={{ background: `${def.color}22`, color: def.color, boxShadow: `inset 0 0 0 2px ${def.color}66` }}>
                <Icon size={18} />
              </span>
              <div className="min-w-0 flex-1 text-[16px] leading-tight">
                <div className="flex flex-wrap items-center gap-x-2">
                  <span className="text-ink">{t(def.name)}</span>
                  <span className="flex gap-[2px]" aria-label={t('Level {n} of {max}', { n: level, max: def.maxLevel })}>
                    {Array.from({ length: def.maxLevel }, (_, i) => (
                      <span key={i} className="size-2" style={{ background: i < level ? def.color : '#2a2550' }} />
                    ))}
                  </span>
                </div>
                <div className="text-dim">{t(def.description)}</div>
                <div>
                  <span style={{ color: def.color }}>{level > 0 ? t(now_.key, now_.params) : t('Not researched')}</span>
                  {!maxed && <span className="text-dim"> → {t(next.key, next.params)}</span>}
                </div>
                {def.id === 'grid' && s.gridVoid && <div className="text-hot">{t('No effect during this challenge.')}</div>}
              </div>
              <PixelButton
                size="xs"
                variant={maxed ? 'secondary' : affordable && !active ? 'success' : 'secondary'}
                disabled={maxed || !!active || !affordable}
                onClick={() => startResearch(def.id)}
                className="shrink-0 flex-col gap-0.5"
                silent
              >
                {maxed ? (
                  <span>{t('MAX')}</span>
                ) : (
                  <>
                    <span>{isActive ? t('Running') : t('Research')}</span>
                    <span className="font-term text-[15px] normal-case">{formatCash(cost)}</span>
                    <span className="font-term text-[14px] normal-case opacity-80">{formatDuration(researchSeconds(def.id, s.research.levels, s.talents))}</span>
                  </>
                )}
              </PixelButton>
            </div>
          );
        })}
      </div>
    </div>
  );
}
