import { Bot, CheckCircle2, ClipboardList, CloudLightning, Coins, Cpu, Gauge, Gem, Hourglass, Pickaxe, RefreshCw, Snowflake, Sparkles, Timer } from 'lucide-react';
import { useEffect, useState, type ReactNode } from 'react';
import { CONTRACT_DEFS, CONTRACT_DIFFICULTY, CONTRACTS } from '../../config/contracts';
import { GPU_BY_ID } from '../../config/hardwareCatalog';
import { sprites } from '../../engine/SpriteManager';
import { contractGoal, contractHint, contractProgressText } from '../../store/contracts';
import { contractTitle } from '../../store/slices/contractsSlice';
import { useGameShallow, useGameStore } from '../../store/useGameStore';
import type { Contract, ContractKind } from '../../types/contracts';
import { bnGte } from '../../utils/bignum';
import { formatCash, formatDuration, formatTemp, tempColor } from '../../utils/formatters';
import { Meter } from '../ui/Meter';
import { PixelButton } from '../ui/PixelButton';
import { SpriteImg } from '../ui/SpriteImg';

export const CONTRACT_ICON: Record<ContractKind, (size: number) => ReactNode> = {
  deliver_cc: (n) => <Pickaxe size={n} />,
  earn_profit: (n) => <Coins size={n} />,
  bot_profit: (n) => <Bot size={n} />,
  reach_hash: (n) => <Gauge size={n} />,
  keep_cool: (n) => <Snowflake size={n} />,
  gpu_tier: (n) => <Cpu size={n} />,
  solo_block: (n) => <Sparkles size={n} />,
  survive_event: (n) => <CloudLightning size={n} />,
};

interface CardProps {
  c: Contract;
  now: number;
  hottest: number;
  rerollCost: number;
  rerollReady: boolean;
  canPayReroll: boolean;
}

function ContractCard({ c, now, hottest, rerollCost, rerollReady, canPayReroll }: CardProps) {
  const { claimContract, rerollContract } = useGameStore.getState();
  const def = CONTRACT_DEFS[c.kind];
  const diff = CONTRACT_DIFFICULTY[c.difficulty];
  const done = c.completedAt !== null;
  const left = Math.max(0, (c.expiresAt - now) / 1000);
  const urgent = !done && left < 60;
  const gpu = c.reward.gpuModelId ? GPU_BY_ID[c.reward.gpuModelId] : undefined;
  const title = contractTitle(c);
  return (
    <article
      className="flex flex-col gap-1.5 bg-panel-2 p-2"
      aria-label={`Contract: ${title}`}
      data-contract-kind={c.kind}
      data-contract-state={done ? 'complete' : 'active'}
      style={{ boxShadow: done ? `inset 0 0 0 2px ${def.color}, 0 0 12px ${def.color}55` : `inset 3px 0 0 0 ${def.color}` }}
    >
      <div className="flex items-start gap-2">
        <div className="grid size-9 shrink-0 place-items-center" style={{ background: `${def.color}22`, color: def.color, boxShadow: `inset 0 0 0 2px ${def.color}66` }}>
          {CONTRACT_ICON[c.kind](18)}
        </div>
        <div className="min-w-0 flex-1 leading-tight">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
            <span className="font-pixel text-[9px]" style={{ color: def.color }}>{title.toUpperCase()}</span>
            <span className="font-pixel text-[7px]" style={{ color: diff.color }}>{diff.label.toUpperCase()}</span>
            {done ? (
              <span className="blink ml-auto flex items-center gap-1 font-pixel text-[8px] text-lime">
                <CheckCircle2 size={11} /> COMPLETE
              </span>
            ) : (
              <span className={`ml-auto flex items-center gap-1 font-pixel text-[8px] ${urgent ? 'blink text-hot' : 'text-dim'}`} title="Time left">
                <Timer size={11} /> {formatDuration(left)}
              </span>
            )}
          </div>
          <div className="text-[17px] text-ink">{contractGoal(c)}</div>
        </div>
      </div>

      <div className="flex items-center gap-2">
        <Meter value={Math.min(c.progress, c.target)} max={c.target} color={def.color} segments={20} warnAt={2} dangerAt={2} className="flex-1" />
        <span className="shrink-0 whitespace-nowrap text-[15px] leading-none text-ink/90">{contractProgressText(c)}</span>
      </div>
      <div className="text-[15px] leading-tight text-dim">
        {contractHint(c)}
        {c.kind === 'keep_cool' && !done && hottest > 0 && (
          <span>
            {' '}Hottest now: <span style={{ color: hottest < c.param ? '#a3e635' : tempColor(Math.max(hottest, 80)) }}>{formatTemp(hottest)}</span>
          </span>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-2 border-t-2 border-[#1b1838] pt-1.5">
        <span className="font-silk text-[10px] uppercase text-dim">Reward</span>
        <span className="font-pixel text-[9px] text-gold">{formatCash(c.reward.cash)}</span>
        {c.reward.gems > 0 && (
          <span className="flex items-center gap-1 font-pixel text-[9px] text-magenta">
            <Gem size={11} /> {c.reward.gems}
          </span>
        )}
        {gpu && (
          <span className="flex items-center gap-1 text-[15px] text-neon" title={`Free ${gpu.brand} ${gpu.name} (silicon lottery on claim)`}>
            <SpriteImg src={sprites.gpuIcon(gpu.id)} width={36} alt="" /> {gpu.name}
          </span>
        )}
        <span className="ml-auto flex items-center">
          {done ? (
            <PixelButton size="sm" variant="success" onClick={() => claimContract(c.id)} aria-label={`Claim ${title}`} silent>
              Claim
            </PixelButton>
          ) : (
            <PixelButton
              size="xs"
              variant="ghost"
              disabled={!rerollReady || !canPayReroll}
              onClick={() => rerollContract(c.id)}
              aria-label={`Reroll ${title} for ${formatCash(rerollCost)}`}
              title={rerollReady ? `Swap for a new contract (${formatCash(rerollCost)})` : 'Reroll on cooldown'}
              icon={<RefreshCw size={10} />}
            >
              {formatCash(rerollCost)}
            </PixelButton>
          )}
        </span>
      </div>
    </article>
  );
}

/** Harvest-style order board: three timed contracts scaled to the farm. */
export function ContractsPanel() {
  const s = useGameShallow((st) => ({
    board: st.contracts,
    cash: st.cash,
    hottest: st.live.hottest,
    claimed: st.stats.contractsCompleted,
    // Re-render when the income estimate (reroll price) moves.
    hash: st.live.totalHash,
  }));
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  const rerollCost = useGameStore.getState().contractRerollCost();
  const rerollLeft = Math.max(0, (s.board.rerollReadyAt - now) / 1000);
  const empty = Math.max(0, CONTRACTS.slots - s.board.slots.length);
  const ready = s.board.slots.filter((c) => c.completedAt !== null).length;

  return (
    <div className="flex flex-col gap-3">
      <div className="grid grid-cols-3 gap-2 bg-panel-2 p-2 text-[16px] leading-tight">
        <span className="flex flex-col">
          <span className="font-silk text-[10px] uppercase text-dim">Ready</span>
          <span className={ready ? 'text-lime' : ''}>{ready}/{CONTRACTS.slots}</span>
        </span>
        <span className="flex flex-col">
          <span className="font-silk text-[10px] uppercase text-dim">Claimed</span>
          <span className="text-gold">{s.claimed}</span>
        </span>
        <span className="flex flex-col">
          <span className="font-silk text-[10px] uppercase text-dim">Reroll</span>
          <span className={rerollLeft > 0 ? 'text-dim' : 'text-neon'}>{rerollLeft > 0 ? formatDuration(rerollLeft) : 'Ready'}</span>
        </span>
      </div>
      <p className="text-[16px] leading-tight text-dim">
        Buyers post timed orders sized to your farm. Finish one before the timer runs out, then claim it. You can reroll one unfinished contract every {CONTRACTS.rerollCooldownSec / 60} minutes.
      </p>

      <h3 className="flex items-center gap-2 font-pixel text-[9px] text-amber">
        <ClipboardList size={14} /> CONTRACTS BOARD
      </h3>
      <div className="flex flex-col gap-2">
        {s.board.slots.map((c) => (
          <ContractCard
            key={c.id}
            c={c}
            now={now}
            hottest={s.hottest}
            rerollCost={rerollCost}
            rerollReady={rerollLeft <= 0}
            canPayReroll={bnGte(s.cash, rerollCost)}
          />
        ))}
        {Array.from({ length: empty }, (_, i) => (
          <div key={`empty-${i}`} className="flex items-center gap-2 bg-panel p-3 text-[16px] text-dim shadow-[inset_0_0_0_2px_#241f45]">
            <Hourglass size={14} className="blink" />
            Incoming contract in {formatDuration(Math.max(0, (s.board.nextRefillAt + i * CONTRACTS.refillSec * 1000 - now) / 1000))}
          </div>
        ))}
      </div>
    </div>
  );
}
