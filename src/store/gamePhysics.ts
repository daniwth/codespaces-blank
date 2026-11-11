/**
 * Pure simulation layer. No React, no Zustand, no DOM: it runs identically in
 * the Web Worker and on the main thread (fallback / offline resolution).
 *
 * Thermal model (per GPU):   ΔT = ((Q_gen − Q_dis) / C) · Δt,  Q_dis = k · (T − T_amb)
 * Integrated analytically so large Δt (background tabs, offline progress) stay stable:
 *   T(t+Δt) = T_eq + (T − T_eq) · e^(−kΔt / C),  T_eq = T_amb + Q_gen / k
 */
import { COOLER_BY_ID, GPU_BY_ID, GPU_CATALOG, OC_LIMITS, PSU_BY_ID, RACK_BY_ID } from '../config/hardwareCatalog';
import {
  ALT_COIN_IDS,
  COIN_IDS,
  COIN_MARKET,
  MINEABLE_COIN_IDS,
  bullMeanMul,
  coinPerMHs,
  hashDifficulty,
  spikeDifficulty,
} from '../config/altcoins';
import { challengeRules } from '../config/challenges';
import { ROOM_BY_ID } from '../config/roomsCatalog';
import { runModifiers, type RunModifiers } from '../config/modifiers';
import type { TalentModifiers } from '../config/prestigeTree';
import {
  EVENT_EFFECTS,
  EVENT_INTERVAL,
  GRID,
  MARKET,
  NETWORK_EVENTS,
  PHYSICS,
  POOLS,
} from '../config/gameBalance';
import type { ActiveNetworkEvent, AltCoinId, CoinId, MarketState, MineableCoin, NetworkEventId } from '../types/economy';
import type {
  GpuInstance,
  GpuLive,
  OverclockSettings,
  RackInstance,
  RackLive,
  RackStatus,
  SiliconProfile,
} from '../types/hardware';
import type { GameData, RoomId } from '../types/player';
import { bnToNumber } from '../utils/bignum';
import { clamp, gaussian, pick, randRange } from '../utils/random';

// ───────────────────────────── Types ─────────────────────────────

export type SimInput = Pick<
  GameData,
  | 'gpus' | 'psus' | 'coolers' | 'racks' | 'ownedRooms' | 'roomTemps' | 'technicians'
  | 'pool' | 'market' | 'bots' | 'event' | 'nextEventAt' | 'talents' | 'vip'
  | 'cash' | 'cc' | 'ccCostBasis' | 'meme' | 'memeCostBasis' | 'alts' | 'minedCoin' | 'lastTick' | 'challenge'
  | 'research' | 'boost'
>;

export type MessageTone = 'info' | 'good' | 'warn' | 'bad';
export type SoundCue = 'block' | 'alarm' | 'raid' | 'event' | 'shutdown' | 'sell' | 'restart';

export interface GameMessage {
  /** English text, already filled in. */
  text: string;
  tone: MessageTone;
  /** English template + params so the main thread can translate (this module never imports i18n: it runs in a Worker). */
  key?: string;
  params?: Record<string, string | number>;
}

/** Build a message from an English template with `{name}` placeholders. */
export function gameMsg(tone: MessageTone, key: string, params?: Record<string, string | number>): GameMessage {
  const text = params ? key.replace(/\{(\w+)\}/g, (m, k: string) => (k in params ? String(params[k]) : m)) : key;
  return { text, tone, key, params };
}

export interface RoomLive {
  load: number;
  wall: number;
  capacity: number;
  brownout: number;
  ambient: number;
  temp: number;
  hash: number;
  blackout: boolean;
  racksOnline: number;
}

/** What the farm would mint of one coin right now (before pool luck): coins/s, dollars/s at the current price, difficulty. */
export interface CoinYield {
  perSec: number;
  valuePerSec: number;
  difficulty: number;
}

export interface LiveMetrics {
  totalHash: number;
  /** $CC per second the farm would mint with the current pool, whichever coin is being mined (sizes contracts). */
  ccPerSec: number;
  /** Coin being mined and its minted amount per second under the current pool. */
  minedCoin: MineableCoin;
  coinPerSec: number;
  /** Per-coin yield preview for the coin picker. */
  yields: Record<MineableCoin, CoinYield>;
  electricityPerSec: number;
  /** Farm-wide grid demand: wall-weighted average of the running GPUs' tariffs (see `gridTariff`). */
  gridDemand: number;
  difficulty: number;
  hottest: number;
  /** Hashrate multiplier of the Overdrive surge right now (1 = none). */
  surge: number;
  rooms: Partial<Record<RoomId, RoomLive>>;
  racks: Record<string, RackLive>;
  gpus: Record<string, GpuLive>;
}

export type GpuThermalUpdate = Pick<GpuInstance, 'temp' | 'wear' | 'paste' | 'shutdown' | 'overheatSeconds'>;

export interface SimOutput {
  now: number;
  dt: number;
  gpuUpdates: Record<string, GpuThermalUpdate>;
  rackReboots: Record<string, number>;
  roomTemps: Partial<Record<RoomId, number>>;
  cashDelta: number;
  ccDelta: number;
  /** Change of the $BYT / $NOVA wallets and cost bases during the tick. */
  altDeltas: Record<AltCoinId, number>;
  altCostDeltas: Record<AltCoinId, number>;
  memeDelta: number;
  memeCostDelta: number;
  ccCostDelta: number;
  gemsDelta: number;
  earnedCash: number;
  /** $CC minted this tick (0 while mining an altcoin). */
  ccMined: number;
  /** Coins of the mined coin minted this tick, and which coin that was. */
  coinMined: number;
  minedCoin: MineableCoin;
  electricityPaid: number;
  market: MarketState;
  botFires: Record<string, number>;
  event: ActiveNetworkEvent | null;
  nextEventAt: number;
  blocksFound: number;
  raids: number;
  overheats: number;
  bestTrade: number;
  /** Hottest die temperature reached at any integration step of this tick (°C, 0 with no mounted GPU). */
  peakTemp: number;
  /** Realized profit (over cost basis) made by trading-bot sells during this tick. */
  botEarned: number;
  live: LiveMetrics;
  messages: GameMessage[];
  sounds: SoundCue[];
}

export interface SimOptions {
  offline: boolean;
  /** Max integration step in seconds. */
  maxStep: number;
}

// ───────────────────────── Overclock helpers ─────────────────────────

export const ocPowerMul = (oc: OverclockSettings): number =>
  (oc.voltage / OC_LIMITS.voltage.stock) ** 2 * (1 + oc.core / 2000) * (1 + oc.mem / 12000);

export const ocHashBonus = (oc: OverclockSettings): number =>
  clamp((oc.core / OC_LIMITS.core.max) * 0.25 + (oc.mem / OC_LIMITS.mem.max) * 0.15, -0.2, OC_LIMITS.maxBonus);

export const effectiveCoreHeadroom = (silicon: SiliconProfile, voltage: number): number =>
  silicon.coreHeadroom + ((voltage - OC_LIMITS.voltage.stock) / 10) * silicon.vScale;

/** Probability (0-1) that a stress test fails with the given settings. */
export function crashChance(silicon: SiliconProfile, oc: OverclockSettings): number {
  const coreMargin = effectiveCoreHeadroom(silicon, oc.voltage) - oc.core;
  const memMargin = silicon.memHeadroom - oc.mem;
  if (coreMargin < 0 || memMargin < 0) return 1;
  if (coreMargin < 15 || memMargin < 60) return 0.35;
  return 0;
}

/** VIP AI diagnostics: best safe profile for this silicon. */
export function aiAutoTune(silicon: SiliconProfile): OverclockSettings {
  const voltage = 1080;
  const core = clamp(Math.floor((effectiveCoreHeadroom(silicon, voltage) - 25) / 5) * 5, OC_LIMITS.core.min, OC_LIMITS.core.max);
  const mem = clamp(Math.floor((silicon.memHeadroom - 90) / 25) * 25, OC_LIMITS.mem.min, OC_LIMITS.mem.max);
  return { core, mem, voltage };
}

export const STOCK_OC: OverclockSettings = { core: 0, mem: 0, voltage: OC_LIMITS.voltage.stock };

/** Rooms the farm may use: a Single Room challenge restricts the run to the Bedroom. */
export function usableRooms(input: Pick<SimInput, 'ownedRooms' | 'challenge'>): RoomId[] {
  if (!challengeRules(input.challenge?.id).singleRoom) return input.ownedRooms;
  return input.ownedRooms.includes('bedroom') ? ['bedroom'] : [];
}

export const pasteFactor = (paste: number): number =>
  PHYSICS.pasteMinFactor + (1 - PHYSICS.pasteMinFactor) * clamp(paste, 0, 1);

// ───────────────────────── Market helpers ─────────────────────────

export const sellPrice = (market: MarketState, coin: CoinId, mods: Pick<TalentModifiers, 'sellBonus'>): number =>
  market[coin].price * (1 + mods.sellBonus) * (1 - MARKET.fee);

export const buyPrice = (market: MarketState, coin: CoinId): number => market[coin].price * (1 + MARKET.fee);

function stepMarket(market: MarketState, dt: number, now: number, event: ActiveNetworkEvent | null, messages: GameMessage[], offline: boolean): void {
  COIN_IDS.forEach((id) => {
    const coin = market[id];
    const cfg = COIN_MARKET[id];
    const mean = coin.basePrice * (event?.id === 'bull_run' ? bullMeanMul(id) : 1);
    const sigma = cfg.sigma * (id === 'MEME' && event?.id === 'meme_mania' ? EVENT_EFFECTS.memeVolMul : 1);
    let logP = Math.log(coin.price);
    logP += cfg.theta * (Math.log(mean) - logP) * dt + sigma * Math.sqrt(dt) * gaussian();
    // $MEME pump & dump jumps
    if (id === 'MEME' && !offline && Math.random() < dt / 150) {
      const jump = Math.random() < 0.5 ? randRange(0.45, 0.75) : randRange(1.4, 2.6);
      logP += Math.log(jump);
      messages.push(jump > 1 ? gameMsg('good', '$MEME PUMP! Whales are buying.') : gameMsg('warn', '$MEME DUMP! Paper hands everywhere.'));
    }
    const price = clamp(Math.exp(logP), coin.basePrice * cfg.min, coin.basePrice * cfg.max);
    coin.price = price;
    if (now - coin.current.t >= MARKET.candleMs) {
      coin.candles = [...coin.candles, coin.current].slice(-MARKET.maxCandles);
      coin.current = { t: now, o: price, h: price, l: price, c: price };
    } else {
      coin.current = { ...coin.current, h: Math.max(coin.current.h, price), l: Math.min(coin.current.l, price), c: price };
    }
  });
}

// ───────────────────────── Rack helpers ─────────────────────────

export interface RackTopology {
  gpuUids: string[];
  coolerUids: string[];
  fanCooling: number;
  fanPower: number;
  capacity: number;
  efficiency: number;
  selfPowered: boolean;
  hasPsu: boolean;
}

export function rackTopology(rack: RackInstance, data: Pick<GameData, 'gpus' | 'psus' | 'coolers'>): RackTopology {
  const model = RACK_BY_ID[rack.modelId];
  const gpuUids = rack.gpuSlots.filter((u): u is string => !!u && !!data.gpus[u]);
  const coolerUids = rack.fanSlots.filter((u): u is string => !!u && !!data.coolers[u]);
  let fanCooling = 0;
  let fanPower = 0;
  coolerUids.forEach((u) => {
    const m = COOLER_BY_ID[data.coolers[u].modelId];
    fanCooling += m.cooling;
    fanPower += m.power;
  });
  const psuInst = rack.psuUid ? data.psus[rack.psuUid] : undefined;
  const psu = psuInst ? PSU_BY_ID[psuInst.modelId] : undefined;
  const selfPowered = model?.selfPowered ?? false;
  return {
    gpuUids,
    coolerUids,
    fanCooling,
    fanPower,
    capacity: selfPowered ? Number.POSITIVE_INFINITY : psu?.capacity ?? 0,
    efficiency: selfPowered ? 1 : psu?.efficiency ?? 1,
    selfPowered,
    hasPsu: selfPowered || !!psu,
  };
}

/** Estimated DC load if every GPU in the rack were running (for UI previews). */
export function rackNominalLoad(rack: RackInstance, data: Pick<GameData, 'gpus' | 'psus' | 'coolers'>): number {
  const topo = rackTopology(rack, data);
  return topo.gpuUids.reduce((acc, u) => acc + GPU_BY_ID[data.gpus[u].modelId].power * ocPowerMul(data.gpus[u].oc), 0) + topo.fanPower;
}

// ───────────────────────── Grid demand ─────────────────────────

const REF_EFFICIENCY = GPU_CATALOG[0].hashrate / GPU_CATALOG[0].power;
const GRID_TARIFFS: Record<string, number> = Object.fromEntries(
  GPU_CATALOG.map((m) => [m.id, (m.hashrate / m.power / REF_EFFICIENCY) ** GRID.tariffExponent]),
);

/** Grid demand multiplier on the per-watt price of one GPU model (1 for the PX-460). */
export const gridTariff = (modelId: string): number => GRID_TARIFFS[modelId] ?? 1;

/** Base price of one wall watt-second in a room, before grid demand (room tariff and Green PPA). */
export const wattPrice = (roomId: RoomId, mods: Pick<TalentModifiers, 'electricityMul'>): number =>
  PHYSICS.pricePerWattSec * ROOM_BY_ID[roomId].priceMul * mods.electricityMul;

// ───────────────────────── Simulation ─────────────────────────

interface World {
  gpus: Record<string, GpuInstance>;
  racks: Record<string, RackInstance>;
  roomTemps: Partial<Record<RoomId, number>>;
  market: MarketState;
  event: ActiveNetworkEvent | null;
  nextEventAt: number;
  botFires: Record<string, number>;
  cash: number;
  cc: number;
  meme: number;
  memeCost: number;
  ccCost: number;
  alts: Record<AltCoinId, { amount: number; cost: number }>;
}

function cloneWorld(input: SimInput): World {
  const gpus: Record<string, GpuInstance> = {};
  Object.values(input.gpus).forEach((g) => {
    gpus[g.uid] = { ...g };
  });
  const racks: Record<string, RackInstance> = {};
  Object.values(input.racks).forEach((r) => {
    racks[r.uid] = { ...r };
  });
  const botFires: Record<string, number> = {};
  input.bots.forEach((b) => {
    botFires[b.id] = b.lastFiredAt;
  });
  return {
    gpus,
    racks,
    roomTemps: { ...input.roomTemps },
    market: Object.fromEntries(
      COIN_IDS.map((id) => [id, { ...input.market[id], candles: input.market[id].candles.slice(), current: { ...input.market[id].current } }]),
    ) as MarketState,
    event: input.event ? { ...input.event } : null,
    nextEventAt: input.nextEventAt,
    botFires,
    cash: bnToNumber(input.cash),
    cc: bnToNumber(input.cc),
    meme: input.meme,
    memeCost: input.memeCostBasis,
    ccCost: input.ccCostBasis,
    alts: {
      BYT: { amount: input.alts.BYT.amount, cost: input.alts.BYT.costBasis },
      NOVA: { amount: input.alts.NOVA.amount, cost: input.alts.NOVA.costBasis },
    },
  };
}

const holdingOf = (w: World, coin: CoinId): number => (coin === 'CC' ? w.cc : coin === 'MEME' ? w.meme : w.alts[coin].amount);
const costOf = (w: World, coin: CoinId): number => (coin === 'CC' ? w.ccCost : coin === 'MEME' ? w.memeCost : w.alts[coin].cost);

function addHolding(w: World, coin: CoinId, amount: number, cost: number): void {
  if (coin === 'CC') {
    w.cc += amount;
    w.ccCost += cost;
  } else if (coin === 'MEME') {
    w.meme += amount;
    w.memeCost += cost;
  } else {
    w.alts[coin].amount += amount;
    w.alts[coin].cost += cost;
  }
}

const emptyYields = (): Record<MineableCoin, CoinYield> => ({
  CC: { perSec: 0, valuePerSec: 0, difficulty: 1 },
  BYT: { perSec: 0, valuePerSec: 0, difficulty: 1 },
  NOVA: { perSec: 0, valuePerSec: 0, difficulty: 1 },
});

function emptyLive(): LiveMetrics {
  return { totalHash: 0, ccPerSec: 0, minedCoin: 'CC', coinPerSec: 0, yields: emptyYields(), electricityPerSec: 0, gridDemand: 1, difficulty: 1, hottest: 0, surge: 1, rooms: {}, racks: {}, gpus: {} };
}

interface StepAccumulator {
  ccMined: number;
  coinMined: number;
  electricity: number;
  earnedCash: number;
  gems: number;
  blocks: number;
  raids: number;
  overheats: number;
  bestTrade: number;
  peakTemp: number;
  botEarned: number;
  messages: GameMessage[];
  sounds: SoundCue[];
}

/**
 * Earnings = proceeds above the cash originally paid for the coins sold.
 * Mined coins have zero cost basis, so selling them is pure earnings, while a
 * buy -> sell round trip only counts its (rare) profit: no wash-trading levels.
 */
export function realizedEarnings(proceeds: number, holding: number, costBasis: number, amount: number): { earned: number; basis: number } {
  const share = holding > 0 ? Math.min(1, amount / holding) : 1;
  const basis = costBasis * share;
  return { earned: Math.max(0, proceeds - basis), basis };
}

function sellCoin(w: World, coin: CoinId, amount: number, mods: RunModifiers, acc: StepAccumulator): number {
  if (amount <= 0) return 0;
  const proceeds = amount * sellPrice(w.market, coin, mods);
  const { earned, basis } = realizedEarnings(proceeds, holdingOf(w, coin), costOf(w, coin), amount);
  addHolding(w, coin, -amount, -basis);
  // Only $MEME is a pure trade: mined coins cost nothing, so their proceeds are not a "trade profit".
  if (coin === 'MEME') acc.bestTrade = Math.max(acc.bestTrade, proceeds - basis);
  acc.earnedCash += earned;
  w.cash += proceeds;
  return proceeds;
}

function buyCoin(w: World, coin: CoinId, cashAmount: number): number {
  if (cashAmount <= 0) return 0;
  const qty = cashAmount / buyPrice(w.market, coin);
  w.cash -= cashAmount;
  addHolding(w, coin, qty, cashAmount);
  return qty;
}

function stepEvents(w: World, rooms: RoomId[], now: number, acc: StepAccumulator): void {
  if (w.event && now >= w.event.endsAt) {
    acc.messages.push(gameMsg('info', 'Network event ended: {name}.', { name: NETWORK_EVENTS[w.event.id].name }));
    w.event = null;
    w.nextEventAt = now + randRange(EVENT_INTERVAL[0], EVENT_INTERVAL[1]) * 1000;
  }
  if (!w.event && now >= w.nextEventAt) {
    const pool: NetworkEventId[] = ['difficulty_spike', 'heatwave', 'cold_snap', 'bull_run', 'meme_mania', 'flash_sale', ...(rooms.length ? (['blackout'] as const) : [])];
    const id = pick(pool);
    const def = NETWORK_EVENTS[id];
    const duration = randRange(def.duration[0], def.duration[1]) * 1000;
    const roomId = id === 'blackout' && rooms.length ? pick(rooms) : null;
    w.event = { id, startedAt: now, endsAt: now + duration, roomId };
    acc.messages.push(roomId
      ? gameMsg(def.positive ? 'good' : 'bad', 'NETWORK EVENT: {name} ({room}). {description}', { name: def.name, room: ROOM_BY_ID[roomId].name, description: def.description })
      : gameMsg(def.positive ? 'good' : 'bad', 'NETWORK EVENT: {name}. {description}', { name: def.name, description: def.description }));
    acc.sounds.push('event');
  }
}

function step(w: World, input: SimInput, dt: number, now: number, mods: RunModifiers, opts: SimOptions, acc: StepAccumulator, live: LiveMetrics): void {
  const rules = challengeRules(input.challenge?.id);
  const rooms = usableRooms(input);
  // Overdrive (airdrop): a short hashrate surge that ends on its own, also mid-catch-up.
  const surge = input.boost && now < input.boost.until ? Math.max(1, input.boost.mul) : 1;
  // Line Upgrade research is void while a challenge squeezes the power budget.
  const lineMul = rules.powerCapMul < 1 || rules.singleRoom ? 1 : mods.lineMul;
  const pasteLife = PHYSICS.pasteLifetimeSec * mods.pasteLifeMul;
  const gpuOc = (g: GpuInstance): OverclockSettings => (rules.lockOverclock ? STOCK_OC : g.oc);
  if (!opts.offline) stepEvents(w, rooms, now, acc);
  const ev = opts.offline ? null : w.event;
  const ambientDelta = ev?.id === 'heatwave' ? EVENT_EFFECTS.heatwaveDelta : ev?.id === 'cold_snap' ? EVENT_EFFECTS.coldSnapDelta : 0;
  const spiking = ev?.id === 'difficulty_spike';
  const coinId = input.minedCoin;
  const eventDifficulty = (coin: MineableCoin): number => (spiking ? spikeDifficulty(coin) : 1);

  const totalMounted = Object.values(w.racks).reduce(
    (acc2, r) => acc2 + (r.roomId ? r.gpuSlots.filter(Boolean).length : 0),
    0,
  );
  const techShare = totalMounted > 0 ? Math.min(1, 8 / totalMounted) : 0;
  const techPaste = input.technicians * PHYSICS.techPastePerSec * mods.techSpeed * techShare;
  const techRepair = input.technicians * PHYSICS.techWearRepairPerSec * mods.techSpeed * techShare;

  live.rooms = {};
  live.racks = {};
  live.gpus = {};
  live.minedCoin = coinId;
  let totalHash = 0;
  let electricityRate = 0;
  let farmPaidWall = 0;
  let farmBilledWall = 0;
  let hottest = 0;

  const racksByRoom: Partial<Record<RoomId, RackInstance[]>> = {};
  Object.values(w.racks).forEach((r) => {
    if (!r.roomId || !rooms.includes(r.roomId)) {
      live.racks[r.uid] = { status: 'stored', load: 0, wall: 0, capacity: 0, hash: 0, maxTemp: 0, cooling: 0, tariff: 1, powerCost: 0 };
      return;
    }
    (racksByRoom[r.roomId] ??= []).push(r);
  });

  rooms.forEach((roomId) => {
    const room = ROOM_BY_ID[roomId];
    const lineW = room.maxPowerW * rules.powerCapMul * lineMul;
    const racks = racksByRoom[roomId] ?? [];
    const blackout = ev?.id === 'blackout' && ev.roomId === roomId;
    const baseAmbient = room.ambient + ambientDelta;
    const roomTemp = w.roomTemps[roomId] ?? baseAmbient;

    // Pass 1: rack power status
    const rackInfo = racks.map((rack) => {
      const full = rackTopology(rack, { gpus: w.gpus, psus: input.psus, coolers: input.coolers });
      // Bronze Only: higher silicon grades stay idle (neither powered nor mining).
      const topo = rules.bronzeOnly ? { ...full, gpuUids: full.gpuUids.filter((u) => w.gpus[u].quality === 'bronze') } : full;
      let status: RackStatus;
      let load = 0;
      let gpuLoad = 0;
      let tariffLoad = 0;
      if (topo.gpuUids.length === 0) status = 'empty';
      else if (!topo.hasPsu) status = 'no_psu';
      else if (blackout && !topo.selfPowered) status = 'blackout';
      else if (rack.rebootUntil > now) status = 'rebooting';
      else {
        topo.gpuUids.forEach((u) => {
          const g = w.gpus[u];
          if (g.shutdown) return;
          const p = GPU_BY_ID[g.modelId].power * ocPowerMul(gpuOc(g));
          gpuLoad += p;
          tariffLoad += p * gridTariff(g.modelId);
        });
        load = topo.fanPower + gpuLoad;
        status = load > topo.capacity ? 'overload' : 'online';
      }
      if (status !== 'online') load = 0;
      const wall = topo.selfPowered ? 0 : load / topo.efficiency;
      // Fans and PSU losses are billed at the rack's (GPU-load weighted) tariff.
      const tariff = gpuLoad > 0 ? tariffLoad / gpuLoad : 1;
      return { rack, topo, status, load, wall, tariff };
    });

    const roomWall = rackInfo.reduce((a, r) => a + r.wall, 0);
    const brownout = roomWall > lineW ? lineW / roomWall : 1;
    const paidWall = Math.min(roomWall, lineW);
    // A brownout caps the paid wall at the contracted line: every rack is billed pro rata.
    const paidShare = roomWall > 0 ? paidWall / roomWall : 0;
    const price = wattPrice(roomId, mods);
    const billedWall = rackInfo.reduce((a, r) => a + r.wall * r.tariff, 0) * paidShare;
    electricityRate += billedWall * price;
    farmPaidWall += paidWall;
    farmBilledWall += billedWall;

    let roomHeat = 0;
    let roomHash = 0;
    let racksOnline = 0;

    // Pass 2: thermals + hashrate
    rackInfo.forEach(({ rack, topo, status, load, wall, tariff }) => {
      const rackModel = RACK_BY_ID[rack.modelId];
      const powered = status === 'online';
      if (powered) racksOnline += 1;
      const n = Math.max(1, topo.gpuUids.length);
      const fanK = powered ? topo.fanCooling : 0;
      let rackHash = 0;
      let rackMax = 0;
      topo.gpuUids.forEach((uid) => {
        const g = w.gpus[uid];
        const model = GPU_BY_ID[g.modelId];
        const running = powered && !g.shutdown;
        const powerMul = ocPowerMul(gpuOc(g));
        const heat = running ? model.power * powerMul * mods.heatMul * rackModel.heatMul * brownout : 0;
        const k = (PHYSICS.baseCooling + fanK / n) * pasteFactor(g.paste) * room.coolingMul * mods.coolingMul;
        const tEq = roomTemp + heat / k;
        g.temp = tEq + (g.temp - tEq) * Math.exp((-k * dt) / model.thermalMass);

        if (!g.shutdown && g.temp >= PHYSICS.shutdownTemp) {
          g.shutdown = true;
          acc.overheats += 1;
          acc.messages.push(gameMsg('bad', 'THERMAL SHUTDOWN: {name} hit {temp}°C!', { name: model.name, temp: g.temp.toFixed(0) }));
          acc.sounds.push('shutdown');
        } else if (g.shutdown && g.temp <= PHYSICS.restartTemp) {
          g.shutdown = false;
          acc.messages.push(gameMsg('info', '{name} cooled down and restarted.', { name: model.name }));
          acc.sounds.push('restart');
        }

        // Re-evaluate after the thermal protection check: a GPU that just shut down stops hashing now.
        const active = powered && !g.shutdown;
        const throttled = active && g.temp > PHYSICS.throttleTemp;
        if (active && g.temp > PHYSICS.wearTemp) {
          g.overheatSeconds += dt;
          g.wear = Math.min(PHYSICS.maxWear, g.wear + (PHYSICS.wearPerMinute * dt) / 60);
        }
        if (active) g.paste = Math.max(0, g.paste - dt / pasteLife);
        if (techPaste > 0) g.paste = Math.min(1, g.paste + techPaste * dt);
        if (techRepair > 0 && g.wear > 0) g.wear = Math.max(0, g.wear - techRepair * dt);

        const hash = active
          ? model.hashrate * (1 + (rules.lockOverclock ? 0 : g.ocBonus)) * (throttled ? 0.5 : 1) * (1 - g.wear) * brownout * mods.hashMul * surge
          : 0;
        rackHash += hash;
        rackMax = Math.max(rackMax, g.temp);
        hottest = Math.max(hottest, g.temp);
        roomHeat += heat;
        live.gpus[uid] = { hash, running: active, throttled, heat, load: active ? clamp(heat / model.power, 0, 2) : 0 };
      });
      roomHeat += load > 0 ? topo.fanPower + (wall - load) : 0;
      roomHash += rackHash;
      const allShutdown = powered && topo.gpuUids.length > 0 && topo.gpuUids.every((u) => w.gpus[u].shutdown);
      live.racks[rack.uid] = {
        status: allShutdown ? 'overheat' : status,
        load,
        wall,
        capacity: topo.capacity,
        hash: rackHash,
        maxTemp: rackMax,
        cooling: (PHYSICS.baseCooling * n + topo.fanCooling) * room.coolingMul * mods.coolingMul,
        tariff,
        powerCost: wall * paidShare * tariff * price,
      };
    });

    // Room air temperature relaxes towards its heat-loaded target
    const target = baseAmbient + roomHeat * room.heatPerWatt;
    w.roomTemps[roomId] = roomTemp + (target - roomTemp) * (1 - Math.exp(-dt / PHYSICS.roomTau));
    totalHash += roomHash;
    live.rooms[roomId] = {
      load: rackInfo.reduce((a, r) => a + r.load, 0),
      wall: roomWall,
      capacity: lineW,
      brownout,
      ambient: baseAmbient,
      temp: w.roomTemps[roomId] ?? baseAmbient,
      hash: roomHash,
      blackout,
      racksOnline,
    };
  });

  // ── Mining yield ──
  const pool = POOLS[input.pool];
  const poolMul = input.pool === 'public' ? 1 - pool.fee : pool.payoutMul;
  const diffOf = (coin: MineableCoin): number => eventDifficulty(coin) * hashDifficulty(coin, totalHash);
  const rateOf = (coin: MineableCoin): number => ((totalHash / 1e6) * coinPerMHs(coin)) / diffOf(coin);
  const baseRate = rateOf(coinId);
  let gain = 0;
  if (input.pool === 'public') {
    gain = baseRate * (1 - pool.fee) * dt;
  } else if (input.pool === 'solo') {
    if (opts.offline) gain = baseRate * pool.payoutMul * dt;
    else if (baseRate > 0 && Math.random() < dt / PHYSICS.soloBlockMeanSec) {
      gain = baseRate * PHYSICS.soloBlockMeanSec * pool.payoutMul;
      acc.blocks += 1;
      const gem = Math.random() < 0.3;
      if (gem) acc.gems += 1;
      if (coinId === 'CC') {
        acc.messages.push(gem
          ? gameMsg('good', 'BLOCK FOUND! Solo jackpot of {cc} $CC + 1 gem!', { cc: gain.toFixed(2) })
          : gameMsg('good', 'BLOCK FOUND! Solo jackpot of {cc} $CC!', { cc: gain.toFixed(2) }));
      } else {
        acc.messages.push(gem
          ? gameMsg('good', 'BLOCK FOUND! Solo jackpot of {amount} ${coin} + 1 gem!', { amount: gain.toFixed(2), coin: coinId })
          : gameMsg('good', 'BLOCK FOUND! Solo jackpot of {amount} ${coin}!', { amount: gain.toFixed(2), coin: coinId }));
      }
      acc.sounds.push('block');
    }
  } else {
    gain = baseRate * pool.payoutMul * dt;
    if (!opts.offline && baseRate > 0 && Math.random() < dt / PHYSICS.darknetRaidMeanSec) {
      const fine = Math.min(Math.max(0, w.cash), Math.max(w.cash * 0.12, baseRate * w.market[coinId].price * 90));
      w.cash -= fine;
      acc.raids += 1;
      const roomId = pick(rooms);
      Object.values(w.racks).forEach((r) => {
        if (r.roomId === roomId) r.rebootUntil = now + PHYSICS.inspectionRebootMs;
      });
      acc.messages.push(gameMsg('bad', 'RAID! Electrical inspection in {room}. Fined ${fine}, rigs offline 30s.', { room: ROOM_BY_ID[roomId].name, fine: fine.toFixed(0) }));
      acc.sounds.push('raid');
    }
  }
  // Mined coins cost nothing: only the amount grows, never the cost basis.
  addHolding(w, coinId, gain, 0);
  acc.coinMined += gain;
  if (coinId === 'CC') acc.ccMined += gain;

  // ── Electricity bill (auto-debits coins when cash runs dry: $CC first, then the altcoins) ──
  let bill = electricityRate * dt;
  acc.electricity += bill;
  const fromCash = Math.min(bill, Math.max(0, w.cash));
  w.cash -= fromCash;
  bill -= fromCash;
  (['CC', ...ALT_COIN_IDS] as const).forEach((coin) => {
    const held = holdingOf(w, coin);
    if (bill <= 0 || held <= 0) return;
    const needed = Math.min(held, bill / w.market[coin].price);
    addHolding(w, coin, -needed, -costOf(w, coin) * (needed / held));
    bill -= needed * w.market[coin].price;
  });

  // ── Market, bots & VIP auto-sell ──
  stepMarket(w.market, dt, now, ev, acc.messages, opts.offline);
  input.bots.forEach((bot) => {
    if (!bot.enabled) return;
    const last = w.botFires[bot.id] ?? 0;
    if (now - last < bot.cooldownSec * 1000) return;
    const coin = w.market[bot.coin];
    const ratio = coin.price / coin.basePrice;
    const hit = bot.trigger === 'above' ? ratio >= bot.threshold : ratio <= bot.threshold;
    if (!hit) return;
    const pctAmt = clamp(bot.amountPct, 1, 100) / 100;
    if (bot.side === 'sell') {
      const holding = holdingOf(w, bot.coin);
      if (holding <= 1e-9) return;
      const earnedBefore = acc.earnedCash;
      sellCoin(w, bot.coin, holding * pctAmt, mods, acc);
      acc.botEarned += acc.earnedCash - earnedBefore;
    } else {
      if (w.cash <= 0.01) return;
      buyCoin(w, bot.coin, w.cash * pctAmt);
    }
    w.botFires[bot.id] = now;
    if (!opts.offline) {
      acc.messages.push(gameMsg('info', 'BOT #{id} {side} {coin} @ {price}', { id: bot.id.slice(-3), side: bot.side.toUpperCase(), coin: bot.coin, price: coin.price.toFixed(4) }));
      acc.sounds.push('sell');
    }
  });
  if (input.vip.autoSellPeaks && input.vip.autoSellEnabled && w.cc > 0 && w.market.CC.price >= w.market.CC.basePrice * MARKET.vipPeakThreshold) {
    sellCoin(w, 'CC', w.cc, mods, acc);
  }

  live.totalHash = totalHash;
  live.ccPerSec = rateOf('CC') * poolMul;
  live.coinPerSec = baseRate * poolMul;
  live.difficulty = diffOf(coinId);
  MINEABLE_COIN_IDS.forEach((coin) => {
    const perSec = rateOf(coin) * poolMul;
    live.yields[coin] = { perSec, valuePerSec: perSec * w.market[coin].price, difficulty: diffOf(coin) };
  });
  live.electricityPerSec = electricityRate;
  live.gridDemand = farmPaidWall > 0 ? farmBilledWall / farmPaidWall : 1;
  live.hottest = hottest;
  live.surge = surge;
  acc.peakTemp = Math.max(acc.peakTemp, hottest);
}

/** Advance the world by `dtSec` seconds ending at `now` (epoch ms). */
export function simulate(input: SimInput, dtSec: number, now: number, opts: SimOptions): SimOutput {
  const w = cloneWorld(input);
  // A research project that finishes inside this window (offline catch-up) counts from its end time on.
  const mods = runModifiers(input.talents, input.research.levels);
  const pending = input.research.active;
  const modsAfter = pending
    ? runModifiers(input.talents, { ...input.research.levels, [pending.id]: (input.research.levels[pending.id] ?? 0) + 1 })
    : mods;
  const acc: StepAccumulator = { ccMined: 0, coinMined: 0, electricity: 0, earnedCash: 0, gems: 0, blocks: 0, raids: 0, overheats: 0, bestTrade: 0, peakTemp: 0, botEarned: 0, messages: [], sounds: [] };
  const live = emptyLive();
  const cash0 = w.cash;
  const cc0 = w.cc;
  const meme0 = w.meme;
  const memeCost0 = w.memeCost;
  const ccCost0 = w.ccCost;
  const alts0 = { BYT: { ...w.alts.BYT }, NOVA: { ...w.alts.NOVA } };
  const rebootBefore: Record<string, number> = {};
  Object.values(w.racks).forEach((r) => {
    rebootBefore[r.uid] = r.rebootUntil;
  });

  const total = Math.max(0, dtSec);
  const steps = Math.max(1, Math.ceil(total / opts.maxStep));
  const h = total / steps;
  const start = now - total * 1000;
  for (let i = 1; i <= steps; i += 1) {
    const stepNow = start + i * h * 1000;
    step(w, input, h, stepNow, pending && stepNow >= pending.endsAt ? modsAfter : mods, opts, acc, live);
  }

  const gpuUpdates: Record<string, GpuThermalUpdate> = {};
  Object.values(w.gpus).forEach((g) => {
    gpuUpdates[g.uid] = { temp: g.temp, wear: g.wear, paste: g.paste, shutdown: g.shutdown, overheatSeconds: g.overheatSeconds };
  });
  const rackReboots: Record<string, number> = {};
  Object.values(w.racks).forEach((r) => {
    if (r.rebootUntil !== rebootBefore[r.uid]) rackReboots[r.uid] = r.rebootUntil;
  });

  return {
    now,
    dt: total,
    gpuUpdates,
    rackReboots,
    roomTemps: w.roomTemps,
    cashDelta: w.cash - cash0,
    ccDelta: w.cc - cc0,
    altDeltas: { BYT: w.alts.BYT.amount - alts0.BYT.amount, NOVA: w.alts.NOVA.amount - alts0.NOVA.amount },
    altCostDeltas: { BYT: w.alts.BYT.cost - alts0.BYT.cost, NOVA: w.alts.NOVA.cost - alts0.NOVA.cost },
    memeDelta: w.meme - meme0,
    memeCostDelta: w.memeCost - memeCost0,
    ccCostDelta: w.ccCost - ccCost0,
    gemsDelta: acc.gems,
    earnedCash: acc.earnedCash,
    ccMined: acc.ccMined,
    coinMined: acc.coinMined,
    minedCoin: input.minedCoin,
    electricityPaid: acc.electricity,
    market: w.market,
    botFires: w.botFires,
    event: w.event,
    nextEventAt: w.nextEventAt,
    blocksFound: acc.blocks,
    raids: acc.raids,
    overheats: acc.overheats,
    bestTrade: acc.bestTrade,
    peakTemp: acc.peakTemp,
    botEarned: acc.botEarned,
    live,
    messages: acc.messages.slice(-12),
    sounds: Array.from(new Set(acc.sounds)),
  };
}

/** Online tick: fine steps, random events enabled. */
export const simulateOnline = (input: SimInput, dtSec: number, now: number): SimOutput =>
  simulate(input, Math.min(dtSec, 600), now, { offline: false, maxStep: 1 });

/** Offline catch-up: coarse steps, no random events / raids, expected-value solo. */
export function simulateOffline(input: SimInput, seconds: number, now: number): SimOutput {
  const maxStep = Math.max(5, seconds / 2500);
  return simulate(input, seconds, now, { offline: true, maxStep });
}

export { emptyLive };
