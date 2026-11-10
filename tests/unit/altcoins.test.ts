import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ALT_COIN_IDS, COIN_IDS, COIN_MARKET, MINEABLE, baseValuePerSec, bullMeanMul, coinPerMHs, hashDifficulty, spikeDifficulty } from '../../src/config/altcoins';
import { EVENT_EFFECTS, MARKET, PHYSICS, POOLS, SAVE_VERSION } from '../../src/config/gameBalance';
import { HALVING_MIN_EARNINGS } from '../../src/config/prestigeTree';
import { simulate, simulateOffline, type SimInput } from '../../src/store/gamePhysics';
import { createGpu, createInitialData, createMarket, createRack } from '../../src/store/initialState';
import { migrateSave } from '../../src/store/migrations';
import { useGameStore } from '../../src/store/useGameStore';
import type { ActiveNetworkEvent, TradingBot } from '../../src/types/economy';
import type { GameData } from '../../src/types/player';
import { starterWorld } from './helpers';

const NOW = 1_800_000_000_000;
const store = () => useGameStore.getState();
const STARTER_HASH = 25e6;

/** Deterministic Math.random (mulberry32) so statistical assertions are stable. */
function seedRandom(seed: number): void {
  let a = seed >>> 0;
  vi.spyOn(Math, 'random').mockImplementation(() => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  });
}

afterEach(() => vi.restoreAllMocks());

/** A warehouse of `n` hydra ASICs: a big farm that raises $NOVA difficulty. */
function bigFarm(): SimInput {
  const { data } = starterWorld();
  const rack = { ...createRack('cabinet', 8, 4), roomId: 'warehouse' as const, pad: 0 };
  for (let i = 0; i < 8; i += 1) {
    const g = createGpu('hydra', 'bronze');
    data.gpus[g.uid] = g;
    rack.gpuSlots[i] = g.uid;
  }
  for (let i = 0; i < 4; i += 1) {
    const uid = `c${i}`;
    data.coolers[uid] = { uid, modelId: 'aio' };
    rack.fanSlots[i] = uid;
  }
  data.psus.big = { uid: 'big', modelId: 'psu12k' };
  rack.psuUid = 'big';
  data.racks[rack.uid] = rack;
  data.ownedRooms = ['bedroom', 'garage', 'warehouse'];
  return data;
}

const logReturnStdev = (candles: { o: number; c: number }[]): number => {
  const r = candles.slice(1).map((c, i) => Math.log(c.c / candles[i].c));
  const mean = r.reduce((a, b) => a + b, 0) / r.length;
  return Math.sqrt(r.reduce((a, b) => a + (b - mean) ** 2, 0) / r.length);
};

describe('altcoin catalog', () => {
  it('defines two extra coins with their own markets and a coherent yield ladder', () => {
    expect(ALT_COIN_IDS).toEqual(['BYT', 'NOVA']);
    expect(COIN_IDS).toEqual(['CC', 'MEME', 'BYT', 'NOVA']);
    expect(Object.keys(createMarket(NOW)).sort()).toEqual([...COIN_IDS].sort());
    // BYT pays less than CC, NOVA pays more (in dollars at base prices, before difficulty).
    expect(baseValuePerSec('BYT', 1e9)).toBeLessThan(baseValuePerSec('CC', 1e9));
    expect(baseValuePerSec('NOVA', 1e6)).toBeGreaterThan(baseValuePerSec('CC', 1e6));
    expect(baseValuePerSec('CC', 1e6)).toBeCloseTo((PHYSICS.rewardPerMHs * MARKET.cc.base) , 10);
    expect(baseValuePerSec('BYT', 1e6) / baseValuePerSec('CC', 1e6)).toBeCloseTo(MINEABLE.BYT.valueMul, 10);
    expect(coinPerMHs('CC')).toBe(PHYSICS.rewardPerMHs);
  });

  it('BYT is steadier than NOVA and NOVA difficulty rises with the farm hashrate', () => {
    expect(COIN_MARKET.BYT.sigma).toBeLessThan(COIN_MARKET.CC.sigma);
    expect(COIN_MARKET.NOVA.sigma).toBeGreaterThan(COIN_MARKET.CC.sigma);
    expect(COIN_MARKET.BYT.max / COIN_MARKET.BYT.min).toBeLessThan(COIN_MARKET.NOVA.max / COIN_MARKET.NOVA.min);
    expect(hashDifficulty('NOVA', 1e6)).toBe(1);
    expect(hashDifficulty('NOVA', 1e12)).toBeGreaterThan(hashDifficulty('NOVA', 1e10));
    expect(hashDifficulty('NOVA', 1e12)).toBeGreaterThan(2);
    expect(hashDifficulty('CC', 1e15)).toBe(1);
    expect(hashDifficulty('BYT', 1e15)).toBe(1);
    // NOVA out-earns CC for small farms and falls behind it for big ones.
    expect(baseValuePerSec('NOVA', 1e9)).toBeGreaterThan(baseValuePerSec('CC', 1e9));
    expect(baseValuePerSec('NOVA', 1e13)).toBeLessThan(baseValuePerSec('CC', 1e13));
  });

  it('event modifiers: Bull Run lifts CC and NOVA most, a Difficulty Spike barely touches BYT', () => {
    expect(bullMeanMul('CC')).toBe(EVENT_EFFECTS.bullMeanMul);
    expect(bullMeanMul('NOVA')).toBe(EVENT_EFFECTS.bullMeanMul);
    expect(bullMeanMul('BYT')).toBe(EVENT_EFFECTS.bytBullMeanMul);
    expect(bullMeanMul('MEME')).toBe(1);
    expect(spikeDifficulty('CC')).toBe(EVENT_EFFECTS.difficultyMul);
    expect(spikeDifficulty('BYT')).toBeLessThan(spikeDifficulty('NOVA'));
  });
});

describe('mining an altcoin in the simulation', () => {
  it('mines the chosen coin into its own wallet at zero cost basis (and no $CC)', () => {
    const { data } = starterWorld();
    for (const coin of ['BYT', 'NOVA'] as const) {
      data.minedCoin = coin;
      const out = simulate(data, 60, NOW, { offline: true, maxStep: 5 });
      const expected = (STARTER_HASH / 1e6) * coinPerMHs(coin) * (1 - POOLS.public.fee) * 60;
      expect(out.altDeltas[coin]).toBeCloseTo(expected, 6);
      expect(out.coinMined).toBeCloseTo(expected, 6);
      expect(out.minedCoin).toBe(coin);
      expect(out.altCostDeltas[coin]).toBe(0);
      expect(out.altDeltas[coin === 'BYT' ? 'NOVA' : 'BYT']).toBe(0);
      expect(out.ccMined).toBe(0);
      expect(out.ccDelta).toBe(0);
      expect(out.live.coinPerSec).toBeCloseTo(expected / 60, 8);
    }
  });

  it('$CC mining is unchanged: ccMined equals the coin mined', () => {
    const { data } = starterWorld();
    const out = simulate(data, 60, NOW, { offline: true, maxStep: 5 });
    expect(out.minedCoin).toBe('CC');
    expect(out.ccMined).toBeCloseTo(out.coinMined, 10);
    expect(out.ccMined).toBeCloseTo((STARTER_HASH / 1e6) * PHYSICS.rewardPerMHs * (1 - POOLS.public.fee) * 60, 6);
    expect(out.altDeltas).toEqual({ BYT: 0, NOVA: 0 });
  });

  it('exposes a per-coin yield preview, with NOVA difficulty rising on a big farm', () => {
    const farm = bigFarm();
    const out = simulate(farm, 30, NOW, { offline: true, maxStep: 5 });
    expect(out.live.totalHash).toBeGreaterThan(1e11);
    const y = out.live.yields;
    expect(y.CC.difficulty).toBe(1);
    expect(y.BYT.difficulty).toBe(1);
    expect(y.NOVA.difficulty).toBeGreaterThan(1.5);
    expect(y.NOVA.perSec).toBeLessThan((out.live.totalHash / 1e6) * coinPerMHs('NOVA') * (1 - POOLS.public.fee));
    // valuePerSec uses the live price.
    expect(y.BYT.valuePerSec).toBeCloseTo(y.BYT.perSec * out.market.BYT.price, 10);
    expect(out.live.ccPerSec).toBeCloseTo(y.CC.perSec, 10);
  });

  it('a Difficulty Spike hits CC and NOVA fully but BYT only a little', () => {
    const { data } = starterWorld();
    const event: ActiveNetworkEvent = { id: 'difficulty_spike', startedAt: NOW - 1000, endsAt: NOW + 60_000, roomId: null };
    data.event = event;
    const out = simulate(data, 5, NOW, { offline: false, maxStep: 1 });
    expect(out.live.yields.CC.difficulty).toBeCloseTo(EVENT_EFFECTS.difficultyMul, 10);
    expect(out.live.yields.BYT.difficulty).toBeCloseTo(EVENT_EFFECTS.bytDifficultyMul, 10);
    expect(out.live.yields.NOVA.difficulty).toBeCloseTo(EVENT_EFFECTS.difficultyMul, 10);
    data.minedCoin = 'BYT';
    expect(simulate(data, 5, NOW, { offline: false, maxStep: 1 }).live.difficulty).toBeCloseTo(EVENT_EFFECTS.bytDifficultyMul, 10);
  });

  it('solo and darknet pools pay the mined coin too', () => {
    const { data } = starterWorld();
    data.minedCoin = 'NOVA';
    data.pool = 'solo';
    const off = simulate(data, 60, NOW, { offline: true, maxStep: 5 });
    expect(off.altDeltas.NOVA).toBeCloseTo((STARTER_HASH / 1e6) * coinPerMHs('NOVA') * POOLS.solo.payoutMul * 60, 6);
    // A found block: a tiny Math.random() hits the block roll, and its message names the coin.
    vi.spyOn(Math, 'random').mockReturnValue(1e-9);
    const online = simulate(data, 1, NOW, { offline: false, maxStep: 1 });
    expect(online.blocksFound).toBe(1);
    expect(online.altDeltas.NOVA).toBeGreaterThan(0);
    expect(online.messages.some((m) => m.params?.coin === 'NOVA' && /BLOCK FOUND/.test(m.text))).toBe(true);
    data.pool = 'darknet';
    vi.restoreAllMocks();
    const dark = simulate(data, 60, NOW, { offline: true, maxStep: 5 });
    expect(dark.altDeltas.NOVA).toBeCloseTo((STARTER_HASH / 1e6) * coinPerMHs('NOVA') * POOLS.darknet.payoutMul * 60, 6);
  });
});

describe('altcoin price series', () => {
  it('BYT moves far less than NOVA over the same window and both stay inside their bands', () => {
    seedRandom(42);
    const { data } = starterWorld();
    const out = simulate(data, 3600, NOW, { offline: true, maxStep: 5 });
    const byt = out.market.BYT;
    const nova = out.market.NOVA;
    expect(byt.candles.length).toBeGreaterThan(40);
    expect(logReturnStdev(nova.candles)).toBeGreaterThan(logReturnStdev(byt.candles) * 2.5);
    expect(byt.price).toBeGreaterThanOrEqual(byt.basePrice * COIN_MARKET.BYT.min);
    expect(byt.price).toBeLessThanOrEqual(byt.basePrice * COIN_MARKET.BYT.max);
    expect(nova.price).toBeGreaterThanOrEqual(nova.basePrice * COIN_MARKET.NOVA.min);
    expect(nova.price).toBeLessThanOrEqual(nova.basePrice * COIN_MARKET.NOVA.max);
  });

  it('a Bull Run pulls NOVA hard, BYT gently and MEME not at all', () => {
    seedRandom(7);
    const mean = (coin: 'BYT' | 'NOVA' | 'MEME', bull: boolean): number => {
      let acc = 0;
      const runs = 40;
      for (let i = 0; i < runs; i += 1) {
        const { data } = starterWorld();
        data.event = bull ? { id: 'bull_run', startedAt: NOW, endsAt: NOW + 3_600_000, roomId: null } : null;
        const out = simulate(data, 300, NOW + 300_000, { offline: false, maxStep: 1 });
        acc += Math.log(out.market[coin].price / out.market[coin].basePrice);
      }
      return acc / runs;
    };
    expect(mean('NOVA', true) - mean('NOVA', false)).toBeGreaterThan(0.2);
    const bytLift = mean('BYT', true) - mean('BYT', false);
    expect(bytLift).toBeGreaterThan(Math.log(EVENT_EFFECTS.bytBullMeanMul) * 0.6);
    expect(bytLift).toBeLessThan(Math.log(EVENT_EFFECTS.bullMeanMul) * 0.6);
    expect(Math.abs(mean('MEME', true) - mean('MEME', false))).toBeLessThan(0.5);
  });
});

describe('altcoin wallets, trading bots and the power bill', () => {
  it('trading bots sell and buy altcoins inside the simulation', () => {
    const { data } = starterWorld();
    data.alts = { BYT: { amount: 100, costBasis: 0 }, NOVA: { amount: 0, costBasis: 0 } };
    const sell: TradingBot = { id: 'bot_sell', coin: 'BYT', side: 'sell', trigger: 'above', threshold: 0.1, amountPct: 50, cooldownSec: 5, lastFiredAt: 0, enabled: true };
    const buy: TradingBot = { id: 'bot_buy', coin: 'NOVA', side: 'buy', trigger: 'above', threshold: 0.1, amountPct: 50, cooldownSec: 5, lastFiredAt: 0, enabled: true };
    data.bots = [sell, buy];
    data.cash = '1000';
    const out = simulate(data, 1, NOW, { offline: true, maxStep: 1 });
    expect(out.altDeltas.BYT).toBeCloseTo(-50, 6);
    expect(out.botEarned).toBeGreaterThan(0);
    expect(out.earnedCash).toBeGreaterThan(0);
    expect(out.altDeltas.NOVA).toBeGreaterThan(0);
    expect(out.altCostDeltas.NOVA).toBeGreaterThan(0);
    expect(out.botFires.bot_sell).toBe(NOW);
    expect(out.botFires.bot_buy).toBe(NOW);
  });

  it('a mined coin sold by a bot is pure earnings, a bought one only counts profit', () => {
    const { data } = starterWorld();
    data.alts = { BYT: { amount: 0, costBasis: 0 }, NOVA: { amount: 10, costBasis: 10 * data.market.NOVA.price * 2 } };
    data.bots = [{ id: 'b', coin: 'NOVA', side: 'sell', trigger: 'above', threshold: 0.1, amountPct: 100, cooldownSec: 5, lastFiredAt: 0, enabled: true }];
    const out = simulate(data, 1, NOW, { offline: true, maxStep: 1 });
    // Bought at twice the price: sold at a loss, so no earnings.
    expect(out.earnedCash).toBe(0);
    expect(out.altCostDeltas.NOVA).toBeCloseTo(-10 * data.market.NOVA.price * 2, 6);
  });

  it('pays the electricity bill from altcoins when cash and $CC run dry', () => {
    const { data } = starterWorld({ cash: '0', cc: '0' });
    data.alts = { BYT: { amount: 500, costBasis: 100 }, NOVA: { amount: 0, costBasis: 0 } };
    data.minedCoin = 'NOVA';
    const out = simulate(data, 60, NOW, { offline: true, maxStep: 5 });
    expect(out.electricityPaid).toBeGreaterThan(0);
    expect(out.altDeltas.BYT).toBeLessThan(0);
    // The cost basis shrinks in proportion to the coins spent.
    expect(out.altCostDeltas.BYT / 100).toBeCloseTo(out.altDeltas.BYT / 500, 6);
  });
});

describe('altcoins in the store', () => {
  beforeEach(() => {
    useGameStore.setState({ ...createInitialData(), cash: '1000' });
  });

  it('chooses the mined coin and merges ticks into the right wallet', () => {
    expect(store().minedCoin).toBe('CC');
    expect(store().setMinedCoin('NOVA')).toBe(true);
    expect(store().minedCoin).toBe('NOVA');
    expect(store().log.some((l) => l.text.includes('Now mining Nova'))).toBe(true);
    const { input } = starterWorld();
    input.minedCoin = 'NOVA';
    const out = simulate(input, 30, Date.now(), { offline: true, maxStep: 5 });
    store().applyTick(out);
    expect(store().alts.NOVA.amount).toBeCloseTo(out.altDeltas.NOVA, 8);
    expect(store().alts.NOVA.amount).toBeGreaterThan(0);
    expect(store().alts.NOVA.costBasis).toBe(0);
    expect(store().cc).toBe('0');
    expect(store().alts.BYT.amount).toBe(0);
    // Offline progress reports the mined coin.
    store().applyOffline(simulateOffline(input, 3600, Date.now()), 3600);
    expect(store().offlineReport?.minedCoin).toBe('NOVA');
    expect(store().offlineReport?.coinMined).toBeGreaterThan(store().offlineReport?.ccMined ?? 0);
    expect(store().offlineReport?.ccMined).toBe(0);
  });

  it('sells a mined altcoin as pure earnings and keeps the wallet and cost basis consistent', () => {
    useGameStore.setState({ alts: { BYT: { amount: 100, costBasis: 0 }, NOVA: { amount: 0, costBasis: 0 } } });
    const cash0 = Number(store().cash);
    const res = store().sellCoin('BYT', 100);
    expect(res.ok).toBe(true);
    expect(store().alts.BYT).toEqual({ amount: 0, costBasis: 0 });
    const proceeds = 100 * store().market.BYT.price * (1 - MARKET.fee);
    expect(Number(store().cash)).toBeCloseTo(cash0 + proceeds, 6);
    expect(Number(store().runEarnings)).toBeCloseTo(proceeds, 6);
    expect(Number(store().lifetimeEarnings)).toBeCloseTo(proceeds, 6);
    expect(store().stats.bestTrade).toBe(0);
    expect(store().sellCoin('BYT', 1).ok).toBe(false);
  });

  it('buying then selling altcoins earns nothing (no wash trading) and tracks the basis', () => {
    const before = Number(store().runEarnings);
    expect(store().buyCoin('NOVA', 400).ok).toBe(true);
    expect(store().alts.NOVA.costBasis).toBe(400);
    expect(Number(store().cash)).toBeCloseTo(600, 6);
    const qty = store().alts.NOVA.amount;
    expect(qty).toBeCloseTo(400 / (store().market.NOVA.price * (1 + MARKET.fee)), 8);
    // Half now: half of the basis leaves with it.
    store().sellCoin('NOVA', qty / 2);
    expect(store().alts.NOVA.costBasis).toBeCloseTo(200, 6);
    store().sellCoin('NOVA', qty / 2);
    expect(store().alts.NOVA.costBasis).toBeCloseTo(0, 6);
    expect(Number(store().runEarnings)).toBe(before);
    expect(store().buyCoin('BYT', 1e9).ok).toBe(false);
  });

  it('mixed holdings: only the mined share of a sale is earnings', () => {
    useGameStore.setState({ alts: { BYT: { amount: 100, costBasis: 25 }, NOVA: { amount: 0, costBasis: 0 } } });
    // Sell everything at the base price: 100 coins worth ~25 with a 25 basis, minus fee and no insider bonus.
    useGameStore.setState({ market: { ...store().market, BYT: { ...store().market.BYT, price: 0.5 } } });
    store().sellCoin('BYT', 100);
    const proceeds = 100 * 0.5 * (1 - MARKET.fee);
    expect(Number(store().runEarnings)).toBeCloseTo(proceeds - 25, 6);
  });

  it('The Halving wipes altcoin wallets and the mined coin but keeps the markets and bots', () => {
    const bot: TradingBot = { id: 'bot_x', coin: 'NOVA', side: 'sell', trigger: 'above', threshold: 1.5, amountPct: 100, cooldownSec: 20, lastFiredAt: 0, enabled: true };
    useGameStore.setState({
      alts: { BYT: { amount: 12, costBasis: 3 }, NOVA: { amount: 5, costBasis: 0 } },
      minedCoin: 'NOVA',
      bots: [bot],
      runEarnings: String(HALVING_MIN_EARNINGS),
    });
    const novaPrice = store().market.NOVA.price;
    expect(store().performHalving()).toBe(true);
    expect(store().alts).toEqual({ BYT: { amount: 0, costBasis: 0 }, NOVA: { amount: 0, costBasis: 0 } });
    expect(store().minedCoin).toBe('CC');
    expect(store().market.NOVA.price).toBe(novaPrice);
    expect(store().bots).toEqual([bot]);
  });
});

describe('altcoin persistence', () => {
  it('migrates a v5 save: empty altcoin wallets, mining $CC, fresh BYT/NOVA markets, bots kept', () => {
    const v5 = createInitialData() as unknown as Record<string, unknown>;
    delete v5.alts;
    delete v5.minedCoin;
    const market = v5.market as Record<string, unknown>;
    delete market.BYT;
    delete market.NOVA;
    v5.saveVersion = 5;
    v5.cc = '123';
    v5.meme = 7;
    const migrated = migrateSave(v5, 5);
    expect(SAVE_VERSION).toBe(6);
    expect(migrated.saveVersion).toBe(SAVE_VERSION);
    expect(migrated.alts).toEqual({ BYT: { amount: 0, costBasis: 0 }, NOVA: { amount: 0, costBasis: 0 } });
    expect(migrated.minedCoin).toBe('CC');
    expect(migrated.cc).toBe('123');
    expect(migrated.meme).toBe(7);
    ALT_COIN_IDS.forEach((id) => {
      expect(migrated.market[id].id).toBe(id);
      expect(migrated.market[id].basePrice).toBe(COIN_MARKET[id].base);
      expect(migrated.market[id].candles).toHaveLength(MARKET.maxCandles);
    });
    // The migrated save simulates without errors on every coin.
    expect(() => simulate({ ...migrated, nextEventAt: Number.MAX_SAFE_INTEGER }, 10, NOW, { offline: true, maxStep: 5 })).not.toThrow();
  });

  it('migrates a v2 save too', () => {
    const v2 = createInitialData() as unknown as Record<string, unknown>;
    delete v2.alts;
    delete v2.minedCoin;
    delete (v2.market as Record<string, unknown>).BYT;
    expect(migrateSave(v2, 2).alts.BYT.amount).toBe(0);
    expect(migrateSave(v2, 2).minedCoin).toBe('CC');
  });

  it('keeps wallets, the mined coin and market history across a save round trip', () => {
    const data: GameData = createInitialData();
    data.alts = { BYT: { amount: 42.5, costBasis: 7 }, NOVA: { amount: 3, costBasis: 0 } };
    data.minedCoin = 'BYT';
    data.bots = [{ id: 'b1', coin: 'NOVA', side: 'buy', trigger: 'below', threshold: 0.5, amountPct: 10, cooldownSec: 30, lastFiredAt: 0, enabled: true }];
    const back = migrateSave(JSON.parse(JSON.stringify(data)), SAVE_VERSION);
    expect(back.alts).toEqual(data.alts);
    expect(back.minedCoin).toBe('BYT');
    expect(back.bots[0].coin).toBe('NOVA');
    expect(back.market.NOVA.candles).toHaveLength(data.market.NOVA.candles.length);
    expect(back.market.NOVA.price).toBe(data.market.NOVA.price);
  });

  it('sanitises tampered altcoin fields', () => {
    const data = createInitialData() as unknown as Record<string, unknown>;
    data.alts = { BYT: { amount: -5, costBasis: 'x' }, NOVA: { amount: Number.POSITIVE_INFINITY, costBasis: -1 }, EVIL: { amount: 1e9 } };
    data.minedCoin = 'DOGE';
    (data.market as Record<string, unknown>).NOVA = { price: 'free', candles: 'no' };
    (data.market as Record<string, unknown>).BYT = { id: 'BYT', price: -3, basePrice: 0.25, candles: [], current: { t: 1, o: 1, h: 1, l: 1, c: 1 } };
    data.bots = [{ id: 'bx', coin: 'BOGUS', side: 'sell' }, { id: 'by', coin: 'BYT', side: 'buy' }];
    const clean = migrateSave(data, SAVE_VERSION);
    expect(clean.alts).toEqual({ BYT: { amount: 0, costBasis: 0 }, NOVA: { amount: 0, costBasis: 0 } });
    expect(Object.keys(clean.alts)).toEqual(['BYT', 'NOVA']);
    expect(clean.minedCoin).toBe('CC');
    expect(clean.market.NOVA.price).toBeGreaterThan(0);
    expect(clean.market.NOVA.candles).toHaveLength(MARKET.maxCandles);
    expect(clean.market.BYT.price).toBeGreaterThan(0);
    expect(clean.bots.map((b) => b.coin)).toEqual(['CC', 'BYT']);
    data.minedCoin = 'NOVA';
    expect(migrateSave(data, SAVE_VERSION).minedCoin).toBe('NOVA');
  });
});
