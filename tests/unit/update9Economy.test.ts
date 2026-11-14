import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CHALLENGE_IDS } from '../../src/config/challenges';
import { COLLECTION, COLLECTION_FAMILIES, RELICS, collect, collectionProgress, perkModifiers } from '../../src/config/collection';
import { PHYSICS, POOLS, POOL_ORDER, SAVE_VERSION } from '../../src/config/gameBalance';
import { GPU_BY_ID, GPU_CATALOG, QUALITY_ORDER } from '../../src/config/hardwareCatalog';
import { MARKET_PHASES, MARKET_PHASE_IDS, NEWS, NEWS_IDS, ORDERS, cycleEffect, newCycle } from '../../src/config/marketCycle';
import { runModifiers } from '../../src/config/modifiers';
import { PRESTIGE_TREE, TALENT_BY_ID, talentModifiers } from '../../src/config/prestigeTree';
import { REPUTATION, emptyReputation, reputationCashMul, reputationLevel, reputationProgress } from '../../src/config/reputation';
import { poolYieldMul, simulate, simulateOffline, stepCycle, type GameMessage, type SoundCue } from '../../src/store/gamePhysics';
import { createGpu, createInitialData } from '../../src/store/initialState';
import { migrateSave } from '../../src/store/migrations';
import { FUSE_COUNT, USED_GPU, usedGpuPrice } from '../../src/store/slices/hardwareSlice';
import { useGameStore } from '../../src/store/useGameStore';
import type { MarketCycle } from '../../src/types/economy';
import { starterWorld } from './helpers';

const NOW = 1_800_000_000_000;
const online = { offline: false, maxStep: 1 } as const;
const store = () => useGameStore.getState();
afterEach(() => vi.restoreAllMocks());

describe('market cycle', () => {
  it('the four phases follow each other in a loop', () => {
    const seen = new Set<string>();
    let id = MARKET_PHASES.accumulation.id;
    for (let i = 0; i < 4; i += 1) {
      seen.add(id);
      id = MARKET_PHASES[id].next;
    }
    expect([...seen].sort()).toEqual([...MARKET_PHASE_IDS].sort());
    expect(id).toBe('accumulation');
    expect(MARKET_PHASES.bull.meanMul.CC).toBeGreaterThan(1);
    expect(MARKET_PHASES.bear.meanMul.CC).toBeLessThan(1);
    // Altseason favours the alts over $CC.
    expect(MARKET_PHASES.altseason.meanMul.NOVA).toBeGreaterThan(MARKET_PHASES.altseason.meanMul.CC);
    expect(MARKET_PHASES.altseason.meanMul.MEME).toBeGreaterThan(MARKET_PHASES.bull.meanMul.MEME);
  });

  it('advances phase by phase, also across a long absence, and only reports it online', () => {
    const cycle: MarketCycle = { phase: 'accumulation', startedAt: NOW, endsAt: NOW + 1000, news: null, nextNewsAt: Number.MAX_SAFE_INTEGER };
    const messages: GameMessage[] = [];
    const sounds: SoundCue[] = [];
    stepCycle(cycle, NOW + 2000, false, messages, sounds);
    expect(cycle.phase).toBe('bull');
    expect(cycle.endsAt).toBeGreaterThan(NOW + 2000);
    expect(messages).toHaveLength(1);
    expect(messages[0].key).toBe('MARKET CYCLE: {name}. {description}');
    // Ten hours away: many phases pass, silently, and the cycle ends up in the future.
    const quiet: GameMessage[] = [];
    stepCycle(cycle, NOW + 36_000_000, true, quiet, sounds);
    expect(quiet).toEqual([]);
    expect(cycle.endsAt).toBeGreaterThan(NOW + 36_000_000);
    expect(MARKET_PHASE_IDS).toContain(cycle.phase);
  });

  it('headlines come and go online, never offline', () => {
    const cycle: MarketCycle = { ...newCycle(NOW), endsAt: Number.MAX_SAFE_INTEGER, nextNewsAt: NOW };
    const messages: GameMessage[] = [];
    const sounds: SoundCue[] = [];
    stepCycle(cycle, NOW + 1, true, messages, sounds);
    expect(cycle.news).toBeNull();
    stepCycle(cycle, NOW + 1, false, messages, sounds);
    expect(cycle.news && NEWS_IDS.includes(cycle.news.id)).toBe(true);
    expect(sounds).toEqual(['news']);
    expect(messages[0].key).toBe('NEWS: {headline}.');
    const ends = cycle.news?.endsAt ?? 0;
    stepCycle(cycle, ends + 1, false, messages, sounds);
    expect(cycle.news).toBeNull();
    expect(cycle.nextNewsAt).toBeGreaterThan(ends);
  });

  it('phase and headline multiply into the mean and volatility of a coin', () => {
    const base = { phase: 'bull' as const, news: null };
    expect(cycleEffect(base, 'CC', NOW)).toEqual({ meanMul: MARKET_PHASES.bull.meanMul.CC, sigmaMul: MARKET_PHASES.bull.sigmaMul });
    const hack = { phase: 'bull' as const, news: { id: 'exchange_hack' as const, startedAt: NOW, endsAt: NOW + 10_000 } };
    const fx = cycleEffect(hack, 'CC', NOW);
    expect(fx.meanMul).toBeCloseTo(MARKET_PHASES.bull.meanMul.CC * (NEWS.exchange_hack.effects.CC?.meanMul ?? 1), 10);
    expect(fx.sigmaMul).toBeGreaterThan(MARKET_PHASES.bull.sigmaMul);
    // A $CC story does not touch $NOVA, and an expired one touches nothing.
    expect(cycleEffect(hack, 'NOVA', NOW).meanMul).toBe(MARKET_PHASES.bull.meanMul.NOVA);
    expect(cycleEffect(hack, 'CC', NOW + 20_000).meanMul).toBe(MARKET_PHASES.bull.meanMul.CC);
  });

  it('a Bull Run lifts $CC and a Bear Market sinks it (long-run average)', () => {
    const avg = (phase: 'bull' | 'bear') => {
      const { input } = starterWorld();
      const world = { ...input, cycle: { ...input.cycle, phase } };
      let sum = 0;
      for (let i = 0; i < 12; i += 1) sum += simulateOffline(world, 900, NOW + i).market.CC.price;
      return sum / 12;
    };
    expect(avg('bull')).toBeGreaterThan(avg('bear') * 1.25);
  });
});

describe('take-profit / stop-loss orders', () => {
  const desk = { research: { levels: { orders: 1 }, active: null } };

  it('a take-profit sells once the price is reached and reports the fill; a stop-loss waits for a drop', () => {
    const { input } = starterWorld({ ...desk, cc: '100' });
    const price = input.market.CC.price;
    const orders = [
      { id: 'tp', coin: 'CC' as const, kind: 'tp' as const, price: price * 0.5, amountPct: 50, createdAt: NOW },
      { id: 'sl', coin: 'CC' as const, kind: 'sl' as const, price: price * 0.2, amountPct: 100, createdAt: NOW },
    ];
    const out = simulate({ ...input, orders }, 0.25, NOW, online);
    expect(out.filledOrders).toEqual(['tp']);
    expect(out.ccDelta).toBeLessThan(-49);
    expect(out.ccDelta).toBeGreaterThan(-51);
    expect(out.cashDelta).toBeGreaterThan(40 * price);
    // Mined coins cost nothing: the sale is all earnings.
    expect(out.earnedCash).toBeGreaterThan(40 * price);
    expect(out.messages.some((m) => m.key?.startsWith('TAKE-PROFIT filled'))).toBe(true);
    const stop = simulate({ ...input, orders: [{ ...orders[1], price: price * 2 }] }, 0.25, NOW, online);
    expect(stop.filledOrders).toEqual(['sl']);
    expect(stop.messages.some((m) => m.key?.startsWith('STOP-LOSS filled'))).toBe(true);
  });

  it('does nothing without the Order Desk, and an order on an empty wallet is consumed without selling', () => {
    const { input } = starterWorld({ cc: '100' });
    const order = { id: 'tp', coin: 'CC' as const, kind: 'tp' as const, price: 0.0001, amountPct: 100, createdAt: NOW };
    expect(simulate({ ...input, orders: [order] }, 0.25, NOW, online).filledOrders).toEqual([]);
    const empty = simulate({ ...input, ...desk, orders: [{ ...order, coin: 'MEME' as const }] }, 0.25, NOW, online);
    expect(empty.filledOrders).toEqual(['tp']);
    expect(empty.memeDelta).toBe(0);
  });

  it('also fires during offline catch-up', () => {
    const { input } = starterWorld({ ...desk, cc: '100' });
    const out = simulateOffline({ ...input, orders: [{ id: 'tp', coin: 'CC', kind: 'tp', price: 0.0001, amountPct: 100, createdAt: NOW }] }, 600, NOW);
    expect(out.filledOrders).toEqual(['tp']);
  });

  describe('store', () => {
    beforeEach(() => useGameStore.setState({ ...createInitialData(), cc: '50', log: [] }));

    it('needs the research, caps the list and drops filled orders on the tick', () => {
      expect(store().addOrder('CC', 'tp', 2, 100)).toBe(false);
      useGameStore.setState({ research: { levels: { orders: 1 }, active: null } });
      expect(store().addOrder('CC', 'tp', 0, 100)).toBe(false);
      expect(store().addOrder('CC', 'tp', 0.0001, 250)).toBe(true);
      expect(store().orders[0].amountPct).toBe(100);
      for (let i = 0; i < ORDERS.max; i += 1) store().addOrder('CC', 'sl', 0.00001, 10);
      expect(store().orders).toHaveLength(ORDERS.max);
      const tick = simulate({ ...store(), nextEventAt: Number.MAX_SAFE_INTEGER }, 0.25, Date.now(), online);
      expect(tick.filledOrders).toEqual([store().orders[0].id]);
      store().applyTick(tick);
      expect(store().orders).toHaveLength(ORDERS.max - 1);
      expect(Number(store().cc)).toBeLessThan(1);
      store().removeOrder(store().orders[0].id);
      expect(store().orders).toHaveLength(ORDERS.max - 2);
    });
  });
});

describe('pool payout schemes', () => {
  it('each pool declares how it pays', () => {
    expect(POOL_ORDER).toEqual(['public', 'pplns', 'solo', 'darknet']);
    expect(POOLS.public.scheme).toBe('pps');
    expect(POOLS.pplns.scheme).toBe('pplns');
    expect(POOLS.solo.scheme).toBe('solo');
    // PPLNS pays a little more than PPS on average for carrying the variance.
    expect(poolYieldMul('pplns')).toBeGreaterThan(poolYieldMul('public'));
    expect(poolYieldMul('pplns')).toBeLessThan(poolYieldMul('solo'));
  });

  it('PPS pays every tick; PPLNS piles shares up and pays them when the pool finds a block', () => {
    const pps = starterWorld({ pool: 'public' });
    expect(simulate(pps.input, 1, NOW, online).ccMined).toBeGreaterThan(0);

    const w = starterWorld({ pool: 'pplns' });
    // No block: nothing is minted, the shares wait.
    vi.spyOn(Math, 'random').mockReturnValue(0.999);
    const waiting = simulate(w.input, 2, NOW, online);
    expect(waiting.ccMined).toBe(0);
    expect(waiting.poolPendingDelta).toBeGreaterThan(0);
    // A block with median luck pays the pending shares and empties the pot.
    vi.spyOn(Math, 'random').mockReturnValue(0.5);
    const pending = 10;
    vi.spyOn(Math, 'random').mockReturnValueOnce(0).mockReturnValue(0.5);
    const paid = simulate({ ...w.input, poolPending: pending }, 0.25, NOW, online);
    const luck = (PHYSICS.pplnsLuck[0] + PHYSICS.pplnsLuck[1]) / 2;
    expect(paid.ccMined).toBeGreaterThan(pending * luck * 0.99);
    expect(paid.ccMined).toBeLessThan((pending + 1) * luck);
    expect(paid.poolPendingDelta).toBeCloseTo(-pending, 6);
    expect(paid.rackFx.some((f) => f.kind === 'block')).toBe(true);
    expect(paid.blocksFound).toBe(0);
  });

  it('PPLNS pays its expected value offline and settles pending shares when leaving the pool', () => {
    const w = starterWorld({ pool: 'pplns' });
    const p = starterWorld({ pool: 'public' });
    const a = simulateOffline(w.input, 600, NOW);
    const b = simulateOffline(p.input, 600, NOW);
    expect(a.ccMined / b.ccMined).toBeCloseTo(poolYieldMul('pplns') / poolYieldMul('public'), 2);
    expect(a.poolPendingDelta).toBe(0);

    useGameStore.setState({ ...createInitialData(), pool: 'pplns', poolPending: 7, cc: '1', lifetimeEarnings: '1000000', log: [] });
    expect(store().setPool('public')).toBe(true);
    expect(store().poolPending).toBe(0);
    expect(Number(store().cc)).toBeCloseTo(8, 10);
    useGameStore.setState({ pool: 'pplns', poolPending: 3 });
    store().setMinedCoin('NOVA');
    expect(store().poolPending).toBe(0);
    expect(Number(store().cc)).toBeCloseTo(11, 10);
  });

  it('Lone Wolf makes solo blocks pay more', () => {
    const base = starterWorld({ pool: 'solo' });
    const wolf = starterWorld({ pool: 'solo', talents: { solo_luck: 3 } });
    wolf.input.gpus = base.input.gpus;
    wolf.input.racks = base.input.racks;
    wolf.input.psus = base.input.psus;
    wolf.input.coolers = base.input.coolers;
    const spy = vi.spyOn(Math, 'random').mockReturnValue(1e-9);
    const a = simulate(base.input, 0.25, NOW, online).coinMined;
    const b = simulate(wolf.input, 0.25, NOW, online).coinMined;
    spy.mockRestore();
    expect(b / a).toBeCloseTo(talentModifiers({ solo_luck: 3 }).soloMul, 6);
    expect(talentModifiers({ solo_luck: 3 }).soloMul).toBeCloseTo(1.45, 10);
  });
});

describe('reputation and Special Contracts', () => {
  beforeEach(() => useGameStore.setState({ ...createInitialData(), cash: '0', log: [] }));

  it('levels follow a growing curve', () => {
    expect(reputationLevel(0)).toBe(0);
    expect(reputationLevel(REPUTATION.levelPoints(1))).toBe(1);
    expect(reputationLevel(REPUTATION.levelPoints(2) - 1)).toBe(1);
    expect(reputationLevel(1e9)).toBe(REPUTATION.maxLevel);
    expect(reputationProgress(REPUTATION.levelPoints(1))).toBe(0);
    expect(reputationCashMul(REPUTATION.levelPoints(2))).toBeCloseTo(1 + 2 * REPUTATION.cashPerLevel, 10);
  });

  const complete = (idx: number) => {
    const board = store().contracts;
    const c = { ...board.slots[idx], completedAt: Date.now(), reward: { ...board.slots[idx].reward, cash: 100, gems: 0, gpuModelId: null } };
    const slots = board.slots.slice();
    slots[idx] = c;
    useGameStore.setState({ contracts: { ...board, slots } });
    return c;
  };

  it('claiming earns points by difficulty and pays more cash with reputation', () => {
    const c = complete(0);
    expect(store().claimContract(c.id)).toBe(true);
    expect(store().reputation.points).toBe(REPUTATION.claim[c.difficulty - 1]);
    expect(Number(store().cash)).toBeCloseTo(100, 6);
    useGameStore.setState({ cash: '0', reputation: { ...emptyReputation(), points: REPUTATION.levelPoints(3) } });
    const d = complete(0);
    store().claimContract(d.id);
    expect(Number(store().cash)).toBeCloseTo(100 * (1 + 3 * REPUTATION.cashPerLevel), 6);
  });

  it('an expired contract costs a point (never below zero)', () => {
    useGameStore.setState({ reputation: { ...emptyReputation(), points: 1 } });
    const board = store().contracts;
    const now = Date.now();
    useGameStore.setState({ contracts: { ...board, slots: board.slots.map((c) => ({ ...c, createdAt: now - 10_000, expiresAt: now - 1, progress: 0 })) } });
    const tick = simulate({ ...store(), nextEventAt: Number.MAX_SAFE_INTEGER }, 0.25, now, online);
    store().advanceContractBoard(tick, false);
    expect(store().reputation.points).toBe(0);
  });

  it('a Special Contract needs reputation, runs three stages that pay more each, and ends with gems', () => {
    expect(store().acceptChain()).toBe(false);
    useGameStore.setState({ reputation: { ...emptyReputation(), points: REPUTATION.levelPoints(REPUTATION.chainLevel) } });
    expect(store().acceptChain()).toBe(true);
    expect(store().acceptChain()).toBe(false);
    const gems = store().gems;
    const rewards: number[] = [];
    for (let stage = 0; stage < REPUTATION.chainStages; stage += 1) {
      const chain = store().reputation.chain;
      expect(chain?.stage).toBe(stage);
      expect(chain?.current.difficulty).toBe(3);
      if (!chain) throw new Error('no chain');
      // Same base reward on every stage, so only the stage multiplier differs.
      const current = { ...chain.current, completedAt: Date.now(), reward: { cash: 1000 * REPUTATION.stageMul[stage], gems: 0, gpuModelId: null } };
      useGameStore.setState({ cash: '0', reputation: { ...store().reputation, chain: { ...chain, current } } });
      expect(store().claimContract(current.id)).toBe(true);
      rewards.push(Number(store().cash));
    }
    expect(rewards[1]).toBeGreaterThan(rewards[0]);
    expect(rewards[2]).toBeGreaterThan(rewards[1]);
    expect(store().reputation.chain).toBeNull();
    expect(store().reputation.chainsDone).toBe(1);
    expect(store().gems).toBe(gems + REPUTATION.chainGems);
    expect(store().reputation.chainReadyAt).toBeGreaterThan(Date.now());
    // The three board contracts were left alone.
    expect(store().contracts.slots).toHaveLength(3);
    expect(store().acceptChain()).toBe(false);
  });

  it('a stage that expires loses the chain and reputation', () => {
    const points = REPUTATION.levelPoints(REPUTATION.chainLevel) + 5;
    useGameStore.setState({ reputation: { ...emptyReputation(), points } });
    store().acceptChain();
    const chain = store().reputation.chain;
    if (!chain) throw new Error('no chain');
    const now = Date.now();
    useGameStore.setState({ reputation: { ...store().reputation, chain: { ...chain, current: { ...chain.current, createdAt: now - 10_000, expiresAt: now - 1, progress: 0 } } } });
    const tick = simulate({ ...store(), nextEventAt: Number.MAX_SAFE_INTEGER }, 0.25, now, online);
    store().advanceContractBoard(tick, false);
    expect(store().reputation.chain).toBeNull();
    expect(store().reputation.points).toBe(points + REPUTATION.chainFail);
  });

  it('reputation survives The Halving, an unfinished chain does not', () => {
    useGameStore.setState({ reputation: { ...emptyReputation(), points: 40, chainsDone: 2 }, runEarnings: '1e9', lifetimeEarnings: '1e9' });
    store().acceptChain();
    expect(store().performHalving()).toBe(true);
    expect(store().reputation.points).toBe(40);
    expect(store().reputation.chainsDone).toBe(2);
    expect(store().reputation.chain).toBeNull();
  });
});

describe('Halving tree: rule-changing talents', () => {
  beforeEach(() => useGameStore.setState({ ...createInitialData(), cash: '1000000', log: [] }));

  it('adds three nodes on a new row with valid prerequisites', () => {
    (['used_market', 'forge_mastery', 'solo_luck'] as const).forEach((id) => {
      const node = TALENT_BY_ID[id];
      expect(node.row).toBe(4);
      node.requires.forEach((req) => expect(TALENT_BY_ID[req]).toBeDefined());
    });
    const cells = PRESTIGE_TREE.map((n) => `${n.col},${n.row}`);
    expect(new Set(cells).size).toBe(cells.length);
  });

  it('Grey Market sells used GPUs: cheaper, worn, with tired paste', () => {
    expect(store().buyUsedGpu('px580')).toBeNull();
    useGameStore.setState({ talents: { used_market: 1 } });
    const gpu = store().buyUsedGpu('px580');
    expect(gpu).not.toBeNull();
    expect(Number(store().cash)).toBeCloseTo(1_000_000 - usedGpuPrice(GPU_BY_ID.px580.price), 6);
    expect(usedGpuPrice(100)).toBe(55);
    expect(gpu?.wear).toBeGreaterThanOrEqual(USED_GPU.wear[0]);
    expect(gpu?.wear).toBeLessThanOrEqual(USED_GPU.wear[1]);
    expect(gpu?.paste).toBeLessThanOrEqual(USED_GPU.paste[1]);
    expect(store().collection.px580).toContain(gpu?.quality);
  });

  it('Forge Mastery sometimes spares the third card', () => {
    const seed = (talents: Record<string, number>) => {
      const gpus = { ...createInitialData().gpus };
      for (let i = 0; i < FUSE_COUNT; i += 1) {
        const g = createGpu('px580', 'bronze');
        gpus[g.uid] = g;
      }
      useGameStore.setState({ gpus, talents });
    };
    const spares = () => Object.values(store().gpus).filter((g) => g.modelId === 'px580' && g.quality === 'bronze').length;
    seed({ forge_mastery: 3 });
    vi.spyOn(Math, 'random').mockReturnValue(0.1);
    expect(store().fuseGpus('px580', 'bronze')?.quality).toBe('silver');
    expect(spares()).toBe(1);
    // Seed with the real RNG: uids are random, a constant roll would make the three cards collide.
    vi.restoreAllMocks();
    seed({ forge_mastery: 3 });
    vi.spyOn(Math, 'random').mockReturnValue(0.9);
    store().fuseGpus('px580', 'bronze');
    expect(spares()).toBe(0);
    vi.restoreAllMocks();
    seed({});
    store().fuseGpus('px580', 'bronze');
    expect(spares()).toBe(0);
    expect(store().collection.px580).toContain('silver');
  });
});

describe('challenge relics', () => {
  it('every challenge has a relic, and only cleared ones count', () => {
    CHALLENGE_IDS.forEach((id) => expect(RELICS[id].challenge).toBe(id));
    expect(perkModifiers({}, {})).toEqual({ hashMul: 1, heatMul: 1, electricityMul: 1, techSpeedMul: 1 });
    const all = Object.fromEntries(CHALLENGE_IDS.map((id) => [id, { clears: 1, bestTimeSec: 10 }]));
    expect(perkModifiers(all, {})).toEqual({ hashMul: 1.03, heatMul: 0.96, electricityMul: 0.95, techSpeedMul: 1.25 });
    expect(perkModifiers({ bronze_only: { clears: 0, bestTimeSec: 1 } }, {}).hashMul).toBe(1);
  });

  it('feeds the run modifiers and the simulation', () => {
    const records = { bronze_only: { clears: 2, bestTimeSec: 10 }, power_cap: { clears: 1, bestTimeSec: 10 } };
    const mods = runModifiers({}, {}, { challengeRecords: records });
    expect(mods.hashMul).toBeCloseTo(1.03, 10);
    expect(mods.electricityMul).toBeCloseTo(0.95, 10);
    const plain = starterWorld();
    const out = simulate(plain.input, 1, NOW, online);
    const relic = simulate({ ...plain.input, challengeRecords: records }, 1, NOW, online);
    expect(relic.live.totalHash / out.live.totalHash).toBeCloseTo(1.03, 6);
    expect(relic.live.electricityPerSec / out.live.electricityPerSec).toBeCloseTo(0.95, 6);
  });
});

describe('Silicon Collection', () => {
  it('records each model and grade once, in grade order', () => {
    let c = collect({}, 'px460', 'gold');
    c = collect(c, 'px460', 'bronze');
    expect(collect(c, 'px460', 'gold')).toBe(c);
    expect(c.px460).toEqual(['bronze', 'gold']);
  });

  it('pays per completed brand and for the full album', () => {
    expect(COLLECTION_FAMILIES.reduce((a, f) => a + f.modelIds.length, 0)).toBe(GPU_CATALOG.length);
    const family = COLLECTION_FAMILIES[0];
    let c = {};
    family.modelIds.forEach((id) => QUALITY_ORDER.forEach((q) => { c = collect(c, id, q); }));
    const one = collectionProgress(c);
    expect(one.families).toBe(1);
    expect(one.hashMul).toBeCloseTo(1 + COLLECTION.familyHash, 10);
    GPU_CATALOG.forEach((g) => QUALITY_ORDER.forEach((q) => { c = collect(c, g.id, q); }));
    const full = collectionProgress(c);
    expect(full.entries).toBe(full.total);
    expect(full.hashMul).toBeCloseTo(1 + COLLECTION_FAMILIES.length * COLLECTION.familyHash + COLLECTION.albumHash, 10);
    // One grade short of a model: no family bonus.
    const missing = { ...c, [family.modelIds[0]]: ['bronze', 'silver', 'gold'] as const };
    expect(collectionProgress(missing as never).families).toBe(COLLECTION_FAMILIES.length - 1);
  });

  it('a new farm has the starter card; purchases and the Halving keep the album', () => {
    useGameStore.setState({ ...createInitialData(), cash: '1e12', log: [] });
    expect(store().collection).toEqual({ px460: ['bronze'] });
    store().buyMany('gpu', 'px580', 20);
    expect(store().collection.px580.length).toBeGreaterThan(0);
    const before = store().collection;
    useGameStore.setState({ runEarnings: '1e9', lifetimeEarnings: '1e9' });
    store().performHalving();
    expect(store().collection.px580).toEqual(before.px580);
  });
});

describe('save v9: phase 4 fields', () => {
  it('older saves start in a fresh cycle, with the album seeded from the GPUs they own', () => {
    const v8 = JSON.parse(JSON.stringify(createInitialData())) as Record<string, unknown> & { gpus: Record<string, { modelId: string; quality: string }> };
    ['cycle', 'orders', 'poolPending', 'reputation', 'collection'].forEach((k) => delete v8[k]);
    v8.gpus.extra = { ...Object.values(v8.gpus)[0], modelId: 'px580', quality: 'gold' };
    const m = migrateSave(v8, 8);
    expect(m.saveVersion).toBe(SAVE_VERSION);
    expect(m.cycle.phase).toBe('accumulation');
    expect(m.orders).toEqual([]);
    expect(m.poolPending).toBe(0);
    expect(m.reputation).toEqual(emptyReputation());
    expect(m.collection).toEqual({ px460: ['bronze'], px580: ['gold'] });
  });

  it('round-trips and sanitizes tampered values', () => {
    const data = createInitialData();
    const now = Date.now();
    data.cycle = { phase: 'bear', startedAt: now - 5000, endsAt: now + 60_000, news: { id: 'rug_pull', startedAt: now, endsAt: now + 10_000 }, nextNewsAt: now + 30_000 };
    data.orders = [{ id: 'o1', coin: 'NOVA', kind: 'sl', price: 2.5, amountPct: 40, createdAt: now }];
    data.poolPending = 3.5;
    data.pool = 'pplns';
    data.reputation = { points: 12, chain: { stage: 1, current: { ...data.contracts.slots[0], id: 'chain-x' } }, chainReadyAt: 0, chainsDone: 3 };
    data.collection = { px460: ['bronze', 'god'], px580: ['silver'] };
    const back = migrateSave(JSON.parse(JSON.stringify(data)), SAVE_VERSION);
    expect(back.cycle).toEqual(data.cycle);
    expect(back.orders).toEqual(data.orders);
    expect(back.poolPending).toBe(3.5);
    expect(back.pool).toBe('pplns');
    expect(back.reputation.points).toBe(12);
    expect(back.reputation.chain?.stage).toBe(1);
    expect(back.reputation.chain?.current.id).toBe('chain-x');
    expect(back.collection).toEqual(data.collection);

    const bad = JSON.parse(JSON.stringify(data)) as Record<string, unknown>;
    bad.cycle = { phase: 'moon', endsAt: 9e15 };
    bad.orders = [{ id: 'a', price: -1 }, { id: 'b', price: 3, coin: 'XXX', kind: 'zz', amountPct: 900 }, 'junk', ...Array.from({ length: 20 }, (_, i) => ({ id: `n${i}`, price: 1 }))];
    bad.poolPending = -4;
    bad.pool = 'casino';
    bad.reputation = { points: -9, chain: { stage: 99, current: 'nope' }, chainReadyAt: 9e15, chainsDone: 'x' };
    bad.collection = { px460: ['bronze', 'platinum'], fake: ['gold'], px580: 'no' };
    const clean = migrateSave(bad, SAVE_VERSION);
    expect(clean.cycle.phase).toBe('accumulation');
    expect(clean.cycle.endsAt).toBeLessThan(Date.now() + 3_600_000);
    expect(clean.orders).toHaveLength(ORDERS.max);
    expect(clean.orders[0]).toMatchObject({ id: 'b', coin: 'CC', kind: 'tp', amountPct: 100 });
    expect(clean.poolPending).toBe(0);
    expect(clean.pool).toBe('public');
    expect(clean.reputation.points).toBe(0);
    expect(clean.reputation.chain).toBeNull();
    expect(clean.reputation.chainReadyAt).toBeLessThanOrEqual(Date.now() + REPUTATION.chainCooldownSec * 1000);
    expect(clean.collection).toEqual({ px460: ['bronze'] });
  });
});
