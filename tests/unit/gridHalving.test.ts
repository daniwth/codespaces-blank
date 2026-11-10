import { describe, expect, it } from 'vitest';
import { PHYSICS, SAVE_VERSION } from '../../src/config/gameBalance';
import { GPU_CATALOG, PSU_CATALOG, RACK_BY_ID } from '../../src/config/hardwareCatalog';
import { HALVING_MIN_EARNINGS, earningsForSc, nextScMilestone, scForEarnings } from '../../src/config/prestigeTree';
import { ROOM_BY_ID } from '../../src/config/roomsCatalog';
import { gridTariff, simulate, wattPrice } from '../../src/store/gamePhysics';
import { createGpu, createInitialData, createRack } from '../../src/store/initialState';
import { migrateSave } from '../../src/store/migrations';
import { useGameStore } from '../../src/store/useGameStore';
import type { GameData, RoomId } from '../../src/types/player';
import { starterWorld } from './helpers';

const NOW = 1_800_000_000_000;

interface FarmSpec {
  room: RoomId;
  rackId: string;
  gpuId: string;
  coolerId: string;
  psuId: string;
  pads?: number;
}

/** Fill `pads` pads of a room with identical, fully populated racks (technicians keep the paste fresh). */
function farm(spec: FarmSpec): GameData {
  const { data } = starterWorld();
  const model = RACK_BY_ID[spec.rackId];
  data.gpus = {};
  data.coolers = {};
  data.psus = {};
  data.racks = {};
  const pads = spec.pads ?? ROOM_BY_ID[spec.room].pads;
  for (let pad = 0; pad < pads; pad += 1) {
    const rack = { ...createRack(spec.rackId, model.slots, model.fanSlots), roomId: spec.room, pad };
    for (let i = 0; i < model.slots; i += 1) {
      const g = createGpu(spec.gpuId, 'bronze');
      data.gpus[g.uid] = g;
      rack.gpuSlots[i] = g.uid;
    }
    for (let i = 0; i < model.fanSlots; i += 1) {
      const uid = `${rack.uid}-c${i}`;
      data.coolers[uid] = { uid, modelId: spec.coolerId };
      rack.fanSlots[i] = uid;
    }
    const psu = `${rack.uid}-p`;
    data.psus[psu] = { uid: psu, modelId: spec.psuId };
    rack.psuUid = psu;
    data.racks[rack.uid] = rack;
  }
  data.ownedRooms = spec.room === 'bedroom' ? ['bedroom'] : ['bedroom', spec.room];
  data.technicians = 6;
  data.market.CC.price = 1;
  return data;
}

/** Electricity bill as a share of gross mining revenue (at $1 CC) once the farm reached steady state. */
function electricityShare(data: GameData): { share: number; healthy: boolean } {
  const warm = simulate(data, 600, NOW, { offline: true, maxStep: 5 });
  Object.entries(warm.gpuUpdates).forEach(([uid, upd]) => {
    data.gpus[uid] = { ...data.gpus[uid], ...upd };
  });
  data.roomTemps = warm.roomTemps;
  const out = simulate(data, 120, NOW + 120_000, { offline: true, maxStep: 2 });
  const healthy = Object.values(out.live.gpus).every((g) => g.running && !g.throttled);
  return { share: out.electricityPaid / out.ccMined, healthy };
}

describe('grid demand keeps electricity a real cost', () => {
  it('tariffs grow with hash per watt and the starter card pays the base price', () => {
    expect(gridTariff('px460')).toBe(1);
    for (let i = 1; i < GPU_CATALOG.length; i += 1) {
      expect(gridTariff(GPU_CATALOG[i].id)).toBeGreaterThan(gridTariff(GPU_CATALOG[i - 1].id));
    }
    expect(gridTariff('unknown-model')).toBe(1);
  });

  const farms: [string, FarmSpec][] = [
    ['starter bench in the Bedroom', { room: 'bedroom', rackId: 'bench', gpuId: 'px460', coolerId: 'fan80', psuId: 'psu500', pads: 1 }],
    ['mid-game: Warehouse of A100 cabinets', { room: 'warehouse', rackId: 'cabinet', gpuId: 'nca100', coolerId: 'aio', psuId: 'psu5000' }],
    ['late game: Arctic of Leviathan cabinets', { room: 'arctic', rackId: 'cabinet', gpuId: 'leviathan', coolerId: 'immersion', psuId: 'psu30k' }],
    ['end game: Submarine of Singularity cabinets', { room: 'submarine', rackId: 'cabinet', gpuId: 'singularity', coolerId: 'cryo', psuId: 'psu30k' }],
  ];
  it.each(farms)('%s spends 10-30%% of gross revenue on power', (_label, spec) => {
    const { share, healthy } = electricityShare(farm(spec));
    expect(healthy).toBe(true);
    expect(share).toBeGreaterThanOrEqual(0.1);
    expect(share).toBeLessThanOrEqual(0.3);
  });

  it('efficiency choices still pay: a better PSU and Green PPA cut the bill', () => {
    const base = farm({ room: 'warehouse', rackId: 'cabinet', gpuId: 'nca100', coolerId: 'aio', psuId: 'psu5000' });
    const bill = (d: GameData) => simulate(d, 60, NOW, { offline: true, maxStep: 5 }).electricityPaid;
    const ref = bill(base);
    const titanium = { ...base, psus: Object.fromEntries(Object.entries(base.psus).map(([uid, p]) => [uid, { ...p, modelId: 'psu12k' }])) };
    expect(bill(titanium) / ref).toBeCloseTo(0.92 / 0.95, 2);
    expect(bill({ ...base, talents: { hash_core: 1, power_discount: 5 } }) / ref).toBeCloseTo(0.6, 2);
  });

  it('no device is ever net-negative, even on the worst PSU that can carry it in the Bedroom', () => {
    GPU_CATALOG.forEach((m) => {
      const psu = PSU_CATALOG.find((p) => p.capacity >= m.power) ?? PSU_CATALOG[PSU_CATALOG.length - 1];
      const cost = (m.power / psu.efficiency) * wattPrice('bedroom', { electricityMul: 1 }) * gridTariff(m.id);
      const revenue = (m.hashrate / 1e6) * PHYSICS.rewardPerMHs;
      expect(cost / revenue, m.id).toBeLessThan(0.75);
    });
  });

  it('the live grid readout and the bill agree between fine (online) and coarse (offline) steps', () => {
    const data = farm({ room: 'warehouse', rackId: 'cabinet', gpuId: 'vx3080', coolerId: 'tower', psuId: 'psu5000', pads: 2 });
    const online = simulate(data, 30, NOW, { offline: false, maxStep: 1 });
    const offline = simulate(data, 30, NOW, { offline: true, maxStep: 10 });
    expect(online.live.gridDemand).toBeCloseTo(gridTariff('vx3080'), 6);
    expect(offline.electricityPaid).toBeCloseTo(online.electricityPaid, 6);
    const rack = Object.values(online.live.racks)[0];
    expect(rack.tariff).toBeCloseTo(gridTariff('vx3080'), 6);
    expect(rack.powerCost * 2).toBeCloseTo(online.live.electricityPerSec, 6);
  });
});

describe('Halving reward has diminishing returns', () => {
  it('keeps the threshold reward and grows by x2, x3, x4… milestones', () => {
    expect(scForEarnings(HALVING_MIN_EARNINGS - 1)).toBe(0);
    expect(scForEarnings(HALVING_MIN_EARNINGS)).toBe(4);
    expect(scForEarnings(8e6 - 1)).toBe(4);
    expect(scForEarnings(8e6)).toBe(5);
    expect(scForEarnings(24e6)).toBe(6);
    expect(scForEarnings(96e6)).toBe(7);
    expect(scForEarnings(480e6)).toBe(8);
    expect(scForEarnings(Number.NaN)).toBe(0);
    expect(scForEarnings(Number.POSITIVE_INFINITY)).toBeGreaterThan(100);
    for (let sc = 4; sc < 14; sc += 1) {
      expect(scForEarnings(earningsForSc(sc))).toBe(sc);
      expect(nextScMilestone(earningsForSc(sc))).toBe(earningsForSc(sc + 1));
    }
    expect(nextScMilestone(1e5)).toBe(HALVING_MIN_EARNINGS);
  });

  /**
   * Greedy-buyer runs (simulate + createInitialData, 8 h) show run earnings growing like
   * t^6-7 once the farm compounds, reaching the $4M threshold after ~1.7-2.4 h on run 1.
   */
  const scPerHour = (exponent: number, thresholdHours: number) =>
    Array.from({ length: 96 }, (_, i) => {
      const hours = (i + 1) / 12;
      return { hours, rate: scForEarnings(HALVING_MIN_EARNINGS * (hours / thresholdHours) ** exponent) / hours };
    });

  it.each([
    [6.7, 2],
    [6, 1.75],
    [7.5, 2.4],
  ])('$SC per hour peaks inside the run and then declines (earnings ~ t^%s, $4M at %sh)', (exponent, thresholdHours) => {
    const curve = scPerHour(exponent, thresholdHours);
    const best = curve.reduce((a, b) => (b.rate > a.rate ? b : a));
    expect(best.hours).toBeGreaterThan(thresholdHours);
    expect(best.hours).toBeLessThanOrEqual(3.25);
    const last = curve[curve.length - 1];
    expect(last.rate).toBeLessThan(best.rate * 0.8);
  });

  it('a faster run (talents) earns more $SC per hour at its own peak', () => {
    const peak = (thresholdHours: number) => Math.max(...scPerHour(6.7, thresholdHours).map((p) => p.rate));
    expect(peak(1.2)).toBeGreaterThan(peak(2) * 1.4);
  });
});

describe('run clock for the $SC/h readout', () => {
  it('a v4 save is dated from its last tick and future timestamps are clamped', () => {
    const v4 = createInitialData() as unknown as Record<string, unknown>;
    delete v4.runStartedAt;
    v4.saveVersion = 4;
    const lastTick = Date.now() - 3_600_000;
    v4.lastTick = lastTick;
    const migrated = migrateSave(v4, 4);
    expect(SAVE_VERSION).toBeGreaterThanOrEqual(5);
    expect(migrated.runStartedAt).toBe(lastTick);
    expect(migrateSave({ ...createInitialData(), runStartedAt: Date.now() + 1e9 }, 5).runStartedAt).toBeLessThanOrEqual(Date.now());
  });

  it('The Halving restarts the run clock', () => {
    useGameStore.setState({ ...createInitialData(), runEarnings: '24000000', runStartedAt: Date.now() - 7_200_000 });
    const sc = useGameStore.getState().sc;
    expect(useGameStore.getState().performHalving()).toBe(true);
    expect(useGameStore.getState().sc).toBe(sc + 6);
    expect(Date.now() - useGameStore.getState().runStartedAt).toBeLessThan(5_000);
  });
});
