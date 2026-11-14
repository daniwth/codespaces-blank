import { tr } from '../../i18n';
import { COOLER_BY_ID, GPU_BY_ID, OC_LIMITS, PSU_BY_ID, QUALITY_DEFS, QUALITY_ORDER, RACK_BY_ID } from '../../config/hardwareCatalog';
import { talentModifiers } from '../../config/prestigeTree';
import { ROOM_ORDER } from '../../config/roomsCatalog';
import type { ComponentKind, CoolerInstance, GpuInstance, OverclockSettings, PsuInstance, RackInstance, SiliconQuality } from '../../types/hardware';
import type { GameData, RoomId } from '../../types/player';
import { bnAdd, bnGte, bnSub, bnToNumber } from '../../utils/bignum';
import { makeUid, sfxBus, fxBus } from '../../utils/eventBus';
import { formatCash } from '../../utils/formatters';
import { aiAutoTune, crashChance, fitOverclock, ocHashBonus, repairCost, repasteCooling, repasteCost, STOCK_OC } from '../gamePhysics';
import { BIOS_PROFILE_NAMES } from '../../config/synergy';
import { clamp, randRange } from '../../utils/random';
import { collect } from '../../config/collection';
import { recordGpuEdit } from '../editLedger';
import { createGpu, createRack, rollQuality } from '../initialState';
import { PHYSICS } from '../../config/gameBalance';
import { hardwarePrice } from '../pricing';
import type { GameStore, GetState, HardwareSlice, SetState } from '../storeTypes';
import { challengeBlocks } from './challengesSlice';

export const SELL_REFUND = 0.5;
/** Grey Market (talent): used GPUs cost this share of the price and arrive worn. */
export const USED_GPU = { priceMul: 0.55, wear: [0.05, 0.3] as [number, number], paste: [0.3, 0.8] as [number, number] } as const;
export const usedGpuPrice = (price: number): number => Math.max(0.01, Math.round(price * USED_GPU.priceMul * 100) / 100);
/** Silicon Forge: spare GPUs of one model and grade melted into one of the next grade. */
export const FUSE_COUNT = 3;
/** "Re-paste all" touches every mounted GPU whose paste is below this. */
export const REPASTE_ALL_BELOW = 0.6;
/** Largest batch the Shop sells in one click. */
export const MAX_BULK = 50;

export { repairCost, repasteCost };

/** Find which rack (if any) holds a component. */
export function findMount(state: Pick<GameStore, 'racks'>, kind: 'gpu' | 'cooler' | 'psu', uid: string): RackInstance | undefined {
  return Object.values(state.racks).find((r) =>
    kind === 'gpu' ? r.gpuSlots.includes(uid) : kind === 'cooler' ? r.fanSlots.includes(uid) : r.psuUid === uid,
  );
}

const withoutUid = (slots: (string | null)[], uid: string) => slots.map((s) => (s === uid ? null : s));

type Parts = Pick<GameData, 'racks' | 'gpus' | 'coolers' | 'psus'>;

/** Uids of every part mounted in any rack. */
export function mountedUids(racks: Record<string, RackInstance>): Set<string> {
  const set = new Set<string>();
  Object.values(racks).forEach((r) => {
    r.gpuSlots.forEach((u) => u && set.add(u));
    r.fanSlots.forEach((u) => u && set.add(u));
    if (r.psuUid) set.add(r.psuUid);
  });
  return set;
}

/**
 * Fills the free slots of one rack with the best spare parts (highest hashrate GPUs, strongest
 * coolers, biggest PSU). Pure: returns the new rack and how many parts it took; `taken` collects
 * the uids used so several racks can be filled in a row from the same storage.
 */
export function fillRack(rack: RackInstance, s: Parts, taken: Set<string>): { rack: RackInstance; count: number } {
  const model = RACK_BY_ID[rack.modelId];
  const free = <T extends { uid: string }>(rec: Record<string, T>): T[] => Object.values(rec).filter((x) => !taken.has(x.uid));
  const freeGpus = free<GpuInstance>(s.gpus).sort((a, b) => GPU_BY_ID[b.modelId].hashrate - GPU_BY_ID[a.modelId].hashrate);
  const freeCoolers = free<CoolerInstance>(s.coolers).sort((a, b) => COOLER_BY_ID[b.modelId].cooling - COOLER_BY_ID[a.modelId].cooling);
  const freePsus = free<PsuInstance>(s.psus).sort((a, b) => PSU_BY_ID[b.modelId].capacity - PSU_BY_ID[a.modelId].capacity);
  let count = 0;
  const take = <T extends { uid: string }>(list: T[]): string | null => {
    const next = list.shift();
    if (!next) return null;
    taken.add(next.uid);
    count += 1;
    return next.uid;
  };
  const gpuSlots = rack.gpuSlots.map((u) => u ?? take(freeGpus));
  const fanSlots = rack.fanSlots.map((u) => u ?? take(freeCoolers));
  const psuUid = rack.psuUid ?? (model.selfPowered ? null : take(freePsus));
  return { rack: count > 0 ? { ...rack, gpuSlots, fanSlots, psuUid } : rack, count };
}

export interface FusableGroup {
  modelId: string;
  quality: SiliconQuality;
  /** Spare (unmounted) GPUs of this model and grade. */
  count: number;
  next: SiliconQuality;
}

/** Spare GPUs grouped by model and grade, for every grade that can still be fused up. */
export function fusableGroups(s: Parts): FusableGroup[] {
  const mounted = mountedUids(s.racks);
  const counts = new Map<string, FusableGroup>();
  Object.values(s.gpus).forEach((g) => {
    const idx = QUALITY_ORDER.indexOf(g.quality);
    if (mounted.has(g.uid) || idx < 0 || idx >= QUALITY_ORDER.length - 1) return;
    const key = `${g.modelId}|${g.quality}`;
    const group = counts.get(key) ?? { modelId: g.modelId, quality: g.quality, count: 0, next: QUALITY_ORDER[idx + 1] };
    group.count += 1;
    counts.set(key, group);
  });
  return [...counts.values()].sort((a, b) =>
    GPU_BY_ID[b.modelId].tier - GPU_BY_ID[a.modelId].tier || QUALITY_ORDER.indexOf(b.quality) - QUALITY_ORDER.indexOf(a.quality));
}

/** Detach a component from any rack in a racks map (returns a new map). */
function detach(racks: Record<string, RackInstance>, kind: 'gpu' | 'cooler' | 'psu', uid: string): Record<string, RackInstance> {
  const next: Record<string, RackInstance> = {};
  Object.values(racks).forEach((r) => {
    next[r.uid] =
      kind === 'gpu' && r.gpuSlots.includes(uid) ? { ...r, gpuSlots: withoutUid(r.gpuSlots, uid) }
        : kind === 'cooler' && r.fanSlots.includes(uid) ? { ...r, fanSlots: withoutUid(r.fanSlots, uid) }
          : kind === 'psu' && r.psuUid === uid ? { ...r, psuUid: null }
            : r;
  });
  return next;
}

/** Floating "-12C" over the rack of a GPU that was just re-pasted (nothing for a spare or a cold card). */
function repasteFx(s: GameStore, gpu: GpuInstance, rack: RackInstance | undefined): void {
  if (!rack?.roomId) return;
  const air = s.live.rooms[rack.roomId]?.temp ?? s.roomTemps[rack.roomId] ?? gpu.temp;
  const drop = Math.round(repasteCooling(gpu.temp, air, gpu.paste));
  if (drop >= 1) fxBus.emit({ kind: 'rackText', rackUid: rack.uid, text: `-${drop}C`, color: '#7dd3fc' });
}

export function createHardwareSlice(set: SetState, get: GetState): HardwareSlice {
  const spend = (price: number, label: string): boolean => {
    const s = get();
    if (!bnGte(s.cash, price)) {
      sfxBus.emit('error');
      s.pushLog(tr('Not enough cash for {label} ({price}).', { label: tr(label), price: formatCash(price) }), 'warn');
      return false;
    }
    set({ cash: bnSub(s.cash, price) });
    return true;
  };

  return {
    buyGpu: (modelId) => {
      const model = GPU_BY_ID[modelId];
      if (!model || !spend(hardwarePrice(model.price, get()), model.name)) return null;
      // Bronze Only: the silicon lottery is locked to Bronze.
      const quality = challengeBlocks(get(), 'bronzeOnly') ? 'bronze' : rollQuality(talentModifiers(get().talents).qualityLuck);
      const gpu = createGpu(modelId, quality);
      set((s) => ({
        gpus: { ...s.gpus, [gpu.uid]: gpu },
        stats: { ...s.stats, gpusBought: s.stats.gpusBought + 1 },
        lottery: { modelId, quality, t: Date.now() },
        collection: collect(s.collection, modelId, quality),
      }));
      get().pushLog(tr('Bought {brand} {name} — Silicon Lottery: {quality}!', { brand: model.brand, name: tr(model.name), quality: tr(QUALITY_DEFS[quality].label).toUpperCase() }), quality === 'god' || quality === 'gold' ? 'good' : 'info');
      sfxBus.emit(quality === 'god' ? 'unlock' : 'buy');
      fxBus.emit({ kind: 'lottery', quality });
      if (quality === 'god') fxBus.emit({ kind: 'confetti', intensity: 0.6 });
      return gpu;
    },

    buyUsedGpu: (modelId) => {
      const s = get();
      const model = GPU_BY_ID[modelId];
      if (!model || !talentModifiers(s.talents).usedMarket) return null;
      if (!spend(usedGpuPrice(hardwarePrice(model.price, s)), model.name)) return null;
      const quality = challengeBlocks(get(), 'bronzeOnly') ? 'bronze' : rollQuality(talentModifiers(s.talents).qualityLuck);
      // Second hand: some silicon wear and paste that has seen better days.
      const gpu: GpuInstance = { ...createGpu(modelId, quality), wear: randRange(USED_GPU.wear[0], USED_GPU.wear[1]), paste: randRange(USED_GPU.paste[0], USED_GPU.paste[1]) };
      set((st) => ({
        gpus: { ...st.gpus, [gpu.uid]: gpu },
        stats: { ...st.stats, gpusBought: st.stats.gpusBought + 1 },
        lottery: { modelId, quality, t: Date.now() },
        collection: collect(st.collection, modelId, quality),
      }));
      get().logT('Bought a used {name}: {quality} silicon, {wear}% worn.', { name: model.name, quality: QUALITY_DEFS[quality].label, wear: Math.round(gpu.wear * 100) }, quality === 'god' || quality === 'gold' ? 'good' : 'info');
      sfxBus.emit('buy');
      fxBus.emit({ kind: 'lottery', quality });
      return gpu;
    },

    buyPsu: (modelId) => {
      const model = PSU_BY_ID[modelId];
      if (!model || !spend(hardwarePrice(model.price, get()), model.name)) return false;
      const uid = makeUid('psu');
      set((s) => ({ psus: { ...s.psus, [uid]: { uid, modelId } } }));
      get().pushLog(tr('Bought PSU {name}.', { name: tr(model.name) }));
      sfxBus.emit('buy');
      return true;
    },

    buyCooler: (modelId) => {
      const model = COOLER_BY_ID[modelId];
      if (!model || !spend(hardwarePrice(model.price, get()), model.name)) return false;
      const uid = makeUid('cool');
      set((s) => ({ coolers: { ...s.coolers, [uid]: { uid, modelId } } }));
      get().pushLog(tr('Bought cooler {name}.', { name: tr(model.name) }));
      sfxBus.emit('buy');
      return true;
    },

    buyRack: (modelId) => {
      const model = RACK_BY_ID[modelId];
      if (!model || model.vip || !spend(hardwarePrice(model.price, get()), model.name)) return false;
      const rack = createRack(modelId, model.slots, model.fanSlots);
      set((s) => ({ racks: { ...s.racks, [rack.uid]: rack } }));
      get().pushLog(tr('Bought {name}. Click an empty floor pad to place it.', { name: tr(model.name) }));
      sfxBus.emit('buy');
      return true;
    },

    sellItem: (kind, uid) => {
      const s = get();
      let refund = 0;
      const patch: Partial<GameStore> = {};
      if (kind === 'gpu') {
        const g = s.gpus[uid];
        if (!g) return false;
        refund = GPU_BY_ID[g.modelId].price * SELL_REFUND * (1 - g.wear);
        const { [uid]: _omit, ...rest } = s.gpus;
        void _omit;
        patch.gpus = rest;
        patch.racks = detach(s.racks, 'gpu', uid);
      } else if (kind === 'psu') {
        const p = s.psus[uid];
        if (!p) return false;
        refund = PSU_BY_ID[p.modelId].price * SELL_REFUND;
        const { [uid]: _omit, ...rest } = s.psus;
        void _omit;
        patch.psus = rest;
        patch.racks = detach(s.racks, 'psu', uid);
      } else if (kind === 'cooler') {
        const c = s.coolers[uid];
        if (!c) return false;
        refund = COOLER_BY_ID[c.modelId].price * SELL_REFUND;
        const { [uid]: _omit, ...rest } = s.coolers;
        void _omit;
        patch.coolers = rest;
        patch.racks = detach(s.racks, 'cooler', uid);
      } else {
        const r = s.racks[uid];
        if (!r) return false;
        const model = RACK_BY_ID[r.modelId];
        if (model.vip) {
          s.pushLog(tr('Gold Edition racks are soulbound and cannot be sold.'), 'warn');
          return false;
        }
        if (r.gpuSlots.some(Boolean) || r.fanSlots.some(Boolean) || r.psuUid) {
          s.pushLog(tr('Empty the rack before selling it.'), 'warn');
          sfxBus.emit('error');
          return false;
        }
        refund = model.price * SELL_REFUND;
        const { [uid]: _omit, ...rest } = s.racks;
        void _omit;
        patch.racks = rest;
        if (s.selectedRack === uid) patch.selectedRack = null;
      }
      set({ ...patch, cash: bnAdd(s.cash, refund) });
      s.pushLog(tr('Sold for {price}.', { price: formatCash(refund) }));
      sfxBus.emit('sell');
      return true;
    },

    installGpu: (rackUid, slot, gpuUid) => {
      set((s) => {
        if (!s.racks[rackUid] || !s.gpus[gpuUid]) return {};
        const racks = detach(s.racks, 'gpu', gpuUid);
        const rack = racks[rackUid];
        const gpuSlots = rack.gpuSlots.slice();
        gpuSlots[slot] = gpuUid;
        return { racks: { ...racks, [rackUid]: { ...rack, gpuSlots } } };
      });
      sfxBus.emit('install');
    },

    installCooler: (rackUid, slot, coolerUid) => {
      set((s) => {
        if (!s.racks[rackUid] || !s.coolers[coolerUid]) return {};
        const racks = detach(s.racks, 'cooler', coolerUid);
        const rack = racks[rackUid];
        const fanSlots = rack.fanSlots.slice();
        fanSlots[slot] = coolerUid;
        return { racks: { ...racks, [rackUid]: { ...rack, fanSlots } } };
      });
      sfxBus.emit('install');
    },

    installPsu: (rackUid, psuUid) => {
      const rackModel = RACK_BY_ID[get().racks[rackUid]?.modelId ?? ''];
      if (rackModel?.selfPowered) {
        get().pushLog(tr('Gold Edition racks have a built-in power plant.'), 'info');
        return;
      }
      set((s) => {
        if (!s.racks[rackUid] || !s.psus[psuUid]) return {};
        const racks = detach(s.racks, 'psu', psuUid);
        return { racks: { ...racks, [rackUid]: { ...racks[rackUid], psuUid } } };
      });
      sfxBus.emit('install');
    },

    uninstallSlot: (rackUid, kind, slot) => {
      set((s) => {
        const rack = s.racks[rackUid];
        if (!rack) return {};
        if (kind === 'psu') return { racks: { ...s.racks, [rackUid]: { ...rack, psuUid: null } } };
        if (kind === 'gpu') {
          const uid = rack.gpuSlots[slot];
          const gpuSlots = rack.gpuSlots.slice();
          gpuSlots[slot] = null;
          if (uid && s.gpus[uid]) recordGpuEdit(uid, { temp: Math.min(s.gpus[uid].temp, 30), shutdown: false, condensed: false });
          const gpus = uid && s.gpus[uid] ? { ...s.gpus, [uid]: { ...s.gpus[uid], temp: Math.min(s.gpus[uid].temp, 30), shutdown: false, condensed: false } } : s.gpus;
          return { gpus, racks: { ...s.racks, [rackUid]: { ...rack, gpuSlots } } };
        }
        const fanSlots = rack.fanSlots.slice();
        fanSlots[slot] = null;
        return { racks: { ...s.racks, [rackUid]: { ...rack, fanSlots } } };
      });
      sfxBus.emit('switch');
    },

    autoFillRack: (rackUid) => {
      const s = get();
      const rack = s.racks[rackUid];
      if (!rack) return 0;
      const filled = fillRack(rack, s, mountedUids(s.racks));
      if (filled.count > 0) {
        set({ racks: { ...s.racks, [rackUid]: filled.rack } });
        sfxBus.emit('install');
      } else {
        sfxBus.emit('error');
      }
      return filled.count;
    },

    autoFillAll: () => {
      const s = get();
      const taken = mountedUids(s.racks);
      const racks = { ...s.racks };
      let count = 0;
      // Placed racks only, room by room and pad by pad, so the best parts go to the first racks.
      Object.values(s.racks)
        .filter((r) => r.roomId !== null)
        .sort((a, b) => ROOM_ORDER.indexOf(a.roomId as RoomId) - ROOM_ORDER.indexOf(b.roomId as RoomId) || (a.pad ?? 0) - (b.pad ?? 0))
        .forEach((r) => {
          const filled = fillRack(r, s, taken);
          racks[r.uid] = filled.rack;
          count += filled.count;
        });
      if (count > 0) {
        set({ racks });
        s.logT('Auto-fill: {n} parts installed across your racks.', { n: count }, 'info');
        sfxBus.emit('install');
      } else {
        s.logT('Auto-fill: nothing to install. Buy parts or place a rack first.', undefined, 'warn');
        sfxBus.emit('error');
      }
      return count;
    },

    repasteAll: () => {
      const s = get();
      const mounted = mountedUids(s.racks);
      // Driest first: if the cash runs out, the GPUs that need it most are done.
      const dry = Object.values(s.gpus).filter((g) => mounted.has(g.uid) && g.paste < REPASTE_ALL_BELOW).sort((a, b) => a.paste - b.paste);
      let budget = bnToNumber(s.cash);
      let spent = 0;
      const gpus = { ...s.gpus };
      let count = 0;
      for (const g of dry) {
        const cost = repasteCost(g);
        if (cost > budget) continue;
        budget -= cost;
        spent += cost;
        gpus[g.uid] = { ...g, paste: 1 };
        recordGpuEdit(g.uid, { paste: 1 });
        count += 1;
      }
      if (count === 0) {
        s.logT(dry.length ? 'Not enough cash to re-paste any GPU.' : 'Every mounted GPU still has good thermal paste.', undefined, dry.length ? 'warn' : 'info');
        sfxBus.emit('error');
        return 0;
      }
      set({ gpus, cash: bnSub(s.cash, spent) });
      s.logT('Re-pasted {n} GPUs for {price}.', { n: count, price: formatCash(spent) }, 'good');
      sfxBus.emit('install');
      return count;
    },

    buyMany: (kind, modelId, qty) => {
      const want = Math.min(MAX_BULK, Math.max(1, Math.floor(qty)));
      const single = (): boolean =>
        kind === 'gpu' ? get().buyGpu(modelId) !== null : kind === 'psu' ? get().buyPsu(modelId) : kind === 'cooler' ? get().buyCooler(modelId) : get().buyRack(modelId);
      if (want === 1) return single() ? 1 : 0;
      const s = get();
      const model = kind === 'gpu' ? GPU_BY_ID[modelId] : kind === 'psu' ? PSU_BY_ID[modelId] : kind === 'cooler' ? COOLER_BY_ID[modelId] : RACK_BY_ID[modelId];
      if (!model || (kind === 'rack' && RACK_BY_ID[modelId].vip)) return 0;
      const unit = hardwarePrice(model.price, s);
      const count = Math.min(want, Math.floor(bnToNumber(s.cash) / unit));
      if (count <= 0) {
        sfxBus.emit('error');
        s.logT('Not enough cash for {label} ({price}).', { label: model.name, price: formatCash(unit) }, 'warn');
        return 0;
      }
      const cash = bnSub(s.cash, unit * count);
      const total = formatCash(unit * count);
      if (kind === 'gpu') {
        const luck = talentModifiers(s.talents).qualityLuck;
        const bronzeOnly = challengeBlocks(s, 'bronzeOnly');
        const gpus = { ...s.gpus };
        const rolled: Record<SiliconQuality, number> = { bronze: 0, silver: 0, gold: 0, god: 0 };
        let collection = s.collection;
        for (let i = 0; i < count; i += 1) {
          const quality = bronzeOnly ? 'bronze' : rollQuality(luck);
          const gpu = createGpu(modelId, quality);
          gpus[gpu.uid] = gpu;
          rolled[quality] += 1;
          collection = collect(collection, modelId, quality);
        }
        const best = [...QUALITY_ORDER].reverse().find((q) => rolled[q] > 0) ?? 'bronze';
        set({ cash, gpus, collection, stats: { ...s.stats, gpusBought: s.stats.gpusBought + count }, lottery: { modelId, quality: best, t: Date.now() } });
        s.logT('Bought {n}x {name} for {price}. Silicon Lottery: {bronze} Bronze, {silver} Silver, {gold} Gold, {god} Silicon God.',
          { n: count, name: model.name, price: total, bronze: rolled.bronze, silver: rolled.silver, gold: rolled.gold, god: rolled.god },
          rolled.god + rolled.gold > 0 ? 'good' : 'info');
        sfxBus.emit(rolled.god > 0 ? 'unlock' : 'buy');
        fxBus.emit({ kind: 'lottery', quality: best });
        if (rolled.god > 0) fxBus.emit({ kind: 'confetti', intensity: 0.6 });
        return count;
      }
      if (kind === 'psu') {
        const psus = { ...s.psus };
        for (let i = 0; i < count; i += 1) {
          const uid = makeUid('psu');
          psus[uid] = { uid, modelId };
        }
        set({ cash, psus });
      } else if (kind === 'cooler') {
        const coolers = { ...s.coolers };
        for (let i = 0; i < count; i += 1) {
          const uid = makeUid('cool');
          coolers[uid] = { uid, modelId };
        }
        set({ cash, coolers });
      } else {
        const rackModel = RACK_BY_ID[modelId];
        const racks = { ...s.racks };
        for (let i = 0; i < count; i += 1) {
          const rack = createRack(modelId, rackModel.slots, rackModel.fanSlots);
          racks[rack.uid] = rack;
        }
        set({ cash, racks });
      }
      s.logT('Bought {n}x {name} for {price}.', { n: count, name: model.name, price: total }, 'info');
      sfxBus.emit('buy');
      return count;
    },

    fuseGpus: (modelId, quality) => {
      const s = get();
      const model = GPU_BY_ID[modelId];
      const idx = QUALITY_ORDER.indexOf(quality);
      if (!model || idx < 0 || idx >= QUALITY_ORDER.length - 1) return null;
      if (challengeBlocks(s, 'bronzeOnly')) {
        get().denyByChallenge(tr('the Silicon Forge is closed: only Bronze silicon counts.'));
        return null;
      }
      const mounted = mountedUids(s.racks);
      // The most worn units go into the furnace first.
      const spare = Object.values(s.gpus).filter((g) => g.modelId === modelId && g.quality === quality && !mounted.has(g.uid)).sort((a, b) => b.wear - a.wear);
      if (spare.length < FUSE_COUNT) {
        s.logT('The Forge needs {n} spare {quality} {name} (not mounted in a rack).', { n: FUSE_COUNT, quality: QUALITY_DEFS[quality].label, name: model.name }, 'warn');
        sfxBus.emit('error');
        return null;
      }
      const next = QUALITY_ORDER[idx + 1];
      const fused = createGpu(modelId, next);
      const gpus = { ...s.gpus };
      // Forge Mastery: sometimes two cards are enough and the third one is spared.
      const used = Math.random() < talentModifiers(s.talents).forgeSave ? FUSE_COUNT - 1 : FUSE_COUNT;
      spare.slice(0, used).forEach((g) => delete gpus[g.uid]);
      gpus[fused.uid] = fused;
      set({ gpus, stats: { ...s.stats, fusions: s.stats.fusions + 1 }, lottery: { modelId, quality: next, t: Date.now() }, collection: collect(s.collection, modelId, next) });
      if (used < FUSE_COUNT) s.logT('Forge Mastery: only {n} cards were needed. One was spared.', { n: used }, 'good');
      s.logT('SILICON FORGE: {n}x {from} {name} fused into 1 {to}.', { n: used, from: QUALITY_DEFS[quality].label, name: model.name, to: QUALITY_DEFS[next].label }, next === 'god' || next === 'gold' ? 'good' : 'info');
      sfxBus.emit('fuse');
      fxBus.emit({ kind: 'lottery', quality: next });
      if (next === 'god') fxBus.emit({ kind: 'confetti', intensity: 0.6 });
      get().checkRoadmap();
      get().checkAchievements();
      return fused;
    },

    applyOverclock: (gpuUid, oc: OverclockSettings) => {
      const s = get();
      const gpu = s.gpus[gpuUid];
      if (!gpu) return 'invalid';
      if (challengeBlocks(s, 'lockOverclock')) {
        get().denyByChallenge(tr('the BIOS is locked at stock clocks.'));
        return 'invalid';
      }
      const chance = crashChance(gpu.silicon, oc);
      const crashed = Math.random() < chance;
      if (crashed) {
        const rack = findMount(s, 'gpu', gpuUid);
        set((st) => ({
          racks: rack ? { ...st.racks, [rack.uid]: { ...st.racks[rack.uid], rebootUntil: Date.now() + PHYSICS.rebootMs } } : st.racks,
          stats: { ...st.stats, bsods: st.stats.bsods + 1 },
        }));
        s.pushLog(tr('BSOD! {name} overclock unstable. Rig rebooting (10s).', { name: tr(GPU_BY_ID[gpu.modelId].name) }), 'bad');
        sfxBus.emit('bsod');
        if (rack) fxBus.emit({ kind: 'rackText', rackUid: rack.uid, text: 'BSOD', color: '#60a5fa', big: true });
        return 'crash';
      }
      const bonus = ocHashBonus(oc);
      set((st) => ({
        gpus: { ...st.gpus, [gpuUid]: { ...st.gpus[gpuUid], oc: { ...oc }, ocBonus: bonus } },
        stats: { ...st.stats, stableOverclocks: st.stats.stableOverclocks + (bonus > 0 ? 1 : 0) },
      }));
      s.pushLog(tr('Overclock stable: {bonus}% hashrate on {name}.', { bonus: `${bonus >= 0 ? '+' : ''}${(bonus * 100).toFixed(1)}`, name: tr(GPU_BY_ID[gpu.modelId].name) }), 'good');
      sfxBus.emit('success');
      return 'stable';
    },

    autoTuneGpu: (gpuUid) => {
      const s = get();
      const gpu = s.gpus[gpuUid];
      if (!gpu || !s.vip.aiDiagnostics) return false;
      if (challengeBlocks(s, 'lockOverclock')) return get().denyByChallenge(tr('the BIOS is locked at stock clocks.'));
      const oc = aiAutoTune(gpu.silicon);
      const bonus = ocHashBonus(oc);
      set((st) => ({ gpus: { ...st.gpus, [gpuUid]: { ...st.gpus[gpuUid], oc, ocBonus: bonus } } }));
      s.pushLog(tr('AI Diagnostics tuned {name}: +{bonus}% safe.', { name: tr(GPU_BY_ID[gpu.modelId].name), bonus: (bonus * 100).toFixed(1) }), 'good');
      sfxBus.emit('success');
      return true;
    },

    saveBiosProfile: (id, oc) => {
      const { core: c, mem: m, voltage: v } = OC_LIMITS;
      const clean = { core: clamp(oc.core, c.min, c.max), mem: clamp(oc.mem, m.min, m.max), voltage: clamp(oc.voltage, v.min, v.max) };
      set((s) => ({ biosProfiles: { ...s.biosProfiles, [id]: clean } }));
      get().logT('BIOS profile saved: {name}.', { name: BIOS_PROFILE_NAMES[id] }, 'info');
      sfxBus.emit('success');
    },

    applyProfileToModel: (modelId, oc) => {
      const s = get();
      const model = GPU_BY_ID[modelId];
      if (!model) return 0;
      if (challengeBlocks(s, 'lockOverclock')) {
        get().denyByChallenge(tr('the BIOS is locked at stock clocks.'));
        return 0;
      }
      const gpus = { ...s.gpus };
      let count = 0;
      let trimmed = 0;
      Object.values(s.gpus).forEach((g) => {
        if (g.modelId !== modelId) return;
        // Each chip gets the closest settings its own silicon holds: batch applies never crash a rig.
        const fitted = fitOverclock(g.silicon, oc);
        if (fitted.core !== oc.core || fitted.mem !== oc.mem || fitted.voltage !== oc.voltage) trimmed += 1;
        gpus[g.uid] = { ...g, oc: fitted, ocBonus: ocHashBonus(fitted) };
        count += 1;
      });
      if (count === 0) return 0;
      set({ gpus });
      s.logT('BIOS profile applied to {n}x {name} ({trimmed} fitted down to their silicon).', { n: count, name: model.name, trimmed }, 'good');
      sfxBus.emit('success');
      return count;
    },

    resetOverclock: (gpuUid) => {
      set((s) => (s.gpus[gpuUid] ? { gpus: { ...s.gpus, [gpuUid]: { ...s.gpus[gpuUid], oc: { ...STOCK_OC }, ocBonus: 0 } } } : {}));
      sfxBus.emit('switch');
    },

    repasteGpu: (gpuUid) => {
      const gpu = get().gpus[gpuUid];
      if (!gpu || !spend(repasteCost(gpu), 'thermal paste')) return false;
      repasteFx(get(), gpu, findMount(get(), 'gpu', gpuUid));
      set((s) => ({ gpus: { ...s.gpus, [gpuUid]: { ...s.gpus[gpuUid], paste: 1 } } }));
      recordGpuEdit(gpuUid, { paste: 1 });
      sfxBus.emit('install');
      return true;
    },

    repairGpu: (gpuUid) => {
      const gpu = get().gpus[gpuUid];
      if (!gpu || gpu.wear <= 0 || !spend(repairCost(gpu), 'silicon repair')) return false;
      set((s) => ({ gpus: { ...s.gpus, [gpuUid]: { ...s.gpus[gpuUid], wear: 0, overheatSeconds: 0 } } }));
      recordGpuEdit(gpuUid, { wear: 0, overheatSeconds: 0 });
      get().pushLog(tr('{name} reballed & repaired. Efficiency restored.', { name: tr(GPU_BY_ID[gpu.modelId].name) }), 'good');
      sfxBus.emit('success');
      return true;
    },
  };
}

export type { ComponentKind };
