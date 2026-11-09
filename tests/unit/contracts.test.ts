import { beforeEach, describe, expect, it } from 'vitest';
import { CONTRACT_DEFS, CONTRACTS } from '../../src/config/contracts';
import { ACHIEVEMENTS, SAVE_VERSION } from '../../src/config/gameBalance';
import {
  advanceContracts,
  contractContext,
  createBoard,
  creditProfit,
  generateContract,
  niceCeil,
  refillBoard,
  sanitizeBoard,
  type ContractContext,
  type ContractFacts,
} from '../../src/store/contracts';
import { simulate } from '../../src/store/gamePhysics';
import { createInitialData } from '../../src/store/initialState';
import { migrateSave } from '../../src/store/migrations';
import { selectSimInput, useGameStore } from '../../src/store/useGameStore';
import type { Contract, ContractBoard, ContractKind } from '../../src/types/contracts';
import type { ActiveNetworkEvent } from '../../src/types/economy';
import { bnToNumber } from '../../src/utils/bignum';
import { starterWorld } from './helpers';

const NOW = 1_800_000_000_000;
const online = { offline: false, maxStep: 1 } as const;
const store = () => useGameStore.getState();

/** Deterministic PRNG (mulberry32) so generation tests are reproducible. */
function seeded(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const ctxAt = (patch: Partial<ContractContext> = {}): ContractContext => ({
  hash: 100e6,
  ccPerSec: 2,
  incomePerSec: 1.5,
  hottest: 70,
  level: 1,
  bestTier: 2,
  runningTiers: [1, 2],
  ...patch,
});

const make = (kind: ContractKind, patch: Partial<Contract> = {}, ctx = ctxAt()): Contract => ({
  ...generateContract(ctx, NOW, [], seeded(7), { kind, difficulty: 2 }),
  ...patch,
});

const boardOf = (...slots: Contract[]): ContractBoard => ({ slots, nextRefillAt: 0, rerollReadyAt: 0 });

const facts = (patch: Partial<ContractFacts> = {}): ContractFacts => ({
  start: NOW,
  end: NOW + 1000,
  offline: false,
  ccMined: 0,
  earnedCash: 0,
  botEarned: 0,
  blocksFound: 0,
  overheats: 0,
  peakTemp: 60,
  totalHash: 100e6,
  event: null,
  runningTiers: [1, 2],
  ...patch,
});

const event = (startedAt: number): ActiveNetworkEvent => ({ id: 'heatwave', startedAt, endsAt: startedAt + 60_000, roomId: null });

describe('contract generation', () => {
  it('rounds goals to two significant figures', () => {
    expect(niceCeil(1234)).toBe(1300);
    expect(niceCeil(31.25e6)).toBe(32e6);
    expect(niceCeil(0.0456)).toBe(0.046);
    expect(niceCeil(0)).toBe(0);
  });

  it('scales goals and rewards with the farm', () => {
    const small = ctxAt({ hash: 25e6, ccPerSec: 0.5, incomePerSec: 0.4 });
    const big = ctxAt({ hash: 1e12, ccPerSec: 2e4, incomePerSec: 1.5e4, bestTier: 8 });
    for (const kind of ['reach_hash', 'deliver_cc', 'earn_profit'] as const) {
      const a = generateContract(small, NOW, [], seeded(1), { kind, difficulty: 2 });
      const b = generateContract(big, NOW, [], seeded(1), { kind, difficulty: 2 });
      expect(b.target / a.target, kind).toBeGreaterThan(1e3);
      expect(b.reward.cash).toBeGreaterThan(a.reward.cash * 1e3);
    }
    const hash = generateContract(small, NOW, [], seeded(1), { kind: 'reach_hash', difficulty: 1 });
    expect(hash.target).toBeGreaterThan(small.hash);
  });

  it('every goal needs real progress beyond the current state', () => {
    const ctx = ctxAt({ hottest: 72, runningTiers: [2, 2, 1], bestTier: 2 });
    const cool = generateContract(ctx, NOW, [], seeded(3), { kind: 'keep_cool', difficulty: 1 });
    expect(cool.param).toBeLessThan(72);
    expect(cool.minHash).toBeCloseTo(ctx.hash * CONTRACTS.keepCoolMinHashShare);
    const fleet = generateContract(ctx, NOW, [], seeded(3), { kind: 'gpu_tier', difficulty: 2 });
    expect(fleet.param).toBe(2);
    expect(fleet.target).toBe(2 + 2);
  });

  it('gives deadlines, rewards and distinct kinds on a fresh board', () => {
    for (let seed = 1; seed < 40; seed += 1) {
      const board = createBoard(ctxAt(), NOW, seeded(seed));
      expect(board.slots).toHaveLength(CONTRACTS.slots);
      expect(new Set(board.slots.map((c) => c.kind)).size).toBe(CONTRACTS.slots);
      board.slots.forEach((c) => {
        expect(c.expiresAt - c.createdAt).toBe(CONTRACT_DEFS[c.kind].minutes[c.difficulty - 1] * 60_000);
        expect(c.target).toBeGreaterThan(0);
        expect(c.reward.cash).toBeGreaterThanOrEqual(CONTRACTS.minCashReward);
        expect(c.progress).toBe(0);
      });
    }
  });

  it('only offers solo-block and bot contracts once those features unlock', () => {
    const kinds = new Set<ContractKind>();
    const rng = seeded(11);
    for (let i = 0; i < 400; i += 1) kinds.add(generateContract(ctxAt({ level: 1 }), NOW, [], rng).kind);
    expect(kinds.has('solo_block')).toBe(false);
    expect(kinds.has('bot_profit')).toBe(false);
    expect(kinds.has('deliver_cc')).toBe(true);
    const later = new Set<ContractKind>();
    for (let i = 0; i < 400; i += 1) later.add(generateContract(ctxAt({ level: 6 }), NOW, [], rng).kind);
    expect(later.has('solo_block')).toBe(true);
    expect(later.has('bot_profit')).toBe(true);
  });

  it('hard contracts pay gems and occasionally a free GPU', () => {
    const rng = seeded(5);
    const hard = Array.from({ length: 300 }, () => generateContract(ctxAt(), NOW, [], rng, { difficulty: 3 }));
    expect(hard.every((c) => c.reward.gems >= 1)).toBe(true);
    const gpus = hard.filter((c) => c.reward.gpuModelId);
    expect(gpus.length).toBeGreaterThan(20);
    expect(gpus.length).toBeLessThan(120);
    expect(gpus.every((c) => c.reward.gpuModelId === 'px580')).toBe(true); // best owned tier (2)
  });

  it('scales from the actual farm (mounted GPUs) when there is no live data', () => {
    const data = createInitialData();
    const ctx = contractContext(data);
    expect(ctx.hash).toBeCloseTo(25e6);
    expect(ctx.runningTiers).toEqual([1]);
    expect(ctx.bestTier).toBe(1);
    expect(ctx.level).toBe(1);
  });
});

describe('contract progress', () => {
  it('delivers mined $CC and completes', () => {
    const c = make('deliver_cc', { target: 10 });
    let res = advanceContracts(boardOf(c), facts({ ccMined: 4 }));
    expect(res.board.slots[0].progress).toBeCloseTo(4);
    expect(res.completed).toHaveLength(0);
    res = advanceContracts(res.board, facts({ start: NOW + 1000, end: NOW + 2000, ccMined: 7 }));
    expect(res.completed).toHaveLength(1);
    expect(res.board.slots[0].completedAt).toBe(NOW + 2000);
    expect(res.board.slots[0].progress).toBe(10);
  });

  it('pro-rates accumulated progress to the part of the window before the deadline', () => {
    const c = make('deliver_cc', { target: 1e9, createdAt: NOW, expiresAt: NOW + 3_600_000 });
    // Two-hour offline gap starting at the contract's creation: only the first hour counts.
    const res = advanceContracts(boardOf(c), facts({ offline: true, start: NOW, end: NOW + 7_200_000, ccMined: 1000 }));
    expect(res.expired).toHaveLength(1);
    expect(res.expired[0].progress).toBeCloseTo(500);
  });

  it('gauges track the live value and latch on completion', () => {
    const c = make('reach_hash', { target: 200e6 });
    let res = advanceContracts(boardOf(c), facts({ totalHash: 150e6 }));
    expect(res.board.slots[0].progress).toBe(150e6);
    res = advanceContracts(res.board, facts({ totalHash: 210e6 }));
    expect(res.completed).toHaveLength(1);
    res = advanceContracts(res.board, facts({ totalHash: 0 }));
    expect(res.board.slots[0].completedAt).not.toBeNull();
    const fleet = make('gpu_tier', { target: 3, param: 2 });
    const f = advanceContracts(boardOf(fleet), facts({ runningTiers: [1, 2, 3, 4] }));
    expect(f.completed).toHaveLength(1);
  });

  it('keep under X °C: needs a continuous streak with the farm running', () => {
    const c = make('keep_cool', { param: 70, target: 3, minHash: 50e6 });
    let res = advanceContracts(boardOf(c), facts({ peakTemp: 65 }));
    expect(res.board.slots[0].progress).toBeCloseTo(1);
    res = advanceContracts(res.board, facts({ peakTemp: 72 }));
    expect(res.board.slots[0].progress).toBe(0); // one hot die resets the streak
    res = advanceContracts(res.board, facts({ peakTemp: 65, totalHash: 10e6 }));
    expect(res.board.slots[0].progress).toBe(0); // switching the farm off is not "cool"
    res = advanceContracts(res.board, facts({ peakTemp: 0 }));
    expect(res.board.slots[0].progress).toBe(0); // no mounted GPU at all
    for (let i = 0; i < 3; i += 1) res = advanceContracts(res.board, facts({ peakTemp: 65 }));
    expect(res.completed).toHaveLength(1);
  });

  it('keep under X °C: offline time never counts and resets the streak', () => {
    const c = make('keep_cool', { param: 70, target: 600, minHash: 0 });
    let res = advanceContracts(boardOf(c), facts({ start: NOW, end: NOW + 300_000, peakTemp: 60 }));
    expect(res.board.slots[0].progress).toBeCloseTo(300);
    res = advanceContracts(res.board, facts({ offline: true, start: NOW + 300_000, end: NOW + 600_000, peakTemp: 40 }));
    expect(res.completed).toHaveLength(0);
    expect(res.board.slots[0].progress).toBe(0);
  });

  it('survive a network event: from start to end, with no thermal shutdown', () => {
    const c = make('survive_event', { target: 1 });
    const ev = event(NOW + 500);
    let res = advanceContracts(boardOf(c), facts({ event: ev }));
    expect(res.board.slots[0].watch).toEqual({ startedAt: ev.startedAt, clean: true, sawHash: true });
    res = advanceContracts(res.board, facts({ event: ev, overheats: 1 }));
    res = advanceContracts(res.board, facts({ event: null }));
    expect(res.completed).toHaveLength(0); // a GPU shut down during the event
    expect(res.board.slots[0].watch).toBeNull();
    const ev2 = event(NOW + 200_000);
    res = advanceContracts(res.board, facts({ event: ev2 }));
    res = advanceContracts(res.board, facts({ event: ev2 }));
    res = advanceContracts(res.board, facts({ event: null }));
    expect(res.completed).toHaveLength(1);
  });

  it('survive a network event: events already running at issue time or interrupted by offline time do not count', () => {
    const c = make('survive_event', { target: 1 });
    const before = event(NOW - 10_000);
    let res = advanceContracts(boardOf(c), facts({ event: before }));
    res = advanceContracts(res.board, facts({ event: null }));
    expect(res.completed).toHaveLength(0);
    const ev = event(NOW + 100);
    res = advanceContracts(res.board, facts({ event: ev }));
    res = advanceContracts(res.board, facts({ event: ev, offline: true }));
    res = advanceContracts(res.board, facts({ event: ev }));
    res = advanceContracts(res.board, facts({ event: null }));
    expect(res.completed).toHaveLength(0);
  });

  it('solo blocks and bot profit accumulate from the tick facts', () => {
    const solo = make('solo_block', { target: 1 });
    const bot = make('bot_profit', { target: 100 });
    const res = advanceContracts(boardOf(solo, bot), facts({ blocksFound: 1, botEarned: 60, earnedCash: 60 }));
    expect(res.completed.map((c) => c.kind)).toEqual(['solo_block']);
    expect(res.board.slots[1].progress).toBe(60);
  });

  it('a window that straddles the deadline cannot complete event-based goals with post-deadline results', () => {
    const solo = make('solo_block', { target: 1, createdAt: NOW - 5 * 60_000, expiresAt: NOW + 1000 });
    const reach = make('reach_hash', { target: 50e6, createdAt: NOW - 5 * 60_000, expiresAt: NOW + 1000 });
    const tier = make('gpu_tier', { target: 1, param: 1, createdAt: NOW - 5 * 60_000, expiresAt: NOW + 1000 });
    // 8 h offline gap starting 1 s before the deadline: ~0.003% of it is inside the contract.
    const gap = facts({ start: NOW, end: NOW + 8 * 3600_000, offline: true, blocksFound: 90, totalHash: 100e6, runningTiers: [2] });
    const res = advanceContracts(boardOf(solo, reach, tier), gap);
    expect(res.completed).toHaveLength(0);
    expect(res.expired).toHaveLength(3);
  });

  it('expires unfinished contracts at the deadline and refills the slot after a delay', () => {
    const ctx = ctxAt();
    const board = createBoard(ctx, NOW, seeded(2));
    const end = board.slots[0].expiresAt;
    const res = advanceContracts(board, facts({ start: end - 1000, end }));
    expect(res.expired.length).toBeGreaterThanOrEqual(1);
    expect(res.board.slots.length).toBe(CONTRACTS.slots - res.expired.length);
    expect(res.board.nextRefillAt).toBe(end + CONTRACTS.refillSec * 1000);
    expect(refillBoard(res.board, ctx, end + 1000).added).toHaveLength(0);
    // Slots come back one at a time, one every refillSec.
    const later = refillBoard(res.board, ctx, end + CONTRACTS.refillSec * 1000);
    expect(later.added).toHaveLength(1);
    const full = refillBoard(res.board, ctx, end + CONTRACTS.slots * CONTRACTS.refillSec * 1000);
    expect(full.board.slots).toHaveLength(CONTRACTS.slots);
    expect(new Set(full.board.slots.map((c) => c.kind)).size).toBe(CONTRACTS.slots);
  });

  it('completed contracts never expire', () => {
    const c = make('deliver_cc', { completedAt: NOW, progress: 10, target: 10 });
    const res = advanceContracts(boardOf(c), facts({ start: c.expiresAt + 1, end: c.expiresAt + 10_000 }));
    expect(res.expired).toHaveLength(0);
    expect(res.board.slots).toHaveLength(1);
  });

  it('manual sales credit only realized profit', () => {
    const c = make('earn_profit', { target: 50 });
    const res = creditProfit(boardOf(c), 20, NOW + 1);
    expect(res.board.slots[0].progress).toBe(20);
    expect(creditProfit(res.board, 40, NOW + 2).completed).toHaveLength(1);
    expect(creditProfit(boardOf(c), 1000, c.expiresAt).completed).toHaveLength(0);
  });
});

describe('simulation facts for contracts', () => {
  it('reports the hottest die over the whole tick, not just its last step', () => {
    const { input, gpuUid } = starterWorld();
    input.gpus[gpuUid] = { ...input.gpus[gpuUid], temp: 93 };
    const out = simulate(input, 120, NOW, online);
    expect(out.gpuUpdates[gpuUid].temp).toBeLessThan(90);
    expect(out.peakTemp).toBeGreaterThan(90);
  });

  it('bot profit counts mined coins but not a buy→sell round trip', () => {
    const bot = { id: 'bot-1', coin: 'CC' as const, side: 'sell' as const, trigger: 'above' as const, threshold: 0.1, amountPct: 100, cooldownSec: 5, lastFiredAt: 0, enabled: true };
    const mined = starterWorld({ cc: '100', ccCostBasis: 0, bots: [bot] });
    const a = simulate(mined.input, 1, NOW, online);
    expect(a.botEarned).toBeGreaterThan(50);
    const bought = starterWorld({ cc: '100', ccCostBasis: 1000, bots: [bot] });
    const b = simulate(bought.input, 1, NOW, online);
    expect(b.botEarned).toBeLessThan(1);
  });
});

describe('contracts in the store', () => {
  beforeEach(() => {
    useGameStore.setState({ ...createInitialData(), cash: '10000', cc: '0', runEarnings: '0', lifetimeEarnings: '0', nextEventAt: Number.MAX_SAFE_INTEGER });
  });

  it('applyTick advances the board from the simulation output', () => {
    const c = make('deliver_cc', { target: 1e6, createdAt: Date.now() - 60_000, expiresAt: Date.now() + 600_000 });
    useGameStore.setState({ contracts: boardOf(c), lastTick: Date.now() - 2000 });
    const out = simulate(selectSimInput(store()), 2, Date.now(), online);
    store().applyTick(out);
    expect(store().contracts.slots.find((x) => x.id === c.id)?.progress).toBeCloseTo(out.ccMined);
  });

  it('wash trading cannot fill a Cash Out contract, selling mined coins can', () => {
    const c = make('earn_profit', { target: 50, createdAt: Date.now() - 1000, expiresAt: Date.now() + 600_000 });
    useGameStore.setState({ contracts: boardOf(c) });
    for (let i = 0; i < 10; i += 1) {
      store().buyCoin('CC', 2000);
      store().sellCoin('CC', bnToNumber(store().cc));
    }
    expect(store().contracts.slots[0].progress).toBeLessThan(1);
    useGameStore.setState({ cc: '100', ccCostBasis: 0 });
    store().sellCoin('CC', 100);
    expect(store().contracts.slots[0].completedAt).not.toBeNull();
    expect(store().contractToast?.contractId).toBe(c.id);
  });

  it('claiming pays the reward (not as earnings), frees the slot and counts it', () => {
    const c = make('deliver_cc', { completedAt: Date.now(), progress: 10, target: 10, reward: { cash: 500, gems: 2, gpuModelId: 'px580' } });
    const others = createBoard(ctxAt(), Date.now(), seeded(4)).slots.filter((x) => x.kind !== 'deliver_cc').slice(0, 2);
    // Pre-unlock every achievement: the reward GPU's silicon roll can be 'god', which would add gems.
    useGameStore.setState({ contracts: boardOf(c, ...others), gems: 1, achievements: ACHIEVEMENTS.map((a) => a.id) });
    const gpusBefore = Object.keys(store().gpus).length;
    expect(store().claimContract(c.id)).toBe(true);
    expect(bnToNumber(store().cash)).toBe(10_500);
    expect(store().gems).toBe(3);
    expect(bnToNumber(store().runEarnings)).toBe(0);
    expect(Object.keys(store().gpus)).toHaveLength(gpusBefore + 1);
    expect(store().lottery?.modelId).toBe('px580');
    expect(store().stats.contractsCompleted).toBe(1);
    expect(store().contracts.slots.map((x) => x.id)).not.toContain(c.id);
    expect(store().contracts.nextRefillAt).toBeGreaterThan(Date.now());
    expect(store().claimContract(c.id)).toBe(false); // no double claim
  });

  it('unfinished contracts cannot be claimed', () => {
    const c = make('deliver_cc');
    useGameStore.setState({ contracts: boardOf(c) });
    expect(store().claimContract(c.id)).toBe(false);
    expect(bnToNumber(store().cash)).toBe(10_000);
  });

  it('reroll swaps one unfinished contract for a cost, then goes on cooldown', () => {
    const board = createBoard(ctxAt(), Date.now(), seeded(9));
    useGameStore.setState({ contracts: board });
    const target = board.slots[0];
    const cost = store().contractRerollCost();
    expect(cost).toBeGreaterThanOrEqual(CONTRACTS.rerollMinCost);
    expect(store().rerollContract(target.id)).toBe(true);
    const after = store().contracts;
    expect(after.slots[0].id).not.toBe(target.id);
    expect(new Set(after.slots.map((x) => x.kind)).size).toBe(CONTRACTS.slots);
    expect(bnToNumber(store().cash)).toBeCloseTo(10_000 - cost);
    expect(after.rerollReadyAt).toBeGreaterThan(Date.now() + (CONTRACTS.rerollCooldownSec - 5) * 1000);
    expect(store().rerollContract(after.slots[1].id)).toBe(false); // cooldown
  });

  it('reroll refuses completed contracts and empty wallets', () => {
    const done = make('deliver_cc', { completedAt: Date.now() });
    const open = make('reach_hash');
    useGameStore.setState({ contracts: boardOf(done, open), cash: '0' });
    expect(store().rerollContract(done.id)).toBe(false);
    expect(store().rerollContract(open.id)).toBe(false);
    expect(store().contracts.slots[1].id).toBe(open.id);
  });

  it('The Halving deals a fresh board for the new run but keeps the claimed count', () => {
    const old = store().contracts.slots.map((c) => c.id);
    useGameStore.setState((s) => ({ runEarnings: '4000000', stats: { ...s.stats, contractsCompleted: 7 } }));
    expect(store().performHalving()).toBe(true);
    expect(store().contracts.slots).toHaveLength(CONTRACTS.slots);
    expect(store().contracts.slots.some((c) => old.includes(c.id))).toBe(false);
    expect(store().contracts.slots.every((c) => c.progress === 0)).toBe(true);
    expect(store().stats.contractsCompleted).toBe(7);
  });
});

describe('contracts persistence', () => {
  it('a v3 save gets a board scaled to its farm and the new stats field', () => {
    const v3 = createInitialData() as unknown as Record<string, unknown>;
    delete v3.contracts;
    v3.saveVersion = 3;
    v3.stats = { ...(v3.stats as Record<string, unknown>) };
    delete (v3.stats as Record<string, unknown>).contractsCompleted;
    const migrated = migrateSave(v3, 3);
    expect(SAVE_VERSION).toBe(5);
    expect(migrated.saveVersion).toBe(5);
    expect(migrated.contracts.slots).toHaveLength(CONTRACTS.slots);
    expect(migrated.stats.contractsCompleted).toBe(0);
  });

  it('a v4 board round-trips unchanged', () => {
    const data = createInitialData();
    const c = { ...data.contracts.slots[0], progress: data.contracts.slots[0].target / 2 };
    const board = { ...data.contracts, slots: [c, ...data.contracts.slots.slice(1)] };
    const migrated = migrateSave(JSON.parse(JSON.stringify({ ...data, contracts: board })), 4);
    expect(migrated.contracts).toEqual(board);
  });

  it('tampered boards are sanitized instead of crashing the game', () => {
    const data = createInitialData();
    const good = data.contracts.slots[0];
    const garbage = [
      null,
      'x',
      { ...good, kind: 'steal_everything' },
      { ...good, id: 'dup' },
      { ...good, id: 'dup' },
      { ...good, id: 'neg', target: -5 },
      { ...good, id: 'big', progress: 1e99, reward: { cash: 'lots', gems: 999, gpuModelId: 'nope' } },
    ];
    const migrated = migrateSave({ ...data, contracts: { slots: garbage, nextRefillAt: 'soon', rerollReadyAt: 1e20 } }, 4);
    const ids = migrated.contracts.slots.map((c) => c.id);
    expect(ids).toEqual(['dup', 'big']);
    const big = migrated.contracts.slots[1];
    expect(big.progress).toBe(big.target);
    expect(big.reward).toEqual({ cash: 0, gems: 10, gpuModelId: null });
    expect(migrated.contracts.nextRefillAt).toBe(0);
    expect(migrated.contracts.rerollReadyAt).toBeLessThanOrEqual(Date.now() + CONTRACTS.rerollCooldownSec * 1000);
    expect(sanitizeBoard('broken', contractContext(data), NOW).slots).toHaveLength(CONTRACTS.slots);
  });
});
