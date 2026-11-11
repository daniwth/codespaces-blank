import { Flame, PaintBucket, Wrench } from 'lucide-react';
import { useMemo } from 'react';
import { COOLER_BY_ID, GPU_BY_ID, PSU_BY_ID, QUALITY_DEFS, RACK_BY_ID } from '../../config/hardwareCatalog';
import { ROOM_BY_ID } from '../../config/roomsCatalog';
import { useT } from '../../i18n';
import { sprites } from '../../engine/SpriteManager';
import { challengeBlocks } from '../../store/slices/challengesSlice';
import { FUSE_COUNT, REPASTE_ALL_BELOW, SELL_REFUND, fusableGroups, repasteCost } from '../../store/slices/hardwareSlice';
import { useGameShallow, useGameStore } from '../../store/useGameStore';
import { formatCash, formatHashrate, formatPower, formatTemp, tempColor } from '../../utils/formatters';
import { QualityBadge } from '../game/RackDetailModal';
import { PixelButton } from '../ui/PixelButton';
import { SpriteImg } from '../ui/SpriteImg';

/** Overview of every rack and the spare parts sitting in storage. */
export function InventoryPanel() {
  const t = useT();
  const s = useGameShallow((st) => ({ racks: st.racks, gpus: st.gpus, psus: st.psus, coolers: st.coolers, live: st.live, forgeClosed: challengeBlocks(st, 'bronzeOnly') }));
  const { selectRack, sellItem, setActiveRoom, autoFillAll, repasteAll, fuseGpus } = useGameStore.getState();

  const mounted = useMemo(() => {
    const set = new Set<string>();
    Object.values(s.racks).forEach((r) => {
      r.gpuSlots.forEach((u) => u && set.add(u));
      r.fanSlots.forEach((u) => u && set.add(u));
      if (r.psuUid) set.add(r.psuUid);
    });
    return set;
  }, [s.racks]);

  const racks = Object.values(s.racks).sort((a, b) => (a.roomId ?? 'zz').localeCompare(b.roomId ?? 'zz') || (a.pad ?? 99) - (b.pad ?? 99));
  const spareGpus = Object.values(s.gpus).filter((g) => !mounted.has(g.uid));
  const spareCoolers = Object.values(s.coolers).filter((c) => !mounted.has(c.uid));
  const sparePsus = Object.values(s.psus).filter((p) => !mounted.has(p.uid));
  const groups = useMemo(() => fusableGroups(s), [s.gpus, s.racks]); // eslint-disable-line react-hooks/exhaustive-deps
  const dry = Object.values(s.gpus).filter((g) => mounted.has(g.uid) && g.paste < REPASTE_ALL_BELOW);
  const dryCost = dry.reduce((a, g) => a + repasteCost(g), 0);
  const spareCount = spareGpus.length + spareCoolers.length + sparePsus.length;

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap gap-1">
        <PixelButton size="xs" variant="primary" icon={<Wrench size={10} />} disabled={spareCount === 0} onClick={() => autoFillAll()} title={t('Mount the best spare parts in every placed rack.')} data-testid="autofill-all" silent>
          {t('Auto-fill all')}
        </PixelButton>
        <PixelButton size="xs" variant="secondary" icon={<PaintBucket size={10} />} disabled={dry.length === 0} onClick={() => repasteAll()} title={t('Re-paste every mounted GPU whose thermal paste is below {pct}%.', { pct: Math.round(REPASTE_ALL_BELOW * 100) })} data-testid="repaste-all" silent>
          {dry.length ? t('Re-paste all ({n} · {price})', { n: dry.length, price: formatCash(dryCost, 0) }) : t('Re-paste all')}
        </PixelButton>
      </div>

      <section>
        <h3 className="mb-1 font-pixel text-[9px] text-neon">{t('RACKS ({n})', { n: racks.length })}</h3>
        <div className="flex flex-col gap-1">
          {racks.map((r) => {
            const m = RACK_BY_ID[r.modelId];
            const live = s.live.racks[r.uid];
            return (
              <button
                key={r.uid}
                type="button"
                onClick={() => {
                  if (r.roomId) setActiveRoom(r.roomId);
                  selectRack(r.uid);
                }}
                className="flex items-center gap-2 bg-panel-2 p-1.5 text-left hover:bg-panel-3"
              >
                <SpriteImg src={sprites.rackIcon(r.modelId)} width={20} height={32} alt="" />
                <div className="min-w-0 flex-1 text-[16px] leading-tight">
                  <div className="truncate">{t(m.name)}</div>
                  <div className="text-dim">{r.roomId ? t('{room} · pad {n}', { room: t(ROOM_BY_ID[r.roomId].name), n: (r.pad ?? 0) + 1 }) : t('In storage — place it from the room view')}</div>
                </div>
                <div className="text-right text-[15px] leading-tight">
                  <div className="text-lime">{formatHashrate(live?.hash ?? 0)}</div>
                  <div style={{ color: tempColor(live?.maxTemp ?? 0) }}>{live && live.maxTemp > 0 ? formatTemp(live.maxTemp) : t((live?.status ?? 'stored').toUpperCase())}</div>
                </div>
              </button>
            );
          })}
        </div>
      </section>

      <section data-testid="forge">
        <h3 className="mb-1 flex items-center gap-2 font-pixel text-[9px] text-[#fb923c]">
          <Flame size={13} /> {t('SILICON FORGE')}
        </h3>
        <p className="mb-1 text-[16px] leading-tight text-dim">
          {t('Melt {n} spare GPUs of the same model and grade into one of the next grade: better silicon overclocks further. The result comes out with fresh paste and no wear.', { n: FUSE_COUNT })}
        </p>
        {s.forgeClosed && <p className="text-[16px] text-hot">{t('Closed during the Bronze Only challenge.')}</p>}
        {groups.length === 0 && !s.forgeClosed && <p className="bg-panel-2 p-1.5 text-[16px] text-dim">{t('No spare GPUs to fuse. Unmount or buy some: only parts outside a rack count.')}</p>}
        <div className="flex flex-col gap-1">
          {groups.map((g) => {
            const gm = GPU_BY_ID[g.modelId];
            const ready = g.count >= FUSE_COUNT && !s.forgeClosed;
            return (
              <div key={`${g.modelId}|${g.quality}`} className="flex items-center gap-2 bg-panel-2 p-1.5 text-[16px] leading-tight" data-testid={`forge-${g.modelId}-${g.quality}`}>
                <SpriteImg src={sprites.gpuIcon(gm.id)} width={60} alt="" />
                <div className="min-w-0 flex-1">
                  <div className="truncate">{t(gm.name)}</div>
                  <div className="flex flex-wrap items-center gap-1">
                    <QualityBadge quality={g.quality} />
                    <span className={ready ? 'text-lime' : 'text-dim'}>{g.count}/{FUSE_COUNT}</span>
                    <span className="text-dim">→</span>
                    <QualityBadge quality={g.next} />
                    <span className="text-dim">{t('+{mhz} MHz core headroom', { mhz: QUALITY_DEFS[g.next].coreHeadroom[1] })}</span>
                  </div>
                </div>
                <PixelButton size="xs" variant={ready ? 'gold' : 'secondary'} disabled={!ready} onClick={() => fuseGpus(g.modelId, g.quality)} silent>
                  {t('Fuse')}
                </PixelButton>
              </div>
            );
          })}
        </div>
      </section>

      <section>
        <h3 className="mb-1 font-pixel text-[9px] text-neon">{t('SPARE PARTS')}</h3>
        {spareCount === 0 && <p className="text-[16px] text-dim">{t('Everything is installed. Buy more in the Shop.')}</p>}
        <div className="flex flex-col gap-1">
          {spareGpus.map((g) => {
            const gm = GPU_BY_ID[g.modelId];
            return (
              <div key={g.uid} className="flex items-center gap-2 bg-panel-2 p-1.5 text-[16px] leading-tight">
                <SpriteImg src={sprites.gpuIcon(gm.id)} width={60} alt="" />
                <div className="min-w-0 flex-1">
                  <div className="truncate">{t(gm.name)}</div>
                  <div className="flex items-center gap-1"><QualityBadge quality={g.quality} /><span className="text-dim">{formatHashrate(gm.hashrate)}</span></div>
                </div>
                <PixelButton size="xs" variant="danger" onClick={() => sellItem('gpu', g.uid)}>
                  {formatCash(gm.price * SELL_REFUND * (1 - g.wear), 0)}
                </PixelButton>
              </div>
            );
          })}
          {spareCoolers.map((c) => {
            const cm = COOLER_BY_ID[c.modelId];
            return (
              <div key={c.uid} className="flex items-center gap-2 bg-panel-2 p-1.5 text-[16px] leading-tight">
                <SpriteImg src={sprites.coolerIcon(cm.id)} width={27} alt="" />
                <div className="flex-1">{t(cm.name)} <span className="text-neon">{cm.cooling} W/°C</span></div>
                <PixelButton size="xs" variant="danger" onClick={() => sellItem('cooler', c.uid)}>
                  {formatCash(cm.price * SELL_REFUND, 0)}
                </PixelButton>
              </div>
            );
          })}
          {sparePsus.map((p) => {
            const pm = PSU_BY_ID[p.modelId];
            return (
              <div key={p.uid} className="flex items-center gap-2 bg-panel-2 p-1.5 text-[16px] leading-tight">
                <SpriteImg src={sprites.psuIcon(pm.id)} width={42} height={15} alt="" />
                <div className="flex-1">{t(pm.name)} <span className="text-amber">{formatPower(pm.capacity)}</span></div>
                <PixelButton size="xs" variant="danger" onClick={() => sellItem('psu', p.uid)}>
                  {formatCash(pm.price * SELL_REFUND, 0)}
                </PixelButton>
              </div>
            );
          })}
        </div>
      </section>
    </div>
  );
}
