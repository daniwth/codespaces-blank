import { beforeEach, describe, expect, it } from 'vitest';
import { PHYSICS, SAVE_VERSION } from '../../src/config/gameBalance';
import { COOLER_BY_ID, GPU_BY_ID, OC_LIMITS, QUALITY_DEFS, QUALITY_ORDER, RACK_BY_ID } from '../../src/config/hardwareCatalog';
import { RESEARCH_BY_ID } from '../../src/config/research';
import { ROOM_BY_ID, ROOM_MECHANICS, dayPhase, garageWave, isNight, padsAdjacent, secondsToDayFlip, secondsToGarageWave } from '../../src/config/roomsCatalog';
import { DEFAULT_BIOS_PROFILES, DEFAULT_BMC, SYNERGY } from '../../src/config/synergy';
import {
  clusterUids, crashChance, fitOverclock, gpuHealth, liquidCooling, rackNoise, repairCost, repasteCost, simulate, simulateOffline, voltageSaving,
} from '../../src/store/gamePhysics';
import { createGpu, createInitialData, createRack } from '../../src/store/initialState';
import { defaultVFloor, migrateSave } from '../../src/store/migrations';
import { useGameStore } from '../../src/store/useGameStore';
import type { GameData, RoomId } from '../../src/types/player';
import type { SiliconQuality } from '../../src/types/hardware';
import { starterWorld } from './helpers';

const DAY = ROOM_MECHANICS.dayLengthSec * 1000;
/** Start of a day (phase 0) with no garage heat wave nearby. */
const NOON = Math.floor(1_800_000_000_000 / DAY) * DAY + 60_000;
const MIDNIGHT = NOON + DAY / 2;
const settle = { offline: true, maxStep: 2 } as const;
const store = () => useGameStore.getState();

interface RackSpec { pad: number; rackId?: string; gpus: [string, SiliconQuality][]; coolers?: string[]; psuId?: string }

/** A world with exactly the given racks in one room. */
function build(room: RoomId, specs: RackSpec[], patch: Partial<GameData> = {}): { data: GameData; racks: string[]; gpus: string[][] } {
  const data = { ...createInitialData(), ...patch };
  data.gpus = {};
  data.coolers = {};
  data.psus = {};
  data.racks = {};
  data.nextEventAt = Number.MAX_SAFE_INTEGER;
  data.ownedRooms = Array.from(new Set<RoomId>(['bedroom', room]));
  const racks: string[] = [];
  const gpus: string[][] = [];
  specs.forEach((spec) => {
    const model = RACK_BY_ID[spec.rackId ?? 'cabinet'];
    const rack = { ...createRack(model.id, model.slots, model.fanSlots), roomId: room, pad: spec.pad };
    const uids: string[] = [];
    spec.gpus.forEach(([modelId, quality], i) => {
      const g = createGpu(modelId, quality);
      data.gpus[g.uid] = g;
      rack.gpuSlots[i] = g.uid;
      uids.push(g.uid);
    });
    (spec.coolers ?? []).forEach((coolerId, i) => {
      const uid = `${rack.uid}-c${i}`;
      data.coolers[uid] = { uid, modelId: coolerId };
      rack.fanSlots[i] = uid;
    });
    const psu = `${rack.uid}-p`;
    data.psus[psu] = { uid: psu, modelId: spec.psuId ?? 'psu30k' };
    rack.psuUid = psu;
    data.racks[rack.uid] = rack;
    racks.push(rack.uid);
    gpus.push(uids);
  });
  return { data, racks, gpus };
}

const same = (modelId: string, quality: SiliconQuality, n: number): [string, SiliconQuality][] => Array.from({ length: n }, () => [modelId, quality]);

describe('Cluster Bonus', () => {
  it('needs four GPUs of one model and one grade in the same rack', () => {
    const gpus = { a: { modelId: 'px460', quality: 'bronze' as const }, b: { modelId: 'px460', quality: 'bronze' as const }, c: { modelId: 'px460', quality: 'bronze' as const }, d: { modelId: 'px460', quality: 'silver' as const }, e: { modelId: 'px580', quality: 'bronze' as const }, f: { modelId: 'px460', quality: 'bronze' as const } };
    expect(clusterUids(['a', 'b', 'c', 'd', 'e'], gpus).size).toBe(0);
    expect([...clusterUids(['a', 'b', 'c', 'd', 'e', 'f'], gpus)].sort()).toEqual(['a', 'b', 'c', 'f']);
    expect(clusterUids(['a', 'b', 'c', 'missing'], gpus).size).toBe(0);
  });

  it('gives +8% hashrate and -5% power draw, with the same heat', () => {
    const mixed = build('warehouse', [{ pad: 0, gpus: [...same('px460', 'bronze', 3), ['px460', 'silver']], coolers: ['tower', 'tower'] }]);
    const cluster = build('warehouse', [{ pad: 0, gpus: same('px460', 'bronze', 4), coolers: ['tower', 'tower'] }]);
    const a = simulate(mixed.data, 300, NOON, settle);
    const b = simulate(cluster.data, 300, NOON, settle);
    const fans = 2 * COOLER_BY_ID.tower.power;
    expect(a.live.racks[mixed.racks[0]].clustered).toBe(0);
    expect(b.live.racks[cluster.racks[0]].clustered).toBe(4);
    expect(b.live.totalHash).toBeCloseTo(a.live.totalHash * (1 + SYNERGY.clusterHash), -3);
    expect(b.live.racks[cluster.racks[0]].load - fans).toBeCloseTo((a.live.racks[mixed.racks[0]].load - fans) * (1 - SYNERGY.clusterPower), 6);
    expect(b.electricityPaid).toBeLessThan(a.electricityPaid);
    // Same heat per die: the cooling a build needs does not change.
    expect(b.gpuUpdates[cluster.gpus[0][0]].temp).toBeCloseTo(a.gpuUpdates[mixed.gpus[0][0]].temp, 0);
    expect(b.live.gpus[cluster.gpus[0][0]].clustered).toBe(true);
  });
});

describe('Liquid Cooling Spillover', () => {
  it('pads are neighbours only side by side in the same row', () => {
    expect(padsAdjacent(0, 1, 6)).toBe(true);
    expect(padsAdjacent(0, 2, 6)).toBe(false);
    // 10 pads = two rows of five: pad 4 ends the first row, pad 5 starts the second.
    expect(padsAdjacent(4, 5, 10)).toBe(false);
    expect(padsAdjacent(5, 6, 10)).toBe(true);
  });

  it('a liquid rack cools the air-cooled rack next to it, not one two pads away nor another liquid rack', () => {
    const air = { gpus: same('vx2070', 'bronze', 2), coolers: ['tower', 'tower'], rackId: 'steel' };
    const liquid = { gpus: same('vx2070', 'bronze', 2), coolers: ['aio', 'aio'], rackId: 'steel' };
    const alone = build('warehouse', [{ pad: 0, ...air }]);
    const next = build('warehouse', [{ pad: 0, ...air }, { pad: 1, ...liquid }]);
    const far = build('warehouse', [{ pad: 0, ...air }, { pad: 2, ...liquid }]);
    const both = build('warehouse', [{ pad: 0, ...liquid }, { pad: 1, ...liquid }]);
    const t = (w: typeof alone) => simulate(w.data, 600, NOON, settle);
    const base = t(alone);
    const helped = t(next);
    expect(liquidCooling(next.data.racks[next.racks[1]], next.data.coolers)).toBe(2 * COOLER_BY_ID.aio.cooling);
    expect(helped.live.racks[next.racks[0]].spill).toBeCloseTo(2 * COOLER_BY_ID.aio.cooling * SYNERGY.spillShare, 10);
    expect(helped.gpuUpdates[next.gpus[0][0]].temp).toBeLessThan(base.gpuUpdates[alone.gpus[0][0]].temp - 3);
    expect(t(far).live.racks[far.racks[0]].spill).toBe(0);
    const closed = t(both);
    expect(closed.live.racks[both.racks[0]].spill).toBe(0);
    expect(closed.live.racks[both.racks[1]].spill).toBe(0);
  });

  it('stops when the liquid rack loses power', () => {
    const w = build('warehouse', [{ pad: 0, gpus: same('vx2070', 'bronze', 2), coolers: ['tower'], rackId: 'steel' }, { pad: 1, gpus: same('vx2070', 'bronze', 2), coolers: ['aio'], rackId: 'steel' }]);
    w.data.racks[w.racks[1]] = { ...w.data.racks[w.racks[1]], psuUid: null };
    expect(simulate(w.data, 5, NOON, settle).live.racks[w.racks[0]].spill).toBe(0);
  });
});

describe('undervolt and BIOS profiles', () => {
  it('every chip has a voltage floor: better silicon undervolts deeper', () => {
    QUALITY_ORDER.forEach((q, i) => {
      const g = createGpu('px460', q);
      expect(g.silicon.vFloor).toBeGreaterThanOrEqual(QUALITY_DEFS[q].vFloor[0]);
      expect(g.silicon.vFloor).toBeLessThanOrEqual(QUALITY_DEFS[q].vFloor[1]);
      if (i > 0) expect(QUALITY_DEFS[q].vFloor[1]).toBeLessThan(QUALITY_DEFS[QUALITY_ORDER[i - 1]].vFloor[1]);
    });
  });

  it('crashes below the floor, is risky just above it and saves power quadratically', () => {
    const silicon = { coreHeadroom: 400, memHeadroom: 1500, vScale: 6, vFloor: 900 };
    const at = (voltage: number) => crashChance(silicon, { core: -200, mem: 0, voltage });
    expect(at(895)).toBe(1);
    expect(at(905)).toBe(0.35);
    expect(at(900 + OC_LIMITS.voltageMargin)).toBe(0);
    expect(voltageSaving(900)).toBeCloseTo(0.19, 10);
    expect(voltageSaving(1000)).toBe(0);
    expect(voltageSaving(1100)).toBeLessThan(0);
  });

  it('fitOverclock always returns crash-free settings and keeps what the chip can hold', () => {
    const profiles = [...Object.values(DEFAULT_BIOS_PROFILES), { core: 500, mem: 1500, voltage: 800 }, { core: -200, mem: -500, voltage: 1200 }];
    for (let i = 0; i < 300; i += 1) {
      const g = createGpu('px460', QUALITY_ORDER[i % 4]);
      profiles.forEach((oc) => {
        const fit = fitOverclock(g.silicon, oc);
        expect(crashChance(g.silicon, fit)).toBe(0);
        expect(fit.core).toBeLessThanOrEqual(oc.core);
        expect(fit.mem).toBeLessThanOrEqual(oc.mem);
        expect(fit.voltage).toBeGreaterThanOrEqual(oc.voltage);
      });
    }
    const strong = { coreHeadroom: 420, memHeadroom: 1500, vScale: 20, vFloor: 810 };
    expect(fitOverclock(strong, DEFAULT_BIOS_PROFILES.balanced)).toEqual(DEFAULT_BIOS_PROFILES.balanced);
  });

  describe('store', () => {
    beforeEach(() => useGameStore.setState({ ...createInitialData(), cash: '100000', log: [] }));

    it('saves a profile (clamped) and applies one to every GPU of a model without crashing any', () => {
      store().saveBiosProfile('eco', { core: -9999, mem: 100, voltage: 905 });
      expect(store().biosProfiles.eco).toEqual({ core: OC_LIMITS.core.min, mem: 100, voltage: 905 });
      const gpus = { ...store().gpus };
      for (let i = 0; i < 12; i += 1) {
        const g = createGpu('px460', QUALITY_ORDER[i % 4]);
        gpus[g.uid] = g;
      }
      const other = createGpu('px580', 'god');
      gpus[other.uid] = other;
      useGameStore.setState({ gpus });
      const bsods = store().stats.bsods;
      const n = store().applyProfileToModel('px460', DEFAULT_BIOS_PROFILES.max);
      expect(n).toBe(13);
      Object.values(store().gpus).forEach((g) => {
        if (g.modelId !== 'px460') return;
        expect(crashChance(g.silicon, g.oc)).toBe(0);
        expect(g.oc.voltage).toBe(DEFAULT_BIOS_PROFILES.max.voltage);
      });
      expect(store().gpus[other.uid].oc).toEqual(other.oc);
      expect(store().stats.bsods).toBe(bsods);
      expect(store().applyProfileToModel('nope', DEFAULT_BIOS_PROFILES.max)).toBe(0);
    });

    it('is refused while a No Overclock challenge locks the BIOS', () => {
      useGameStore.setState({ challenge: { id: 'no_overclock', startedAt: Date.now() } });
      expect(store().applyProfileToModel('px460', DEFAULT_BIOS_PROFILES.max)).toBe(0);
      expect(Object.values(store().gpus)[0].oc.core).toBe(0);
    });
  });
});

describe('room identity', () => {
  it('shares one day/night clock', () => {
    expect(isNight(NOON)).toBe(false);
    expect(isNight(MIDNIGHT)).toBe(true);
    expect(dayPhase(NOON + DAY)).toBeCloseTo(dayPhase(NOON), 10);
    expect(secondsToDayFlip(NOON)).toBeCloseTo(ROOM_MECHANICS.dayLengthSec / 2 - 60, 6);
  });

  it('Bedroom: loud fans at night halve the overclock bonus; quiet coolers or daytime do not', () => {
    const loud = (coolers: string[]) => {
      const w = build('bedroom', [{ pad: 0, rackId: 'steel', gpus: same('px460', 'bronze', 2), coolers, psuId: 'psu1000' }]);
      w.gpus[0].forEach((uid) => {
        w.data.gpus[uid] = { ...w.data.gpus[uid], ocBonus: 0.2 };
      });
      return w;
    };
    const noisy = loud(['fan120', 'fan120', 'fan120']);
    expect(rackNoise(noisy.data.racks[noisy.racks[0]], noisy.data.coolers)).toBe(60);
    const day = simulate(noisy.data, 1, NOON, settle);
    const night = simulate(noisy.data, 1, MIDNIGHT, settle);
    expect(day.live.rooms.bedroom?.ocCapped).toBe(false);
    expect(night.live.rooms.bedroom?.ocCapped).toBe(true);
    expect(night.live.night).toBe(true);
    expect(night.live.totalHash / day.live.totalHash).toBeCloseTo((1 + 0.2 * ROOM_MECHANICS.bedroom.nightOcShare) / 1.2, 6);
    const quiet = loud(['tower', 'tower', 'tower']);
    expect(simulate(quiet.data, 1, MIDNIGHT, settle).live.rooms.bedroom?.ocCapped).toBe(false);
    // A negative offset (underclock) is never "capped" upwards.
    noisy.gpus[0].forEach((uid) => {
      noisy.data.gpus[uid] = { ...noisy.data.gpus[uid], ocBonus: -0.1 };
    });
    const under = simulate(noisy.data, 1, MIDNIGHT, settle);
    expect(under.live.totalHash).toBeCloseTo(2 * GPU_BY_ID.px460.hashrate * 0.9, -3);
  });

  it('Garage: heat waves come and go on schedule', () => {
    const g = ROOM_MECHANICS.garage;
    const wait = secondsToGarageWave(NOON);
    expect(garageWave(NOON)).toBe(0);
    expect(wait).toBeGreaterThan(0);
    const peak = NOON + (wait + g.waveSec / 2) * 1000;
    expect(garageWave(peak)).toBeCloseTo(g.delta, 6);
    expect(secondsToGarageWave(peak)).toBe(0);
    expect(garageWave(peak + g.waveSec * 1000)).toBe(0);
    const w = build('garage', [{ pad: 0, rackId: 'steel', gpus: same('px460', 'bronze', 1), coolers: ['fan120'], psuId: 'psu1000' }]);
    expect(simulate(w.data, 1, peak, settle).live.rooms.garage?.ambient).toBeCloseTo(ROOM_BY_ID.garage.ambient + g.delta, 6);
    expect(simulate(w.data, 1, NOON, settle).live.rooms.garage?.ambient).toBe(ROOM_BY_ID.garage.ambient);
  });

  it('Warehouse: the battery bank makes night power cheaper, and only there', () => {
    const w = build('warehouse', [{ pad: 0, gpus: same('vx2070', 'bronze', 4), coolers: ['tower', 'tower'] }]);
    const bill = (now: number, battery: boolean) => simulate({ ...w.data, upgrades: { battery } }, 1, now, settle).live.electricityPerSec;
    expect(bill(MIDNIGHT, true)).toBeCloseTo(bill(MIDNIGHT, false) * ROOM_MECHANICS.warehouse.valleyMul, 10);
    expect(bill(NOON, true)).toBeCloseTo(bill(NOON, false), 10);
    const g = build('garage', [{ pad: 0, gpus: same('vx2070', 'bronze', 4), coolers: ['tower', 'tower'] }]);
    const garage = (battery: boolean) => simulate({ ...g.data, upgrades: { battery } }, 1, MIDNIGHT, settle).live.electricityPerSec;
    expect(garage(true)).toBeCloseTo(garage(false), 10);
  });

  it('Arctic: a card that sat cold and off pre-heats before it hashes; a working one never condenses', () => {
    const w = build('arctic', [{ pad: 0, gpus: same('hydra', 'bronze', 2), coolers: ['cryo', 'cryo', 'cryo', 'cryo'] }]);
    const [a] = w.gpus[0];
    // Powered off (no PSU) and frozen: condensation sets in.
    const off = { ...w.data, racks: { ...w.data.racks, [w.racks[0]]: { ...w.data.racks[w.racks[0]], psuUid: null } } };
    off.gpus = { ...off.gpus, [a]: { ...off.gpus[a], temp: -8 } };
    const frozen = simulate(off, 5, NOON, settle);
    expect(frozen.gpuUpdates[a].condensed).toBe(true);
    // Powered again: heater strip, no hashing, then it dries and mines.
    const on = { ...w.data, gpus: { ...w.data.gpus, [a]: { ...w.data.gpus[a], ...frozen.gpuUpdates[a] } } };
    const first = simulate(on, 1, NOON, { offline: false, maxStep: 1 });
    expect(first.live.gpus[a].preheating).toBe(true);
    expect(first.live.gpus[a].hash).toBe(0);
    expect(first.live.racks[w.racks[0]].preheating).toBe(1);
    const later = simulate(on, 900, NOON, settle);
    expect(later.gpuUpdates[a].condensed).toBe(false);
    expect(later.live.gpus[a].hash).toBeGreaterThan(0);
    // Massively over-cooled and running: cold, but dry and hashing the whole time.
    const cold = simulate(w.data, 900, NOON, settle);
    w.gpus[0].forEach((uid) => {
      expect(cold.gpuUpdates[uid].condensed).toBe(false);
      expect(cold.live.gpus[uid].hash).toBeGreaterThan(0);
    });
    // Elsewhere the flag is cleared.
    const bed = build('bedroom', [{ pad: 0, rackId: 'bench', gpus: same('px460', 'bronze', 1), psuId: 'psu500' }]);
    bed.data.gpus[bed.gpus[0][0]] = { ...bed.data.gpus[bed.gpus[0][0]], condensed: true };
    expect(simulate(bed.data, 1, NOON, settle).gpuUpdates[bed.gpus[0][0]].condensed).toBe(false);
  });

  it('Submarine: cools best, but only 84 GPUs run; the rest stay idle', () => {
    expect(ROOM_BY_ID.submarine.coolingMul).toBeGreaterThan(ROOM_BY_ID.arctic.coolingMul);
    const cap = ROOM_BY_ID.submarine.maxGpus ?? 0;
    expect(cap).toBe(84);
    const specs = Array.from({ length: 11 }, (_, pad) => ({ pad, gpus: same('px460', 'bronze', 8), coolers: ['tower', 'tower', 'tower', 'tower'] }));
    const w = build('submarine', specs);
    const out = simulate(w.data, 5, NOON, settle);
    const running = Object.values(out.live.gpus).filter((g) => g.running).length;
    expect(running).toBe(cap);
    expect(out.live.rooms.submarine?.gpusOverCap).toBe(88 - cap);
    expect(out.live.rooms.submarine?.gpuCap).toBe(cap);
    // Pad order: the last rack is the one left partly idle.
    expect(out.live.racks[w.racks[10]].idle).toBe(4);
    expect(out.live.racks[w.racks[0]].idle).toBe(0);
  });
});

describe('Smart BMC', () => {
  const withBmc = (patch: Partial<GameData> = {}) => {
    const w = starterWorld({ research: { levels: { bmc: 1 }, active: null }, cash: '1000', ...patch });
    return w;
  };

  it('is a one-level Lab project', () => {
    expect(RESEARCH_BY_ID.bmc.maxLevel).toBe(1);
    expect(DEFAULT_BMC.pasteBelow).toBe(0.25);
    expect(DEFAULT_BMC.healthBelow).toBe(0.4);
  });

  it('re-pastes and repairs past the thresholds, paying the normal price', () => {
    const w = withBmc();
    const g = { ...w.input.gpus[w.gpuUid], paste: 0.2, wear: PHYSICS.maxWear * 0.7 };
    w.input.gpus[w.gpuUid] = g;
    expect(gpuHealth(g)).toBeCloseTo(0.3, 10);
    const out = simulate(w.input, 1, NOON, { offline: false, maxStep: 1 });
    expect(out.bmc).toEqual({ pasted: 1, repaired: 1, spent: repasteCost(g) + repairCost(g) });
    expect(out.gpuUpdates[w.gpuUid].paste).toBeGreaterThan(0.99);
    expect(out.gpuUpdates[w.gpuUid].wear).toBe(0);
    expect(out.cashDelta).toBeLessThanOrEqual(-out.bmc.spent + 1);
    expect(out.earnedCash).toBe(0);
    expect(out.messages.some((m) => m.key?.startsWith('SMART BMC'))).toBe(true);
  });

  it('respects thresholds, switches, the research and an empty wallet', () => {
    const run = (patch: Partial<GameData>, gpu: { paste: number; wear: number }) => {
      const w = withBmc(patch);
      w.input.gpus[w.gpuUid] = { ...w.input.gpus[w.gpuUid], ...gpu };
      return simulate(w.input, 1, NOON, { offline: false, maxStep: 1 }).bmc;
    };
    const worn = { paste: 0.2, wear: PHYSICS.maxWear * 0.7 };
    expect(run({}, { paste: 0.3, wear: PHYSICS.maxWear * 0.5 })).toEqual({ pasted: 0, repaired: 0, spent: 0 });
    expect(run({ bmc: { ...DEFAULT_BMC, enabled: false } }, worn).spent).toBe(0);
    expect(run({ bmc: { ...DEFAULT_BMC, autoRepair: false } }, worn)).toMatchObject({ pasted: 1, repaired: 0 });
    expect(run({ bmc: { ...DEFAULT_BMC, autoPaste: false } }, worn)).toMatchObject({ pasted: 0, repaired: 1 });
    expect(run({ research: { levels: {}, active: null } }, worn).spent).toBe(0);
    expect(run({ cash: '0' }, worn).spent).toBe(0);
    expect(run({ bmc: { ...DEFAULT_BMC, pasteBelow: 0.5 } }, { paste: 0.4, wear: 0 }).pasted).toBe(1);
  });

  it('also works during offline catch-up, silently', () => {
    const w = withBmc();
    w.input.gpus[w.gpuUid] = { ...w.input.gpus[w.gpuUid], paste: 0.1 };
    const out = simulateOffline(w.input, 600, NOON);
    expect(out.bmc.pasted).toBeGreaterThanOrEqual(1);
    expect(out.messages).toEqual([]);
  });

  it('thresholds are clamped by the store', () => {
    useGameStore.setState({ ...createInitialData() });
    store().setBmc({ pasteBelow: 5, healthBelow: -1, enabled: false });
    expect(store().bmc).toEqual({ ...DEFAULT_BMC, enabled: false, pasteBelow: 0.9, healthBelow: 0.1 });
  });
});

describe('battery bank purchase', () => {
  beforeEach(() => useGameStore.setState({ ...createInitialData(), cash: '1000000', log: [] }));

  it('needs the Warehouse, costs cash and is bought once', () => {
    expect(store().buyRoomUpgrade('battery')).toBe(false);
    useGameStore.setState({ ownedRooms: ['bedroom', 'garage', 'warehouse'] });
    expect(store().buyRoomUpgrade('battery')).toBe(true);
    expect(store().upgrades.battery).toBe(true);
    expect(Number(store().cash)).toBe(1_000_000 - ROOM_MECHANICS.warehouse.batteryPrice);
    expect(store().buyRoomUpgrade('battery')).toBe(false);
    useGameStore.setState({ upgrades: { battery: false }, cash: '10' });
    expect(store().buyRoomUpgrade('battery')).toBe(false);
  });
});

describe('save v9: phase 3 fields', () => {
  it('older chips get a fixed undervolt floor inside their grade, and new systems start at their defaults', () => {
    const v8 = JSON.parse(JSON.stringify(createInitialData())) as { gpus: Record<string, { silicon: Record<string, unknown>; quality: SiliconQuality; condensed?: boolean }> } & Record<string, unknown>;
    const uid = Object.keys(v8.gpus)[0];
    delete v8.gpus[uid].silicon.vFloor;
    delete v8.gpus[uid].condensed;
    delete v8.upgrades;
    delete v8.bmc;
    delete v8.biosProfiles;
    const a = migrateSave(JSON.parse(JSON.stringify(v8)), 8);
    const b = migrateSave(JSON.parse(JSON.stringify(v8)), 8);
    expect(a.saveVersion).toBe(SAVE_VERSION);
    expect(a.gpus[uid].silicon.vFloor).toBe(defaultVFloor(uid, 'bronze'));
    expect(a.gpus[uid].silicon.vFloor).toBe(b.gpus[uid].silicon.vFloor);
    expect(a.gpus[uid].silicon.vFloor).toBeGreaterThanOrEqual(QUALITY_DEFS.bronze.vFloor[0]);
    expect(a.gpus[uid].silicon.vFloor).toBeLessThanOrEqual(QUALITY_DEFS.bronze.vFloor[1]);
    expect(a.gpus[uid].condensed).toBe(false);
    expect(a.upgrades).toEqual({ battery: false });
    expect(a.bmc).toEqual(DEFAULT_BMC);
    expect(a.biosProfiles).toEqual(DEFAULT_BIOS_PROFILES);
  });

  it('round-trips and sanitizes tampered values', () => {
    const data = createInitialData();
    data.ownedRooms = ['bedroom', 'garage', 'warehouse'];
    data.upgrades = { battery: true };
    data.bmc = { enabled: false, autoPaste: false, pasteBelow: 0.4, autoRepair: true, healthBelow: 0.6 };
    data.biosProfiles = { ...data.biosProfiles, eco: { core: -100, mem: -50, voltage: 880 } };
    const back = migrateSave(JSON.parse(JSON.stringify(data)), SAVE_VERSION);
    expect(back.upgrades).toEqual(data.upgrades);
    expect(back.bmc).toEqual(data.bmc);
    expect(back.biosProfiles).toEqual(data.biosProfiles);

    const bad = JSON.parse(JSON.stringify(data)) as Record<string, unknown>;
    bad.ownedRooms = ['bedroom'];
    bad.bmc = { enabled: 'yes', pasteBelow: 99, healthBelow: Number.NaN };
    bad.biosProfiles = { eco: { core: 1e9, mem: 'x', voltage: 5 }, max: null };
    const clean = migrateSave(bad, SAVE_VERSION);
    // No Warehouse, no battery.
    expect(clean.upgrades.battery).toBe(false);
    expect(clean.bmc).toEqual({ ...DEFAULT_BMC, pasteBelow: 0.9 });
    expect(clean.biosProfiles.eco).toEqual({ core: OC_LIMITS.core.max, mem: DEFAULT_BIOS_PROFILES.eco.mem, voltage: OC_LIMITS.voltage.min });
    expect(clean.biosProfiles.max).toEqual(DEFAULT_BIOS_PROFILES.max);
  });
});
