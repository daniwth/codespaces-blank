import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PHYSICS, SAVE_VERSION } from '../../src/config/gameBalance';
import { COOLER_CATALOG, GPU_CATALOG, OC_LIMITS, PSU_CATALOG, QUALITY_ORDER, RACK_CATALOG } from '../../src/config/hardwareCatalog';
import { HINTS, HINT_IDS, nextHint, type HintContext } from '../../src/config/hints';
import { ROOM_ORDER } from '../../src/config/roomsCatalog';
import { THERMAL_STOPS, THERMAL_STOPS_SAFE, thermalColor } from '../../src/engine/SpriteManager';
import { ES } from '../../src/i18n/es';
import {
  HEALTH_WORN_BELOW, LEDGER_DAYS, PASTE_WORN_BELOW, diagnoseFarm, emptyLive, foldLedger, ledgerNet, offlineDigest, simulate, simulateOffline,
  type SimOutput,
} from '../../src/store/gamePhysics';
import { createGpu, createInitialData, createRack } from '../../src/store/initialState';
import { migrateSave } from '../../src/store/migrations';
import { resetHintClock, useGameStore } from '../../src/store/useGameStore';
import type { DayLedger, GameData } from '../../src/types/player';
import { starterWorld } from './helpers';

const NOW = 1_800_000_000_000 - (1_800_000_000_000 % 600_000) + 60_000;
const online = { offline: false, maxStep: 1 } as const;
const store = () => useGameStore.getState();

afterEach(() => vi.restoreAllMocks());

describe('maintenance bottlenecks', () => {
  it('flags mounted GPUs with dried paste or low health, and only those', () => {
    const w = starterWorld();
    w.data.gpus[w.gpuUid] = { ...w.data.gpus[w.gpuUid], paste: PASTE_WORN_BELOW - 0.01, wear: PHYSICS.maxWear * (1 - HEALTH_WORN_BELOW) + 0.01 };
    // A spare card in the inventory is nobody's problem.
    const spare = { ...createGpu('px460', 'bronze'), paste: 0, wear: PHYSICS.maxWear };
    w.data.gpus[spare.uid] = spare;
    const list = diagnoseFarm(w.data, simulate(w.data, 1, NOW, online).live);
    const paste = list.find((b) => b.id === 'paste_worn');
    const worn = list.find((b) => b.id === 'worn_gpus');
    expect(paste?.params.n).toBe(1);
    expect(paste?.severity).toBe(2);
    expect(worn?.params.n).toBe(1);
    // Problems that cost hashrate still come first; room to grow comes last.
    expect(list.map((b) => b.severity)).toEqual([...list.map((b) => b.severity)].sort((a, b) => b - a));
  });
});

describe('offline digest', () => {
  it('a quiet night on a healthy farm has nothing to report', () => {
    const w = starterWorld();
    const out = simulateOffline(w.input, 600, NOW);
    const digest = offlineDigest(w.data, w.data, out);
    expect(digest.events.filter((e) => e.id !== 'price')).toEqual([]);
    expect(digest.todo).toEqual([]);
  });

  it('reports shutdowns, wear, the market phase and price moves, and what to do first', () => {
    const before = starterWorld().data;
    const uid = Object.keys(before.gpus)[0];
    const after: GameData = JSON.parse(JSON.stringify(before));
    after.gpus[uid].wear = PHYSICS.maxWear * 0.6;
    after.gpus[uid].paste = 0.2;
    after.cycle.phase = 'bear';
    after.market.CC.price = before.market.CC.price * 0.8;
    const base = simulate(after, 1, NOW, online);
    const out: SimOutput = { ...base, overheats: 3, filledOrders: ['a', 'b'], bmc: { pasted: 2, repaired: 1, spent: 40 } };
    const digest = offlineDigest(before, after, out);
    expect(digest.events.map((e) => e.id)).toEqual(['shutdowns', 'health', 'bmc', 'orders', 'phase', 'price']);
    expect(digest.events[0].params.n).toBe(3);
    expect(digest.events[1].params).toEqual({ from: 100, to: 40 });
    expect(digest.events[5].params.pct).toBe('-20');
    expect(digest.events[5].tone).toBe('warn');
    expect(digest.todo.map((b) => b.id)).toEqual(['paste_worn', 'worn_gpus']);
    expect(digest.todo.length).toBeLessThanOrEqual(3);
  });

  it('applyOffline stores the digest with the report', () => {
    const w = starterWorld();
    useGameStore.setState({ ...w.data, screen: 'game' });
    store().applyOffline(simulateOffline(store(), 3600, NOW), 3600);
    const report = store().offlineReport;
    expect(report?.digest.events).toBeInstanceOf(Array);
    expect(report?.digest.todo.every((b) => b.severity >= 2)).toBe(true);
  });

  it('every digest and bottleneck line is translated', () => {
    const before = starterWorld().data;
    const after: GameData = JSON.parse(JSON.stringify(before));
    const uid = Object.keys(after.gpus)[0];
    after.gpus[uid].wear = PHYSICS.maxWear;
    after.gpus[uid].paste = 0;
    after.cycle.phase = 'bull';
    after.market.CC.price *= 2;
    const out: SimOutput = { ...simulate(after, 1, NOW, online), overheats: 1, filledOrders: ['x'], bmc: { pasted: 1, repaired: 1, spent: 5 } };
    const digest = offlineDigest(before, after, out);
    [...digest.events, ...digest.todo].forEach((line) => expect(ES[line.key], line.key).toBeTruthy());
  });
});

describe('daily ledger', () => {
  const tick = (coinMined: number, electricityPaid: number, earnedCash = 0, spent = 0) => ({ coinMined, electricityPaid, earnedCash, bmc: { pasted: 0, repaired: 0, spent } });

  it('adds up the ticks of one day and opens a page for the next', () => {
    let ledger: DayLedger[] = [];
    ledger = foldLedger(ledger, tick(10, 3), 2, 100);
    ledger = foldLedger(ledger, tick(5, 1, 7, 4), 2, 100);
    expect(ledger).toEqual([{ day: 100, mined: 30, electricity: 4, sold: 7, upkeep: 4 }]);
    expect(ledgerNet(ledger[0])).toBe(30 + 7 - 4 - 4);
    ledger = foldLedger(ledger, tick(1, 0), 2, 101);
    expect(ledger.map((d) => d.day)).toEqual([100, 101]);
  });

  it('keeps two weeks, ignores idle ticks and a clock set back', () => {
    let ledger: DayLedger[] = [];
    for (let day = 1; day <= LEDGER_DAYS + 5; day += 1) ledger = foldLedger(ledger, tick(1, 0), 1, day);
    expect(ledger).toHaveLength(LEDGER_DAYS);
    expect(ledger[0].day).toBe(6);
    expect(foldLedger(ledger, tick(0, 0), 1, 99)).toBe(ledger);
    expect(foldLedger(ledger, tick(9, 9), 1, 3)).toBe(ledger);
  });

  it('a loss-making day has a negative net result', () => {
    const [day] = foldLedger([], tick(0, 50, -10), 1, 7);
    expect(ledgerNet(day)).toBe(-60);
  });

  it('every simulation tick lands in the books of the store', () => {
    const w = starterWorld();
    useGameStore.setState({ ...w.data, ledger: [], screen: 'game' });
    const price = store().market.CC.price;
    const out = simulate(store(), 10, NOW, online);
    store().applyTick(out);
    const [today] = store().ledger;
    expect(store().ledger).toHaveLength(1);
    expect(today.mined).toBeCloseTo(out.coinMined * price, 8);
    expect(today.electricity).toBeCloseTo(out.electricityPaid, 8);
    expect(today.mined).toBeGreaterThan(0);
  });
});

describe('save v10', () => {
  it('a v9 save gains empty books, no hints seen and the default palette', () => {
    const v9: Record<string, unknown> = JSON.parse(JSON.stringify(createInitialData()));
    v9.saveVersion = 9;
    delete v9.ledger;
    delete v9.hints;
    const settings = v9.settings as Record<string, unknown>;
    delete settings.thermalPalette;
    delete settings.hints;
    const data = migrateSave(v9, 9);
    expect(SAVE_VERSION).toBe(10);
    expect(data.saveVersion).toBe(10);
    expect(data.ledger).toEqual([]);
    expect(data.hints).toEqual([]);
    expect(data.settings.thermalPalette).toBe('infrared');
    expect(data.settings.hints).toBe(true);
  });

  it('sanitizes a tampered ledger, hint list and palette', () => {
    const raw: Record<string, unknown> = JSON.parse(JSON.stringify(createInitialData()));
    const today = Math.floor((Date.now() - new Date().getTimezoneOffset() * 60_000) / 86_400_000);
    raw.ledger = [
      { day: today, mined: 'x', electricity: -5, sold: Number.NaN, upkeep: 2 },
      { day: today + 9, mined: 1e9, electricity: 0, sold: 0, upkeep: 0 },
      { day: today - 400, mined: 1, electricity: 0, sold: 0, upkeep: 0 },
      { day: today - 1, mined: 4, electricity: 1, sold: -3, upkeep: 0 },
      { day: 1.5 }, null, 'junk',
    ];
    raw.hints = ['paste', 'not-a-hint', 'paste', 42];
    (raw.settings as Record<string, unknown>).thermalPalette = 'rainbow';
    const data = migrateSave(raw, 10);
    expect(data.ledger).toEqual([
      { day: today - 1, mined: 4, electricity: 1, sold: -3, upkeep: 0 },
      { day: today, mined: 0, electricity: 0, sold: 0, upkeep: 2 },
    ]);
    expect(data.hints).toEqual(['paste']);
    expect(data.settings.thermalPalette).toBe('infrared');
    expect(migrateSave({ ...raw, ledger: 'no', hints: null }, 10).ledger).toEqual([]);
  });

  it('the books and the hints survive a Halving', () => {
    const ledger = [{ day: 5, mined: 1, electricity: 0, sold: 0, upkeep: 0 }];
    const next = createInitialData({ ledger, hints: ['paste'] });
    expect(next.ledger).toEqual(ledger);
    expect(next.hints).toEqual(['paste']);
  });
});

describe('contextual hints', () => {
  const ctx = (patch: Partial<HintContext> = {}): HintContext => {
    const data = starterWorld().data;
    return { ...data, live: emptyLive(), ...patch };
  };

  beforeEach(() => {
    resetHintClock();
    useGameStore.setState({ ...starterWorld().data, activeHint: null, screen: 'game' });
  });

  it('a brand new farm gets no hint', () => {
    expect(nextHint([], ctx())).toBeNull();
  });

  it('shows the most pressing unseen hint first', () => {
    const data = starterWorld().data;
    const uid = Object.keys(data.gpus)[0];
    data.gpus[uid] = { ...data.gpus[uid], paste: 0.1 };
    const c = ctx({ ...data, ownedRooms: ['bedroom', 'garage'] });
    expect(nextHint([], c)?.id).toBe('paste');
    expect(nextHint(['paste'], c)?.id).toBe('rooms');
    expect(nextHint(['paste', 'rooms'], c)).toBeNull();
  });

  it('fires on live trouble: throttling and a tripped PSU', () => {
    const w = starterWorld();
    w.data.gpus[w.gpuUid] = { ...w.data.gpus[w.gpuUid], temp: PHYSICS.throttleTemp + 5 };
    const hot = simulate(w.data, 0.1, NOW, online);
    expect(nextHint([], { ...w.data, live: hot.live })?.id).toBe('throttle');

    const over = starterWorld();
    const extra = createGpu('nca100', 'bronze');
    over.data.gpus[extra.uid] = extra;
    over.data.racks[over.rackUid] = { ...over.data.racks[over.rackUid], gpuSlots: [over.gpuUid, extra.uid] };
    expect(nextHint([], { ...over.data, live: simulate(over.data, 1, NOW, online).live })?.id).toBe('overload');
  });

  it('the store shows one hint at a time, once per save, and obeys the setting', () => {
    useGameStore.setState({ ownedRooms: ['bedroom', 'garage'], cycle: { ...store().cycle, phase: 'bull' } });
    store().checkHints(NOW);
    expect(store().activeHint).toBe('rooms');
    expect(store().hints).toEqual(['rooms']);
    // Nothing replaces a hint that is still on screen.
    store().checkHints(NOW + 10_000);
    expect(store().activeHint).toBe('rooms');
    store().dismissHint();
    // Looked for every couple of seconds, not every tick.
    store().checkHints(NOW + 1_000);
    expect(store().activeHint).toBeNull();
    store().checkHints(NOW + 20_000);
    expect(store().activeHint).toBe('bull');
    store().dismissHint();
    store().checkHints(NOW + 30_000);
    expect(store().activeHint).toBeNull();
    expect(store().hints).toEqual(['rooms', 'bull']);

    resetHintClock();
    useGameStore.setState({ hints: [], settings: { ...store().settings, hints: false } });
    store().checkHints(NOW + 40_000);
    expect(store().activeHint).toBeNull();
    expect(store().hints).toEqual([]);
  });

  it('every hint has unique id and Spanish text with the same placeholders', () => {
    expect(new Set(HINT_IDS).size).toBe(HINTS.length);
    HINTS.forEach((h) => {
      expect(ES[h.title], h.title).toBeTruthy();
      expect(ES[h.text], h.text).toBeTruthy();
      (h.text.match(/\{\w+\}/g) ?? []).forEach((ph) => expect(Object.keys(h.params ?? {}).map((k) => `{${k}}`)).toContain(ph));
    });
  });
});

describe('colour-blind safe thermal palette', () => {
  const luminance = (hex: string): number => {
    const n = parseInt(hex.slice(1), 16);
    const lin = (v: number) => (v / 255 <= 0.03928 ? v / 255 / 12.92 : ((v / 255 + 0.055) / 1.055) ** 2.4);
    return 0.2126 * lin((n >> 16) & 255) + 0.7152 * lin((n >> 8) & 255) + 0.0722 * lin(n & 255);
  };

  it('gets strictly brighter with temperature, so it reads without hue', () => {
    let last = -1;
    for (let c = -20; c <= 105; c += 5) {
      const l = luminance(thermalColor(c, 'safe'));
      expect(l, `${c}°C`).toBeGreaterThan(last);
      last = l;
    }
  });

  it('never leans on red against green', () => {
    THERMAL_STOPS_SAFE.forEach(([, hex]) => {
      const n = parseInt(hex.slice(1), 16);
      // Red and green move together on a blue-yellow ramp.
      expect(Math.abs(((n >> 16) & 255) - ((n >> 8) & 255))).toBeLessThan(40);
    });
  });

  it('shares its key temperatures with the infrared ramp and leaves it untouched', () => {
    expect(THERMAL_STOPS_SAFE.map(([c]) => c)).toEqual(THERMAL_STOPS.map(([c]) => c));
    expect(thermalColor(88)).toBe('#ef4444');
    expect(thermalColor(88, 'infrared')).toBe(thermalColor(88));
    expect(thermalColor(88, 'safe')).toBe('#eed54a');
    expect(thermalColor(-99, 'safe')).toBe(THERMAL_STOPS_SAFE[0][1]);
  });
});

// ───────────────────────── Randomized invariants ─────────────────────────

/** Small seeded generator: a failing seed reproduces the exact same farm. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function randomFarm(rng: () => number): GameData {
  const pickOf = <T,>(list: readonly T[]): T => list[Math.floor(rng() * list.length)];
  const data = starterWorld().data;
  data.ownedRooms = ROOM_ORDER.slice(0, 1 + Math.floor(rng() * ROOM_ORDER.length));
  data.technicians = Math.floor(rng() * 4);
  data.pool = pickOf(['public', 'solo', 'pplns'] as const);
  data.cash = String(Math.floor(rng() * 1e6));
  const racks = 1 + Math.floor(rng() * 6);
  for (let i = 0; i < racks; i += 1) {
    const model = pickOf(RACK_CATALOG);
    const rack = createRack(model.id, model.slots, model.fanSlots);
    rack.roomId = pickOf(data.ownedRooms);
    rack.pad = i + 1;
    rack.gpuSlots = rack.gpuSlots.map(() => {
      if (rng() < 0.25) return null;
      const g = createGpu(pickOf(GPU_CATALOG).id, pickOf(QUALITY_ORDER));
      g.temp = -30 + rng() * 150;
      g.wear = rng() * PHYSICS.maxWear;
      g.paste = rng();
      g.shutdown = rng() < 0.1;
      g.oc = {
        core: OC_LIMITS.core.min + rng() * (OC_LIMITS.core.max - OC_LIMITS.core.min),
        mem: OC_LIMITS.mem.min + rng() * (OC_LIMITS.mem.max - OC_LIMITS.mem.min),
        voltage: OC_LIMITS.voltage.min + rng() * (OC_LIMITS.voltage.max - OC_LIMITS.voltage.min),
      };
      g.ocBonus = rng() * OC_LIMITS.maxBonus;
      data.gpus[g.uid] = g;
      return g.uid;
    });
    rack.fanSlots = rack.fanSlots.map((_, k) => {
      if (rng() < 0.3) return null;
      const uid = `cool-${i}-${k}`;
      data.coolers[uid] = { uid, modelId: pickOf(COOLER_CATALOG).id };
      return uid;
    });
    if (rng() < 0.85) {
      const uid = `psu-${i}`;
      data.psus[uid] = { uid, modelId: pickOf(PSU_CATALOG).id };
      rack.psuUid = uid;
    }
    data.racks[rack.uid] = rack;
  }
  return data;
}

/** Path of the first number that is not finite, or null. */
function firstBadNumber(value: unknown, path = 'out'): string | null {
  if (typeof value === 'number') return Number.isFinite(value) || value === Number.POSITIVE_INFINITY ? null : path;
  if (value && typeof value === 'object') {
    for (const [k, v] of Object.entries(value)) {
      const bad = firstBadNumber(v, `${path}.${k}`);
      if (bad) return bad;
    }
  }
  return null;
}

describe('simulation invariants on random farms', () => {
  const SEEDS = Array.from({ length: 40 }, (_, i) => 1000 + i * 7919);

  it.each(SEEDS)('seed %i: finite, bounded and consistent, online and offline', (seed) => {
    const rng = mulberry32(seed);
    vi.spyOn(Math, 'random').mockImplementation(rng);
    let data = randomFarm(rng);
    for (let step = 0; step < 6; step += 1) {
      const offline = step === 3;
      const dt = offline ? 600 + rng() * 20_000 : 0.05 + rng() * 30;
      const now = NOW + step * 60_000;
      const out = offline ? simulateOffline(data, dt, now) : simulate(data, dt, now, online);
      expect(firstBadNumber(out)).toBeNull();
      expect(out.live.totalHash).toBeGreaterThanOrEqual(0);
      expect(out.electricityPaid).toBeGreaterThanOrEqual(0);
      expect(out.coinMined).toBeGreaterThanOrEqual(0);
      expect(out.live.electricityPerSec).toBeGreaterThanOrEqual(0);
      Object.values(out.market).forEach((coin) => expect(coin.price).toBeGreaterThan(0));
      Object.entries(out.gpuUpdates).forEach(([uid, g]) => {
        expect(g.wear, uid).toBeGreaterThanOrEqual(0);
        expect(g.wear, uid).toBeLessThanOrEqual(PHYSICS.maxWear + 1e-9);
        expect(g.paste, uid).toBeGreaterThanOrEqual(0);
        expect(g.paste, uid).toBeLessThanOrEqual(1);
        expect(g.temp, uid).toBeGreaterThan(-80);
        expect(g.temp, uid).toBeLessThan(400);
      });
      Object.values(out.live.racks).forEach((r) => {
        expect(r.hash).toBeGreaterThanOrEqual(0);
        expect(r.wall).toBeGreaterThanOrEqual(0);
        expect(r.powerCost).toBeGreaterThanOrEqual(0);
      });
      // The farm total is the sum of its racks, and a rack that is not online hashes nothing.
      const sum = Object.values(out.live.racks).reduce((a, r) => a + r.hash, 0);
      expect(Math.abs(out.live.totalHash - sum)).toBeLessThanOrEqual(1e-9 * Math.max(1, sum));
      Object.values(out.live.racks).filter((r) => r.status !== 'online').forEach((r) => expect(r.hash).toBe(0));
      // The diagnosis and the digest never throw on any farm.
      const gpus = { ...data.gpus };
      Object.entries(out.gpuUpdates).forEach(([uid, g]) => {
        gpus[uid] = { ...gpus[uid], ...g };
      });
      const after: GameData = { ...data, gpus, market: out.market, cycle: out.cycle, roomTemps: { ...data.roomTemps, ...out.roomTemps } };
      expect(() => diagnoseFarm(after, out.live)).not.toThrow();
      expect(() => offlineDigest(data, after, out)).not.toThrow();
      data = after;
    }
  });

  it('the same seed gives the same farm and the same result', () => {
    const run = (): string => {
      const rng = mulberry32(4242);
      vi.spyOn(Math, 'random').mockImplementation(rng);
      const data = randomFarm(rng);
      const out = simulate(data, 12, NOW, online);
      vi.restoreAllMocks();
      return `${out.live.totalHash}|${out.electricityPaid}|${out.cashDelta}`;
    };
    expect(run()).toBe(run());
  });
});
