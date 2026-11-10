import { beforeEach, describe, expect, it } from 'vitest';
import { CHALLENGES, CHALLENGE_BY_ID, POWER_CAP_MUL, challengeRules } from '../../src/config/challenges';
import { SAVE_VERSION } from '../../src/config/gameBalance';
import { GPU_BY_ID } from '../../src/config/hardwareCatalog';
import { HALVING_MIN_EARNINGS } from '../../src/config/prestigeTree';
import { ROOM_BY_ID } from '../../src/config/roomsCatalog';
import { aiAutoTune, ocHashBonus, simulate, usableRooms } from '../../src/store/gamePhysics';
import { createGpu, createInitialData, createRack } from '../../src/store/initialState';
import { migrateSave } from '../../src/store/migrations';
import { useGameStore } from '../../src/store/useGameStore';
import type { ChallengeId, GameData } from '../../src/types/player';
import { starterWorld } from './helpers';

const NOW = 1_800_000_000_000;
const store = () => useGameStore.getState();

function withChallenge(id: ChallengeId | null, patch: Partial<GameData> = {}): ReturnType<typeof starterWorld> {
  const w = starterWorld(patch);
  w.data.challenge = id ? { id, startedAt: NOW - 600_000 } : null;
  return w;
}

/** Output of a 60 s offline simulation of the starter rig with its GPU overclocked (if the rules allow it). */
function run(w: ReturnType<typeof starterWorld>) {
  const g = w.data.gpus[w.gpuUid];
  g.oc = { core: 80, mem: 300, voltage: 1050 };
  g.ocBonus = ocHashBonus(g.oc);
  return simulate(w.data, 60, NOW, { offline: true, maxStep: 5 });
}

describe('challenge catalog', () => {
  it('has four challenges whose rewards grow with difficulty and repeats pay less', () => {
    expect(CHALLENGES.map((c) => c.id)).toEqual(['bronze_only', 'no_overclock', 'power_cap', 'single_room']);
    CHALLENGES.forEach((c) => {
      expect(c.repeatSc).toBeLessThan(c.firstSc);
      expect(c.repeatGems).toBeLessThan(c.firstGems);
    });
    const firstSc = CHALLENGES.map((c) => c.firstSc);
    expect(firstSc).toEqual([...firstSc].sort((a, b) => a - b));
  });

  it('free runs have no rules', () => {
    expect(challengeRules(null)).toEqual({ lockOverclock: false, bronzeOnly: false, singleRoom: false, powerCapMul: 1 });
  });
});

describe('challenge rules are enforced by the pure simulation', () => {
  it('No Overclock ignores the overclock in hashrate and power draw', () => {
    const free = run(withChallenge(null));
    const locked = run(withChallenge('no_overclock'));
    const stock = GPU_BY_ID.px460;
    expect(locked.live.totalHash).toBeCloseTo(stock.hashrate, 0);
    expect(free.live.totalHash).toBeGreaterThan(locked.live.totalHash * 1.05);
    expect(Object.values(locked.live.racks)[0].load).toBeLessThan(Object.values(free.live.racks)[0].load);
  });

  it('Bronze Only keeps higher silicon grades idle', () => {
    const bronze = withChallenge('bronze_only');
    const base = run(bronze);
    expect(base.live.totalHash).toBeGreaterThan(0);

    const gold = withChallenge('bronze_only');
    gold.data.gpus[gold.gpuUid].quality = 'gold';
    expect(run(gold).live.totalHash).toBe(0);

    const goldFree = withChallenge(null);
    goldFree.data.gpus[goldFree.gpuUid].quality = 'gold';
    expect(run(goldFree).live.totalHash).toBeGreaterThan(0);
  });

  it('Single Room restricts mining to the Bedroom', () => {
    const w = withChallenge('single_room');
    const rack = { ...createRack('bench', 2, 1), roomId: 'garage' as const, pad: 0 };
    const gpu = createGpu('px460', 'bronze');
    rack.gpuSlots[0] = gpu.uid;
    rack.psuUid = Object.keys(w.data.psus)[0];
    w.data.coolers.garageFan = { uid: 'garageFan', modelId: 'tower' };
    rack.fanSlots[0] = 'garageFan';
    w.data.gpus[gpu.uid] = gpu;
    w.data.racks[rack.uid] = rack;
    w.data.ownedRooms = ['bedroom', 'garage'];
    expect(usableRooms(w.data)).toEqual(['bedroom']);
    const out = simulate(w.data, 60, NOW, { offline: true, maxStep: 5 });
    expect(out.live.racks[rack.uid].status).toBe('stored');
    expect(out.live.rooms.garage).toBeUndefined();
    expect(out.live.totalHash).toBeCloseTo(GPU_BY_ID.px460.hashrate, 0);

    w.data.challenge = null;
    const free = simulate(w.data, 60, NOW, { offline: true, maxStep: 5 });
    expect(free.live.totalHash).toBeGreaterThan(out.live.totalHash);
  });

  it('Power Cap shrinks every room line and brownouts overdraw', () => {
    const free = simulate(withChallenge(null).data, 30, NOW, { offline: true, maxStep: 5 });
    const capped = withChallenge('power_cap');
    expect(free.live.rooms.bedroom?.capacity).toBe(ROOM_BY_ID.bedroom.maxPowerW);
    expect(simulate(capped.data, 30, NOW, { offline: true, maxStep: 5 }).live.rooms.bedroom?.capacity).toBe(ROOM_BY_ID.bedroom.maxPowerW * POWER_CAP_MUL);

    // Eight stock PX-460 cards on a cabinet-sized PSU draw ~1.1 kW wall: over the 525 W cap, under the 1.5 kW line.
    const heavy = withChallenge('power_cap');
    const rack = Object.values(heavy.data.racks)[0];
    heavy.data.psus[rack.psuUid as string] = { uid: rack.psuUid as string, modelId: 'psu5000' };
    heavy.data.racks[rack.uid] = { ...rack, modelId: 'cabinet', gpuSlots: Array.from({ length: 8 }, () => null), fanSlots: [rack.fanSlots[0], null, null, null] };
    for (let i = 0; i < 8; i += 1) {
      const g = createGpu('vx2070', 'bronze');
      heavy.data.gpus[g.uid] = g;
      heavy.data.racks[rack.uid].gpuSlots[i] = g.uid;
    }
    const capOut = simulate(heavy.data, 30, NOW, { offline: true, maxStep: 5 });
    heavy.data.challenge = null;
    const freeOut = simulate(heavy.data, 30, NOW, { offline: true, maxStep: 5 });
    expect(capOut.live.rooms.bedroom?.brownout).toBeLessThan(1);
    expect(freeOut.live.rooms.bedroom?.brownout).toBeLessThan(1);
    expect(capOut.live.totalHash).toBeLessThan(freeOut.live.totalHash);
  });

  it('a free run is unaffected', () => {
    const w = withChallenge(null);
    expect(usableRooms(w.data)).toEqual(w.data.ownedRooms);
  });
});

describe('challenge rules are enforced by the store actions', () => {
  beforeEach(() => {
    useGameStore.setState({ ...createInitialData(), cash: '10000000' });
  });

  const start = (id: ChallengeId) => useGameStore.setState({ ...createInitialData({}, id), cash: '10000000' });

  it('No Overclock refuses BIOS changes and AI tuning', () => {
    start('no_overclock');
    const uid = Object.keys(store().gpus)[0];
    useGameStore.setState({ vip: { ...store().vip, aiDiagnostics: true } });
    expect(store().applyOverclock(uid, { core: 50, mem: 100, voltage: 1000 })).toBe('invalid');
    expect(store().gpus[uid].ocBonus).toBe(0);
    expect(store().autoTuneGpu(uid)).toBe(false);
    expect(store().gpus[uid].oc.core).toBe(0);
    expect(store().log.some((l) => l.text.includes('BIOS is locked'))).toBe(true);
    // Outside the challenge both work.
    useGameStore.setState({ challenge: null });
    expect(store().autoTuneGpu(uid)).toBe(true);
    expect(aiAutoTune(store().gpus[uid].silicon).core).toBe(store().gpus[uid].oc.core);
  });

  it('Bronze Only locks the silicon lottery to Bronze', () => {
    start('bronze_only');
    for (let i = 0; i < 25; i += 1) expect(store().buyGpu('px460')?.quality).toBe('bronze');
  });

  it('Single Room refuses new rooms and racks placed outside the Bedroom', () => {
    start('single_room');
    expect(store().buyRoom('garage')).toBe(false);
    expect(store().ownedRooms).toEqual(['bedroom']);
    expect(store().cash).toBe('10000000');
    // A kept room (Real Estate Trust) is still owned, but racks cannot be built there.
    useGameStore.setState({ ownedRooms: ['bedroom', 'garage'] });
    const rack = createRack('steel', 4, 2);
    useGameStore.setState({ racks: { ...store().racks, [rack.uid]: rack } });
    expect(store().placeRack(rack.uid, 'garage', 0)).toBe(false);
    expect(store().placeRack(rack.uid, 'bedroom', 1)).toBe(true);
    expect(store().log.some((l) => l.text.includes('only use the Bedroom'))).toBe(true);
  });

  it('Power Cap does not block any action: it only shrinks the line', () => {
    start('power_cap');
    expect(store().buyRoom('garage')).toBe(true);
    const uid = Object.keys(store().gpus)[0];
    expect(store().applyOverclock(uid, { core: 0, mem: 0, voltage: 1000 })).toBe('stable');
  });
});

describe('challenge completion', () => {
  beforeEach(() => {
    useGameStore.setState({ ...createInitialData(), cash: '0' });
  });

  const begin = (id: ChallengeId, startedAgoSec: number, records: GameData['challengeRecords'] = {}) => {
    const now = Date.now();
    useGameStore.setState({
      ...createInitialData({ challengeRecords: records }, id),
      lastTick: now,
      challenge: { id, startedAt: now - startedAgoSec * 1000 },
    });
  };

  it('does nothing below the Halving threshold', () => {
    begin('power_cap', 600);
    useGameStore.setState({ runEarnings: String(HALVING_MIN_EARNINGS - 1) });
    expect(store().checkChallenge()).toBe(false);
    expect(store().challenge?.id).toBe('power_cap');
    expect(store().sc).toBe(0);
  });

  it('pays the first-clear bonus, records the time and lifts the restriction', () => {
    begin('single_room', 7200);
    useGameStore.setState({ runEarnings: String(HALVING_MIN_EARNINGS), sc: 10, scLifetime: 10, gems: 1 });
    expect(store().checkChallenge()).toBe(true);
    const def = CHALLENGE_BY_ID.single_room;
    expect(store().sc).toBe(10 + def.firstSc);
    expect(store().scLifetime).toBe(10 + def.firstSc);
    expect(store().gems).toBe(1 + def.firstGems);
    expect(store().challenge).toBeNull();
    expect(store().challengeRecords.single_room?.clears).toBe(1);
    expect(store().challengeRecords.single_room?.bestTimeSec).toBeCloseTo(7200, -1);
    // Only once: nothing more to pay.
    expect(store().checkChallenge()).toBe(false);
    expect(store().sc).toBe(10 + def.firstSc);
  });

  it('repeat clears pay the smaller bonus and keep the best time', () => {
    begin('no_overclock', 5000, { no_overclock: { clears: 1, bestTimeSec: 4000 } });
    useGameStore.setState({ runEarnings: String(HALVING_MIN_EARNINGS) });
    store().checkChallenge();
    const def = CHALLENGE_BY_ID.no_overclock;
    expect(store().sc).toBe(def.repeatSc);
    expect(store().gems).toBe(def.repeatGems);
    expect(store().challengeRecords.no_overclock).toEqual({ clears: 2, bestTimeSec: 4000 });

    begin('no_overclock', 3000, { no_overclock: { clears: 2, bestTimeSec: 4000 } });
    useGameStore.setState({ runEarnings: String(HALVING_MIN_EARNINGS) });
    store().checkChallenge();
    expect(store().challengeRecords.no_overclock?.clears).toBe(3);
    expect(store().challengeRecords.no_overclock?.bestTimeSec).toBeCloseTo(3000, -1);
  });

  it('is detected from the tick merge', () => {
    begin('bronze_only', 100);
    useGameStore.setState({ runEarnings: String(HALVING_MIN_EARNINGS - 5) });
    const w = starterWorld();
    store().applyTick({ ...simulate(w.input, 1, Date.now(), { offline: true, maxStep: 1 }), earnedCash: 10 });
    expect(store().challenge).toBeNull();
    expect(store().challengeRecords.bronze_only?.clears).toBe(1);
  });

  it('abandoning drops the restriction, pays nothing and keeps the normal Halving reward', () => {
    begin('power_cap', 600);
    useGameStore.setState({ runEarnings: String(HALVING_MIN_EARNINGS - 1) });
    expect(store().abandonChallenge()).toBe(true);
    expect(store().challenge).toBeNull();
    expect(store().challengeRecords).toEqual({});
    expect(store().abandonChallenge()).toBe(false);
    useGameStore.setState({ runEarnings: String(HALVING_MIN_EARNINGS) });
    expect(store().checkChallenge()).toBe(false);
    expect(store().performHalving()).toBe(true);
    expect(store().sc).toBe(4);
  });

  it('The Halving carries completed challenges and can start the next run under a challenge', () => {
    begin('single_room', 600);
    useGameStore.setState({ runEarnings: String(HALVING_MIN_EARNINGS), challengeRecords: { power_cap: { clears: 1, bestTimeSec: 900 } } });
    store().checkChallenge();
    expect(store().performHalving('power_cap')).toBe(true);
    expect(store().challenge?.id).toBe('power_cap');
    expect(store().challengeRecords.power_cap?.clears).toBe(1);
    expect(store().challengeRecords.single_room?.clears).toBe(1);
    expect(store().sc).toBe(4 + CHALLENGE_BY_ID.single_room.firstSc);
    // Halving without a pick starts a free run.
    useGameStore.setState({ runEarnings: String(HALVING_MIN_EARNINGS) });
    store().checkChallenge();
    expect(store().performHalving()).toBe(true);
    expect(store().challenge).toBeNull();
  });

  it('a new game can start under a challenge and wipes records', () => {
    useGameStore.setState({ challengeRecords: { power_cap: { clears: 2, bestTimeSec: 100 } } });
    store().startNewGame('no_overclock');
    expect(store().challenge?.id).toBe('no_overclock');
    expect(store().challengeRecords).toEqual({});
    store().startNewGame();
    expect(store().challenge).toBeNull();
  });
});

describe('challenge persistence', () => {
  it('migrates a v5 save to a free run with no clears', () => {
    const v5 = createInitialData() as unknown as Record<string, unknown>;
    delete v5.challenge;
    delete v5.challengeRecords;
    v5.saveVersion = 5;
    const migrated = migrateSave(v5, 5);
    expect(SAVE_VERSION).toBe(6);
    expect(migrated.saveVersion).toBe(SAVE_VERSION);
    expect(migrated.challenge).toBeNull();
    expect(migrated.challengeRecords).toEqual({});
  });

  it('migrates older saves too', () => {
    const v2 = createInitialData() as unknown as Record<string, unknown>;
    delete v2.challenge;
    delete v2.challengeRecords;
    const migrated = migrateSave(v2, 2);
    expect(migrated.challenge).toBeNull();
    expect(migrated.challengeRecords).toEqual({});
    expect(migrated.contracts.slots.length).toBeGreaterThan(0);
  });

  it('keeps a valid challenge and records across a save round trip', () => {
    const data = createInitialData({ challengeRecords: { power_cap: { clears: 3, bestTimeSec: 1234 } } }, 'single_room');
    const back = migrateSave(JSON.parse(JSON.stringify(data)), SAVE_VERSION);
    expect(back.challenge).toEqual(data.challenge);
    expect(back.challengeRecords).toEqual({ power_cap: { clears: 3, bestTimeSec: 1234 } });
  });

  it('sanitises a tampered challenge field', () => {
    const data = createInitialData() as unknown as Record<string, unknown>;
    data.challenge = { id: 'god_mode', startedAt: 5 };
    data.challengeRecords = { power_cap: { clears: -4, bestTimeSec: 'x' }, single_room: { clears: 2, bestTimeSec: 50 }, hacked: { clears: 99 } };
    const clean = migrateSave(data, SAVE_VERSION);
    expect(clean.challenge).toBeNull();
    expect(clean.challengeRecords).toEqual({ single_room: { clears: 2, bestTimeSec: 50 } });
    data.challenge = { id: 'power_cap', startedAt: Date.now() + 1e9 };
    expect(migrateSave(data, SAVE_VERSION).challenge?.startedAt).toBeLessThanOrEqual(Date.now());
  });
});
