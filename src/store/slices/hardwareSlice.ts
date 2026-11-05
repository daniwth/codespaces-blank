import { COOLER_BY_ID, GPU_BY_ID, PSU_BY_ID, QUALITY_DEFS, RACK_BY_ID } from '../../config/hardwareCatalog';
import { talentModifiers } from '../../config/prestigeTree';
import type { ComponentKind, GpuInstance, OverclockSettings, RackInstance } from '../../types/hardware';
import { bnAdd, bnGte, bnSub } from '../../utils/bignum';
import { makeUid, sfxBus, fxBus } from '../../utils/eventBus';
import { formatCash } from '../../utils/formatters';
import { aiAutoTune, crashChance, ocHashBonus, STOCK_OC } from '../gamePhysics';
import { recordGpuEdit } from '../editLedger';
import { createGpu, createRack, rollQuality } from '../initialState';
import { PHYSICS } from '../../config/gameBalance';
import type { GameStore, GetState, HardwareSlice, SetState } from '../storeTypes';

export const SELL_REFUND = 0.5;

export const repasteCost = (g: GpuInstance): number => Math.max(5, Math.round(GPU_BY_ID[g.modelId].price * 0.03));
export const repairCost = (g: GpuInstance): number => Math.max(5, Math.round(GPU_BY_ID[g.modelId].price * 0.5 * g.wear));

/** Find which rack (if any) holds a component. */
export function findMount(state: Pick<GameStore, 'racks'>, kind: 'gpu' | 'cooler' | 'psu', uid: string): RackInstance | undefined {
  return Object.values(state.racks).find((r) =>
    kind === 'gpu' ? r.gpuSlots.includes(uid) : kind === 'cooler' ? r.fanSlots.includes(uid) : r.psuUid === uid,
  );
}

const withoutUid = (slots: (string | null)[], uid: string) => slots.map((s) => (s === uid ? null : s));

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

export function createHardwareSlice(set: SetState, get: GetState): HardwareSlice {
  const spend = (price: number, label: string): boolean => {
    const s = get();
    if (!bnGte(s.cash, price)) {
      sfxBus.emit('error');
      s.pushLog(`Not enough cash for ${label} (${formatCash(price)}).`, 'warn');
      return false;
    }
    set({ cash: bnSub(s.cash, price) });
    return true;
  };

  return {
    buyGpu: (modelId) => {
      const model = GPU_BY_ID[modelId];
      if (!model || !spend(model.price, model.name)) return null;
      const quality = rollQuality(talentModifiers(get().talents).qualityLuck);
      const gpu = createGpu(modelId, quality);
      set((s) => ({
        gpus: { ...s.gpus, [gpu.uid]: gpu },
        stats: { ...s.stats, gpusBought: s.stats.gpusBought + 1 },
        lottery: { modelId, quality, t: Date.now() },
      }));
      get().pushLog(`Bought ${model.brand} ${model.name} — Silicon Lottery: ${QUALITY_DEFS[quality].label.toUpperCase()}!`, quality === 'god' || quality === 'gold' ? 'good' : 'info');
      sfxBus.emit(quality === 'god' ? 'unlock' : 'buy');
      fxBus.emit({ kind: 'lottery', quality });
      if (quality === 'god') fxBus.emit({ kind: 'confetti', intensity: 0.6 });
      return gpu;
    },

    buyPsu: (modelId) => {
      const model = PSU_BY_ID[modelId];
      if (!model || !spend(model.price, model.name)) return false;
      const uid = makeUid('psu');
      set((s) => ({ psus: { ...s.psus, [uid]: { uid, modelId } } }));
      get().pushLog(`Bought PSU ${model.name}.`);
      sfxBus.emit('buy');
      return true;
    },

    buyCooler: (modelId) => {
      const model = COOLER_BY_ID[modelId];
      if (!model || !spend(model.price, model.name)) return false;
      const uid = makeUid('cool');
      set((s) => ({ coolers: { ...s.coolers, [uid]: { uid, modelId } } }));
      get().pushLog(`Bought cooler ${model.name}.`);
      sfxBus.emit('buy');
      return true;
    },

    buyRack: (modelId) => {
      const model = RACK_BY_ID[modelId];
      if (!model || model.vip || !spend(model.price, model.name)) return false;
      const rack = createRack(modelId, model.slots, model.fanSlots);
      set((s) => ({ racks: { ...s.racks, [rack.uid]: rack } }));
      get().pushLog(`Bought ${model.name}. Click an empty floor pad to place it.`);
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
          s.pushLog('Gold Edition racks are soulbound and cannot be sold.', 'warn');
          return false;
        }
        if (r.gpuSlots.some(Boolean) || r.fanSlots.some(Boolean) || r.psuUid) {
          s.pushLog('Empty the rack before selling it.', 'warn');
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
      s.pushLog(`Sold for ${formatCash(refund)}.`);
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
        get().pushLog('Gold Edition racks have a built-in power plant.', 'info');
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
          if (uid && s.gpus[uid]) recordGpuEdit(uid, { temp: Math.min(s.gpus[uid].temp, 30), shutdown: false });
          const gpus = uid && s.gpus[uid] ? { ...s.gpus, [uid]: { ...s.gpus[uid], temp: Math.min(s.gpus[uid].temp, 30), shutdown: false } } : s.gpus;
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
      const model = RACK_BY_ID[rack.modelId];
      const mounted = new Set<string>();
      Object.values(s.racks).forEach((r) => {
        r.gpuSlots.forEach((u) => u && mounted.add(u));
        r.fanSlots.forEach((u) => u && mounted.add(u));
        if (r.psuUid) mounted.add(r.psuUid);
      });
      const freeGpus = Object.values(s.gpus).filter((g) => !mounted.has(g.uid))
        .sort((a, b) => GPU_BY_ID[b.modelId].hashrate - GPU_BY_ID[a.modelId].hashrate);
      const freeCoolers = Object.values(s.coolers).filter((c) => !mounted.has(c.uid))
        .sort((a, b) => COOLER_BY_ID[b.modelId].cooling - COOLER_BY_ID[a.modelId].cooling);
      const freePsus = Object.values(s.psus).filter((p) => !mounted.has(p.uid))
        .sort((a, b) => PSU_BY_ID[b.modelId].capacity - PSU_BY_ID[a.modelId].capacity);
      let count = 0;
      const gpuSlots = rack.gpuSlots.map((u) => {
        if (u) return u;
        const next = freeGpus.shift();
        if (next) count += 1;
        return next?.uid ?? null;
      });
      const fanSlots = rack.fanSlots.map((u) => {
        if (u) return u;
        const next = freeCoolers.shift();
        if (next) count += 1;
        return next?.uid ?? null;
      });
      let psuUid = rack.psuUid;
      if (!psuUid && !model.selfPowered && freePsus.length) {
        psuUid = freePsus[0].uid;
        count += 1;
      }
      if (count > 0) {
        set({ racks: { ...s.racks, [rackUid]: { ...rack, gpuSlots, fanSlots, psuUid } } });
        sfxBus.emit('install');
      } else {
        sfxBus.emit('error');
      }
      return count;
    },

    applyOverclock: (gpuUid, oc: OverclockSettings) => {
      const s = get();
      const gpu = s.gpus[gpuUid];
      if (!gpu) return 'invalid';
      const chance = crashChance(gpu.silicon, oc);
      const crashed = Math.random() < chance;
      if (crashed) {
        const rack = findMount(s, 'gpu', gpuUid);
        set((st) => ({
          racks: rack ? { ...st.racks, [rack.uid]: { ...st.racks[rack.uid], rebootUntil: Date.now() + PHYSICS.rebootMs } } : st.racks,
          stats: { ...st.stats, bsods: st.stats.bsods + 1 },
        }));
        s.pushLog(`BSOD! ${GPU_BY_ID[gpu.modelId].name} overclock unstable. Rig rebooting (10s).`, 'bad');
        sfxBus.emit('bsod');
        return 'crash';
      }
      const bonus = ocHashBonus(oc);
      set((st) => ({
        gpus: { ...st.gpus, [gpuUid]: { ...st.gpus[gpuUid], oc: { ...oc }, ocBonus: bonus } },
        stats: { ...st.stats, stableOverclocks: st.stats.stableOverclocks + (bonus > 0 ? 1 : 0) },
      }));
      s.pushLog(`Overclock stable: ${bonus >= 0 ? '+' : ''}${(bonus * 100).toFixed(1)}% hashrate on ${GPU_BY_ID[gpu.modelId].name}.`, 'good');
      sfxBus.emit('success');
      return 'stable';
    },

    autoTuneGpu: (gpuUid) => {
      const s = get();
      const gpu = s.gpus[gpuUid];
      if (!gpu || !s.vip.aiDiagnostics) return false;
      const oc = aiAutoTune(gpu.silicon);
      const bonus = ocHashBonus(oc);
      set((st) => ({ gpus: { ...st.gpus, [gpuUid]: { ...st.gpus[gpuUid], oc, ocBonus: bonus } } }));
      s.pushLog(`AI Diagnostics tuned ${GPU_BY_ID[gpu.modelId].name}: +${(bonus * 100).toFixed(1)}% safe.`, 'good');
      sfxBus.emit('success');
      return true;
    },

    resetOverclock: (gpuUid) => {
      set((s) => (s.gpus[gpuUid] ? { gpus: { ...s.gpus, [gpuUid]: { ...s.gpus[gpuUid], oc: { ...STOCK_OC }, ocBonus: 0 } } } : {}));
      sfxBus.emit('switch');
    },

    repasteGpu: (gpuUid) => {
      const gpu = get().gpus[gpuUid];
      if (!gpu || !spend(repasteCost(gpu), 'thermal paste')) return false;
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
      get().pushLog(`${GPU_BY_ID[gpu.modelId].name} reballed & repaired. Efficiency restored.`, 'good');
      sfxBus.emit('success');
      return true;
    },
  };
}

export type { ComponentKind };
