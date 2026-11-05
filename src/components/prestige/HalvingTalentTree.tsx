import { Atom, Building2, Coins, Cpu, Crown, Leaf, Moon, Snowflake, TrendingUp, Wrench, Zap, type LucideIcon } from 'lucide-react';
import { useState } from 'react';
import { HALVING_MIN_EARNINGS, PRESTIGE_TREE, talentCost, talentLevel } from '../../config/prestigeTree';
import { halvingReward } from '../../store/slices/economySlice';
import { useGameShallow, useGameStore } from '../../store/useGameStore';
import type { TalentIcon } from '../../types/player';
import { bnToNumber } from '../../utils/bignum';
import { cn } from '../../utils/cn';
import { formatCash } from '../../utils/formatters';
import { PixelButton } from '../ui/PixelButton';

const ICONS: Record<TalentIcon, LucideIcon> = {
  zap: Zap, leaf: Leaf, snowflake: Snowflake, coins: Coins, moon: Moon, cpu: Cpu,
  trending: TrendingUp, wrench: Wrench, crown: Crown, atom: Atom, building: Building2,
};

// Percentage-based layout: 5 columns × 4 rows.
const CELL_W = 20;
const CELL_H = 25;

export function HalvingTalentTree() {
  const s = useGameShallow((st) => ({
    runEarnings: st.runEarnings,
    sc: st.sc,
    scLifetime: st.scLifetime,
    talents: st.talents,
    halvings: st.stats.halvings,
  }));
  const { performHalving, buyTalent } = useGameStore.getState();
  const [confirm, setConfirm] = useState(false);
  const reward = halvingReward(s);
  const run = bnToNumber(s.runEarnings);
  const progress = Math.min(1, run / HALVING_MIN_EARNINGS);

  return (
    <div className="flex flex-col gap-3">
      <div className="relative overflow-hidden bg-[#1a0f00] p-3 shadow-[inset_0_0_0_2px_#a16207]">
        <div className="gold-shimmer font-pixel text-[13px]">THE HALVING</div>
        <p className="mt-1 text-[16px] leading-tight text-amber/80">
          The block reward is cut in half: wipe ordinary hardware, rooms and $CC to mint permanent <b>Smart Contracts ($SC)</b>. Gold racks, gems, bots and talents survive.
        </p>
        <div className="mt-2 grid grid-cols-3 gap-2 text-[16px] leading-tight">
          <div>
            <div className="font-silk text-[9px] text-dim">RUN EARNINGS</div>
            <div className="text-gold">{formatCash(s.runEarnings)}</div>
          </div>
          <div>
            <div className="font-silk text-[9px] text-dim">REWARD</div>
            <div className="text-gold">{reward} $SC</div>
          </div>
          <div>
            <div className="font-silk text-[9px] text-dim">HALVINGS</div>
            <div className="text-gold">{s.halvings}</div>
          </div>
        </div>
        {reward <= 0 && (
          <div className="mt-2">
            <div className="h-2 bg-black">
              <div className="h-full bg-gold" style={{ width: `${progress * 100}%` }} />
            </div>
            <div className="mt-1 text-[15px] text-dim">Earn {formatCash(HALVING_MIN_EARNINGS)} this run to unlock ({(progress * 100).toFixed(1)}%).</div>
          </div>
        )}
        <div className="mt-2 flex gap-1">
          {!confirm ? (
            <PixelButton variant="gold" size="sm" disabled={reward <= 0} onClick={() => setConfirm(true)}>
              Trigger halving
            </PixelButton>
          ) : (
            <>
              <PixelButton variant="danger" size="sm" onClick={() => { performHalving(); setConfirm(false); }}>
                Confirm: reset for {reward} $SC
              </PixelButton>
              <PixelButton size="sm" variant="ghost" onClick={() => setConfirm(false)}>
                Cancel
              </PixelButton>
            </>
          )}
        </div>
      </div>

      <div className="flex items-center justify-between">
        <span className="font-pixel text-[9px] text-amber">SMART CONTRACT TREE</span>
        <span className="font-pixel text-[10px] text-gold">{s.sc} $SC</span>
      </div>

      <div className="relative w-full" style={{ aspectRatio: '5 / 4.4' }}>
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
              title={`${node.name}: ${node.description}\nNow: ${node.format(lvl)}${maxed ? '' : `\nNext: ${node.format(lvl + 1)} (${cost} $SC)`}`}
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
              <span className="font-silk text-[8px] leading-none text-ink">{node.name}</span>
              <span className="text-[13px] leading-none text-dim">
                {lvl}/{node.maxLevel}
                {!maxed && <span className={affordable ? 'text-gold' : ''}> · {cost}$SC</span>}
              </span>
            </button>
          );
        })}
      </div>
      <p className="text-[15px] leading-tight text-dim">Hover a node for details. Lifetime minted: {s.scLifetime} $SC.</p>
    </div>
  );
}
