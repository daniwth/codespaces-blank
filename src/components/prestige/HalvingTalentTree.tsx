import { Atom, Building2, Coins, Cpu, Crown, FlaskConical, Leaf, Moon, Radar, Snowflake, TrendingUp, Wrench, Zap, type LucideIcon, Dices, Hammer, Recycle } from 'lucide-react';
import { useState } from 'react';
import { CHALLENGES } from '../../config/challenges';
import { HALVING_MIN_EARNINGS, PRESTIGE_TREE, earningsForSc, nextScMilestone, talentCost, talentLevel } from '../../config/prestigeTree';
import { useT } from '../../i18n';
import { halvingReward } from '../../store/slices/economySlice';
import { useGameShallow, useGameStore } from '../../store/useGameStore';
import type { ChallengeId, TalentIcon } from '../../types/player';
import { bnToNumber } from '../../utils/bignum';
import { cn } from '../../utils/cn';
import { formatCash, formatDuration } from '../../utils/formatters';
import { PixelButton } from '../ui/PixelButton';
import { ChallengePicker } from './ChallengePicker';
import { SLOT, slotted } from '../panels/richText';

const ICONS: Record<TalentIcon, LucideIcon> = {
  zap: Zap, leaf: Leaf, snowflake: Snowflake, coins: Coins, moon: Moon, cpu: Cpu,
  trending: TrendingUp, wrench: Wrench, crown: Crown, atom: Atom, building: Building2, radar: Radar, flask: FlaskConical, recycle: Recycle, hammer: Hammer, dice: Dices,
};

// Percentage-based layout: 5 columns × 5 rows.
const CELL_W = 20;
const CELL_H = 20;

export function HalvingTalentTree() {
  const t = useT();
  const s = useGameShallow((st) => ({
    runEarnings: st.runEarnings,
    sc: st.sc,
    scLifetime: st.scLifetime,
    talents: st.talents,
    halvings: st.stats.halvings,
    runStartedAt: st.runStartedAt,
    challenge: st.challenge,
    records: st.challengeRecords,
    now: st.lastTick,
  }));
  const { performHalving, buyTalent, abandonChallenge } = useGameStore.getState();
  const [confirm, setConfirm] = useState(false);
  const [next, setNext] = useState<ChallengeId | null>(null);
  const reward = halvingReward(s);
  const run = bnToNumber(s.runEarnings);
  const progress = Math.min(1, run / HALVING_MIN_EARNINGS);
  const runSec = Math.max(0, (s.now - s.runStartedAt) / 1000);
  const scPerHour = reward > 0 && runSec > 0 ? reward / (runSec / 3600) : 0;
  const nextAt = nextScMilestone(run);
  const prevAt = earningsForSc(reward);
  // Log-scale progress between the current and the next $SC milestone.
  const milestoneProgress = reward > 0 ? Math.min(1, Math.max(0, Math.log(run / prevAt) / Math.log(nextAt / prevAt))) : 0;

  return (
    <div className="flex flex-col gap-3">
      <div className="relative overflow-hidden bg-[#1a0f00] p-3 shadow-[inset_0_0_0_2px_#a16207]">
        <div className="gold-shimmer font-pixel text-[13px]">{t('THE HALVING')}</div>
        <p className="mt-1 text-[16px] leading-tight text-amber/80">
          {slotted(t('Cash out your run before the network halves: wipe ordinary hardware, rooms and $CC to mint permanent {sc}. Gold racks, gems, bots and talents survive.', { sc: SLOT }), <b>{t('Smart Contracts ($SC)')}</b>)}
        </p>
        <div className="mt-2 grid grid-cols-3 gap-2 text-[16px] leading-tight">
          <div>
            <div className="font-silk text-[9px] text-dim">{t('RUN EARNINGS')}</div>
            <div className="text-gold">{formatCash(s.runEarnings)}</div>
          </div>
          <div>
            <div className="font-silk text-[9px] text-dim">{t('REWARD')}</div>
            <div className="text-gold">{reward} $SC</div>
          </div>
          <div>
            <div className="font-silk text-[9px] text-dim">{t('HALVINGS')}</div>
            <div className="text-gold">{s.halvings}</div>
          </div>
          <div>
            <div className="font-silk text-[9px] text-dim">{t('RUN TIME')}</div>
            <div className="text-amber">{formatDuration(runSec)}</div>
          </div>
          <div data-testid="halving-rate">
            <div className="font-silk text-[9px] text-dim">{t('$SC / HOUR')}</div>
            <div className="text-amber">{reward > 0 ? scPerHour.toFixed(2) : '—'}</div>
          </div>
          <div>
            <div className="font-silk text-[9px] text-dim">{t('NEXT $SC AT')}</div>
            <div className="text-amber">{formatCash(nextAt)}</div>
          </div>
        </div>
        {reward > 0 && (
          <div className="mt-2" data-testid="halving-milestone">
            <div className="h-2 bg-black">
              <div className="h-full bg-amber" style={{ width: `${milestoneProgress * 100}%` }} />
            </div>
            <div className="mt-1 text-[15px] leading-tight text-dim">
              {t('+1 $SC ({total} total) at {at} (x{mult} the last milestone). Each extra $SC needs x2, x3, x4… more earnings, so $SC per hour peaks and then falls: cash out near the peak.', { total: reward + 1, at: formatCash(nextAt), mult: Math.round(nextAt / prevAt) })}
            </div>
          </div>
        )}
        {reward <= 0 && (
          <div className="mt-2">
            <div className="h-2 bg-black">
              <div className="h-full bg-gold" style={{ width: `${progress * 100}%` }} />
            </div>
            <div className="mt-1 text-[15px] text-dim">{t('Earn {amount} this run to unlock ({pct}%).', { amount: formatCash(HALVING_MIN_EARNINGS), pct: (progress * 100).toFixed(1) })}</div>
          </div>
        )}
        <div className="mt-2 flex flex-col gap-2">
          {confirm && <ChallengePicker value={next} onChange={setNext} records={s.records} id="halving-challenge" />}
          <div className="flex gap-1">
            {!confirm ? (
              <PixelButton variant="gold" size="sm" disabled={reward <= 0} onClick={() => setConfirm(true)}>
                {t('Trigger halving')}
              </PixelButton>
            ) : (
              <>
                <PixelButton variant="danger" size="sm" onClick={() => { performHalving(next); setConfirm(false); setNext(null); }}>
                  {next ? t('Confirm: reset for {n} $SC + challenge', { n: reward }) : t('Confirm: reset for {n} $SC', { n: reward })}
                </PixelButton>
                <PixelButton size="sm" variant="ghost" onClick={() => { setConfirm(false); setNext(null); }}>
                  {t('Cancel')}
                </PixelButton>
              </>
            )}
          </div>
        </div>
      </div>

      <div className="bg-panel-2 p-2" data-testid="challenge-log">
        <div className="flex items-center justify-between">
          <span className="font-pixel text-[9px] text-neon">{t('CHALLENGE RUNS')}</span>
          <span className="text-[15px] text-dim">
            {t('{n}/{max} cleared', { n: CHALLENGES.filter((c) => (s.records[c.id]?.clears ?? 0) > 0).length, max: CHALLENGES.length })}
          </span>
        </div>
        <p className="mt-1 text-[15px] leading-tight text-dim">
          {t('Pick one when you trigger the Halving or start a new game. Reach the Halving threshold with its restriction held for bonus $SC and gems (full on the first clear, smaller after). Abandoning keeps the normal reward.')}
        </p>
        <div className="mt-2 flex flex-col gap-1">
          {CHALLENGES.map((c) => {
            const rec = s.records[c.id];
            const active = s.challenge?.id === c.id;
            return (
              <div key={c.id} className="flex items-start gap-2 bg-panel p-1.5 text-[16px] leading-tight" style={{ boxShadow: active ? `inset 0 0 0 2px ${c.color}` : undefined }} data-testid={`challenge-row-${c.id}`}>
                <span className="mt-0.5 shrink-0 font-pixel text-[9px]" style={{ color: c.color }}>{rec ? '✓' : active ? '▶' : '·'}</span>
                <span className="min-w-0 flex-1">
                  <span style={{ color: c.color }}>{t(c.name)}</span>{active && <span className="text-lime"> {t('ACTIVE')}</span>}
                  <span className="block text-dim">{t(c.description)}</span>
                  <span className="block text-gold">
                    {rec
                      ? t('Cleared x{n} · best {time} · repeat +{sc} $SC, +{gems} gems', { n: rec.clears, time: formatDuration(rec.bestTimeSec), sc: c.repeatSc, gems: c.repeatGems })
                      : t('First clear: +{sc} $SC, +{gems} gems', { sc: c.firstSc, gems: c.firstGems })}
                  </span>
                </span>
              </div>
            );
          })}
        </div>
        {s.challenge && (
          <div className="mt-2">
            <PixelButton size="xs" variant="danger" onClick={() => abandonChallenge()}>
              {t('Abandon active challenge')}
            </PixelButton>
          </div>
        )}
      </div>

      <div className="flex items-center justify-between">
        <span className="font-pixel text-[9px] text-amber">{t('SMART CONTRACT TREE')}</span>
        <span className="font-pixel text-[10px] text-gold">{s.sc} $SC</span>
      </div>

      <div className="relative w-full" style={{ aspectRatio: '5 / 5.5' }}>
        <svg className="absolute inset-0 h-full w-full" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden>
          {PRESTIGE_TREE.flatMap((node) =>
            node.requires.map((req) => {
              const parent = PRESTIGE_TREE.find((n) => n.id === req);
              if (!parent) return null;
              const active = talentLevel(s.talents, req) > 0;
              return (
                <line
                  key={`${req}-${node.id}`}
                  x1={parent.col * CELL_W + CELL_W / 2}
                  y1={parent.row * CELL_H + CELL_H / 2}
                  x2={node.col * CELL_W + CELL_W / 2}
                  y2={node.row * CELL_H + CELL_H / 2}
                  stroke={active ? '#facc15' : '#3a3470'}
                  strokeWidth={active ? 1 : 0.6}
                  strokeDasharray={active ? undefined : '1.5 1.5'}
                  vectorEffect="non-scaling-stroke"
                />
              );
            }),
          )}
        </svg>
        {PRESTIGE_TREE.map((node) => {
          const lvl = talentLevel(s.talents, node.id);
          const maxed = lvl >= node.maxLevel;
          const locked = node.requires.some((r) => talentLevel(s.talents, r) === 0);
          const cost = talentCost(node, lvl);
          const affordable = !locked && !maxed && s.sc >= cost;
          const Icon = ICONS[node.icon];
          return (
            <button
              key={node.id}
              type="button"
              onClick={() => buyTalent(node.id)}
              disabled={!affordable}
              title={`${t(node.name)}: ${t(node.description)}\n${t('Now: {v}', { v: node.format(lvl) })}${maxed ? '' : `\n${t('Next: {v} ({cost} $SC)', { v: node.format(lvl + 1), cost })}`}`}
              className={cn(
                'group absolute flex -translate-x-1/2 -translate-y-1/2 flex-col items-center gap-0.5 p-1 text-center transition-transform',
                affordable && 'hover:scale-105',
                locked && 'opacity-55',
              )}
              style={{ left: `${node.col * CELL_W + CELL_W / 2}%`, top: `${node.row * CELL_H + CELL_H / 2}%`, width: `${CELL_W}%` }}
            >
              <span
                className="grid size-10 place-items-center"
                style={{
                  background: maxed ? '#422006' : lvl > 0 ? '#2a1f05' : '#141128',
                  color: maxed ? '#facc15' : lvl > 0 ? '#fde047' : '#8f89c4',
                  boxShadow: `0 0 0 2px ${affordable ? '#facc15' : maxed ? '#a16207' : '#3a3470'}${affordable ? ', 0 0 10px #facc15aa' : ''}`,
                }}
              >
                <Icon size={18} />
              </span>
              <span className="font-silk text-[8px] leading-none text-ink">{t(node.name)}</span>
              <span className="text-[13px] leading-none text-dim">
                {lvl}/{node.maxLevel}
                {!maxed && <span className={affordable ? 'text-gold' : ''}> · {cost}$SC</span>}
              </span>
            </button>
          );
        })}
      </div>
      <p className="text-[15px] leading-tight text-dim">{t('Hover a node for details. Lifetime minted: {n} $SC.', { n: s.scLifetime })}</p>
    </div>
  );
}
