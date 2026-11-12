import { beforeEach, describe, expect, it } from 'vitest';
import { AUTOPILOT, AUTOPILOT_PLANS, AUTOPILOT_PLAN_BY_ID } from '../../src/config/autopilot';
import { SAVE_VERSION } from '../../src/config/gameBalance';
import { GPU_BY_ID } from '../../src/config/hardwareCatalog';
import '../../src/i18n/es';
import { NEW_RACK, applyOps, candidates, plan, simulatedNet } from '../../src/store/autopilot/planner';
import { simulate } from '../../src/store/gamePhysics';
import { createInitialData } from '../../src/store/initialState';
import { logLine } from '../../src/store/logLine';
import { migrateSave } from '../../src/store/migrations';
import { autopilotActive, executeOps, resetAutopilotClock, shouldHalve } from '../../src/store/slices/autopilotSlice';
import { useGameStore } from '../../src/store/useGameStore';
import type { GameData } from '../../src/types/player';
import { starterWorld } from './helpers';

const NOW = 1_800_000_000_000;
const store = () => useGameStore.getState();
const ON = { remainingSec: 3600, paused: false, purchases: 0, spent: 0, autoHalving: false };

const fresh = (patch: Partial<GameData> = {}) => {
  resetAutopilotClock();
  useGameStore.setState({
    ...createInitialData(), nextEventAt: Number.MAX_SAFE_INTEGER, nextAirdropAt: Number.MAX_SAFE_INTEGER,
    log: [], history: [], airdrop: null, autopilotStatus: null, ...patch,
  });
};

/** Headless play: 1 s ticks merged the way the game loop does. */
function play(seconds: number, start = NOW): void {
  for (let t = 1; t <= seconds; t += 1) store().applyTick(simulate(store(), 1, start + t * 1000, { offline: false, maxStep: 1 }));
}

beforeEach(() => fresh());

describe('autopilot plans', () => {
  it('sells 1 hour, 2 hours and 1 day, cheaper per hour the longer the plan', () => {
    expect(AUTOPILOT_PLANS.map((p) => p.seconds)).toEqual([3600, 7200, 86_400]);
    const perHour = AUTOPILOT_PLANS.map((p) => p.gems / (p.seconds / 3600));
    expect(perHour).toEqual([...perHour].sort((a, b) => b - a));
  });

  it('charges gems, stacks time and refuses without gems or past the cap', () => {
    useGameStore.setState({ gems: 8 });
    expect(store().buyAutopilot('h1')).toBe(true);
    expect(store().buyAutopilot('h2')).toBe(true);
    expect(store().gems).toBe(0);
    expect(store().autopilot.remainingSec).toBe(3 * 3600);
    expect(store().buyAutopilot('h1')).toBe(false);
    useGameStore.setState({ gems: 999, autopilot: { ...ON, remainingSec: AUTOPILOT.maxSeconds - 60 } });
    expect(store().buyAutopilot('h1')).toBe(false);
    expect(store().gems).toBe(999);
  });

  it('time only runs while it works: paused or sleeping tabs are not charged', () => {
    useGameStore.setState({ autopilot: ON });
    store().autopilotTick(1, NOW);
    expect(store().autopilot.remainingSec).toBe(3599);
    store().autopilotTick(7200, NOW + 1000);
    expect(store().autopilot.remainingSec).toBe(3599 - AUTOPILOT.maxTickSec);
    store().setAutopilotPaused(true);
    expect(autopilotActive(store())).toBe(false);
    store().autopilotTick(1, NOW + 2000);
    expect(store().autopilot.remainingSec).toBe(3599 - AUTOPILOT.maxTickSec);
  });

  it('switches itself off when the time runs out', () => {
    useGameStore.setState({ autopilot: { ...ON, remainingSec: 1 } });
    store().autopilotTick(1, NOW);
    expect(store().autopilot.remainingSec).toBe(0);
    expect(autopilotActive(store())).toBe(false);
    const cash = store().cash;
    useGameStore.setState({ cash: '1000000' });
    store().autopilotTick(1, NOW + 60_000);
    expect(store().cash).toBe('1000000');
    expect(cash).toBeDefined();
  });

  it('survives The Halving and a save round trip; a v7 save gets none', () => {
    useGameStore.setState({ autopilot: { ...ON, purchases: 4, spent: 900 }, runEarnings: '50000000', lifetimeEarnings: '50000000' });
    expect(store().performHalving()).toBe(true);
    expect(store().autopilot).toEqual({ ...ON, purchases: 4, spent: 900 });

    const data = createInitialData({ autopilot: { remainingSec: 500, paused: true, purchases: 2, spent: 10, autoHalving: true } });
    expect(migrateSave(JSON.parse(JSON.stringify(data)), SAVE_VERSION).autopilot).toEqual(data.autopilot);
    const v7 = { ...JSON.parse(JSON.stringify(data)), saveVersion: 7, autopilot: { remainingSec: 1e12 } };
    expect(migrateSave(v7, 7).autopilot.remainingSec).toBe(0);
    const bad = { ...JSON.parse(JSON.stringify(data)), autopilot: { remainingSec: 1e12, paused: 'x', purchases: -3, spent: 'NaN' } };
    expect(migrateSave(bad, SAVE_VERSION).autopilot).toEqual({ remainingSec: AUTOPILOT.maxSeconds, paused: false, purchases: 0, spent: 0, autoHalving: false });
  });
});

describe('planner', () => {
  it('values the starter farm at a positive net income', () => {
    const { net, live } = simulatedNet(starterWorld().data, NOW);
    expect(net).toBeGreaterThan(0);
    expect(live.totalHash).toBeGreaterThan(0);
  });

  it('applyOps builds the hypothetical farm without touching the real one', () => {
    const w = starterWorld().data;
    const next = applyOps(w, [
      { op: 'rack', modelId: 'steel', roomId: 'bedroom', pad: 1 },
      { op: 'psu', modelId: 'psu1000', rackUid: NEW_RACK },
      { op: 'cooler', modelId: 'fan120', rackUid: NEW_RACK, slot: 0 },
      { op: 'gpu', modelId: 'px580', rackUid: NEW_RACK, slot: 0 },
    ]);
    expect(Object.keys(w.racks)).toHaveLength(1);
    expect(Object.keys(next.racks)).toHaveLength(2);
    expect(simulatedNet(next, NOW).live.totalHash).toBeCloseTo(GPU_BY_ID.px460.hashrate + GPU_BY_ID.px580.hashrate, -5);
  });

  it('every candidate costs money and a broke farm saves for the best one', () => {
    const w = starterWorld({ cash: '0' }).data;
    const p = plan(w, NOW);
    expect(p.target).not.toBeNull();
    expect(p.buyNow).toBeNull();
    expect(p.target?.wait).toBeGreaterThan(0);
    p.evaluated.forEach((e) => {
      expect(e.cost, e.id).toBeGreaterThan(0);
      expect(e.gain, e.id).toBeGreaterThan(0);
      expect(e.payback, e.id).toBeLessThanOrEqual(AUTOPILOT.maxPaybackSec);
    });
    expect([...p.evaluated].sort((a, b) => a.score - b.score)).toEqual(p.evaluated);
  });

  it('buys at once what it can afford and never plans past the catalog', () => {
    const w = starterWorld({ cash: '5000' }).data;
    const p = plan(w, NOW);
    expect(p.buyNow).not.toBeNull();
    expect(p.buyNow?.cost).toBeLessThanOrEqual(p.spendable);
    const all = candidates(w, p.baseNet, p.live);
    expect(all.length).toBeGreaterThan(3);
    expect(all.length).toBeLessThanOrEqual(20);
    expect(new Set(all.map((c) => c.id)).size).toBe(all.length);
  });

  it('respects the Single Room challenge and an idle-only Lab', () => {
    const w = starterWorld({ cash: '1e7', challenge: { id: 'single_room', startedAt: NOW }, research: { levels: {}, active: { id: 'pfc', startedAt: NOW, endsAt: NOW + 1e6 } } }).data;
    const ids = plan(w, NOW).evaluated.map((e) => e.id);
    expect(ids.some((id) => id.startsWith('room:'))).toBe(false);
    expect(ids.some((id) => id.startsWith('research:'))).toBe(false);
  });

  it('a planned kit runs cool and within its PSU when really bought', () => {
    fresh({ cash: '200000' });
    const p = plan(store(), NOW);
    const kit = p.evaluated.find((e) => e.id.startsWith('rack:'));
    expect(kit).toBeDefined();
    expect(executeOps(store, kit?.ops ?? [])).toBe(true);
    const out = simulate(store(), 900, NOW, { offline: true, maxStep: 10 });
    Object.values(out.live.racks).forEach((r) => expect(r.status).toBe('online'));
    expect(out.live.hottest).toBeLessThan(85);
    expect(Number(store().cash)).toBeCloseTo(200_000 - (kit?.cost ?? 0), 0);
  });
});

describe('manager at work', () => {
  it('does the chores: claims, sells, mounts and fuses without being asked', () => {
    const spare = Object.values(store().gpus)[0];
    const gpus = { ...store().gpus };
    for (let i = 0; i < 3; i += 1) gpus[`s${i}`] = { ...spare, uid: `s${i}`, quality: 'bronze' as const };
    fresh({ autopilot: ON, gpus, cc: '50', lifetimeEarnings: '5', roadmap: { step: 0, ready: true } });
    useGameStore.setState({ airdrop: { id: 1, kind: 'gem', spawnedAt: NOW, expiresAt: NOW + 60_000 } });
    const gems = store().gems;
    play(3);
    expect(store().roadmap.step).toBeGreaterThan(0);
    expect(store().airdrop).toBeNull();
    expect(store().gems).toBeGreaterThan(gems);
    expect(store().daily.streak).toBe(1);
    expect(Number(store().cc)).toBeLessThan(5);
    expect(store().stats.fusions + Object.values(store().racks)[0].gpuSlots.filter(Boolean).length).toBeGreaterThanOrEqual(2);
  });

  it('grows a fresh farm many times over in twenty minutes, without overheating or going broke', () => {
    play(1200);
    const idle = store().live.totalHash;
    fresh({ autopilot: { ...ON, remainingSec: 7200 } });
    play(1200);
    expect(store().live.totalHash).toBeGreaterThan(idle * 5);
    expect(store().autopilot.purchases).toBeGreaterThanOrEqual(2);
    expect(store().autopilot.spent).toBeGreaterThan(0);
    expect(Number(store().cash)).toBeGreaterThanOrEqual(0);
    expect(store().live.hottest).toBeLessThan(90);
    expect(store().stats.halvings).toBe(0);
    // The log is capped, so the purchase line is rendered here from its template.
    const line = { text: '', key: 'AI MANAGER: {what} for {price}, pays for itself in {time}.', params: { what: { key: 'new rack: {rack} with {name}', params: { rack: 'Steel Rack 4U', name: 'PX-580' } }, price: '$1K', time: '3m' } };
    expect(logLine(line, 'es')).toMatch(/^GESTOR IA: rack nuevo: .+ con PX-580 por \$1K/);
    expect(logLine(line, 'es')).not.toContain('Steel Rack');
    expect(store().autopilotStatus).not.toBeNull();
  }, 60_000);

  it('never spends gems, $SC or $MEME and never resets the run', () => {
    fresh({ autopilot: { ...ON, remainingSec: 7200 }, gems: 40, sc: 12, meme: 500, memeCostBasis: 5, cash: '50000' });
    play(120);
    expect(store().gems).toBeGreaterThanOrEqual(40);
    expect(store().sc).toBe(12);
    expect(store().meme).toBe(500);
    expect(store().talents).toEqual({});
    expect(AUTOPILOT_PLAN_BY_ID.d1.gems).toBe(25);
  });
});

describe('automatic Halving (opt-in)', () => {
  const run = (earnings: number, hours: number) => ({ runEarnings: String(earnings), runStartedAt: NOW - hours * 3_600_000 });

  it('never fires below the Halving threshold', () => {
    expect(shouldHalve(run(3.9e6, 5), 1000, NOW)).toBe(false);
  });

  it('waits while the next $SC is close and resets once it is not worth the wait', () => {
    // 4 $SC after 1 h; the 5th needs $8M. At $10K/s that is 400 s away: (5 / 1.11 h) beats (4 / 1 h).
    expect(shouldHalve(run(4e6, 1), 10_000, NOW)).toBe(false);
    // At $100/s it is 11 hours away: reset now.
    expect(shouldHalve(run(4e6, 1), 100, NOW)).toBe(true);
    expect(shouldHalve(run(4e6, 1), 0, NOW)).toBe(true);
  });

  it('is off by default: a ripe run is left alone', () => {
    fresh({ autopilot: ON, ...run(5e6, 3), lifetimeEarnings: '5000000' });
    play(6);
    expect(store().stats.halvings).toBe(0);
  });

  it('when on, it does The Halving, spends the $SC on talents and keeps working', () => {
    fresh({ autopilot: ON, ...run(5e6, 3), lifetimeEarnings: '5000000' });
    store().setAutopilotAutoHalving(true);
    play(6);
    expect(store().stats.halvings).toBe(1);
    expect(Object.values(store().talents).reduce((a, l) => a + (l ?? 0), 0)).toBeGreaterThan(0);
    expect(store().sc).toBeLessThan(4);
    expect(store().autopilot.autoHalving).toBe(true);
    expect(store().autopilot.remainingSec).toBeGreaterThan(0);
    expect(Number(store().runEarnings)).toBeLessThan(1e6);
  });
});
