import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ENERGY, PPA_PLANS, PPA_PLAN_IDS, SPOT_MAX, SPOT_MIN, gridSpot, ppaCancelFee, ppaQuote, ppaRateBounds } from '../../src/config/energy';
import { PHYSICS } from '../../src/config/gameBalance';
import { runModifiers } from '../../src/config/modifiers';
import { RESEARCH_BY_ID, researchModifiers } from '../../src/config/research';
import { ROOM_BY_ID, surgeProtectorPrice } from '../../src/config/roomsCatalog';
import { FORECAST_HORIZON_SEC, SURGE } from '../../src/config/synergy';
import { ES } from '../../src/i18n/es';
import { HEALTH_WORN_BELOW, PASTE_WORN_BELOW, diagnoseFarm, maintenanceForecast, simulate, simulateOffline } from '../../src/store/gamePhysics';
import { createGpu, createInitialData, createRack } from '../../src/store/initialState';
import { migrateSave } from '../../src/store/migrations';
import { rackFxLabel, useGameStore } from '../../src/store/useGameStore';
import type { PowerContract } from '../../src/types/economy';
import type { GameData } from '../../src/types/player';
import { bnToNumber } from '../../src/utils/bignum';
import { starterWorld } from './helpers';

const NOW = 1_800_000_000_000 - (1_800_000_000_000 % 600_000) + 60_000;
const online = { offline: false, maxStep: 1 } as const;
const store = () => useGameStore.getState();
const DESK = { levels: { energy: 1 }, active: null };

afterEach(() => vi.restoreAllMocks());

/** Moment inside [from, from + span) where the spot index is lowest / highest (1 s grid). */
function extreme(kind: 'min' | 'max', from = NOW, spanSec = 1800): number {
  let best = from;
  for (let t = from; t < from + spanSec * 1000; t += 1000) {
    if (kind === 'min' ? gridSpot(t) < gridSpot(best) : gridSpot(t) > gridSpot(best)) best = t;
  }
  return best;
}

const contract = (rate: number, endsAt: number, plan: PowerContract['plan'] = 'short'): PowerContract => ({ plan, rate, signedAt: NOW, endsAt, saved: 0 });

describe('wholesale spot index', () => {
  it('stays inside its band and averages the documented mean', () => {
    let sum = 0;
    const n = 20_000;
    for (let i = 0; i < n; i += 1) {
      const v = gridSpot(NOW + i * 7_000);
      expect(v).toBeGreaterThanOrEqual(SPOT_MIN - 1e-9);
      expect(v).toBeLessThanOrEqual(SPOT_MAX + 1e-9);
      sum += v;
    }
    expect(sum / n).toBeCloseTo(ENERGY.mean, 2);
    expect(SPOT_MIN).toBeGreaterThan(0.5);
    expect(ENERGY.mean).toBeLessThan(1);
  });

  it('without the Energy Desk the bill is the flat retail tariff, whatever the clock or the contract', () => {
    const w = starterWorld();
    const a = simulate(w.input, 1, extreme('min'), online);
    const b = simulate({ ...w.input, ppa: contract(0.5, Number.MAX_SAFE_INTEGER) }, 1, extreme('max'), online);
    expect(a.live.energyMul).toBe(1);
    expect(a.live.gridSpot).toBe(1);
    expect(b.live.electricityPerSec).toBeCloseTo(a.live.electricityPerSec, 12);
    expect(b.ppaSaved).toBe(0);
  });

  it('with the Energy Desk the bill follows the index, and its mean offline', () => {
    const w = starterWorld();
    const base = simulate(w.input, 1, NOW, online).live.electricityPerSec;
    const low = extreme('min');
    const high = extreme('max');
    const desk = { ...w.input, research: DESK };
    expect(simulate(desk, 1, low, online).live.electricityPerSec).toBeCloseTo(base * gridSpot(low), 10);
    expect(simulate(desk, 1, high, online).live.electricityPerSec).toBeCloseTo(base * gridSpot(high), 10);
    expect(gridSpot(high)).toBeGreaterThan(1);
    expect(gridSpot(low)).toBeLessThan(0.8);
    const off = simulateOffline(desk, 3600, high);
    expect(off.live.energyMul).toBe(ENERGY.mean);
    expect(off.electricityPaid).toBeCloseTo(simulateOffline(w.input, 3600, high).electricityPaid * ENERGY.mean, 6);
  });
});

describe('power contracts', () => {
  it('quotes lean towards the spot price: cheap in a trough, dear on a peak, always inside the plan band', () => {
    const low = extreme('min');
    const high = extreme('max');
    PPA_PLAN_IDS.forEach((id) => {
      const [lo, hi] = ppaRateBounds(id);
      expect(ppaQuote(id, low)).toBeLessThan(ppaQuote(id, high));
      expect(ppaQuote(id, low)).toBeGreaterThanOrEqual(lo - 5e-4);
      expect(ppaQuote(id, high)).toBeLessThanOrEqual(hi + 5e-4);
      // A contract never beats the spot price of the very moment it is signed in a trough.
      expect(ppaQuote(id, low)).toBeGreaterThan(gridSpot(low));
    });
    // The long plan follows the spot less: a narrower band.
    expect(ppaQuote('long', low)).toBeGreaterThan(ppaQuote('short', low));
    expect(ppaQuote('long', high)).toBeLessThan(ppaQuote('short', high));
    // A trough signature beats the long-run average; a peak one does not.
    expect(ppaQuote('short', low)).toBeLessThan(ENERGY.mean);
    expect(ppaQuote('short', high)).toBeGreaterThan(ENERGY.mean);
  });

  it('a contract in force replaces the index and reports what it saved against it', () => {
    const w = starterWorld();
    const base = simulate(w.input, 1, NOW, online).live.electricityPerSec;
    const high = extreme('max');
    const input = { ...w.input, research: DESK, ppa: contract(0.8, high + 60_000) };
    const out = simulate(input, 1, high, online);
    expect(out.live.energyMul).toBe(0.8);
    expect(out.live.gridSpot).toBeCloseTo(gridSpot(high), 12);
    expect(out.live.electricityPerSec).toBeCloseTo(base * 0.8, 10);
    expect(out.ppaSaved).toBeCloseTo(base * (gridSpot(high) - 0.8), 8);
    expect(out.ppaSaved).toBeGreaterThan(0);
    // The same contract loses money in a trough.
    const low = extreme('min');
    expect(simulate({ ...input, ppa: contract(0.8, low + 60_000) }, 1, low, online).ppaSaved).toBeLessThan(0);
    // An expired contract is ignored.
    const expired = simulate({ ...input, ppa: contract(0.8, high - 1) }, 1, high, online);
    expect(expired.live.energyMul).toBeCloseTo(gridSpot(high), 12);
    expect(expired.ppaSaved).toBe(0);
  });

  it('offline, a contract is billed at its rate until it ends and at the mean afterwards', () => {
    const w = starterWorld();
    const flat = simulateOffline(w.input, 7200, NOW).electricityPaid;
    const half = simulateOffline({ ...w.input, research: DESK, ppa: contract(0.7, NOW - 3600_000) }, 7200, NOW).electricityPaid;
    expect(half / flat).toBeCloseTo((0.7 + ENERGY.mean) / 2, 3);
  });

  describe('store', () => {
    beforeEach(() => {
      useGameStore.setState({ ...starterWorld().data, cash: '100000', screen: 'game' });
    });

    it('needs the research, locks the quote of the moment and allows one contract at a time', () => {
      expect(store().signPpa('short', NOW)).toBe(false);
      expect(store().ppa).toBeNull();
      useGameStore.setState({ research: DESK });
      expect(store().signPpa('short', NOW)).toBe(true);
      expect(store().ppa).toEqual({ plan: 'short', rate: ppaQuote('short', NOW), signedAt: NOW, endsAt: NOW + PPA_PLANS.short.durationSec * 1000, saved: 0 });
      expect(store().signPpa('long', NOW + 1000)).toBe(false);
      expect(store().ppa?.plan).toBe('short');
    });

    it('cancelling charges the early termination fee', () => {
      useGameStore.setState({ research: DESK });
      store().signPpa('long', NOW);
      useGameStore.setState({ live: { ...store().live, electricityPerSec: 2 } });
      const ppa = store().ppa as PowerContract;
      const fee = ppaCancelFee(ppa, 2, NOW + 60_000);
      expect(fee).toBe(Math.round((PPA_PLANS.long.durationSec - 60) * 2 * ENERGY.cancelFee));
      expect(store().cancelPpa(NOW + 60_000)).toBe(true);
      expect(store().ppa).toBeNull();
      expect(bnToNumber(store().cash)).toBeCloseTo(100000 - fee, 6);
      expect(store().cancelPpa(NOW + 60_000)).toBe(false);
      // Not enough cash: the contract stays.
      store().signPpa('long', NOW);
      useGameStore.setState({ cash: '1' });
      expect(store().cancelPpa(NOW + 1000)).toBe(false);
      expect(store().ppa).not.toBeNull();
    });

    it('ticks add up the savings and drop the contract when it ends', () => {
      const high = extreme('max');
      useGameStore.setState({ research: DESK, ppa: contract(0.8, high + 1500) });
      const first = simulate(store(), 1, high, online);
      store().applyTick(first);
      expect(store().ppa?.saved).toBeCloseTo(first.ppaSaved, 10);
      expect(first.ppaSaved).toBeGreaterThan(0);
      store().applyTick(simulate(store(), 1, high + 1000, online));
      expect(store().ppa).not.toBeNull();
      store().applyTick(simulate(store(), 1, high + 2000, online));
      expect(store().ppa).toBeNull();
      expect(store().log.some((l) => l.key?.startsWith('Your power contract ended'))).toBe(true);
    });
  });

  it('save: no contract before v10, and a tampered one is clamped or dropped', () => {
    const raw: Record<string, unknown> = JSON.parse(JSON.stringify(createInitialData()));
    expect(migrateSave({ ...raw, ppa: { plan: 'short', rate: 0.1, signedAt: 0, endsAt: Date.now() + 60_000, saved: 5 } }, 9).ppa).toBeNull();
    const [lo, hi] = ppaRateBounds('short');
    const cheap = migrateSave({ ...raw, ppa: { plan: 'short', rate: 0.01, signedAt: Date.now() + 9e9, endsAt: Date.now() + 9e12, saved: Number.NaN } }, 10).ppa;
    expect(cheap?.rate).toBeCloseTo(lo, 10);
    expect(cheap?.saved).toBe(0);
    expect(cheap?.signedAt).toBeLessThanOrEqual(Date.now());
    expect((cheap?.endsAt ?? 0) - Date.now()).toBeLessThanOrEqual(PPA_PLANS.short.durationSec * 1000);
    expect(migrateSave({ ...raw, ppa: { plan: 'short', rate: 9, endsAt: Date.now() + 60_000 } }, 10).ppa?.rate).toBeCloseTo(hi, 10);
    expect(migrateSave({ ...raw, ppa: { plan: 'short', rate: 0.9, endsAt: Date.now() - 1 } }, 10).ppa).toBeNull();
    expect(migrateSave({ ...raw, ppa: { plan: 'forever', rate: 0.9, endsAt: Date.now() + 60_000 } }, 10).ppa).toBeNull();
    expect(migrateSave({ ...raw, ppa: 'x' }, 10).ppa).toBeNull();
    // A new run never inherits a contract.
    expect(createInitialData({ ppa: contract(0.8, Date.now() + 60_000) }).ppa).toBeNull();
  });
});

// ───────────────────────── Power surges ─────────────────────────

/** Starter rig on pad 0 plus a second, healthy rig on `pad`. The starter card is about to shut down. */
function twoRacks(pad = 1): { data: GameData; hot: string; neighbour: string } {
  const w = starterWorld();
  const data = w.data;
  const g = createGpu('px460', 'bronze');
  const rack = createRack('bench', 2, 1);
  rack.roomId = 'bedroom';
  rack.pad = pad;
  rack.gpuSlots[0] = g.uid;
  rack.psuUid = 'psu-b';
  rack.fanSlots[0] = 'fan-b';
  data.gpus[g.uid] = g;
  data.psus['psu-b'] = { uid: 'psu-b', modelId: 'psu500' };
  data.coolers['fan-b'] = { uid: 'fan-b', modelId: Object.values(data.coolers)[0].modelId };
  data.racks[rack.uid] = rack;
  data.gpus[w.gpuUid] = { ...data.gpus[w.gpuUid], temp: PHYSICS.shutdownTemp + 5 };
  return { data, hot: w.rackUid, neighbour: rack.uid };
}

describe('power surges', () => {
  it('a thermal shutdown trips the rack on the next pad, which reboots', () => {
    const w = twoRacks();
    // Below the surge chance, and never 0 (the market's gaussian draw rejects zeros).
    vi.spyOn(Math, 'random').mockReturnValue(0.25);
    const out = simulate(w.data, 0.5, NOW, online);
    expect(out.overheats).toBe(1);
    expect(out.surges).toBe(1);
    expect(out.rackReboots[w.neighbour]).toBe(NOW + SURGE.rebootSec * 1000);
    expect(out.rackReboots[w.hot]).toBeUndefined();
    expect(out.rackFx.some((fx) => fx.kind === 'surge' && fx.rackUid === w.neighbour)).toBe(true);
    expect(out.messages.some((m) => m.key?.startsWith('POWER SURGE'))).toBe(true);
    // While it reboots the neighbour hashes nothing.
    const racks = { ...w.data.racks, [w.neighbour]: { ...w.data.racks[w.neighbour], rebootUntil: out.rackReboots[w.neighbour] } };
    const next = simulate({ ...w.data, racks }, 1, NOW + 1000, online);
    expect(next.live.racks[w.neighbour].status).toBe('rebooting');
    expect(next.live.racks[w.neighbour].hash).toBe(0);
    expect(rackFxLabel({ kind: 'surge', rackUid: w.neighbour, value: SURGE.rebootSec }).text).toBe('SURGE!');
  });

  it('is a coin flip per neighbour', () => {
    const w = twoRacks();
    vi.spyOn(Math, 'random').mockReturnValue(SURGE.chance + 0.01);
    const out = simulate(w.data, 0.5, NOW, online);
    expect(out.overheats).toBe(1);
    expect(out.surges).toBe(0);
    expect(out.rackReboots).toEqual({});
  });

  it('a Surge Protector, distance and being away all stop it', () => {
    // Below the surge chance, and never 0 (the market's gaussian draw rejects zeros).
    vi.spyOn(Math, 'random').mockReturnValue(0.25);
    const guarded = twoRacks();
    guarded.data.upgrades = { ...guarded.data.upgrades, surge: ['bedroom'] };
    expect(simulate(guarded.data, 0.5, NOW, online).surges).toBe(0);
    // A protector in another room does not help this one.
    const elsewhere = twoRacks();
    elsewhere.data.upgrades = { ...elsewhere.data.upgrades, surge: ['garage'] };
    expect(simulate(elsewhere.data, 0.5, NOW, online).surges).toBe(1);
    // Not next to each other: the garage has room for a gap.
    const far = twoRacks(3);
    far.data.ownedRooms = ['bedroom', 'garage'];
    Object.values(far.data.racks).forEach((r) => {
      far.data.racks[r.uid] = { ...r, roomId: 'garage' };
    });
    const apart = simulate(far.data, 0.5, NOW, online);
    expect(apart.overheats).toBe(1);
    expect(apart.surges).toBe(0);
    const away = twoRacks();
    const off = simulateOffline(away.data, 600, NOW);
    expect(off.surges).toBe(0);
    expect(off.rackReboots).toEqual({});
  });

  it('a rack that is already down or has no neighbour shutdown is left alone', () => {
    // Below the surge chance, and never 0 (the market's gaussian draw rejects zeros).
    vi.spyOn(Math, 'random').mockReturnValue(0.25);
    const w = twoRacks();
    w.data.gpus[Object.keys(w.data.gpus)[0]].temp = 40;
    const calm = simulate(w.data, 0.5, NOW, online);
    expect(calm.overheats).toBe(0);
    expect(calm.surges).toBe(0);
    const noPsu = twoRacks();
    noPsu.data.racks[noPsu.neighbour] = { ...noPsu.data.racks[noPsu.neighbour], psuUid: null };
    expect(simulate(noPsu.data, 0.5, NOW, online).surges).toBe(0);
  });

  it('the protector is bought per room, once, for a share of the room price', () => {
    expect(surgeProtectorPrice('bedroom')).toBe(SURGE.minPrice);
    expect(surgeProtectorPrice('warehouse')).toBe(Math.round(ROOM_BY_ID.warehouse.price * SURGE.priceShare));
    useGameStore.setState({ ...starterWorld().data, cash: String(SURGE.minPrice + 50), screen: 'game' });
    expect(store().buyRoomUpgrade('surge')).toBe(false);
    expect(store().buyRoomUpgrade('surge', 'garage')).toBe(false);
    expect(store().buyRoomUpgrade('surge', 'bedroom')).toBe(true);
    expect(store().upgrades.surge).toEqual(['bedroom']);
    expect(bnToNumber(store().cash)).toBe(50);
    expect(store().buyRoomUpgrade('surge', 'bedroom')).toBe(false);
    expect(bnToNumber(store().cash)).toBe(50);
    useGameStore.setState({ ownedRooms: ['bedroom', 'garage'] });
    expect(store().buyRoomUpgrade('surge', 'garage')).toBe(false);
    expect(store().upgrades.surge).toEqual(['bedroom']);
  });

  it('save: protectors of rooms that are not owned are dropped, older saves have none', () => {
    const raw: Record<string, unknown> = JSON.parse(JSON.stringify(createInitialData()));
    raw.upgrades = { battery: false, surge: ['bedroom', 'submarine', 'moon', 7, 'bedroom'] };
    expect(migrateSave(raw, 10).upgrades.surge).toEqual(['bedroom']);
    raw.upgrades = { battery: false };
    expect(migrateSave(raw, 9).upgrades.surge).toEqual([]);
    raw.upgrades = { battery: false, surge: 'all' };
    expect(migrateSave(raw, 10).upgrades.surge).toEqual([]);
  });
});

// ───────────────────────── Predictive maintenance ─────────────────────────

describe('predictive maintenance', () => {
  const mods = runModifiers({});
  const life = PHYSICS.pasteLifetimeSec;

  it('forecasts when the paste will cross the re-paste threshold, and the simulation agrees', () => {
    const w = starterWorld();
    const eta = 300;
    w.data.gpus[w.gpuUid] = { ...w.data.gpus[w.gpuUid], paste: PASTE_WORN_BELOW + eta / life };
    const live = simulate(w.data, 0.01, NOW, online).live;
    const forecast = maintenanceForecast(w.data, live, mods, NOW);
    expect(forecast.gpus[w.gpuUid].pasteSec).toBeCloseTo(eta, 6);
    expect(forecast.gpus[w.gpuUid].wearSec).toBeNull();
    expect(forecast.pasteSoon).toBe(1);
    expect(forecast.nextSec).toBeCloseTo(eta, 6);
    // Just before the forecast the paste is still fine; just after, it is not.
    const before = simulate(w.data, eta - 5, NOW + (eta - 5) * 1000, online).gpuUpdates[w.gpuUid].paste;
    const after = simulate(w.data, eta + 5, NOW + (eta + 5) * 1000, online).gpuUpdates[w.gpuUid].paste;
    expect(before).toBeGreaterThan(PASTE_WORN_BELOW);
    expect(after).toBeLessThan(PASTE_WORN_BELOW);
  });

  it('beyond the horizon is not "soon"; already dry is now; a stopped card does not dry', () => {
    const w = starterWorld();
    w.data.gpus[w.gpuUid] = { ...w.data.gpus[w.gpuUid], paste: PASTE_WORN_BELOW + (FORECAST_HORIZON_SEC + 60) / life };
    const live = simulate(w.data, 0.01, NOW, online).live;
    const later = maintenanceForecast(w.data, live, mods, NOW);
    expect(later.pasteSoon).toBe(0);
    expect(later.nextSec).toBeNull();
    expect(later.gpus[w.gpuUid].pasteSec).toBeGreaterThan(FORECAST_HORIZON_SEC);

    w.data.gpus[w.gpuUid] = { ...w.data.gpus[w.gpuUid], paste: 0.1 };
    expect(maintenanceForecast(w.data, live, mods, NOW).gpus[w.gpuUid].pasteSec).toBe(0);

    w.data.gpus[w.gpuUid] = { ...w.data.gpus[w.gpuUid], paste: 0.9 };
    w.data.racks[w.rackUid] = { ...w.data.racks[w.rackUid], psuUid: null };
    const idle = simulate(w.data, 0.01, NOW, online).live;
    expect(maintenanceForecast(w.data, idle, mods, NOW).gpus[w.gpuUid].pasteSec).toBeNull();
    // Cards in the inventory are not forecast at all.
    const spare = createGpu('px460', 'bronze');
    w.data.gpus[spare.uid] = spare;
    expect(maintenanceForecast(w.data, idle, mods, NOW).gpus[spare.uid]).toBeUndefined();
  });

  it('an overheating card gets a repair forecast; a technician crew can cancel the paste one', () => {
    const w = starterWorld();
    const limit = PHYSICS.maxWear * (1 - HEALTH_WORN_BELOW);
    w.data.gpus[w.gpuUid] = { ...w.data.gpus[w.gpuUid], temp: PHYSICS.wearTemp + 2, wear: limit - (PHYSICS.wearPerMinute / 60) * 120 };
    const live = simulate(w.data, 0.01, NOW, online).live;
    const hot = maintenanceForecast(w.data, live, mods, NOW);
    expect(hot.gpus[w.gpuUid].wearSec).toBeCloseTo(120, 3);
    expect(hot.wearSoon).toBe(1);
    // With enough technicians the paste is restored faster than it dries.
    const crewed = { ...w.data, technicians: 6 };
    expect(maintenanceForecast(crewed, live, mods, NOW).gpus[w.gpuUid].pasteSec).toBeNull();
  });

  it('the diagnosis only lists forecasts when it is given one', () => {
    const w = starterWorld();
    w.data.gpus[w.gpuUid] = { ...w.data.gpus[w.gpuUid], paste: PASTE_WORN_BELOW + 200 / life };
    const live = simulate(w.data, 0.01, NOW, online).live;
    expect(diagnoseFarm(w.data, live).map((b) => b.id)).not.toContain('paste_soon');
    const list = diagnoseFarm(w.data, live, maintenanceForecast(w.data, live, mods, NOW));
    const soon = list.find((b) => b.id === 'paste_soon');
    expect(soon?.params).toEqual({ n: 1, min: 4 });
    expect(ES[soon?.key ?? '']).toBeTruthy();
  });

  it('both projects are one-level Lab research that switch their modifier on', () => {
    (['energy', 'predictive'] as const).forEach((id) => {
      expect(RESEARCH_BY_ID[id].maxLevel).toBe(1);
      expect(ES[RESEARCH_BY_ID[id].name]).toBeTruthy();
      expect(ES[RESEARCH_BY_ID[id].description]).toBeTruthy();
      expect(ES[RESEARCH_BY_ID[id].effectOf(1).key]).toBeTruthy();
    });
    expect(researchModifiers({ energy: 1 })).toMatchObject({ energyDesk: true, predictive: false });
    expect(researchModifiers({ predictive: 1 })).toMatchObject({ energyDesk: false, predictive: true });
    expect(runModifiers({}, { energy: 1, predictive: 1 })).toMatchObject({ energyDesk: true, predictive: true });
  });
});
