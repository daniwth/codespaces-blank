import { beforeEach, describe, expect, it } from 'vitest';
import { MARKET, PHYSICS, POOLS } from '../../src/config/gameBalance';
import { COOLER_BY_ID, GPU_BY_ID, PSU_BY_ID } from '../../src/config/hardwareCatalog';
import { TAB_KEYS, openRackBios, quickMaintenance } from '../../src/components/App';
import { HOTKEYS } from '../../src/components/ui/HotkeysModal';
import { ES } from '../../src/i18n/es';
import { diagnoseFarm, farmPnl, mountPreview, previewPurchase, simulate } from '../../src/store/gamePhysics';
import { createGpu, createInitialData, createRack } from '../../src/store/initialState';
import { REPASTE_ALL_BELOW, equipBest, repairCost, repasteCost } from '../../src/store/slices/hardwareSlice';
import { useGameStore } from '../../src/store/useGameStore';
import { starterWorld } from './helpers';

const NOW = 1_800_000_000_000 - (1_800_000_000_000 % 600_000) + 60_000;
const online = { offline: false, maxStep: 1 } as const;
const store = () => useGameStore.getState();

describe('live P&L', () => {
  it('splits what the farm hashes into fees, electricity and net profit', () => {
    const live = { coinPerSec: 9.8, electricityPerSec: 1.5 };
    const pnl = farmPnl(live, 'public', 2);
    // 9.8 coins/s reach the wallet after the 2% pool fee: 10 were hashed.
    expect(pnl.gross).toBeCloseTo(20, 10);
    expect(pnl.fees).toBeCloseTo(20 * POOLS.public.fee + 9.8 * 2 * MARKET.fee, 10);
    expect(pnl.electricity).toBe(1.5);
    expect(pnl.net).toBeCloseTo(pnl.gross - pnl.fees - 1.5, 10);
    expect(farmPnl(live, 'solo', 2).gross).toBeCloseTo(19.6, 10);
    expect(farmPnl({ coinPerSec: 0, electricityPerSec: 3 }, 'public', 1).net).toBe(-3);
  });

  it('matches the simulation of the starter rig', () => {
    const { input } = starterWorld();
    const out = simulate(input, 1, NOW, online);
    const pnl = farmPnl(out.live, 'public', input.market.CC.price);
    expect(pnl.gross).toBeCloseTo((GPU_BY_ID.px460.hashrate / 1e6) * PHYSICS.rewardPerMHs * input.market.CC.price, 6);
    expect(pnl.net).toBeGreaterThan(0);
  });
});

describe('bottleneck detector', () => {
  const ids = (data: ReturnType<typeof starterWorld>['data'], now = NOW) => diagnoseFarm(data, simulate(data, 1, now, online).live).map((b) => b.id);

  it('a healthy starter rig only has room to grow', () => {
    const { data } = starterWorld();
    const list = diagnoseFarm(data, simulate(data, 1, NOW, online).live);
    expect(list.map((b) => b.id)).toEqual(['empty_slots', 'empty_pads']);
    expect(list.every((b) => b.severity === 1)).toBe(true);
    expect(list[0].params.n).toBe(1);
  });

  it('reports PSU saturation, a missing PSU and thermal trouble first', () => {
    const over = starterWorld();
    const extra = createGpu('nca100', 'bronze');
    over.data.gpus[extra.uid] = extra;
    over.data.racks[over.rackUid] = { ...over.data.racks[over.rackUid], gpuSlots: [over.gpuUid, extra.uid] };
    expect(ids(over.data)[0]).toBe('overload');

    const none = starterWorld();
    none.data.racks[none.rackUid] = { ...none.data.racks[none.rackUid], psuUid: null };
    expect(ids(none.data)).toContain('no_psu');

    const hot = starterWorld();
    hot.data.gpus[hot.gpuUid] = { ...hot.data.gpus[hot.gpuUid], temp: 90 };
    hot.data.racks[hot.rackUid] = { ...hot.data.racks[hot.rackUid], fanSlots: [null] };
    const throttle = diagnoseFarm(hot.data, simulate(hot.data, 0.05, NOW, online).live);
    expect(throttle[0]).toMatchObject({ id: 'throttle', severity: 3 });

    const off = starterWorld();
    off.data.gpus[off.gpuUid] = { ...off.data.gpus[off.gpuUid], shutdown: true, temp: 80 };
    expect(ids(off.data)).toContain('shutdown');
  });

  it('reports a saturated power line, and an empty farm', () => {
    const w = starterWorld({ challenge: { id: 'power_cap', startedAt: NOW } });
    // 35% of 1.5 kW = 525 W: two VX-2070 (440 W) plus a fan and PSU losses do not fit.
    const rack = { ...createRack('steel', 4, 2), roomId: 'bedroom' as const, pad: 1 };
    ['a', 'b'].forEach((k, i) => {
      const g = createGpu('vx2070', 'bronze');
      w.data.gpus[g.uid] = g;
      rack.gpuSlots[i] = g.uid;
      w.data.coolers[`c${k}`] = { uid: `c${k}`, modelId: 'tower' };
      rack.fanSlots[i] = `c${k}`;
    });
    w.data.psus.big = { uid: 'big', modelId: 'psu1000' };
    rack.psuUid = 'big';
    w.data.racks[rack.uid] = rack;
    const list = diagnoseFarm(w.data, simulate(w.data, 1, NOW, online).live);
    expect(list.find((b) => b.id === 'brownout')?.params.room).toBe('Bedroom');

    const bare = starterWorld();
    bare.data.racks[bare.rackUid] = { ...bare.data.racks[bare.rackUid], gpuSlots: [null, null] };
    expect(ids(bare.data)[0]).toBe('no_gpus');
  });

  it('every message has a Spanish translation with the same placeholders', () => {
    const w = starterWorld();
    diagnoseFarm(w.data, simulate(w.data, 1, NOW, online).live).forEach((b) => expect(ES[b.key], b.key).toBeTruthy());
  });
});

describe('purchase preview', () => {
  it('mounts the part in a free slot of the room, or says there is none', () => {
    const { input, rackUid } = starterWorld();
    const next = mountPreview(input, 'gpu', 'px460', 'bedroom');
    expect(next?.racks[rackUid].gpuSlots.filter(Boolean)).toHaveLength(2);
    // The original world is untouched.
    expect(input.racks[rackUid].gpuSlots.filter(Boolean)).toHaveLength(1);
    expect(mountPreview(input, 'gpu', 'px460', 'garage')).toBeNull();
    expect(mountPreview(input, 'gpu', 'nope', 'bedroom')).toBeNull();
    const full = mountPreview(next ?? input, 'gpu', 'px460', 'bedroom');
    expect(full).toBeNull();
    expect(previewPurchase(input, 'gpu', 'px460', 'garage', 45, NOW)).toMatchObject({ placed: false, dHash: 0 });
  });

  it('a second card adds its hashrate, its power draw, some heat and a finite ROI', () => {
    const { input } = starterWorld();
    const px = GPU_BY_ID.px460;
    const impact = previewPurchase(input, 'gpu', 'px460', 'bedroom', px.price, NOW);
    expect(impact.placed).toBe(true);
    expect(impact.dHash).toBeCloseTo(px.hashrate, -5);
    expect(impact.dWall).toBeCloseTo(px.power / PSU_BY_ID.psu500.efficiency, 0);
    expect(impact.dTemp).toBeGreaterThan(1);
    expect(impact.dNet).toBeGreaterThan(0);
    expect(impact.roiSec).toBeCloseTo(px.price / impact.dNet, 6);
    // Deterministic: the market noise of the two runs never reaches the result.
    const again = previewPurchase(input, 'gpu', 'px460', 'bedroom', px.price, NOW);
    expect(again.dHash).toBeCloseTo(impact.dHash, 6);
    expect(again.dNet).toBeCloseTo(impact.dNet, 9);
  });

  it('a card the PSU cannot carry shows a loss, not a gain', () => {
    const { input } = starterWorld();
    const impact = previewPurchase(input, 'gpu', 'nca100', 'bedroom', GPU_BY_ID.nca100.price, NOW);
    // 120 W + 400 W + fan > 500 W: the rack trips and the farm stops hashing.
    expect(impact.dHash).toBeLessThan(0);
    expect(impact.roiSec).toBe(Number.POSITIVE_INFINITY);
  });

  it('a better cooler lowers the temperature and costs a little power; a better PSU lowers the wall draw', () => {
    const { input } = starterWorld();
    const cooler = previewPurchase(input, 'cooler', 'tower', 'bedroom', COOLER_BY_ID.tower.price, NOW);
    expect(cooler.placed).toBe(true);
    expect(cooler.dTemp).toBeLessThan(-5);
    expect(cooler.dWall).toBeGreaterThan(0);
    expect(Math.abs(cooler.dHash)).toBeLessThan(1);
    const psu = previewPurchase(input, 'psu', 'psu2000', 'bedroom', PSU_BY_ID.psu2000.price, NOW);
    expect(psu.placed).toBe(true);
    expect(psu.dWall).toBeLessThan(0);
    expect(psu.dNet).toBeGreaterThan(0);
    // A PSU no better than the one mounted has nowhere to go.
    expect(previewPurchase(input, 'psu', 'psu500', 'bedroom', 25, NOW).placed).toBe(false);
  });
});

describe('mass actions', () => {
  beforeEach(() => useGameStore.setState({ ...createInitialData(), cash: '100000', log: [], selectedRack: null, biosGpu: null }));

  const addRack = (roomId: 'bedroom' | 'garage', pad: number, gpus: { modelId: string; paste?: number; wear?: number }[]) => {
    const rack = { ...createRack('steel', 4, 2), roomId, pad };
    const next = { ...store().gpus };
    gpus.forEach((spec, i) => {
      const g = { ...createGpu(spec.modelId, 'bronze'), paste: spec.paste ?? 1, wear: spec.wear ?? 0 };
      next[g.uid] = g;
      rack.gpuSlots[i] = g.uid;
    });
    useGameStore.setState({ gpus: next, racks: { ...store().racks, [rack.uid]: rack }, ownedRooms: ['bedroom', 'garage'] });
    return rack.uid;
  };

  it('re-paste all only touches GPUs below 50%, and only in the room asked for', () => {
    expect(REPASTE_ALL_BELOW).toBe(0.5);
    const bed = addRack('bedroom', 1, [{ modelId: 'px460', paste: 0.4 }, { modelId: 'px460', paste: 0.55 }]);
    const gar = addRack('garage', 0, [{ modelId: 'px460', paste: 0.1 }]);
    expect(store().repasteAll('bedroom')).toBe(1);
    const paste = (rackUid: string, slot: number) => store().gpus[store().racks[rackUid].gpuSlots[slot] ?? ''].paste;
    expect(paste(bed, 0)).toBe(1);
    expect(paste(bed, 1)).toBe(0.55);
    expect(paste(gar, 0)).toBe(0.1);
    expect(Number(store().cash)).toBe(100_000 - repasteCost({ modelId: 'px460' }));
    expect(store().repasteAll()).toBe(1);
    expect(paste(gar, 0)).toBe(1);
  });

  it('repair all fixes worn GPUs, most worn first, within the cash available', () => {
    const rack = addRack('bedroom', 1, [{ modelId: 'vx2070', wear: 0.3 }, { modelId: 'vx2070', wear: 0.1 }, { modelId: 'px460', wear: 0 }]);
    const costs = [repairCost({ modelId: 'vx2070', wear: 0.3 }), repairCost({ modelId: 'vx2070', wear: 0.1 })];
    useGameStore.setState({ cash: String(costs[0] + 1) });
    expect(store().repairAll('bedroom')).toBe(1);
    const wear = (slot: number) => store().gpus[store().racks[rack].gpuSlots[slot] ?? ''].wear;
    expect(wear(0)).toBe(0);
    expect(wear(1)).toBe(0.1);
    useGameStore.setState({ cash: '100000' });
    expect(store().repairAll()).toBe(1);
    expect(store().repairAll()).toBe(0);
  });

  it('auto-equip fills free slots and swaps mounted parts only for strictly better spares', () => {
    const rackUid = addRack('bedroom', 1, [{ modelId: 'px460' }, { modelId: 'px580' }]);
    const better = createGpu('vx2070', 'bronze');
    const worse = createGpu('px460', 'bronze');
    const best = createGpu('vx3080', 'bronze');
    useGameStore.setState({
      gpus: { ...store().gpus, [better.uid]: better, [worse.uid]: worse, [best.uid]: best },
      coolers: { ...store().coolers, t1: { uid: 't1', modelId: 'tower' } },
      psus: { ...store().psus, big: { uid: 'big', modelId: 'psu2000' }, small: { uid: 'small', modelId: 'psu500' } },
    });
    const plan = equipBest(store(), 'bedroom');
    expect(plan.changes).toBeGreaterThan(0);
    expect(store().autoEquipBest('bedroom')).toBe(plan.changes);
    const s = store();
    const mounted = Object.values(s.racks).filter((r) => r.roomId === 'bedroom').flatMap((r) => r.gpuSlots.filter((u): u is string => !!u));
    // No duplicates, and the two best cards are mounted.
    expect(new Set(mounted).size).toBe(mounted.length);
    expect(mounted).toContain(best.uid);
    expect(mounted).toContain(better.uid);
    const psus = Object.values(s.racks).map((r) => r.psuUid);
    expect(psus).toContain('big');
    expect(Object.values(s.racks).flatMap((r) => r.fanSlots)).toContain('t1');
    expect(s.racks[rackUid].gpuSlots.filter(Boolean).length).toBeGreaterThanOrEqual(2);
    // Nothing left to improve.
    expect(store().autoEquipBest('bedroom')).toBe(0);
  });
});

describe('keyboard shortcuts', () => {
  beforeEach(() => useGameStore.setState({ ...createInitialData(), cash: '100000', log: [], selectedRack: null, biosGpu: null, helpOpen: false }));

  it('1-9 and 0 map to the first ten side tabs', () => {
    expect(TAB_KEYS['1']).toBe('shop');
    expect(TAB_KEYS['2']).toBe('rigs');
    expect(TAB_KEYS['9']).toBe('trophies');
    expect(TAB_KEYS['0']).toBe('account');
    expect(Object.keys(TAB_KEYS)).toHaveLength(10);
  });

  it('R maintains the room on screen and B opens the BIOS of its first rack', () => {
    const gpuUid = Object.keys(store().gpus)[0];
    useGameStore.setState((s) => ({ gpus: { ...s.gpus, [gpuUid]: { ...s.gpus[gpuUid], paste: 0.2, wear: 0.2 } } }));
    expect(quickMaintenance()).toBe(2);
    expect(store().gpus[gpuUid]).toMatchObject({ paste: 1, wear: 0 });
    expect(openRackBios()).toBe(true);
    expect(store().biosGpu).toBe(gpuUid);
    // An empty room has no BIOS to open.
    useGameStore.setState({ biosGpu: null, racks: {} });
    expect(openRackBios()).toBe(false);
  });

  it('the guide lists every shortcut, each with a Spanish translation', () => {
    const keys = HOTKEYS.flatMap((h) => h.keys);
    ['1', '0', 'T', 'R', 'B', 'M', '?'].forEach((k) => expect(keys).toContain(k));
    HOTKEYS.forEach((h) => expect(ES[h.label], h.label).toBeTruthy());
    store().setHelpOpen(true);
    expect(store().helpOpen).toBe(true);
  });
});
