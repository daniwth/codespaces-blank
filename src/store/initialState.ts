import { AIRDROP } from '../config/airdrops';
import { COIN_MARKET, emptyAlts } from '../config/altcoins';
import { GPU_BY_ID, QUALITY_DEFS } from '../config/hardwareCatalog';
import { MARKET, SAVE_VERSION, STARTING_CASH, EVENT_INTERVAL } from '../config/gameBalance';
import { talentModifiers } from '../config/prestigeTree';
import type { CoinId, CoinMarket, MarketState } from '../types/economy';
import type { GpuInstance, RackInstance, SiliconQuality } from '../types/hardware';
import type { ChallengeId, GameData, RoomId, TalentLevels, VipState } from '../types/player';
import { bn } from '../utils/bignum';
import { makeUid } from '../utils/eventBus';
import { randRange, weightedPick } from '../utils/random';
import { contractContext, createBoard } from './contracts';
import { STOCK_OC } from './gamePhysics';

export function rollQuality(luck: number): SiliconQuality {
  return weightedPick<SiliconQuality>({
    bronze: QUALITY_DEFS.bronze.weight,
    silver: QUALITY_DEFS.silver.weight,
    gold: QUALITY_DEFS.gold.weight * luck,
    god: QUALITY_DEFS.god.weight * luck,
  });
}

export function createGpu(modelId: string, quality: SiliconQuality): GpuInstance {
  const q = QUALITY_DEFS[quality];
  return {
    uid: makeUid('gpu'),
    modelId,
    quality,
    silicon: {
      coreHeadroom: Math.round(randRange(q.coreHeadroom[0], q.coreHeadroom[1])),
      memHeadroom: Math.round(randRange(q.memHeadroom[0], q.memHeadroom[1])),
      vScale: Number(randRange(q.vScale[0], q.vScale[1]).toFixed(1)),
    },
    oc: { ...STOCK_OC },
    ocBonus: 0,
    temp: 26,
    wear: 0,
    paste: 1,
    shutdown: false,
    overheatSeconds: 0,
  };
}

export function createRack(modelId: string, slots: number, fanSlots: number): RackInstance {
  return {
    uid: makeUid('rack'),
    modelId,
    roomId: null,
    pad: null,
    gpuSlots: Array.from({ length: slots }, () => null),
    fanSlots: Array.from({ length: fanSlots }, () => null),
    psuUid: null,
    rebootUntil: 0,
  };
}

function createCoin(id: CoinId, now: number): CoinMarket {
  const cfg = COIN_MARKET[id];
  const base: number = cfg.base;
  const candles = [];
  let price: number = base;
  // Pre-roll a short synthetic history so the chart is alive on first launch.
  for (let i = MARKET.maxCandles; i > 0; i -= 1) {
    const o = price;
    let h = o;
    let l = o;
    for (let k = 0; k < 5; k += 1) {
      price = Math.min(base * cfg.max, Math.max(base * cfg.min, price * Math.exp(cfg.sigma * (Math.random() * 2 - 1) * 1.6 + cfg.theta * Math.log(base / price))));
      h = Math.max(h, price);
      l = Math.min(l, price);
    }
    candles.push({ t: now - i * MARKET.candleMs, o, h, l, c: price });
  }
  return { id, price, basePrice: base, candles, current: { t: now, o: price, h: price, l: price, c: price } };
}

export const createMarket = (now: number): MarketState => ({
  CC: createCoin('CC', now),
  MEME: createCoin('MEME', now),
  BYT: createCoin('BYT', now),
  NOVA: createCoin('NOVA', now),
});

export const DEFAULT_VIP: VipState = { goldRacksBought: 0, aiDiagnostics: false, autoSellPeaks: false, autoSellEnabled: true };

/**
 * Fresh run state. `carry` holds the progression that survives The Halving.
 */
export function createInitialData(carry?: Partial<GameData>, challenge?: ChallengeId | null): GameData {
  const now = Date.now();
  const talents: TalentLevels = carry?.talents ?? {};
  const mods = talentModifiers(talents);

  // Starter rig: an open bench with a PX-460, a bronze PSU and a case fan.
  const starterGpu = createGpu('px460', 'bronze');
  const rack = createRack('bench', 2, 1);
  rack.roomId = 'bedroom';
  rack.pad = 0;
  rack.gpuSlots[0] = starterGpu.uid;
  const psuUid = makeUid('psu');
  const fanUid = makeUid('cool');
  rack.psuUid = psuUid;
  rack.fanSlots[0] = fanUid;

  const ownedRooms: RoomId[] = carry?.ownedRooms ?? ['bedroom'];

  const data: Omit<GameData, 'contracts'> = {
    saveVersion: SAVE_VERSION,
    createdAt: carry?.createdAt ?? now,
    lastTick: now,
    cash: bn(STARTING_CASH + mods.startCash),
    cc: '0',
    meme: 0,
    memeCostBasis: 0,
    ccCostBasis: 0,
    alts: emptyAlts(),
    minedCoin: 'CC',
    gems: carry?.gems ?? 0,
    sc: carry?.sc ?? 0,
    scLifetime: carry?.scLifetime ?? 0,
    runEarnings: '0',
    runStartedAt: now,
    lifetimeEarnings: carry?.lifetimeEarnings ?? '0',
    gpus: { [starterGpu.uid]: starterGpu, ...(carry?.gpus ?? {}) },
    psus: { [psuUid]: { uid: psuUid, modelId: 'psu500' } },
    coolers: { [fanUid]: { uid: fanUid, modelId: 'fan80' } },
    racks: { [rack.uid]: rack, ...(carry?.racks ?? {}) },
    ownedRooms,
    activeRoom: 'bedroom',
    roomTemps: {},
    technicians: mods.startTechnicians,
    pool: 'public',
    market: carry?.market ?? createMarket(now),
    bots: carry?.bots ?? [],
    event: null,
    nextEventAt: now + randRange(EVENT_INTERVAL[0], EVENT_INTERVAL[1]) * 1000,
    talents,
    vip: carry?.vip ?? { ...DEFAULT_VIP },
    achievements: carry?.achievements ?? [],
    stats: carry?.stats ?? {
      blocksFound: 0, halvings: 0, raids: 0, bsods: 0, overheats: 0, stableOverclocks: 0,
      gpusBought: 0, playTimeSec: 0, maxHashrate: 0, bestTrade: 0, contractsCompleted: 0,
      airdrops: 0, fusions: 0, researchDone: 0, bestStreak: 0,
    },
    challenge: challenge ? { id: challenge, startedAt: now } : null,
    challengeRecords: carry?.challengeRecords ?? {},
    // Lab research and the Overdrive surge belong to the run: every Halving starts them from scratch.
    research: { levels: {}, active: null },
    boost: null,
    nextAirdropAt: now + AIRDROP.firstDelaySec * 1000,
    roadmap: carry?.roadmap ?? { step: 0, ready: false },
    daily: carry?.daily ?? { lastDay: 0, streak: 0 },
    autopilot: carry?.autopilot ?? { remainingSec: 0, paused: false, purchases: 0, spent: 0, autoHalving: false },
    settings: carry?.settings ?? { muted: false, volume: 0.6, ambientHum: true, particles: true, offlineProgress: true },
  };
  // A fresh board scaled to this run (The Halving starts a new one: the old targets were sized for the old farm).
  return { ...data, contracts: carry?.contracts ?? createBoard(contractContext(data), now) };
}

export const gpuModelOf = (g: GpuInstance) => GPU_BY_ID[g.modelId];
