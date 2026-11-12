import { Bot, BrainCircuit, Crown, Gem, Pause, Play, TrendingUp } from 'lucide-react';
import type { ReactNode } from 'react';
import { AUTOPILOT, AUTOPILOT_PLANS } from '../../config/autopilot';
import { MARKET, VIP_COSTS } from '../../config/gameBalance';
import { logLine } from '../../store/logLine';
import { formatCash, formatDuration } from '../../utils/formatters';
import { useLang, useT } from '../../i18n';
import { sprites } from '../../engine/SpriteManager';
import { useGameShallow, useGameStore } from '../../store/useGameStore';
import { PixelButton } from '../ui/PixelButton';
import { SpriteImg } from '../ui/SpriteImg';

function VipCard({ icon, title, desc, cost, owned, onBuy, gems, extra }: { icon: ReactNode; title: string; desc: string; cost: number; owned: string | null; onBuy: () => void; gems: number; extra?: ReactNode }) {
  const t = useT();
  return (
    <div className="flex items-center gap-3 bg-[#1f1503] p-2 shadow-[inset_0_0_0_2px_#a16207]">
      <div className="grid w-12 shrink-0 place-items-center text-gold">{icon}</div>
      <div className="flex-1 text-[16px] leading-tight">
        <div className="gold-shimmer font-pixel text-[9px]">{title}</div>
        <div className="text-amber/80">{desc}</div>
        {extra}
      </div>
      <PixelButton size="xs" variant="gold" disabled={!!owned || gems < cost} onClick={onBuy} className="flex-col gap-0.5">
        <span>{owned ?? t('Unlock')}</span>
        {!owned && (
          <span className="flex items-center gap-1 font-term text-[15px]">
            <Gem size={10} /> {cost}
          </span>
        )}
      </PixelButton>
    </div>
  );
}

/** AI Farm Manager: buy time with gems, see what it is doing, pause it. */
function AutopilotCard() {
  const t = useT();
  const lang = useLang();
  const s = useGameShallow((st) => ({ gems: st.gems, autopilot: st.autopilot, status: st.autopilotStatus }));
  const { buyAutopilot, setAutopilotPaused, setAutopilotAutoHalving } = useGameStore.getState();
  const left = s.autopilot.remainingSec;
  const on = left > 0;
  return (
    <div className="bg-[#04141a] p-2 shadow-[inset_0_0_0_2px_#22d3ee]" data-testid="autopilot-card">
      <div className="flex items-center gap-3">
        <div className={`grid w-12 shrink-0 place-items-center text-neon ${on && !s.autopilot.paused ? 'blink' : ''}`}>
          <Bot size={30} />
        </div>
        <div className="flex-1 text-[16px] leading-tight">
          <div className="font-pixel text-[9px] text-neon">{t('AI FARM MANAGER')}</div>
          <div className="text-[#a5f3fc]/80">
            {t('Runs the whole farm for you: sells coins, picks the best coin, buys and mounts hardware, rooms and research, keeps everything cool and maintained, and claims every reward.')}
          </div>
        </div>
      </div>
      <div className="mt-2 grid grid-cols-3 gap-1">
        {AUTOPILOT_PLANS.map((p) => (
          <PixelButton
            key={p.id}
            size="xs"
            variant="primary"
            disabled={s.gems < p.gems || left + p.seconds > AUTOPILOT.maxSeconds}
            onClick={() => buyAutopilot(p.id)}
            className="flex-col gap-0.5"
            data-testid={`autopilot-buy-${p.id}`}
            silent
          >
            <span>{on ? `+${t(p.label)}` : t(p.label)}</span>
            <span className="flex items-center gap-1 font-term text-[15px]">
              <Gem size={10} /> {p.gems}
            </span>
          </PixelButton>
        ))}
      </div>
      <label className="mt-2 flex items-start gap-2 text-[15px] leading-tight text-[#a5f3fc]">
        <input type="checkbox" className="mt-1" checked={s.autopilot.autoHalving} onChange={(e) => setAutopilotAutoHalving(e.target.checked)} data-testid="autopilot-halving" />
        <span>
          {t('Automatic Halving (optional)')}
          <span className="block text-dim">
            {t('While it works, it does The Halving when waiting for the next $SC would lower your $SC per hour, then spends the $SC on the cheapest talents. This resets the run: leave it off to decide yourself.')}
          </span>
        </span>
      </label>
      {on ? (
        <div className="mt-2 bg-black/40 p-2 text-[16px] leading-tight" data-testid="autopilot-status">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className={s.autopilot.paused ? 'text-amber' : 'text-lime'}>
              {s.autopilot.paused ? t('Paused · {time} left', { time: formatDuration(Math.ceil(left)) }) : t('Working · {time} left', { time: formatDuration(Math.ceil(left)) })}
            </span>
            <PixelButton size="xs" variant="ghost" icon={s.autopilot.paused ? <Play size={10} /> : <Pause size={10} />} onClick={() => setAutopilotPaused(!s.autopilot.paused)} data-testid="autopilot-pause">
              {s.autopilot.paused ? t('Resume') : t('Pause')}
            </PixelButton>
          </div>
          {s.status && !s.autopilot.paused && (
            <>
              <div className="mt-1 text-[#a5f3fc]">{logLine({ text: '', key: s.status.key, params: s.status.params }, lang)}</div>
              {s.status.progress !== undefined && (
                <div className="mt-1 h-2 bg-black" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(s.status.progress * 100)}>
                  <div className="h-full bg-neon transition-[width] duration-500" style={{ width: `${s.status.progress * 100}%` }} />
                </div>
              )}
            </>
          )}
          <div className="mt-1 text-[15px] text-dim">
            {t('{n} purchases · {spent} invested', { n: s.autopilot.purchases, spent: formatCash(s.autopilot.spent) })}
          </div>
        </div>
      ) : (
        <div className="mt-2 text-[15px] text-dim">
          {t('Its time only runs while the game is open, and stops while paused. It never spends gems, and it only touches The Halving and your $SC if you tick the option above.')}
        </div>
      )}
    </div>
  );
}

/** Gem-powered VIP zone: Gold Edition racks and automations. */
export function VipPanel() {
  const t = useT();
  const s = useGameShallow((st) => ({ gems: st.gems, vip: st.vip }));
  const { buyVip, setAutoSellEnabled } = useGameStore.getState();
  const goldLeft = VIP_COSTS.maxGoldRacks - s.vip.goldRacksBought;
  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between bg-[#2a0f2e] p-2 shadow-[inset_0_0_0_2px_#e879f9]">
        <span className="flex items-center gap-2 font-pixel text-[10px] text-magenta">
          <Crown size={16} /> {t('VIP ZONE')}
        </span>
        <span className="flex items-center gap-1 font-pixel text-[11px] text-magenta">
          <Gem size={14} /> {s.gems}
        </span>
      </div>
      <p className="text-[16px] leading-tight text-dim">{t('Gems drop from achievements, solo-mined blocks and every Halving (+5).')}</p>
      <AutopilotCard />
      <VipCard
        icon={<SpriteImg src={sprites.rackIcon('gold')} width={25} height={40} alt={t('Gold rack')} />}
        title={t('Gold Edition Rack')}
        desc={t('8 slots, built-in reactor: zero electricity bill, no PSU needed and 50% less heat. Survives the Halving.')}
        cost={VIP_COSTS.goldRack}
        owned={goldLeft <= 0 ? t('SOLD OUT') : null}
        gems={s.gems}
        onBuy={() => buyVip('goldRack')}
        extra={<div className="text-[15px] text-dim">{t('{n}/{max} owned', { n: s.vip.goldRacksBought, max: VIP_COSTS.maxGoldRacks })}</div>}
      />
      <VipCard
        icon={<BrainCircuit size={28} />}
        title={t('AI Self-Diagnostics')}
        desc={t('Adds F9 Auto-Tune to every BIOS: a safe overclock profile with zero crash risk.')}
        cost={VIP_COSTS.aiDiagnostics}
        owned={s.vip.aiDiagnostics ? t('OWNED') : null}
        gems={s.gems}
        onBuy={() => buyVip('aiDiagnostics')}
      />
      <VipCard
        icon={<TrendingUp size={28} />}
        title={t('Peak Auto-Seller')}
        desc={t('Sells all $CC automatically whenever the price spikes above {x}x.', { x: MARKET.vipPeakThreshold })}
        cost={VIP_COSTS.autoSellPeaks}
        owned={s.vip.autoSellPeaks ? t('OWNED') : null}
        gems={s.gems}
        onBuy={() => buyVip('autoSellPeaks')}
        extra={
          s.vip.autoSellPeaks ? (
            <label className="mt-1 flex items-center gap-2 text-[15px] text-gold">
              <input type="checkbox" checked={s.vip.autoSellEnabled} onChange={(e) => setAutoSellEnabled(e.target.checked)} /> {t('Enabled')}
            </label>
          ) : null
        }
      />
    </div>
  );
}
