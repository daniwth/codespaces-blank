import { Cable, Cpu, Fan, Gauge, PackageOpen, Plug, Trash2, Wand2, Warehouse, Wrench } from 'lucide-react';
import { useMemo, useState, type DragEvent } from 'react';
import { COOLER_BY_ID, GPU_BY_ID, PSU_BY_ID, QUALITY_DEFS, RACK_BY_ID } from '../../config/hardwareCatalog';
import { ROOM_BY_ID } from '../../config/roomsCatalog';
import { sprites } from '../../engine/SpriteManager';
import { PHYSICS } from '../../config/gameBalance';
import { rackNominalLoad } from '../../store/gamePhysics';
import { repairCost, repasteCost } from '../../store/slices/hardwareSlice';
import { useGameShallow, useGameStore } from '../../store/useGameStore';
import type { GpuInstance } from '../../types/hardware';
import { cn } from '../../utils/cn';
import { formatCash, formatHashrate, formatMultiplier, formatPercent, formatPower, formatTemp, tempColor } from '../../utils/formatters';
import { Meter } from '../ui/Meter';
import { PixelButton } from '../ui/PixelButton';
import { PixelModal } from '../ui/PixelModal';
import { SpriteImg } from '../ui/SpriteImg';
import { CoolerSprite, GpuSprite } from './GpuSprite';

type Kind = 'gpu' | 'cooler' | 'psu';
type InvTab = Kind;

interface Selection {
  kind: Kind;
  uid: string;
}

export function QualityBadge({ quality }: { quality: GpuInstance['quality'] }) {
  const q = QUALITY_DEFS[quality];
  return (
    <span className="px-1 font-pixel text-[7px] uppercase" style={{ color: q.color, boxShadow: `inset 0 0 0 1px ${q.color}`, background: `${q.glow}55` }}>
      {q.label}
    </span>
  );
}

const STATUS_COPY: Record<string, { text: string; color: string }> = {
  online: { text: 'ONLINE', color: '#a3e635' },
  overheat: { text: 'OVERHEAT — ALL GPUS SHUT DOWN', color: '#f43f5e' },
  empty: { text: 'NO GPUS', color: '#8f89c4' },
  no_psu: { text: 'NO PSU INSTALLED', color: '#fbbf24' },
  overload: { text: 'PSU OVERLOAD — TRIPPED', color: '#f43f5e' },
  rebooting: { text: 'REBOOTING…', color: '#60a5fa' },
  blackout: { text: 'GRID BLACKOUT', color: '#94a3b8' },
  stored: { text: 'IN STORAGE', color: '#8f89c4' },
};

/** Physical assembly view: PCIe slots, fan bays, PSU and power cabling. */
export function RackDetailModal({ rackUid }: { rackUid: string }) {
  const s = useGameShallow((st) => ({
    rack: st.racks[rackUid],
    racks: st.racks,
    gpus: st.gpus,
    psus: st.psus,
    coolers: st.coolers,
    live: st.live,
  }));
  const actions = useGameStore.getState();
  const [sel, setSel] = useState<Selection | null>(null);
  const [tab, setTab] = useState<InvTab>('gpu');
  const [dragOver, setDragOver] = useState<string | null>(null);

  const mounted = useMemo(() => {
    const set = new Set<string>();
    Object.values(s.racks).forEach((r) => {
      r.gpuSlots.forEach((u) => u && set.add(u));
      r.fanSlots.forEach((u) => u && set.add(u));
      if (r.psuUid) set.add(r.psuUid);
    });
    return set;
  }, [s.racks]);

  if (!s.rack) return null;
  const rack = s.rack;
  const model = RACK_BY_ID[rack.modelId];
  const rackLive = s.live.racks[rack.uid];
  const status = rackLive?.status ?? (rack.roomId ? 'empty' : 'stored');
  const powered = status === 'online' || status === 'overheat';
  const nominal = rackNominalLoad(rack, s);
  const psu = rack.psuUid ? s.psus[rack.psuUid] : undefined;
  const psuModel = psu ? PSU_BY_ID[psu.modelId] : undefined;
  const capacity = model.selfPowered ? Number.POSITIVE_INFINITY : psuModel?.capacity ?? 0;
  const gpuCount = rack.gpuSlots.filter(Boolean).length;
  const fanK = rack.fanSlots.reduce((a, u) => a + (u && s.coolers[u] ? COOLER_BY_ID[s.coolers[u].modelId].cooling : 0), 0);
  const perGpuK = gpuCount ? PHYSICS.baseCooling + fanK / gpuCount : 0;

  const freeGpus = Object.values(s.gpus).filter((g) => !mounted.has(g.uid)).sort((a, b) => GPU_BY_ID[b.modelId].hashrate - GPU_BY_ID[a.modelId].hashrate);
  const freeCoolers = Object.values(s.coolers).filter((c) => !mounted.has(c.uid)).sort((a, b) => COOLER_BY_ID[b.modelId].cooling - COOLER_BY_ID[a.modelId].cooling);
  const freePsus = Object.values(s.psus).filter((p) => !mounted.has(p.uid)).sort((a, b) => PSU_BY_ID[b.modelId].capacity - PSU_BY_ID[a.modelId].capacity);

  const install = (kind: Kind, uid: string, slot: number) => {
    if (kind === 'gpu') actions.installGpu(rack.uid, slot, uid);
    else if (kind === 'cooler') actions.installCooler(rack.uid, slot, uid);
    else actions.installPsu(rack.uid, uid);
    setSel(null);
  };

  const slotHandlers = (kind: Kind, slot: number) => ({
    onDragOver: (e: DragEvent) => {
      if (e.dataTransfer.types.includes(`application/x-${kind}`)) {
        e.preventDefault();
        setDragOver(`${kind}:${slot}`);
      }
    },
    onDragLeave: () => setDragOver(null),
    onDrop: (e: DragEvent) => {
      const uid = e.dataTransfer.getData(`application/x-${kind}`);
      setDragOver(null);
      if (uid) install(kind, uid, slot);
    },
    onClick: () => {
      if (sel && sel.kind === kind) install(kind, sel.uid, slot);
    },
  });

  const dragProps = (kind: Kind, uid: string) => ({
    draggable: true,
    onDragStart: (e: DragEvent) => {
      e.dataTransfer.setData(`application/x-${kind}`, uid);
      e.dataTransfer.effectAllowed = 'move';
      setSel({ kind, uid });
    },
    onClick: () => setSel((cur) => (cur?.uid === uid ? null : { kind, uid })),
  });

  const waiting = (kind: Kind) => sel?.kind === kind;
  const loadRatio = Number.isFinite(capacity) && capacity > 0 ? nominal / capacity : 0;
  const statusCopy = STATUS_COPY[status] ?? STATUS_COPY.empty;

  return (
    <PixelModal
      title={
        <span className="flex items-center gap-2">
          <Warehouse size={14} /> {model.name}
          <span className="font-silk text-[10px] text-dim">{rack.roomId ? `${ROOM_BY_ID[rack.roomId].name} · pad ${(rack.pad ?? 0) + 1}` : 'storage'}</span>
        </span>
      }
      onClose={() => actions.selectRack(null)}
      className="max-w-5xl"
      accent={model.vip ? '#facc15' : '#22d3ee'}
    >
      <div className="grid gap-4 lg:grid-cols-[1.35fr_1fr]">
        {/* ── Rack assembly ── */}
        <div className="flex flex-col gap-3">
          <div className="grid grid-cols-2 gap-2 bg-panel-2 p-2 text-[17px] leading-tight sm:grid-cols-4">
            <div>
              <div className="font-silk text-[9px] text-dim">STATUS</div>
              <div className={cn('font-pixel text-[9px]', !powered && 'blink')} style={{ color: statusCopy.color }}>
                {statusCopy.text}
              </div>
            </div>
            <div>
              <div className="font-silk text-[9px] text-dim">HASHRATE</div>
              <div className="text-lime">{formatHashrate(rackLive?.hash ?? 0)}</div>
            </div>
            <div>
              <div className="font-silk text-[9px] text-dim">COOLING / GPU</div>
              <div className="text-neon">{perGpuK.toFixed(1)} W/°C</div>
            </div>
            <div>
              <div className="font-silk text-[9px] text-dim">WALL DRAW</div>
              <div className="text-amber">{model.selfPowered ? '0 W (gold)' : formatPower(rackLive?.wall ?? 0)}</div>
              {!model.selfPowered && (rackLive?.powerCost ?? 0) > 0 && (
                <div className="text-[14px] leading-none text-dim" title="Grid demand: dense, high-hash GPUs are billed at a higher rate per watt.">
                  -{formatCash(rackLive?.powerCost ?? 0)}/s · grid {formatMultiplier(rackLive?.tariff ?? 1)}
                </div>
              )}
            </div>
          </div>

          <div className="flex items-center gap-2 text-[16px]">
            <Gauge size={14} className="text-amber" />
            <span className="w-24 font-silk text-[9px] text-dim">PSU LOAD</span>
            <Meter value={nominal} max={Number.isFinite(capacity) ? capacity : nominal * 3 || 1} color="#fbbf24" className="flex-1" />
            <span className={cn('w-36 text-right', loadRatio > 1 && 'text-hot')}>
              {formatPower(nominal)} / {Number.isFinite(capacity) ? formatPower(capacity) : '∞'}
            </span>
          </div>
          {loadRatio > 1 && <div className="blink font-pixel text-[8px] text-hot">⚠ The PSU can't feed this rack. Install a bigger PSU or remove GPUs.</div>}

          {/* GPU slots with power cabling */}
          <div className="relative pl-6">
            <div className="absolute bottom-0 left-2 top-2 w-1" style={{ background: powered ? '#facc15' : '#3f3f46', boxShadow: powered ? '0 0 6px #facc15' : undefined }} />
            <div className="mb-1 flex items-center gap-1 font-silk text-[10px] text-dim">
              <Cpu size={12} /> PCIE SLOTS ({gpuCount}/{model.slots})
            </div>
            <div className="flex flex-col gap-1.5">
              {rack.gpuSlots.map((uid, i) => {
                const g = uid ? s.gpus[uid] : undefined;
                const handlers = slotHandlers('gpu', i);
                const over = dragOver === `gpu:${i}`;
                return (
                  <div key={i} className="relative">
                    <div
                      className={cn('absolute -left-4 top-1/2 h-1 w-4', g && powered && 'cable-flow')}
                      style={{ background: g ? (powered ? '#facc15' : '#52525b') : '#27272a' }}
                    />
                    {g ? (
                      <GpuRow gpu={g} rackUid={rack.uid} slot={i} live={s.live.gpus[g.uid]} />
                    ) : (
                      <button
                        type="button"
                        {...handlers}
                        className={cn(
                          'flex h-12 w-full items-center justify-center gap-2 border-2 border-dashed text-[17px]',
                          over || waiting('gpu') ? 'border-neon bg-neon/10 text-neon' : 'border-edge text-dim',
                        )}
                      >
                        <PackageOpen size={14} /> {waiting('gpu') ? 'Click to install selected GPU' : `Empty PCIe x16 slot #${i + 1}`}
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          {/* Fans */}
          <div>
            <div className="mb-1 flex items-center gap-1 font-silk text-[10px] text-dim">
              <Fan size={12} /> COOLING BAYS · total {fanK.toFixed(1)} W/°C
            </div>
            <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
              {rack.fanSlots.map((uid, i) => {
                const c = uid ? s.coolers[uid] : undefined;
                const cm = c ? COOLER_BY_ID[c.modelId] : undefined;
                const over = dragOver === `cooler:${i}`;
                return c && cm ? (
                  <div key={i} className="flex items-center gap-2 bg-panel-2 p-1.5">
                    <CoolerSprite modelId={cm.id} spinning={powered} scale={2} />
                    <div className="min-w-0 flex-1 text-[15px] leading-tight">
                      <div className="truncate">{cm.name}</div>
                      <div className="text-neon">{cm.cooling} W/°C</div>
                    </div>
                    <button type="button" className="text-dim hover:text-hot" onClick={() => actions.uninstallSlot(rack.uid, 'cooler', i)} aria-label="Remove cooler">
                      <Trash2 size={13} />
                    </button>
                  </div>
                ) : (
                  <button
                    key={i}
                    type="button"
                    {...slotHandlers('cooler', i)}
                    className={cn('flex h-12 items-center justify-center border-2 border-dashed text-[15px]', over || waiting('cooler') ? 'border-neon bg-neon/10 text-neon' : 'border-edge text-dim')}
                  >
                    {waiting('cooler') ? 'Install here' : `Fan bay ${i + 1}`}
                  </button>
                );
              })}
            </div>
          </div>

          {/* PSU */}
          <div>
            <div className="mb-1 flex items-center gap-1 font-silk text-[10px] text-dim">
              <Plug size={12} /> POWER SUPPLY
            </div>
            {model.selfPowered ? (
              <div className="gold-shimmer bg-panel-2 p-2 font-pixel text-[9px]">★ BUILT-IN MICRO REACTOR — ZERO ELECTRICITY ★</div>
            ) : psu && psuModel ? (
              <div className="flex items-center gap-3 bg-panel-2 p-2">
                <SpriteImg src={sprites.psuIcon(psuModel.id)} width={84} height={30} alt={psuModel.name} />
                <div className="flex-1 text-[16px] leading-tight">
                  <div>{psuModel.name}</div>
                  <div className="text-dim">
                    {formatPower(psuModel.capacity)} · {formatPercent(psuModel.efficiency)} efficiency
                  </div>
                </div>
                <span className="size-2.5" style={{ background: powered ? '#22c55e' : status === 'overload' ? '#ef4444' : '#3f3f46', boxShadow: powered ? '0 0 6px #22c55e' : undefined }} />
                <button type="button" className="text-dim hover:text-hot" onClick={() => actions.uninstallSlot(rack.uid, 'psu', 0)} aria-label="Remove PSU">
                  <Trash2 size={13} />
                </button>
              </div>
            ) : (
              <button
                type="button"
                {...slotHandlers('psu', 0)}
                className={cn('blink flex h-12 w-full items-center justify-center gap-2 border-2 border-dashed text-[17px]', dragOver === 'psu:0' || waiting('psu') ? 'border-neon text-neon' : 'border-amber text-amber')}
              >
                <Cable size={14} /> {waiting('psu') ? 'Click to install PSU' : 'No PSU — the rack has no power!'}
              </button>
            )}
          </div>

          <div className="flex flex-wrap gap-1 border-t-2 border-[#1b1838] pt-3">
            <PixelButton size="sm" variant="primary" icon={<Wand2 size={12} />} onClick={() => actions.autoFillRack(rack.uid)}>
              Auto-fill
            </PixelButton>
            {rack.roomId && (
              <PixelButton size="sm" onClick={() => { actions.storeRack(rack.uid); actions.selectRack(null); }}>
                Move to storage
              </PixelButton>
            )}
            {!model.vip && (
              <PixelButton
                size="sm"
                variant="danger"
                disabled={gpuCount > 0 || rack.fanSlots.some(Boolean) || !!rack.psuUid}
                onClick={() => actions.sellItem('rack', rack.uid)}
                title="Empty the rack to sell it"
              >
                Sell rack ({formatCash(model.price / 2)})
              </PixelButton>
            )}
          </div>
        </div>

        {/* ── Inventory ── */}
        <div className="flex min-h-0 flex-col gap-2">
          <div className="flex gap-1">
            {(['gpu', 'cooler', 'psu'] as const).map((k) => (
              <PixelButton key={k} size="xs" variant={tab === k ? 'primary' : 'secondary'} onClick={() => setTab(k)} silent>
                {k === 'gpu' ? `GPUs (${freeGpus.length})` : k === 'cooler' ? `Cooling (${freeCoolers.length})` : `PSUs (${freePsus.length})`}
              </PixelButton>
            ))}
          </div>
          <p className="text-[15px] leading-tight text-dim">Drag a part onto a slot, or click it and then click the slot.</p>
          <div className="retro-scroll flex max-h-[52vh] flex-col gap-1 overflow-y-auto pr-1">
            {tab === 'gpu' &&
              (freeGpus.length ? freeGpus.map((g) => {
                const gm = GPU_BY_ID[g.modelId];
                return (
                  <div key={g.uid} {...dragProps('gpu', g.uid)} className={cn('flex cursor-grab items-center gap-2 bg-panel-2 p-1.5 active:cursor-grabbing', sel?.uid === g.uid && 'shadow-[inset_0_0_0_2px_#22d3ee]')}>
                    <SpriteImg src={sprites.gpuIcon(gm.id)} width={72} alt={gm.name} />
                    <div className="min-w-0 flex-1 text-[15px] leading-tight">
                      <div className="truncate">{gm.brand} {gm.name}</div>
                      <div className="flex items-center gap-1">
                        <QualityBadge quality={g.quality} />
                        <span className="text-lime">{formatHashrate(gm.hashrate * (1 + g.ocBonus))}</span>
                      </div>
                      <div className="text-dim">{formatPower(gm.power)}{g.wear > 0 ? ` · wear ${formatPercent(g.wear)}` : ''}</div>
                    </div>
                  </div>
                );
              }) : <Empty text="No spare GPUs. Buy some in the Shop." />)}
            {tab === 'cooler' &&
              (freeCoolers.length ? freeCoolers.map((c) => {
                const cm = COOLER_BY_ID[c.modelId];
                return (
                  <div key={c.uid} {...dragProps('cooler', c.uid)} className={cn('flex cursor-grab items-center gap-2 bg-panel-2 p-1.5', sel?.uid === c.uid && 'shadow-[inset_0_0_0_2px_#22d3ee]')}>
                    <SpriteImg src={sprites.coolerIcon(cm.id)} width={36} alt={cm.name} />
                    <div className="flex-1 text-[15px] leading-tight">
                      <div>{cm.name}</div>
                      <div className="text-neon">{cm.cooling} W/°C · {cm.power} W</div>
                    </div>
                  </div>
                );
              }) : <Empty text="No spare coolers." />)}
            {tab === 'psu' &&
              (freePsus.length ? freePsus.map((p) => {
                const pm = PSU_BY_ID[p.modelId];
                return (
                  <div key={p.uid} {...dragProps('psu', p.uid)} className={cn('flex cursor-grab items-center gap-2 bg-panel-2 p-1.5', sel?.uid === p.uid && 'shadow-[inset_0_0_0_2px_#22d3ee]')}>
                    <SpriteImg src={sprites.psuIcon(pm.id)} width={56} height={20} alt={pm.name} />
                    <div className="flex-1 text-[15px] leading-tight">
                      <div>{pm.name}</div>
                      <div className="text-amber">{formatPower(pm.capacity)} · {formatPercent(pm.efficiency)}</div>
                    </div>
                  </div>
                );
              }) : <Empty text="No spare PSUs." />)}
          </div>
          {sel && (
            <PixelButton size="xs" variant="ghost" onClick={() => setSel(null)}>
              Cancel selection
            </PixelButton>
          )}
        </div>
      </div>
    </PixelModal>
  );
}

function Empty({ text }: { text: string }) {
  return <div className="border-2 border-dashed border-edge p-3 text-center text-[16px] text-dim">{text}</div>;
}

function GpuRow({ gpu, rackUid, slot, live }: { gpu: GpuInstance; rackUid: string; slot: number; live?: { hash: number; throttled: boolean; running: boolean } }) {
  const actions = useGameStore.getState();
  const gm = GPU_BY_ID[gpu.modelId];
  const pasteC = repasteCost(gpu);
  const repairC = repairCost(gpu);
  return (
    <div className="flex flex-wrap items-center gap-2 bg-panel-2 p-1.5 sm:flex-nowrap">
      <GpuSprite gpuUid={gpu.uid} scale={2} />
      <div className="min-w-0 flex-1 text-[15px] leading-tight">
        <div className="flex items-center gap-1 truncate">
          <span className="truncate">{gm.brand} {gm.name}</span>
          <QualityBadge quality={gpu.quality} />
        </div>
        <div className="flex flex-wrap gap-x-2">
          <span style={{ color: tempColor(gpu.temp) }}>{formatTemp(gpu.temp)}</span>
          <span className="text-lime">{formatHashrate(live?.hash ?? 0)}</span>
          {gpu.ocBonus !== 0 && <span className="text-magenta">OC {gpu.ocBonus > 0 ? '+' : ''}{(gpu.ocBonus * 100).toFixed(0)}%</span>}
          {live?.throttled && <span className="blink text-hot">THROTTLED</span>}
          {gpu.shutdown && <span className="blink text-hot">SHUTDOWN</span>}
        </div>
        <div className="flex items-center gap-2 text-dim">
          <span>paste</span>
          <div className="h-1.5 w-12 bg-[#0b0a18]">
            <div className="h-full" style={{ width: `${gpu.paste * 100}%`, background: gpu.paste > 0.5 ? '#a3e635' : gpu.paste > 0.2 ? '#fbbf24' : '#f43f5e' }} />
          </div>
          {gpu.wear > 0 && <span className="text-hot">wear -{formatPercent(gpu.wear, 1)}</span>}
        </div>
      </div>
      <div className="flex flex-wrap gap-0.5">
        <PixelButton size="xs" variant="gold" onClick={() => actions.openBios(gpu.uid)} title="Overclock in the BIOS">
          BIOS
        </PixelButton>
        <PixelButton size="xs" onClick={() => actions.repasteGpu(gpu.uid)} disabled={gpu.paste > 0.98} title={`Re-apply thermal paste (${formatCash(pasteC)})`}>
          Paste
        </PixelButton>
        {gpu.wear > 0 && (
          <PixelButton size="xs" variant="success" icon={<Wrench size={10} />} onClick={() => actions.repairGpu(gpu.uid)} title={`Repair silicon wear (${formatCash(repairC)})`}>
            {formatCash(repairC, 0)}
          </PixelButton>
        )}
        <PixelButton size="xs" variant="danger" onClick={() => actions.uninstallSlot(rackUid, 'gpu', slot)} aria-label="Remove GPU">
          <Trash2 size={10} />
        </PixelButton>
      </div>
    </div>
  );
}
