import { BrainCircuit, Crown, Gem, TrendingUp } from 'lucide-react';
import type { ReactNode } from 'react';
import { MARKET, VIP_COSTS } from '../../config/gameBalance';
import { sprites } from '../../engine/SpriteManager';
import { useGameShallow, useGameStore } from '../../store/useGameStore';
import { PixelButton } from '../ui/PixelButton';
import { SpriteImg } from '../ui/SpriteImg';

function VipCard({ icon, title, desc, cost, owned, onBuy, gems, extra }: { icon: ReactNode; title: string; desc: string; cost: number; owned: string | null; onBuy: () => void; gems: number; extra?: ReactNode }) {
  return (
    <div className="flex items-center gap-3 bg-[#1f1503] p-2 shadow-[inset_0_0_0_2px_#a16207]">
      <div className="grid w-12 shrink-0 place-items-center text-gold">{icon}</div>
      <div className="flex-1 text-[16px] leading-tight">
        <div className="gold-shimmer font-pixel text-[9px]">{title}</div>
        <div className="text-amber/80">{desc}</div>
        {extra}
      </div>
      <PixelButton size="xs" variant="gold" disabled={!!owned || gems < cost} onClick={onBuy} className="flex-col gap-0.5">
        <span>{owned ?? 'Unlock'}</span>
        {!owned && (
          <span className="flex items-center gap-1 font-term text-[15px]">
            <Gem size={10} /> {cost}
          </span>
        )}
      </PixelButton>
    </div>
  );
}

/** Gem-powered VIP zone: Gold Edition racks and automations. */
export function VipPanel() {
  const s = useGameShallow((st) => ({ gems: st.gems, vip: st.vip }));
  const { buyVip, setAutoSellEnabled } = useGameStore.getState();
  const goldLeft = VIP_COSTS.maxGoldRacks - s.vip.goldRacksBought;
  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between bg-[#2a0f2e] p-2 shadow-[inset_0_0_0_2px_#e879f9]">
        <span className="flex items-center gap-2 font-pixel text-[10px] text-magenta">
          <Crown size={16} /> VIP ZONE
        </span>
        <span className="flex items-center gap-1 font-pixel text-[11px] text-magenta">
          <Gem size={14} /> {s.gems}
        </span>
      </div>
      <p className="text-[16px] leading-tight text-dim">Gems drop from achievements, solo-mined blocks and every Halving (+5).</p>
      <VipCard
        icon={<SpriteImg src={sprites.rackIcon('gold')} width={25} height={40} alt="Gold rack" />}
        title="Gold Edition Rack"
        desc="8 slots, built-in reactor: zero electricity bill, no PSU needed and 50% less heat. Survives the Halving."
        cost={VIP_COSTS.goldRack}
        owned={goldLeft <= 0 ? 'SOLD OUT' : null}
        gems={s.gems}
        onBuy={() => buyVip('goldRack')}
        extra={<div className="text-[15px] text-dim">{s.vip.goldRacksBought}/{VIP_COSTS.maxGoldRacks} owned</div>}
      />
      <VipCard
        icon={<BrainCircuit size={28} />}
        title="AI Self-Diagnostics"
        desc="Adds F9 Auto-Tune to every BIOS: a safe overclock profile with zero crash risk."
        cost={VIP_COSTS.aiDiagnostics}
        owned={s.vip.aiDiagnostics ? 'OWNED' : null}
        gems={s.gems}
        onBuy={() => buyVip('aiDiagnostics')}
      />
      <VipCard
        icon={<TrendingUp size={28} />}
        title="Peak Auto-Seller"
        desc={`Sells all $CC automatically whenever the price spikes above ${MARKET.vipPeakThreshold}x.`}
        cost={VIP_COSTS.autoSellPeaks}
        owned={s.vip.autoSellPeaks ? 'OWNED' : null}
        gems={s.gems}
        onBuy={() => buyVip('autoSellPeaks')}
        extra={
          s.vip.autoSellPeaks ? (
            <label className="mt-1 flex items-center gap-2 text-[15px] text-gold">
              <input type="checkbox" checked={s.vip.autoSellEnabled} onChange={(e) => setAutoSellEnabled(e.target.checked)} /> Enabled
            </label>
          ) : null
        }
      />
    </div>
  );
}
