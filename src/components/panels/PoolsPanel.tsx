import { Radio, ShieldAlert, Sparkles, Waves } from 'lucide-react';
import { useEffect, useState, type ReactNode } from 'react';
import { NETWORK_EVENTS, POOL_ORDER, POOLS, levelFromEarnings } from '../../config/gameBalance';
import { useGameShallow, useGameStore } from '../../store/useGameStore';
import type { PoolMode } from '../../types/economy';
import { bnToNumber } from '../../utils/bignum';
import { cn } from '../../utils/cn';
import { formatDuration, formatHashrate, formatNumber } from '../../utils/formatters';

const POOL_ICON: Record<PoolMode, ReactNode> = {
  public: <Waves size={16} />,
  solo: <Sparkles size={16} />,
  darknet: <ShieldAlert size={16} />,
};

export function PoolsPanel() {
  const s = useGameShallow((st) => ({
    pool: st.pool,
    lifetime: st.lifetimeEarnings,
    live: st.live,
    event: st.event,
    nextEventAt: st.nextEventAt,
    stats: st.stats,
  }));
  const setPool = useGameStore((st) => st.setPool);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  const level = levelFromEarnings(bnToNumber(s.lifetime));
  const event = s.event ? NETWORK_EVENTS[s.event.id] : null;

  return (
    <div className="flex flex-col gap-3">
      <h3 className="font-pixel text-[9px] text-neon">MINING POOL</h3>
      {POOL_ORDER.map((id) => {
        const p = POOLS[id];
        const locked = level < p.unlockLevel;
        const active = s.pool === id;
        return (
          <button
            key={id}
            type="button"
            disabled={locked}
            onClick={() => setPool(id)}
            className={cn('flex gap-3 p-2 text-left transition-colors', active ? 'bg-panel-3' : 'bg-panel-2 hover:bg-panel-3', locked && 'opacity-50')}
            style={{ boxShadow: active ? `inset 0 0 0 2px ${p.color}` : undefined }}
          >
            <span className="mt-0.5" style={{ color: p.color }}>{POOL_ICON[id]}</span>
            <span className="flex-1 text-[16px] leading-tight">
              <span className="font-pixel text-[9px]" style={{ color: p.color }}>
                {p.name} {active && '● ACTIVE'}
              </span>
              <span className="block text-ink/90">{p.tagline} — {p.description}</span>
              <span className="block text-dim">
                Yield x{p.payoutMul}{p.fee ? ` · fee ${(p.fee * 100).toFixed(0)}%` : ''}{locked ? ` · unlocks at LV ${p.unlockLevel}` : ''}
              </span>
            </span>
          </button>
        );
      })}

      <h3 className="mt-1 font-pixel text-[9px] text-neon">BLOCKCHAIN NETWORK</h3>
      <div className="grid grid-cols-2 gap-2 bg-panel-2 p-2 text-[16px] leading-tight">
        <span className="text-dim">Your hashrate</span>
        <span className="text-lime">{formatHashrate(s.live.totalHash)}</span>
        <span className="text-dim">Difficulty</span>
        <span className={s.live.difficulty > 1 ? 'text-hot' : ''}>x{s.live.difficulty.toFixed(2)}</span>
        <span className="text-dim">Expected yield</span>
        <span>{formatNumber(s.live.ccPerSec, 3)} $CC/s</span>
        <span className="text-dim">Blocks found</span>
        <span className="text-gold">{s.stats.blocksFound}</span>
        <span className="text-dim">Raids survived</span>
        <span className="text-hot">{s.stats.raids}</span>
        <span className="text-dim">Overheats</span>
        <span>{s.stats.overheats}</span>
      </div>
      <div className="flex items-center gap-2 bg-panel-2 p-2 text-[16px] leading-tight">
        <Radio size={14} className={event ? 'blink' : 'text-dim'} style={{ color: event?.color }} />
        {event ? (
          <span>
            <span style={{ color: event.color }}>{event.name}</span> — {event.description} ({formatDuration(((s.event?.endsAt ?? now) - now) / 1000)} left)
          </span>
        ) : (
          <span className="text-dim">No active event. Next network event in ~{formatDuration(Math.max(0, s.nextEventAt - now) / 1000)}.</span>
        )}
      </div>
    </div>
  );
}
