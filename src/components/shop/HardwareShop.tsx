import { Building2, Cpu, Fan, HardHat, Plug, Server } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { COOLER_CATALOG, GPU_CATALOG, MAX_TECHNICIANS, PSU_CATALOG, RACK_CATALOG } from '../../config/hardwareCatalog';
import { ROOM_CATALOG, ROOM_MECHANICS, ROOM_ORDER } from '../../config/roomsCatalog';
import type { RoomId } from '../../types/player';
import { talentModifiers } from '../../config/prestigeTree';
import type { ComponentKind } from '../../store/slices/hardwareSlice';
import { useT } from '../../i18n';
import { sprites } from '../../engine/SpriteManager';
import { gridTariff, poolYieldMul } from '../../store/gamePhysics';
import { gpuEconomics, hardwarePrice, hardwarePriceMul, roomPsuEfficiency } from '../../store/pricing';
import { MAX_BULK } from '../../store/slices/hardwareSlice';
import { runModifiers } from '../../config/modifiers';
import { challengeBlocks } from '../../store/slices/challengesSlice';
import { technicianCost } from '../../store/slices/roomsSlice';
import { useGameShallow, useGameStore } from '../../store/useGameStore';
import { bnGte, bnToNumber } from '../../utils/bignum';
import { cn } from '../../utils/cn';
import { formatCash, formatDuration, formatHashrate, formatMultiplier, formatPercent, formatPower, formatTemp } from '../../utils/formatters';
import { PixelButton } from '../ui/PixelButton';
import { SpriteImg } from '../ui/SpriteImg';
import { SLOT, slotted } from '../panels/richText';

/** One line per room on what makes it play differently (see ROOM_MECHANICS). */
const ROOM_TRAITS: Record<RoomId, string> = {
  bedroom: 'Night noise: loud fans at night halve your overclock bonus.',
  garage: 'Heat waves: every few minutes the ambient climbs +7°C for a while.',
  warehouse: 'Unlocks the Battery Bank: cheaper power at night.',
  arctic: 'Condensation: a card that sat cold and off must pre-heat before it hashes.',
  submarine: 'Abyssal water cools best, but the hull only carries 84 GPUs.',
};

type Category = 'gpu' | 'cooling' | 'power' | 'racks' | 'rooms' | 'crew';
type Qty = 1 | 5 | 10 | 'max';
const QTYS: Qty[] = [1, 5, 10, 'max'];

const CATEGORIES: { id: Category; label: string; icon: ReactNode }[] = [
  { id: 'gpu', label: 'GPUs', icon: <Cpu size={12} /> },
  { id: 'cooling', label: 'Cooling', icon: <Fan size={12} /> },
  { id: 'power', label: 'PSUs', icon: <Plug size={12} /> },
  { id: 'racks', label: 'Racks', icon: <Server size={12} /> },
  { id: 'rooms', label: 'Rooms', icon: <Building2 size={12} /> },
  { id: 'crew', label: 'Crew', icon: <HardHat size={12} /> },
];

function Card({ icon, title, tier, children, price, listPrice, affordable, onBuy, owned, cta, disabled }: {
  icon: ReactNode; title: string; tier?: number; children: ReactNode; price: string; listPrice?: string; affordable: boolean; onBuy: () => void; owned?: number; cta?: string; disabled?: boolean;
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
        {listPrice && <span className="font-term text-[13px] normal-case line-through opacity-70">{listPrice}</span>}
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
    research: st.research,
    event: st.event,
    activeRoom: st.activeRoom,
    minedCoin: st.minedCoin,
    coinPrice: st.market[st.minedCoin].price,
    difficulty: st.live.minedCoin === st.minedCoin ? st.live.difficulty : 1,
    pool: st.pool,
    battery: st.upgrades.battery,
  }));
  const actions = useGameStore.getState();
  const [qty, setQty] = useState<Qty>(1);
  const can = (price: number) => bnGte(s.cash, price);
  const priceMul = hardwarePriceMul(s);
  const cash = bnToNumber(s.cash);
  /** Props of a hardware card for the chosen quantity: unit count, total and struck list price. */
  const deal = (kind: ComponentKind, modelId: string, list: number) => {
    const unit = hardwarePrice(list, s);
    const n = qty === 'max' ? Math.max(1, Math.min(MAX_BULK, Math.floor(cash / unit))) : qty;
    return {
      price: formatCash(unit * n),
      listPrice: priceMul < 1 ? formatCash(list * n) : undefined,
      affordable: can(unit * (qty === 'max' ? 1 : n)),
      cta: n > 1 ? t('Buy x{n}', { n }) : undefined,
      onBuy: () => void actions.buyMany(kind, modelId, n),
    };
  };
  const run = runModifiers(s.talents, s.research.levels);
  /** Net economics of one stock card in the room on screen: mined value minus its real power bill. */
  const economics = (g: (typeof GPU_CATALOG)[number]) =>
    gpuEconomics(g, hardwarePrice(g.price, s), {
      roomId: s.activeRoom,
      hashMul: run.hashMul,
      electricityMul: run.electricityMul,
      psuEfficiency: roomPsuEfficiency(s, s.activeRoom, g.power),
      coin: s.minedCoin,
      coinPrice: s.coinPrice,
      difficulty: s.difficulty,
      poolMul: poolYieldMul(s.pool),
    });
  const bulk = cat === 'gpu' || cat === 'cooling' || cat === 'power' || cat === 'racks';
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

      {bulk && (
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[15px] leading-tight">
          <span className="font-silk text-[10px] uppercase text-dim">{t('Quantity')}</span>
          <span className="flex gap-0.5" role="group" aria-label={t('Quantity')}>
            {QTYS.map((q) => (
              <PixelButton key={q} size="xs" variant={qty === q ? 'gold' : 'secondary'} aria-pressed={qty === q} onClick={() => setQty(q)} data-testid={`qty-${q}`} silent>
                {q === 'max' ? t('MAX') : `x${q}`}
              </PixelButton>
            ))}
          </span>
          {priceMul < 1 && (
            <span className={cn('ml-auto px-1.5 py-0.5 font-pixel text-[8px] text-void', s.event?.id === 'flash_sale' ? 'blink bg-gold' : 'bg-neon')} data-testid="shop-discount">
              {s.event?.id === 'flash_sale' ? t('FLASH SALE -{pct}%', { pct: Math.round((1 - priceMul) * 100) }) : t('-{pct}% hardware', { pct: Math.round((1 - priceMul) * 100) })}
            </span>
          )}
        </div>
      )}

      <div className="flex flex-col gap-1.5">
        {cat === 'gpu' &&
          GPU_CATALOG.map((g) => {
            const eco = economics(g);
            return (
            <Card
              key={g.id}
              icon={<SpriteImg src={sprites.gpuIcon(g.id)} width={84} alt={t(g.name)} />}
              title={`${g.brand} ${t(g.name)}`}
              tier={g.tier}
              owned={count(s.gpus, g.id)}
              {...deal('gpu', g.id, g.price)}
            >
              <div className="text-lime">{formatHashrate(g.hashrate)}</div>
              <div className="text-dim" data-testid={`roi-${g.id}`} title={t('Net ROI: price / (mined value - power bill) for this room, your PSUs, pool and the current coin price.')}>
                {t('{power} · {eff}', { power: formatPower(g.power), eff: formatHashrate(g.hashrate / g.power).replace('/s', '/W') })}
                {' · '}
                {Number.isFinite(eco.roiSec)
                  ? slotted(t('net ROI {x}', { x: SLOT }), <span className="text-lime">{formatDuration(eco.roiSec)}</span>)
                  : <span className="text-hot">{t('net ROI: never (loses money here)')}</span>}
              </div>
              <div className="text-dim" title={t('Estimated power bill of this card in the room on screen, with its grid tariff and the efficiency of your PSUs.')}>
                {slotted(t('power bill ~{x}/s here', { x: SLOT }), <span className="text-hot">{formatCash(eco.powerPerSec)}</span>)}
                {' · '}
                {slotted(t('net {x}/s', { x: SLOT }), <span className={eco.netPerSec > 0 ? 'text-lime' : 'text-hot'}>{formatCash(eco.netPerSec)}</span>)}
              </div>
              <div className="text-dim" title={t('Grid demand: dense, high-hash hardware is billed at a higher rate per watt.')}>
                {slotted(t('grid tariff {x} per watt', { x: SLOT }), <span className="text-amber">{formatMultiplier(gridTariff(g.id))}</span>)}
              </div>
            </Card>
            );
          })}

        {cat === 'cooling' &&
          COOLER_CATALOG.map((c) => (
            <Card
              key={c.id}
              icon={<SpriteImg src={sprites.coolerIcon(c.id)} width={45} alt={t(c.name)} />}
              title={t(c.name)}
              tier={c.tier}
              owned={count(s.coolers, c.id)}
              {...deal('cooler', c.id, c.price)}
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
              owned={count(s.psus, p.id)}
              {...deal('psu', p.id, p.price)}
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
              owned={count(s.racks, r.id)}
              {...deal('rack', r.id, r.price)}
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
                <div className="text-amber" data-testid={`room-trait-${room.id}`}>{t(ROOM_TRAITS[room.id])}</div>
              </Card>
            );
          })}

        {cat === 'rooms' && (
          <Card
            icon={<SpriteImg src={sprites.psuIcon('psu30k')} width={84} height={30} alt="" />}
            title={t('Battery Bank')}
            price={s.battery ? t('OWNED') : formatCash(ROOM_MECHANICS.warehouse.batteryPrice)}
            affordable={!s.battery && s.ownedRooms.includes('warehouse') && can(ROOM_MECHANICS.warehouse.batteryPrice)}
            disabled={s.battery || !s.ownedRooms.includes('warehouse')}
            cta={s.battery ? '✓' : s.ownedRooms.includes('warehouse') ? t('Buy') : t('Locked')}
            onBuy={() => actions.buyRoomUpgrade('battery')}
          >
            <div className="text-dim">{t('Warehouse upgrade: charges at the valley tariff.')}</div>
            <div>{t('Night-time power in the Warehouse costs {pct}% less.', { pct: Math.round((1 - ROOM_MECHANICS.warehouse.valleyMul) * 100) })}</div>
          </Card>
        )}

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
