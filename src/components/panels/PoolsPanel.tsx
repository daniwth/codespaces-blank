import { Radio, ShieldAlert, Sparkles, Waves, Layers } from 'lucide-react';
import { useEffect, useState, type ReactNode } from 'react';
import { COIN_INFO, COIN_MARKET, MINEABLE, MINEABLE_COIN_IDS } from '../../config/altcoins';
import { NETWORK_EVENTS, POOL_ORDER, POOLS, levelFromEarnings } from '../../config/gameBalance';
import { sprites } from '../../engine/SpriteManager';
import { useT } from '../../i18n';
import { useGameShallow, useGameStore } from '../../store/useGameStore';
import type { PoolMode, PoolScheme } from '../../types/economy';
import { bnToNumber } from '../../utils/bignum';
import { cn } from '../../utils/cn';
import { formatCash, formatDuration, formatHashrate, formatNumber, formatPrice } from '../../utils/formatters';
import { SpriteImg } from '../ui/SpriteImg';

const SCHEME_LABEL: Record<PoolScheme, string> = { pps: 'PPS', pplns: 'PPLNS', solo: 'SOLO' };
const SCHEME_HELP: Record<PoolScheme, string> = {
  pps: 'Pay Per Share: a steady payout every tick.',
  pplns: 'Pay Per Last N Shares: paid when the pool finds a block, with the luck of that block.',
  solo: 'Solo: nothing until you find a block yourself, then a jackpot.',
};

const POOL_ICON: Record<PoolMode, ReactNode> = {
  public: <Waves size={16} />,
  pplns: <Layers size={16} />,
  solo: <Sparkles size={16} />,
  darknet: <ShieldAlert size={16} />,
};

export function PoolsPanel() {
  const t = useT();
  const s = useGameShallow((st) => ({
    pool: st.pool,
    lifetime: st.lifetimeEarnings,
    live: st.live,
    event: st.event,
    nextEventAt: st.nextEventAt,
    stats: st.stats,
    minedCoin: st.minedCoin,
    market: st.market,
    poolPending: st.poolPending,
  }));
  const setPool = useGameStore((st) => st.setPool);
  const setMinedCoin = useGameStore((st) => st.setMinedCoin);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  const level = levelFromEarnings(bnToNumber(s.lifetime));
  const event = s.event ? NETWORK_EVENTS[s.event.id] : null;

  return (
    <div className="flex flex-col gap-3">
      <h3 className="font-pixel text-[9px] text-neon">{t('MINING POOL')}</h3>
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
                {t(p.name)} {active && `● ${t('ACTIVE')}`}
              </span>
              <span className="ml-2 px-1 font-pixel text-[7px] text-void" style={{ background: p.color }} title={t(SCHEME_HELP[p.scheme])}>
                {SCHEME_LABEL[p.scheme]}
              </span>
              <span className="ml-1 font-silk text-[9px] uppercase text-dim">{t(p.scheme === 'pps' ? 'low variance' : p.scheme === 'pplns' ? 'medium variance' : 'high variance')}</span>
              <span className="block text-ink/90">{t(p.tagline)} — {t(p.description)}</span>
              <span className="block text-dim">
                {[
                  t('Yield x{mul}', { mul: p.payoutMul }),
                  ...(active && p.scheme === 'pplns' ? [t('pending {amount} ${coin}', { amount: formatNumber(s.poolPending, 3), coin: s.minedCoin })] : []),
                  ...(p.fee ? [t('fee {pct}%', { pct: (p.fee * 100).toFixed(0) })] : []),
                  ...(locked ? [t('unlocks at LV {lv}', { lv: p.unlockLevel })] : []),
                ].join(' · ')}
              </span>
            </span>
          </button>
        );
      })}

      <h3 className="mt-1 font-pixel text-[9px] text-neon">{t('MINED COIN')}</h3>
      <p className="text-[16px] leading-tight text-dim">{t('Your farm mines one coin at a time and every pool pays it. Each coin has its own price, wallet and market.')}</p>
      {MINEABLE_COIN_IDS.map((id) => {
        const info = COIN_INFO[id];
        const y = s.live.yields[id];
        const m = s.market[id];
        const first = m.candles[0]?.o ?? m.price;
        const change = m.price / first - 1;
        const active = s.minedCoin === id;
        const cfg = COIN_MARKET[id];
        const swing = cfg.sigma >= 0.04 ? t('volatile') : cfg.sigma <= 0.012 ? t('steady') : t('balanced');
        return (
          <button
            key={id}
            type="button"
            onClick={() => setMinedCoin(id)}
            data-testid={`mine-${id}`}
            aria-pressed={active}
            className={cn('flex gap-3 p-2 text-left transition-colors', active ? 'bg-panel-3' : 'bg-panel-2 hover:bg-panel-3')}
            style={{ boxShadow: active ? `inset 0 0 0 2px ${info.color}` : undefined }}
          >
            <SpriteImg src={sprites.coinIcon(id)} width={28} height={28} alt="" className="mt-0.5 shrink-0 self-start" />
            <span className="flex-1 text-[16px] leading-tight">
              <span className="font-pixel text-[9px]" style={{ color: info.color }}>
                {t(info.name)} (${id}) {active && `● ${t('MINING')}`}
              </span>
              <span className="block text-ink/90">{t(info.blurb)}</span>
              <span className="block text-dim">
                {[
                  `${formatPrice(m.price)} ${change >= 0 ? '▲' : '▼'}${Math.abs(change * 100).toFixed(1)}%`,
                  t('{amount} ${coin}/s ≈ {value}/s', { amount: formatNumber(y.perSec, 3), coin: id, value: formatCash(y.valuePerSec) }),
                  t('difficulty x{d}', { d: y.difficulty.toFixed(2) }),
                  t('yield x{mul}', { mul: MINEABLE[id].valueMul }),
                  swing,
                ].join(' · ')}
              </span>
            </span>
          </button>
        );
      })}

      <h3 className="mt-1 font-pixel text-[9px] text-neon">{t('BLOCKCHAIN NETWORK')}</h3>
      <div className="grid grid-cols-2 gap-2 bg-panel-2 p-2 text-[16px] leading-tight">
        <span className="text-dim">{t('Your hashrate')}</span>
        <span className="text-lime">{formatHashrate(s.live.totalHash)}</span>
        <span className="text-dim">{t('Difficulty')}</span>
        <span className={s.live.difficulty > 1 ? 'text-hot' : ''}>x{s.live.difficulty.toFixed(2)}</span>
        <span className="text-dim">{t('Expected yield')}</span>
        <span>{formatNumber(s.live.coinPerSec, 3)} ${s.minedCoin}/s</span>
        <span className="text-dim">{t('Blocks found')}</span>
        <span className="text-gold">{s.stats.blocksFound}</span>
        <span className="text-dim">{t('Raids survived')}</span>
        <span className="text-hot">{s.stats.raids}</span>
        <span className="text-dim">{t('Overheats')}</span>
        <span>{s.stats.overheats}</span>
      </div>
      <div className="flex items-center gap-2 bg-panel-2 p-2 text-[16px] leading-tight">
        <Radio size={14} className={event ? 'blink' : 'text-dim'} style={{ color: event?.color }} />
        {event ? (
          <span>
            <span style={{ color: event.color }}>{t(event.name)}</span> — {t(event.description)} ({t('{time} left', { time: formatDuration(((s.event?.endsAt ?? now) - now) / 1000) })})
          </span>
        ) : (
          <span className="text-dim">{t('No active event. Next network event in ~{time}.', { time: formatDuration(Math.max(0, s.nextEventAt - now) / 1000) })}</span>
        )}
      </div>
    </div>
  );
}
