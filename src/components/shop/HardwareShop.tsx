import { Building2, Cpu, Fan, HardHat, Plug, Server } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { COOLER_CATALOG, GPU_CATALOG, MAX_TECHNICIANS, PSU_CATALOG, RACK_CATALOG } from '../../config/hardwareCatalog';
import { ROOM_CATALOG, ROOM_ORDER } from '../../config/roomsCatalog';
import { talentModifiers } from '../../config/prestigeTree';
import { PHYSICS } from '../../config/gameBalance';
import { useT } from '../../i18n';
import { sprites } from '../../engine/SpriteManager';
import { gridTariff } from '../../store/gamePhysics';
import { challengeBlocks } from '../../store/slices/challengesSlice';
import { technicianCost } from '../../store/slices/roomsSlice';
import { useGameShallow, useGameStore } from '../../store/useGameStore';
import { bnGte } from '../../utils/bignum';
import { cn } from '../../utils/cn';
import { formatCash, formatHashrate, formatMultiplier, formatPercent, formatPower, formatTemp } from '../../utils/formatters';
import { PixelButton } from '../ui/PixelButton';
import { SpriteImg } from '../ui/SpriteImg';
import { SLOT, slotted } from '../panels/richText';

type Category = 'gpu' | 'cooling' | 'power' | 'racks' | 'rooms' | 'crew';

const CATEGORIES: { id: Category; label: string; icon: ReactNode }[] = [
  { id: 'gpu', label: 'GPUs', icon: <Cpu size={12} /> },
  { id: 'cooling', label: 'Cooling', icon: <Fan size={12} /> },
  { id: 'power', label: 'PSUs', icon: <Plug size={12} /> },
  { id: 'racks', label: 'Racks', icon: <Server size={12} /> },
  { id: 'rooms', label: 'Rooms', icon: <Building2 size={12} /> },
  { id: 'crew', label: 'Crew', icon: <HardHat size={12} /> },
];

function Card({ icon, title, tier, children, price, affordable, onBuy, owned, cta, disabled }: {
  icon: ReactNode; title: string; tier?: number; children: ReactNode; price: string; affordable: boolean; onBuy: () => void; owned?: number; cta?: string; disabled?: boolean;
}) {
  const t = useT();
  return (
    <div className={cn('flex items-center gap-3 bg-panel-2 p-2', !affordable && 'opacity-75')}>
      <div className="grid w-[84px] shrink-0 place-items-center">{icon}</div>
      <div className="min-w-0 flex-1 text-[16px] leading-tight">
        <div className="flex items-center gap-1.5">
          <span className="truncate text-ink">{title}</span>
          {tier !== undefined && <span className="font-pixel text-[7px] text-dim">T{tier}</span>}
          {owned ? <span className="font-pixel text-[7px] text-neon">x{owned}</span> : null}
        </div>
        {children}
      </div>
      <PixelButton size="xs" variant={affordable ? 'gold' : 'secondary'} disabled={!affordable || disabled} onClick={onBuy} className="shrink-0 flex-col gap-0.5" silent>
        <span>{cta ?? t('Buy')}</span>
        <span className="font-term text-[15px] normal-case">{price}</span>
      </PixelButton>
    </div>
  );
}

export function HardwareShop() {
  const t = useT();
  const [cat, setCat] = useState<Category>('gpu');
  const s = useGameShallow((st) => ({
    cash: st.cash,
    gpus: st.gpus,
    coolers: st.coolers,
    psus: st.psus,
    racks: st.racks,
    ownedRooms: st.ownedRooms,
    technicians: st.technicians,
    talents: st.talents,
    roomsLocked: challengeBlocks(st, 'singleRoom'),
  }));
  const actions = useGameStore.getState();
  const can = (price: number) => bnGte(s.cash, price);
  const count = <T extends { modelId: string }>(rec: Record<string, T>, id: string) => Object.values(rec).filter((x) => x.modelId === id).length;
  const mods = talentModifiers(s.talents);

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap gap-0.5">
        {CATEGORIES.map((c) => (
          <PixelButton key={c.id} size="xs" variant={cat === c.id ? 'primary' : 'secondary'} icon={c.icon} onClick={() => setCat(c.id)} silent>
            {t(c.label)}
          </PixelButton>
        ))}
      </div>

      <div className="flex flex-col gap-1.5">
        {cat === 'gpu' &&
          GPU_CATALOG.map((g) => (
            <Card
              key={g.id}
              icon={<SpriteImg src={sprites.gpuIcon(g.id)} width={84} alt={t(g.name)} />}
              title={`${g.brand} ${t(g.name)}`}
              tier={g.tier}
              price={formatCash(g.price)}
              affordable={can(g.price)}
              owned={count(s.gpus, g.id)}
              onBuy={() => actions.buyGpu(g.id)}
            >
              <div className="text-lime">{formatHashrate(g.hashrate)}</div>
              <div className="text-dim">
                {t('{power} · {eff} · ROI ~{sec}s', { power: formatPower(g.power), eff: formatHashrate(g.hashrate / g.power).replace('/s', '/W'), sec: Math.round(g.price / ((g.hashrate / 1e6) * PHYSICS.rewardPerMHs)) })}
              </div>
              <div className="text-dim" title={t('Grid demand: dense, high-hash hardware is billed at a higher rate per watt.')}>
                {slotted(t('grid tariff {x} per watt', { x: SLOT }), <span className="text-amber">{formatMultiplier(gridTariff(g.id))}</span>)}
              </div>
            </Card>
          ))}

        {cat === 'cooling' &&
          COOLER_CATALOG.map((c) => (
            <Card
              key={c.id}
              icon={<SpriteImg src={sprites.coolerIcon(c.id)} width={45} alt={t(c.name)} />}
              title={t(c.name)}
              tier={c.tier}
              price={formatCash(c.price)}
              affordable={can(c.price)}
              owned={count(s.coolers, c.id)}
              onBuy={() => actions.buyCooler(c.id)}
            >
              <div className="text-neon">{t('{n} W/°C heat transfer', { n: c.cooling })}</div>
              <div className="text-dim">
                {t('{kind} · {n} W draw', { kind: t(c.kind), n: c.power })}
              </div>
            </Card>
          ))}

        {cat === 'power' &&
          PSU_CATALOG.map((p) => (
            <Card
              key={p.id}
              icon={<SpriteImg src={sprites.psuIcon(p.id)} width={84} height={30} alt={t(p.name)} />}
              title={t(p.name)}
              tier={p.tier}
              price={formatCash(p.price)}
              affordable={can(p.price)}
              owned={count(s.psus, p.id)}
              onBuy={() => actions.buyPsu(p.id)}
            >
              <div className="text-amber">{t('{cap} max load', { cap: formatPower(p.capacity) })}</div>
              <div className="text-dim">{t('{pct} efficiency (wall losses become heat)', { pct: formatPercent(p.efficiency) })}</div>
            </Card>
          ))}

        {cat === 'racks' &&
          RACK_CATALOG.filter((r) => !r.vip).map((r) => (
            <Card
              key={r.id}
              icon={<SpriteImg src={sprites.rackIcon(r.id)} width={30} height={48} alt={t(r.name)} />}
              title={t(r.name)}
              price={formatCash(r.price)}
              affordable={can(r.price)}
              owned={count(s.racks, r.id)}
              onBuy={() => actions.buyRack(r.id)}
            >
              <div className="text-ink">
                {r.fanSlots > 1 ? t('{slots} GPU slots · {bays} fan bays · 1 PSU', { slots: r.slots, bays: r.fanSlots }) : t('{slots} GPU slots · {bays} fan bay · 1 PSU', { slots: r.slots, bays: r.fanSlots })}
              </div>
              <div className="text-dim">{t('Place it on an empty floor pad.')}</div>
            </Card>
          ))}

        {cat === 'rooms' &&
          ROOM_CATALOG.map((room, i) => {
            const owned = s.ownedRooms.includes(room.id);
            const prevOwned = i === 0 || s.ownedRooms.includes(ROOM_ORDER[i - 1]);
            return (
              <Card
                key={room.id}
                icon={<SpriteImg src={sprites.roomIcon(room.id)} width={84} height={48} alt={t(room.name)} />}
                title={t(room.name)}
                price={owned ? t('OWNED') : formatCash(room.price)}
                affordable={!owned && prevOwned && !s.roomsLocked && can(room.price)}
                disabled={owned || !prevOwned || s.roomsLocked}
                cta={owned ? '✓' : s.roomsLocked ? t('Challenge') : prevOwned ? t('Buy') : t('Locked')}
                onBuy={() => actions.buyRoom(room.id)}
              >
                <div className="text-dim">{t(room.subtitle)}</div>
                {s.roomsLocked && !owned && <div className="text-hot">{t('Locked by the Single Room challenge.')}</div>}
                <div>
                  {t('{temp} · {power} line · {pads} pads', { temp: formatTemp(room.ambient), power: formatPower(room.maxPowerW), pads: room.pads + mods.extraPads })}
                </div>
                <div className="text-dim">
                  {t('power x{power} · cooling x{cooling}', { power: room.priceMul, cooling: room.coolingMul })}
                </div>
              </Card>
            );
          })}

        {cat === 'crew' && (
          <Card
            icon={<SpriteImg src={sprites.technician(0, '#22c55e', false).toDataURL()} width={30} height={48} alt={t('Technician')} />}
            title={t('Rig Technician')}
            price={s.technicians >= MAX_TECHNICIANS ? t('MAX') : formatCash(technicianCost(s.technicians, mods.startTechnicians))}
            affordable={s.technicians < MAX_TECHNICIANS && can(technicianCost(s.technicians, mods.startTechnicians))}
            disabled={s.technicians >= MAX_TECHNICIANS}
            owned={s.technicians}
            cta={t('Hire')}
            onBuy={() => actions.hireTechnician()}
          >
            <div>{t('Walks the floor re-applying thermal paste and slowly repairing silicon wear.')}</div>
            <div className="text-dim">
              {t('Crew {n}/{max} · speed x{speed}', { n: s.technicians, max: MAX_TECHNICIANS, speed: mods.techSpeed.toFixed(2) })}
            </div>
          </Card>
        )}
      </div>
    </div>
  );
}
