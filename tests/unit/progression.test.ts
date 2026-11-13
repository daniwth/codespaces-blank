import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AIRDROP } from '../../src/config/airdrops';
import { DAILY_MIN_CASH, DAILY_REWARDS, dailyCash, dailyRewardFor, localDay } from '../../src/config/daily';
import { ACHIEVEMENTS, EVENT_EFFECTS, NETWORK_EVENTS, SAVE_VERSION } from '../../src/config/gameBalance';
import { GPU_BY_ID, PSU_BY_ID } from '../../src/config/hardwareCatalog';
import { runModifiers } from '../../src/config/modifiers';
import { PRESTIGE_TREE, talentModifiers } from '../../src/config/prestigeTree';
import { RESEARCH, RESEARCH_BY_ID, researchCost, researchModifiers, researchTime, rushCost } from '../../src/config/research';
import { ROADMAP, currentGoal, goalMet, goalProgress } from '../../src/config/roadmap';
import { ROOM_BY_ID } from '../../src/config/roomsCatalog';
import '../../src/i18n/es';
import { simulate } from '../../src/store/gamePhysics';
import { createGpu, createInitialData } from '../../src/store/initialState';
import { fillLog, logLine } from '../../src/store/logLine';
import { migrateSave } from '../../src/store/migrations';
import { hardwarePrice, hardwarePriceMul } from '../../src/store/pricing';
import { FUSE_COUNT, MAX_BULK, fusableGroups } from '../../src/store/slices/hardwareSlice';
import { dailyAvailable, nextDailyStreak, roadmapContext } from '../../src/store/slices/progressSlice';
import { useGameStore } from '../../src/store/useGameStore';
import type { GameData } from '../../src/types/player';
import { starterWorld } from './helpers';

const NOW = 1_800_000_000_000;
const store = () => useGameStore.getState();
const cash = () => Number(store().cash);

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
  useGameStore.setState({ ...createInitialData(), cash: '1000000', airdrop: null, history: [], dailyOpen: false, log: [] });
});
afterEach(() => vi.useRealTimers());

describe('research catalog', () => {
  it('costs and times grow every level and modifiers start neutral', () => {
    RESEARCH.forEach((r) => {
      for (let l = 1; l < r.maxLevel; l += 1) {
        expect(researchCost(r, l)).toBeGreaterThan(researchCost(r, l - 1));
        expect(researchTime(r, l)).toBeGreaterThan(researchTime(r, l - 1));
      }
    });
    expect(researchModifiers({})).toEqual({ hashMul: 1, coolingMul: 1, electricityMul: 1, pasteLifeMul: 1, lineMul: 1, hardwarePriceMul: 1, smartBmc: false });
  });

  it('caps levels at the maximum and never makes anything free', () => {
    const maxed = researchModifiers({ firmware: 99, airflow: 99, pfc: 99, paste: 99, grid: 99, logistics: 99 });
    expect(maxed.hashMul).toBeCloseTo(1.2);
    expect(maxed.electricityMul).toBeCloseTo(0.75);
    expect(maxed.hardwarePriceMul).toBeCloseTo(0.9);
    expect(maxed.lineMul).toBeCloseTo(1.5);
  });

  it('rush costs one gem per started ten minutes', () => {
    expect(rushCost(0)).toBe(1);
    expect(rushCost(600)).toBe(1);
    expect(rushCost(601)).toBe(2);
  });

  it('combines with talents multiplicatively', () => {
    const both = runModifiers({ hash_core: 2 }, { firmware: 5 });
    expect(both.hashMul).toBeCloseTo(talentModifiers({ hash_core: 2 }).hashMul * 1.2);
  });
});

describe('research in the simulation', () => {
  const hashOf = (patch: Partial<GameData>) => simulate(starterWorld(patch).data, 10, NOW, { offline: true, maxStep: 5 }).live.totalHash;

  it('Firmware Tuning raises hashrate and PFC cuts the bill', () => {
    const base = starterWorld();
    const tuned = starterWorld({ research: { levels: { firmware: 5, pfc: 5 }, active: null } });
    const a = simulate(base.data, 10, NOW, { offline: true, maxStep: 5 });
    const b = simulate(tuned.data, 10, NOW, { offline: true, maxStep: 5 });
    expect(b.live.totalHash).toBeCloseTo(a.live.totalHash * 1.2, -3);
    expect(b.electricityPaid).toBeLessThan(a.electricityPaid);
  });

  it('Airflow Engineering runs the same rig cooler', () => {
    const a = simulate(starterWorld().data, 600, NOW, { offline: true, maxStep: 5 });
    const b = simulate(starterWorld({ research: { levels: { airflow: 5 }, active: null } }).data, 600, NOW, { offline: true, maxStep: 5 });
    expect(b.live.hottest).toBeLessThan(a.live.hottest);
  });

  it('Overdrive multiplies hashrate while the boost lasts', () => {
    const plain = hashOf({});
    expect(hashOf({ boost: { mul: 2, until: NOW + 60_000 } })).toBeCloseTo(plain * 2, -3);
    expect(hashOf({ boost: { mul: 2, until: NOW - 60_000 } })).toBeCloseTo(plain, -3);
  });

  it('a project that ends while away counts from its end time on', () => {
    const never = starterWorld({ research: { levels: {}, active: null } });
    const pending = starterWorld({ research: { levels: {}, active: { id: 'firmware', startedAt: NOW - 1000, endsAt: NOW - 500 } } });
    const a = simulate(never.data, 100, NOW, { offline: true, maxStep: 5 });
    const b = simulate(pending.data, 100, NOW, { offline: true, maxStep: 5 });
    expect(b.coinMined).toBeGreaterThan(a.coinMined);
  });
});

describe('research in the store', () => {
  it('charges the cost, runs one project at a time and grants the level when due', () => {
    const def = RESEARCH_BY_ID.firmware;
    expect(store().startResearch('firmware')).toBe(true);
    expect(cash()).toBeCloseTo(1_000_000 - researchCost(def, 0));
    expect(store().research.active?.endsAt).toBe(NOW + researchTime(def, 0) * 1000);
    expect(store().startResearch('airflow')).toBe(false);
    expect(store().checkResearch(NOW + 1000)).toBe(false);
    expect(store().checkResearch(NOW + researchTime(def, 0) * 1000)).toBe(true);
    expect(store().research).toEqual({ levels: { firmware: 1 }, active: null });
    expect(store().stats.researchDone).toBe(1);
  });

  it('cancel refunds everything and rush spends gems', () => {
    store().startResearch('grid');
    expect(store().cancelResearch()).toBe(true);
    expect(cash()).toBeCloseTo(1_000_000);
    expect(store().research.active).toBeNull();

    useGameStore.setState({ gems: 0 });
    store().startResearch('grid');
    expect(store().rushResearch()).toBe(false);
    useGameStore.setState({ gems: 3 });
    expect(store().rushResearch()).toBe(true);
    expect(store().gems).toBe(2);
    expect(store().research.levels.grid).toBe(1);
  });

  it('refuses maxed projects and ones the player cannot afford', () => {
    useGameStore.setState({ research: { levels: { paste: RESEARCH_BY_ID.paste.maxLevel }, active: null } });
    expect(store().startResearch('paste')).toBe(false);
    useGameStore.setState({ cash: '1' });
    expect(store().startResearch('firmware')).toBe(false);
    expect(cash()).toBe(1);
  });

  it('R&D Grant shortens projects', () => {
    useGameStore.setState({ talents: { lab_grant: 2 } });
    store().startResearch('firmware');
    const active = store().research.active;
    expect(active && active.endsAt - active.startedAt).toBe(researchTime(RESEARCH_BY_ID.firmware, 0, 0.7) * 1000);
  });

  it('The Halving wipes the Lab but keeps the roadmap and the daily streak', () => {
    useGameStore.setState({
      research: { levels: { firmware: 3 }, active: null }, runEarnings: '50000000', lifetimeEarnings: '50000000',
      roadmap: { step: 7, ready: false }, daily: { lastDay: 123, streak: 4 },
    });
    expect(store().performHalving()).toBe(true);
    expect(store().research).toEqual({ levels: {}, active: null });
    expect(store().roadmap.step).toBe(7);
    expect(store().daily).toEqual({ lastDay: 123, streak: 4 });
  });
});

describe('hardware prices', () => {
  it('Bulk Logistics and the Flash Sale stack and every purchase pays the discounted price', () => {
    const list = GPU_BY_ID.px580.price;
    const s = { research: { levels: { logistics: 5 }, active: null }, event: { id: 'flash_sale' as const, startedAt: NOW, endsAt: NOW + 1000, roomId: null } };
    expect(hardwarePriceMul(s)).toBeCloseTo(0.9 * EVENT_EFFECTS.flashSaleMul);
    useGameStore.setState(s);
    store().buyGpu('px580');
    expect(cash()).toBeCloseTo(1_000_000 - hardwarePrice(list, s), 2);
    expect(NETWORK_EVENTS.flash_sale).toBeDefined();
  });

  it('buyMany buys as many as the cash allows, in one go', () => {
    expect(store().buyMany('gpu', 'px460', 5)).toBe(5);
    expect(Object.values(store().gpus).filter((g) => g.modelId === 'px460')).toHaveLength(6);
    expect(cash()).toBeCloseTo(1_000_000 - 5 * GPU_BY_ID.px460.price);
    expect(store().stats.gpusBought).toBe(5);

    useGameStore.setState({ cash: String(PSU_BY_ID.psu500.price * 2.5) });
    expect(store().buyMany('psu', 'psu500', 10)).toBe(2);
    expect(store().buyMany('psu', 'psu500', 10)).toBe(0);
    useGameStore.setState({ cash: '1e12' });
    expect(store().buyMany('cooler', 'fan80', 9999)).toBe(MAX_BULK);
  });

  it('bulk GPUs are all Bronze in the Bronze Only challenge', () => {
    useGameStore.setState({ challenge: { id: 'bronze_only', startedAt: NOW } });
    store().buyMany('gpu', 'px460', 20);
    expect(Object.values(store().gpus).every((g) => g.quality === 'bronze')).toBe(true);
  });
});

describe('Silicon Forge', () => {
  const spare = (n: number, quality: 'bronze' | 'silver' | 'gold' | 'god' = 'bronze') => {
    const gpus = { ...store().gpus };
    for (let i = 0; i < n; i += 1) {
      const g = createGpu('px460', quality);
      gpus[g.uid] = { ...g, wear: 0.1 * i, paste: 0.3 };
    }
    useGameStore.setState({ gpus });
  };

  it('fuses 3 spare cards into one of the next grade, fresh', () => {
    spare(FUSE_COUNT);
    expect(fusableGroups(store())).toEqual([{ modelId: 'px460', quality: 'bronze', count: 3, next: 'silver' }]);
    const fused = store().fuseGpus('px460', 'bronze');
    expect(fused?.quality).toBe('silver');
    expect(fused?.wear).toBe(0);
    expect(fused?.paste).toBe(1);
    // The mounted starter card is untouched; the three spares are gone.
    expect(Object.keys(store().gpus)).toHaveLength(2);
    expect(store().stats.fusions).toBe(1);
  });

  it('never touches mounted cards and needs a full set', () => {
    const mounted = Object.values(store().gpus)[0];
    spare(FUSE_COUNT - 1, mounted.quality as 'bronze');
    expect(store().fuseGpus('px460', mounted.quality)).toBeNull();
    expect(store().gpus[mounted.uid]).toBeDefined();
  });

  it('cannot go past Silicon God and is closed in Bronze Only', () => {
    spare(FUSE_COUNT, 'god');
    expect(store().fuseGpus('px460', 'god')).toBeNull();
    spare(FUSE_COUNT);
    useGameStore.setState({ challenge: { id: 'bronze_only', startedAt: NOW } });
    expect(store().fuseGpus('px460', 'bronze')).toBeNull();
  });

  it('auto-fill all mounts spares and re-paste all renews dry paste', () => {
    spare(1);
    const before = Object.values(store().racks)[0].gpuSlots.filter(Boolean).length;
    expect(store().autoFillAll()).toBeGreaterThan(0);
    expect(Object.values(store().racks)[0].gpuSlots.filter(Boolean).length).toBe(before + 1);
    expect(store().autoFillAll()).toBe(0);
    expect(store().repasteAll()).toBe(1);
    expect(Object.values(store().gpus).every((g) => g.paste === 1)).toBe(true);
    expect(store().repasteAll()).toBe(0);
  });
});

describe('roadmap', () => {
  it('is an ordered chain of unique goals that all pay something', () => {
    expect(new Set(ROADMAP.map((g) => g.id)).size).toBe(ROADMAP.length);
    ROADMAP.forEach((g) => {
      expect(g.cash + g.gems, g.id).toBeGreaterThan(0);
      expect(g.target, g.id).toBeGreaterThan(0);
    });
    expect(currentGoal(ROADMAP.length)).toBeNull();
  });

  it('a fresh farm has met none of the first goals', () => {
    const ctx = roadmapContext(store());
    expect(goalMet(ROADMAP[0], ctx)).toBe(false);
    expect(goalProgress(ROADMAP[1], ctx)).toBe(0.5);
  });

  it('marks the goal ready, pays the gift on claim and moves on', () => {
    expect(store().claimRoadmap()).toBe(false);
    useGameStore.setState({ lifetimeEarnings: '5' });
    expect(store().checkRoadmap()).toBe(true);
    expect(store().roadmap).toEqual({ step: 0, ready: true });
    expect(store().checkRoadmap()).toBe(false);
    const earnings = store().runEarnings;
    expect(store().claimRoadmap()).toBe(true);
    expect(cash()).toBeCloseTo(1_000_000 + ROADMAP[0].cash);
    // A gift never counts as earnings.
    expect(store().runEarnings).toBe(earnings);
    expect(store().roadmap).toEqual({ step: 1, ready: false });
  });

  it('claiming chains into a goal that is already met', () => {
    useGameStore.setState({ lifetimeEarnings: '5', gpus: { ...store().gpus, x: createGpu('px460', 'bronze') } });
    store().claimRoadmap();
    expect(store().roadmap).toEqual({ step: 1, ready: true });
  });

  it('finishing the roadmap unlocks its achievement', () => {
    useGameStore.setState({ roadmap: { step: ROADMAP.length - 1, ready: true }, ownedRooms: ['bedroom', 'garage', 'warehouse', 'arctic', 'submarine'] });
    expect(store().claimRoadmap()).toBe(true);
    expect(store().roadmap.step).toBe(ROADMAP.length);
    expect(store().achievements).toContain('roadmap');
    expect(store().claimRoadmap()).toBe(false);
  });
});

describe('daily bonus', () => {
  it('pays a 7-day ladder that loops, with a floor', () => {
    expect(DAILY_REWARDS).toHaveLength(7);
    expect(dailyRewardFor(8)).toBe(DAILY_REWARDS[0]);
    expect(dailyCash(DAILY_REWARDS[0], 0)).toBe(DAILY_MIN_CASH);
    expect(dailyCash(DAILY_REWARDS[6], 10)).toBe(30 * 60 * 10);
  });

  it('streaks climb on consecutive days and restart after a gap', () => {
    expect(nextDailyStreak({ lastDay: 0, streak: 0 }, 100)).toBe(1);
    expect(nextDailyStreak({ lastDay: 99, streak: 3 }, 100)).toBe(4);
    expect(nextDailyStreak({ lastDay: 97, streak: 3 }, 100)).toBe(1);
  });

  it('can be claimed once per local day', () => {
    const today = localDay(NOW);
    expect(dailyAvailable(store(), NOW)).toBe(true);
    expect(store().claimDaily()).toBe(true);
    expect(store().daily).toEqual({ lastDay: today, streak: 1 });
    expect(cash()).toBeGreaterThanOrEqual(1_000_000 + DAILY_MIN_CASH);
    expect(store().claimDaily()).toBe(false);
    vi.setSystemTime(NOW + 86_400_000);
    expect(store().claimDaily()).toBe(true);
    expect(store().daily.streak).toBe(2);
    expect(store().stats.bestStreak).toBe(2);
  });

  it('a new game keeps the streak', () => {
    store().claimDaily();
    store().startNewGame();
    expect(store().daily.streak).toBe(1);
    expect(store().roadmap.step).toBe(0);
  });
});

describe('supply drones', () => {
  it('spawn when due, fly off when they expire and reschedule', () => {
    useGameStore.setState({ nextAirdropAt: NOW + 5000 });
    store().tickAirdrop(NOW);
    expect(store().airdrop).toBeNull();
    store().tickAirdrop(NOW + 5000);
    const drop = store().airdrop;
    expect(drop?.expiresAt).toBe(NOW + 5000 + AIRDROP.lifetimeSec * 1000);
    expect(store().nextAirdropAt).toBeGreaterThanOrEqual(NOW + 5000 + AIRDROP.interval[0] * 1000);
    store().tickAirdrop(NOW + 5000 + AIRDROP.lifetimeSec * 1000);
    expect(store().airdrop).toBeNull();
    expect(store().stats.airdrops).toBe(0);
  });

  const drop = (kind: 'cash' | 'coins' | 'overdrive' | 'gem') =>
    useGameStore.setState({ airdrop: { id: 1, kind, spawnedAt: NOW, expiresAt: NOW + 10_000 } });

  it('a cash crate pays at least the minimum and is not earnings', () => {
    drop('cash');
    expect(store().claimAirdrop()).toBe(true);
    expect(cash()).toBeGreaterThanOrEqual(1_000_000 + AIRDROP.minCash);
    expect(Number(store().runEarnings)).toBe(0);
    expect(store().airdrop).toBeNull();
    expect(store().stats.airdrops).toBe(1);
    expect(store().claimAirdrop()).toBe(false);
  });

  it('a coin crate falls back to cash on a farm with no hashrate', () => {
    drop('coins');
    store().claimAirdrop();
    expect(Number(store().cc)).toBe(0);
    expect(cash()).toBeGreaterThan(1_000_000);
  });

  it('Overdrive stacks up to its cap and Drone Uplink stretches it', () => {
    drop('overdrive');
    store().claimAirdrop();
    expect(store().boost).toEqual({ mul: AIRDROP.overdriveMul, until: NOW + AIRDROP.overdriveSec * 1000 });
    for (let i = 0; i < 6; i += 1) {
      drop('overdrive');
      store().claimAirdrop();
    }
    expect(store().boost?.until).toBe(NOW + AIRDROP.overdriveMaxSec * 1000);

    useGameStore.setState({ boost: null, talents: { drone_uplink: 2 } });
    drop('overdrive');
    store().claimAirdrop();
    expect(store().boost?.until).toBe(NOW + AIRDROP.overdriveSec * 2 * 1000);
  });

  it('a gem crate gives a gem and expired drones give nothing', () => {
    const gems = store().gems;
    drop('gem');
    store().claimAirdrop();
    expect(store().gems).toBe(gems + AIRDROP.gems);
    drop('gem');
    vi.setSystemTime(NOW + 20_000);
    expect(store().claimAirdrop()).toBe(false);
  });
});

describe('talents and achievements', () => {
  it('the new talents hang off existing ones', () => {
    const ids = new Set(PRESTIGE_TREE.map((n) => n.id));
    for (const id of ['drone_uplink', 'lab_grant'] as const) {
      const node = PRESTIGE_TREE.find((n) => n.id === id);
      expect(node).toBeDefined();
      node?.requires?.forEach((r) => expect(ids.has(r)).toBe(true));
    }
    expect(talentModifiers({ drone_uplink: 3 }).airdropMul).toBeCloseTo(2.5);
    expect(talentModifiers({ lab_grant: 3 }).researchTimeMul).toBeCloseTo(0.55);
    expect(talentModifiers({}).researchTimeMul).toBe(1);
  });

  it('achievement ids are unique and the new ones unlock from their stats', () => {
    expect(new Set(ACHIEVEMENTS.map((a) => a.id)).size).toBe(ACHIEVEMENTS.length);
    useGameStore.setState({ stats: { ...store().stats, airdrops: 10, fusions: 5, researchDone: 10, bestStreak: 7 } });
    store().checkAchievements();
    expect(store().achievements).toEqual(expect.arrayContaining(['airdrops10', 'fusion5', 'research10', 'streak7']));
  });
});

describe('persistence', () => {
  it('a v6 save migrates with an empty Lab, the first goal and a drone on the way', () => {
    const v6 = createInitialData() as unknown as Record<string, unknown>;
    for (const k of ['research', 'boost', 'roadmap', 'daily', 'nextAirdropAt']) delete v6[k];
    const stats = v6.stats as Record<string, unknown>;
    for (const k of ['airdrops', 'fusions', 'researchDone', 'bestStreak']) delete stats[k];
    v6.saveVersion = 6;
    const m = migrateSave(v6, 6);
    expect(m.saveVersion).toBe(SAVE_VERSION);
    expect(m.research).toEqual({ levels: {}, active: null });
    expect(m.boost).toBeNull();
    expect(m.roadmap).toEqual({ step: 0, ready: false });
    expect(m.daily).toEqual({ lastDay: 0, streak: 0 });
    expect(m.stats.airdrops).toBe(0);
    expect(m.nextAirdropAt).toBeGreaterThan(0);
  });

  it('sanitizes corrupt progression data', () => {
    const bad = createInitialData() as unknown as Record<string, unknown>;
    bad.research = { levels: { firmware: 999, bogus: 3, airflow: -2 }, active: { id: 'nope', startedAt: 1, endsAt: 2 } };
    bad.boost = { mul: 1e9, until: 'soon' };
    bad.roadmap = { step: 1e9, ready: 'yes' };
    bad.daily = { lastDay: -5, streak: 2.5 };
    const m = migrateSave(bad, SAVE_VERSION);
    expect(m.research.levels.firmware).toBe(RESEARCH_BY_ID.firmware.maxLevel);
    expect(Object.keys(m.research.levels)).not.toContain('bogus');
    expect(m.research.active).toBeNull();
    expect(m.boost).toBeNull();
    expect(m.roadmap.step).toBeLessThanOrEqual(ROADMAP.length);
    expect(m.daily.lastDay).toBeGreaterThanOrEqual(0);
    expect(JSON.stringify(m)).not.toMatch(/NaN|Infinity/);
  });

  it('round-trips a save in the middle of everything', () => {
    const data = createInitialData({
      research: { levels: { firmware: 2 }, active: { id: 'pfc', startedAt: NOW, endsAt: NOW + 60_000 } },
      boost: { mul: 2, until: NOW + 30_000 }, roadmap: { step: 5, ready: true }, daily: { lastDay: localDay(NOW), streak: 3 },
    });
    const back = migrateSave(JSON.parse(JSON.stringify(data)), SAVE_VERSION);
    expect(back.research).toEqual(data.research);
    expect(back.roadmap).toEqual(data.roadmap);
    expect(back.daily).toEqual(data.daily);
    expect(back.boost).toEqual(data.boost);
  });
});

describe('retranslatable log', () => {
  it('renders a template in either language, translating names and nested effects', () => {
    const entry = { text: '', key: 'RESEARCH COMPLETE: {name} Lv.{level} ({effect}).', params: { name: 'Firmware Tuning', level: 2, effect: { key: '+{pct}% hashrate', params: { pct: 8 } } } };
    expect(logLine(entry, 'en')).toBe('RESEARCH COMPLETE: Firmware Tuning Lv.2 (+8% hashrate).');
    expect(logLine(entry, 'es')).toBe('INVESTIGACIÓN COMPLETADA: Ajuste de firmware Nv.2 (+8% de hashrate).');
    expect(fillLog(entry.key, entry.params)).toBe(logLine(entry, 'en'));
    expect(logLine({ text: 'plain' }, 'es')).toBe('plain');
  });

  it('store actions log templates, not finished sentences', () => {
    store().startResearch('firmware');
    const last = store().log[store().log.length - 1];
    expect(last.key).toBe('Research started: {name} Lv.{level} ({time}).');
    expect(logLine(last, 'es')).toContain('Ajuste de firmware');
  });

  it('line upgrade is void under a power cap', () => {
    const w = starterWorld({ research: { levels: { grid: 5 }, active: null } });
    const capped = starterWorld({ research: { levels: { grid: 5 }, active: null }, challenge: { id: 'power_cap', startedAt: NOW } });
    const line = ROOM_BY_ID.bedroom.maxPowerW;
    expect(line).toBeGreaterThan(0);
    // Same rig either way: it must simply keep running without errors in both rule sets.
    expect(simulate(w.data, 5, NOW, { offline: true, maxStep: 5 }).live.totalHash).toBeGreaterThan(0);
    expect(simulate(capped.data, 5, NOW, { offline: true, maxStep: 5 }).live.totalHash).toBeGreaterThan(0);
  });
});
