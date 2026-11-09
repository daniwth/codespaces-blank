/**
 * Regression tests for bugs found by the QA pass (game-qa-tester).
 * Each test reproduces a confirmed bug and is expected to fail until it is fixed.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { MAX_TECHNICIANS } from '../../src/config/hardwareCatalog';
import { simulate } from '../../src/store/gamePhysics';
import { createInitialData } from '../../src/store/initialState';
import { migrateSave } from '../../src/store/migrations';
import { selectSimInput, useGameStore } from '../../src/store/useGameStore';
import { bnToNumber } from '../../src/utils/bignum';
import { starterWorld } from './helpers';

const store = () => useGameStore.getState();
const NOW = 1_800_000_000_000;
const online = { offline: false, maxStep: 1 } as const;

beforeEach(() => {
  useGameStore.setState({ ...createInitialData(), cash: '10000', cc: '0', runEarnings: '0', lifetimeEarnings: '0' });
});

describe('economy: wash trading', () => {
  // Bug: selling coins that were just bought with cash counts the gross proceeds
  // as run/lifetime "earnings". 60 buy→sell round trips of $5K in the Market tab
  // turned a $3K fee loss into $252K of run earnings and LV 1 → LV 9.
  it('buying coins with cash and selling them back does not count as earnings', () => {
    for (let i = 0; i < 20; i += 1) {
      const cash = bnToNumber(store().cash);
      expect(store().buyCoin('CC', cash * 0.5).ok).toBe(true);
      expect(store().sellCoin('CC', bnToNumber(store().cc)).ok).toBe(true);
    }
    // Every round trip loses ~1% in fees: there is no profit to report.
    expect(bnToNumber(store().cash)).toBeLessThan(10_000);
    expect(bnToNumber(store().runEarnings)).toBeLessThan(1);
    expect(bnToNumber(store().lifetimeEarnings)).toBeLessThan(1);
  });

  it('same for $MEME round trips', () => {
    store().buyCoin('MEME', 5_000);
    store().sellCoin('MEME', store().meme);
    expect(bnToNumber(store().runEarnings)).toBeLessThan(1);
  });
});

describe('technicians', () => {
  // Bug: buyTalent('tech_union') adds a technician with no cap, so a full crew
  // of 6 becomes 9 (MAX_TECHNICIANS is 6 and hireTechnician enforces it).
  it('Tech Union never pushes the crew above MAX_TECHNICIANS', () => {
    useGameStore.setState({ cash: '1e12', sc: 1_000 });
    for (let i = 0; i < MAX_TECHNICIANS; i += 1) store().hireTechnician();
    expect(store().technicians).toBe(MAX_TECHNICIANS);
    store().buyTalent('hash_core');
    store().buyTalent('quick_start');
    for (let i = 0; i < 3; i += 1) store().buyTalent('tech_union');
    expect(store().technicians).toBeLessThanOrEqual(MAX_TECHNICIANS);
  });
});

describe('worker tick merge', () => {
  // Bug: the worker answers with absolute GPU fields (paste, wear, temp) computed from
  // the snapshot posted at the start of the tick. If the player re-pastes or repairs
  // while that tick is in flight, mergeTick overwrites the fix with the stale values:
  // the player pays and nothing changes.
  it('a re-paste / repair made while a tick is in flight is not reverted by that tick', () => {
    const uid = Object.keys(store().gpus)[0];
    useGameStore.setState((s) => ({ cash: '1e6', nextEventAt: Number.MAX_SAFE_INTEGER, gpus: { ...s.gpus, [uid]: { ...s.gpus[uid], paste: 0.2, wear: 0.4 } } }));
    const inFlight = simulate(selectSimInput(store()), 0.25, Date.now(), online); // posted to the worker
    expect(store().repasteGpu(uid)).toBe(true); // player clicks PASTE meanwhile
    expect(store().repairGpu(uid)).toBe(true); // ...and REPAIR
    store().applyTick(inFlight); // worker answers
    expect(store().gpus[uid].paste).toBeGreaterThan(0.99);
    expect(store().gpus[uid].wear).toBeLessThan(0.01);
  });
});

describe('tampered / corrupted saves', () => {
  // Bug: migrateSave only checks typeof, so cash: "banana" survives and the app
  // throws "[DecimalError] Invalid argument: banana" on boot (white screen, forever).
  it('rejects BigNum fields that are not numeric strings', () => {
    const base = createInitialData();
    const migrated = migrateSave({ ...base, cash: 'banana', cc: 'NaN', runEarnings: '{}' }, 2);
    for (const key of ['cash', 'cc', 'runEarnings'] as const) {
      expect(Number.isFinite(Number(migrated[key])), `${key}=${migrated[key]}`).toBe(true);
    }
  });

  // Bug: GPU records are copied verbatim, so a GPU without `oc`/`silicon` makes every
  // tick throw "Cannot read properties of undefined (reading 'voltage')": the farm freezes.
  it('a GPU record with missing fields does not crash the simulation', () => {
    const { data, gpuUid } = starterWorld();
    const broken = { ...data.gpus[gpuUid] } as Record<string, unknown>;
    delete broken.oc;
    delete broken.silicon;
    const migrated = migrateSave({ ...data, gpus: { [gpuUid]: broken } }, 2);
    migrated.nextEventAt = Number.MAX_SAFE_INTEGER;
    expect(() => simulate(migrated, 1, NOW, online)).not.toThrow();
  });

  // Bug: bots are copied verbatim; `[{}, null]` makes every tick throw
  // "Cannot read properties of null (reading 'id')".
  it('garbage trading bots do not crash the simulation', () => {
    const { data } = starterWorld();
    const migrated = migrateSave({ ...data, bots: [{}, null, 'x'] }, 2);
    migrated.nextEventAt = Number.MAX_SAFE_INTEGER;
    expect(() => simulate(migrated, 1, NOW, online)).not.toThrow();
  });
});
