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
import { BUFFS, blockMulOf, crewRallied, nitroActive } from '../config/buffs';
import { challengeRules } from '../config/challenges';
import { MAX_PADS, ROOM_BY_ID, ROOM_MECHANICS, garageWave, isNight, padsAdjacent } from '../config/roomsCatalog';
import { SYNERGY } from '../config/synergy';
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
import type { ActiveNetworkEvent, AltCoinId, CoinId, MarketState, MineableCoin, NetworkEventId, PoolMode } from '../types/economy';
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
  | 'research' | 'boost' | 'buffs' | 'upgrades' | 'bmc'
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
  /** Fan noise of the running racks (the Bedroom caps overclocks when it is loud at night). */
  noise: number;
  /** Bedroom at night, too loud: overclocks only deliver part of their bonus. */
  ocCapped: boolean;
  /** Garage heat wave: degrees it adds to the ambient right now. */
  wave: number;
  /** Warehouse battery: the valley tariff applies right now. */
  valley: boolean;
  /** Structural GPU limit of the room (null = none) and the mounted GPUs it leaves idle. */
  gpuCap: number | null;
  gpusOverCap: number;
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
  /** Mean die temperature of the GPUs that are hashing (°C, 0 when none is). */
  avgTemp: number;
  /** Night half of the shared day/night clock. */
  night: boolean;
  /** Hashrate multiplier of the Overdrive surge right now (1 = none). */
  surge: number;
  rooms: Partial<Record<RoomId, RoomLive>>;
  racks: Record<string, RackLive>;
  gpus: Record<string, GpuLive>;
}

/** Something worth a floating label over one rack (online ticks only). */
export interface RackFx {
  kind: 'block' | 'hot' | 'shutdown';
  rackUid: string;
  /** Coins paid (block) or die temperature in °C (hot, shutdown). */
  value: number;
  coin?: MineableCoin;
}

export type GpuThermalUpdate = Pick<GpuInstance, 'temp' | 'wear' | 'paste' | 'shutdown' | 'overheatSeconds' | 'condensed'>;

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
  /** Per-rack events for the canvas (floating labels). Empty offline. */
  rackFx: RackFx[];
  /** What the Smart BMC did during the tick: GPUs re-pasted and repaired, and the cash it spent. */
  bmc: { pasted: number; repaired: number; spent: number };
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
  // Undervolt: every chip has a floor it will not run below, whatever the clock.
  const voltMargin = oc.voltage - silicon.vFloor;
  if (coreMargin < 0 || memMargin < 0 || voltMargin < 0) return 1;
  if (coreMargin < OC_LIMITS.coreMargin || memMargin < OC_LIMITS.memMargin || voltMargin < OC_LIMITS.voltageMargin) return 0.35;
  return 0;
}

const stepDown = (value: number, step: number): number => Math.floor(value / step) * step;
const stepUp = (value: number, step: number): number => Math.ceil(value / step) * step;

/**
 * The closest settings to `oc` that this chip runs with no crash risk: the voltage is raised to its
 * safe floor if needed, then core and memory are lowered to their safe margins. Used to apply one
 * BIOS profile to a whole batch of cards with different silicon.
 */
export function fitOverclock(silicon: SiliconProfile, oc: OverclockSettings): OverclockSettings {
  const { core: c, mem: m, voltage: v } = OC_LIMITS;
  const voltage = clamp(Math.max(oc.voltage, stepUp(silicon.vFloor + OC_LIMITS.voltageMargin, v.step)), v.min, v.max);
  const core = clamp(Math.min(oc.core, stepDown(effectiveCoreHeadroom(silicon, voltage) - OC_LIMITS.coreMargin, c.step)), c.min, c.max);
  const mem = clamp(Math.min(oc.mem, stepDown(silicon.memHeadroom - OC_LIMITS.memMargin, m.step)), m.min, m.max);
  return { core, mem, voltage };
}

/** Share of the stock board power (and heat) an undervolt saves at the same clocks (negative when overvolted). */
export const voltageSaving = (voltage: number): number => 1 - (voltage / OC_LIMITS.voltage.stock) ** 2;

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

// ───────────────────────── Maintenance ─────────────────────────

export const repasteCost = (g: { modelId: string }): number => Math.max(5, Math.round(GPU_BY_ID[g.modelId].price * 0.03));
export const repairCost = (g: { modelId: string; wear: number }): number => Math.max(5, Math.round(GPU_BY_ID[g.modelId].price * 0.5 * g.wear));

/** Silicon health, 1 = pristine, 0 = as worn as a chip can get. */
export const gpuHealth = (g: Pick<GpuInstance, 'wear'>): number => clamp(1 - g.wear / PHYSICS.maxWear, 0, 1);

// ───────────────────────── Rack synergies & room rules ─────────────────────────

/**
 * Cluster Bonus: the GPUs of a rack that belong to a group of `SYNERGY.clusterSize` or more cards of the
 * same model and silicon grade. They hash faster and draw less power.
 */
export function clusterUids(gpuUids: readonly string[], gpus: Record<string, Pick<GpuInstance, 'modelId' | 'quality'>>): Set<string> {
  const groups = new Map<string, string[]>();
  gpuUids.forEach((uid) => {
    const g = gpus[uid];
    if (!g) return;
    const key = `${g.modelId}|${g.quality}`;
    const list = groups.get(key);
    if (list) list.push(uid);
    else groups.set(key, [uid]);
  });
  const out = new Set<string>();
  groups.forEach((list) => {
    if (list.length >= SYNERGY.clusterSize) list.forEach((uid) => out.add(uid));
  });
  return out;
}

const LIQUID_KINDS: readonly string[] = ['liquid', 'immersion', 'cryo'];

/** Heat transfer (W/°C) of the liquid-loop coolers mounted in a rack: what spills over to its neighbours. */
export function liquidCooling(rack: Pick<RackInstance, 'fanSlots'>, coolers: GameData['coolers']): number {
  return rack.fanSlots.reduce((acc, uid) => {
    const m = uid && coolers[uid] ? COOLER_BY_ID[coolers[uid].modelId] : undefined;
    return acc + (m && LIQUID_KINDS.includes(m.kind) ? m.cooling : 0);
  }, 0);
}

/** Fan noise a rack makes while it runs. */
export function rackNoise(rack: Pick<RackInstance, 'fanSlots'>, coolers: GameData['coolers']): number {
  return rack.fanSlots.reduce((acc, uid) => acc + (uid && coolers[uid] ? COOLER_BY_ID[coolers[uid].modelId]?.noise ?? 0 : 0), 0);
}

/** Watts the heater strip of a card burns while it warms up past the dew point (Arctic). */
export const preheatWatts = (boardPower: number): number =>
  Math.max(ROOM_MECHANICS.arctic.preheatMinW, boardPower * ROOM_MECHANICS.arctic.preheatShare);

const IDLE_RACK_LIVE: RackLive = { status: 'stored', load: 0, wall: 0, capacity: 0, hash: 0, maxTemp: 0, cooling: 0, tariff: 1, powerCost: 0, clustered: 0, spill: 0, idle: 0, preheating: 0 };

export const pasteFactor = (paste: number): number =>
  PHYSICS.pasteMinFactor + (1 - PHYSICS.pasteMinFactor) * clamp(paste, 0, 1);

/** Expected payout multiplier of a pool on the base yield (fee for the public pool, bonus for the others). */
export const poolYieldMul = (pool: PoolMode): number => (pool === 'public' ? 1 - POOLS[pool].fee : POOLS[pool].payoutMul);

/**
 * Degrees a fresh coat of paste takes off a die at steady state. The die sits `temp - air` above the
 * room air with heat transfer k·pasteFactor(paste); new paste restores the full k, so the gap shrinks
 * to gap · pasteFactor(paste).
 */
export const repasteCooling = (temp: number, air: number, paste: number): number =>
  Math.max(0, temp - air) * (1 - pasteFactor(paste));

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
  return { totalHash: 0, ccPerSec: 0, minedCoin: 'CC', coinPerSec: 0, yields: emptyYields(), electricityPerSec: 0, gridDemand: 1, difficulty: 1, hottest: 0, avgTemp: 0, night: false, surge: 1, rooms: {}, racks: {}, gpus: {} };
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
  rackFx: RackFx[];
  bmcPasted: number;
  bmcRepaired: number;
  bmcSpent: number;
}

/** Floating labels are eye candy: a busy tick keeps only the first few. */
const MAX_RACK_FX = 12;
function pushRackFx(acc: StepAccumulator, opts: SimOptions, fx: RackFx): void {
  if (!opts.offline && acc.rackFx.length < MAX_RACK_FX) acc.rackFx.push(fx);
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
  const ambientDelta = (ev?.id === 'heatwave' ? EVENT_EFFECTS.heatwaveDelta : ev?.id === 'cold_snap' ? EVENT_EFFECTS.coldSnapDelta : 0)
    // Liquid nitrogen drone: a short, deep ambient drop.
    + (nitroActive(input.buffs, now) ? BUFFS.nitro.delta : 0);
  // Crew rally (a clicked technician): faster maintenance and a little extra airflow while it lasts.
  const rally = input.technicians > 0 && crewRallied(input.buffs, now);
  const crewSpeed = rally ? BUFFS.crew.speedMul : 1;
  const crewCooling = rally ? BUFFS.crew.coolingMul : 1;
  const spiking = ev?.id === 'difficulty_spike';
  const coinId = input.minedCoin;
  const eventDifficulty = (coin: MineableCoin): number => (spiking ? spikeDifficulty(coin) : 1);

  const totalMounted = Object.values(w.racks).reduce(
    (acc2, r) => acc2 + (r.roomId ? r.gpuSlots.filter(Boolean).length : 0),
    0,
  );
  const techShare = totalMounted > 0 ? Math.min(1, 8 / totalMounted) : 0;
  const techPaste = input.technicians * PHYSICS.techPastePerSec * mods.techSpeed * techShare * crewSpeed;
  const techRepair = input.technicians * PHYSICS.techWearRepairPerSec * mods.techSpeed * techShare * crewSpeed;

  live.rooms = {};
  live.racks = {};
  live.gpus = {};
  live.minedCoin = coinId;
  let totalHash = 0;
  let electricityRate = 0;
  let farmPaidWall = 0;
  let farmBilledWall = 0;
  let hottest = 0;
  let tempSum = 0;
  let tempCount = 0;
  /** Rack with the most hashrate: where a found block is celebrated. */
  const topRack = { uid: '', hash: 0 };

  const racksByRoom: Partial<Record<RoomId, RackInstance[]>> = {};
  Object.values(w.racks).forEach((r) => {
    if (!r.roomId || !rooms.includes(r.roomId)) {
      live.racks[r.uid] = { ...IDLE_RACK_LIVE };
      return;
    }
    (racksByRoom[r.roomId] ??= []).push(r);
  });

  const night = isNight(now);
  live.night = night;
  const bmcOn = mods.smartBmc && input.bmc.enabled;
  const arctic = ROOM_MECHANICS.arctic;

  rooms.forEach((roomId) => {
    const room = ROOM_BY_ID[roomId];
    const lineW = room.maxPowerW * rules.powerCapMul * lineMul;
    // Pad order: the structural limit and the neighbours of a liquid loop both follow the floor plan.
    const racks = (racksByRoom[roomId] ?? []).slice().sort((x, y) => (x.pad ?? 0) - (y.pad ?? 0));
    const blackout = ev?.id === 'blackout' && ev.roomId === roomId;
    // Garage: a heat wave rolls in every few minutes.
    const wave = roomId === 'garage' ? garageWave(now) : 0;
    const baseAmbient = room.ambient + ambientDelta + wave;
    const roomTemp = w.roomTemps[roomId] ?? baseAmbient;
    // Submarine: the pressure hull only carries so many GPUs; the rest stay idle.
    let capLeft = room.maxGpus ?? Number.POSITIVE_INFINITY;
    let overCap = 0;

    // Pass 1: rack power status
    const rackInfo = racks.map((rack) => {
      const full = rackTopology(rack, { gpus: w.gpus, psus: input.psus, coolers: input.coolers });
      // Bronze Only: higher silicon grades stay idle (neither powered nor mining).
      const allowed = rules.bronzeOnly ? full.gpuUids.filter((u) => w.gpus[u].quality === 'bronze') : full.gpuUids;
      const gpuUids = allowed.slice(0, Math.max(0, capLeft));
      capLeft -= gpuUids.length;
      overCap += allowed.length - gpuUids.length;
      const topo = gpuUids.length === full.gpuUids.length ? full : { ...full, gpuUids };
      const cluster = clusterUids(topo.gpuUids, w.gpus);
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
          const model = GPU_BY_ID[g.modelId];
          const p = roomId === 'arctic' && g.condensed
            ? preheatWatts(model.power)
            : model.power * ocPowerMul(gpuOc(g)) * (cluster.has(u) ? 1 - SYNERGY.clusterPower : 1);
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
      return { rack, topo, status, load, wall, tariff, cluster, idle: full.gpuUids.length - topo.gpuUids.length, spill: 0 };
    });

    // Liquid Cooling Spillover: a running liquid loop also carries heat away from the racks right next to it.
    const pads = Math.min(MAX_PADS, room.pads + mods.extraPads);
    rackInfo.forEach((src) => {
      if (src.status !== 'online') return;
      const liquid = liquidCooling(src.rack, input.coolers);
      if (liquid <= 0) return;
      rackInfo.forEach((dst) => {
        // Only racks without a loop of their own benefit: the chilled air helps open, air-cooled rigs.
        if (dst === src || liquidCooling(dst.rack, input.coolers) > 0) return;
        if (padsAdjacent(src.rack.pad ?? -9, dst.rack.pad ?? -99, pads)) dst.spill += liquid * SYNERGY.spillShare;
      });
    });

    // Bedroom: too much fan noise at night and the neighbours make you back the overclocks off.
    const noise = rackInfo.reduce((a, r) => a + (r.status === 'online' ? rackNoise(r.rack, input.coolers) : 0), 0);
    const ocCapped = roomId === 'bedroom' && night && noise > ROOM_MECHANICS.bedroom.noiseLimit;
    const ocShare = ocCapped ? ROOM_MECHANICS.bedroom.nightOcShare : 1;

    const roomWall = rackInfo.reduce((a, r) => a + r.wall, 0);
    const brownout = roomWall > lineW ? lineW / roomWall : 1;
    const paidWall = Math.min(roomWall, lineW);
    // A brownout caps the paid wall at the contracted line: every rack is billed pro rata.
    const paidShare = roomWall > 0 ? paidWall / roomWall : 0;
    // Warehouse battery bank: valley (night) power is cheaper.
    const valley = roomId === 'warehouse' && input.upgrades.battery && night;
    const price = wattPrice(roomId, mods) * (valley ? ROOM_MECHANICS.warehouse.valleyMul : 1);
    const billedWall = rackInfo.reduce((a, r) => a + r.wall * r.tariff, 0) * paidShare;
    electricityRate += billedWall * price;
    farmPaidWall += paidWall;
    farmBilledWall += billedWall;

    let roomHeat = 0;
    let roomHash = 0;
    let racksOnline = 0;

    // Pass 2: thermals + hashrate
    rackInfo.forEach(({ rack, topo, status, load, wall, tariff, cluster, idle, spill }) => {
      const rackModel = RACK_BY_ID[rack.modelId];
      const powered = status === 'online';
      if (powered) racksOnline += 1;
      const n = Math.max(1, topo.gpuUids.length);
      const fanK = (powered ? topo.fanCooling : 0) + spill;
      let rackHash = 0;
      let rackMax = 0;
      let preheating = 0;
      topo.gpuUids.forEach((uid) => {
        const g = w.gpus[uid];
        const model = GPU_BY_ID[g.modelId];
        const running = powered && !g.shutdown;
        const clustered = cluster.has(uid);
        // Arctic: a die that sat cold and off has condensation; powered again, it runs its heater strip
        // (fans off, no hashing) until it is dry. A working die never condenses, however cold it runs.
        if (roomId !== 'arctic') g.condensed = false;
        else if (!running && g.temp < arctic.dewTemp) g.condensed = true;
        const preheat = running && g.condensed;
        if (preheat) preheating += 1;
        // The Cluster Bonus trims the electrical draw (pass 1), not the heat of the die.
        const powerMul = ocPowerMul(gpuOc(g));
        const heat = !running ? 0 : preheat ? preheatWatts(model.power) : model.power * powerMul * mods.heatMul * rackModel.heatMul * brownout;
        const k = preheat
          ? PHYSICS.baseCooling * pasteFactor(g.paste) * room.coolingMul
          : (PHYSICS.baseCooling + fanK / n) * pasteFactor(g.paste) * room.coolingMul * mods.coolingMul * crewCooling;
        const tEq = roomTemp + heat / k;
        const tempBefore = g.temp;
        g.temp = tEq + (g.temp - tEq) * Math.exp((-k * dt) / model.thermalMass);
        if (preheat && g.temp >= arctic.dryTemp) g.condensed = false;

        if (!g.shutdown && g.temp >= PHYSICS.shutdownTemp) {
          g.shutdown = true;
          acc.overheats += 1;
          acc.messages.push(gameMsg('bad', 'THERMAL SHUTDOWN: {name} hit {temp}°C!', { name: model.name, temp: g.temp.toFixed(0) }));
          acc.sounds.push('shutdown');
          pushRackFx(acc, opts, { kind: 'shutdown', rackUid: rack.uid, value: g.temp });
        } else if (g.shutdown && g.temp <= PHYSICS.restartTemp) {
          g.shutdown = false;
          acc.messages.push(gameMsg('info', '{name} cooled down and restarted.', { name: model.name }));
          acc.sounds.push('restart');
        }

        // Re-evaluate after the thermal protection check: a GPU that just shut down stops hashing now.
        const active = powered && !g.shutdown;
        const hashing = active && !preheat;
        const throttled = hashing && g.temp > PHYSICS.throttleTemp;
        if (active && g.temp > PHYSICS.wearTemp) {
          if (tempBefore <= PHYSICS.wearTemp) pushRackFx(acc, opts, { kind: 'hot', rackUid: rack.uid, value: g.temp });
          g.overheatSeconds += dt;
          g.wear = Math.min(PHYSICS.maxWear, g.wear + (PHYSICS.wearPerMinute * dt) / 60);
        }
        if (active) g.paste = Math.max(0, g.paste - dt / pasteLife);
        if (techPaste > 0) g.paste = Math.min(1, g.paste + techPaste * dt);
        if (techRepair > 0 && g.wear > 0) g.wear = Math.max(0, g.wear - techRepair * dt);
        // Smart BMC: maintenance by threshold, at the normal price, as long as the cash is there.
        if (bmcOn) {
          if (input.bmc.autoPaste && g.paste < input.bmc.pasteBelow) {
            const cost = repasteCost(g);
            if (w.cash >= cost) {
              w.cash -= cost;
              g.paste = 1;
              acc.bmcPasted += 1;
              acc.bmcSpent += cost;
            }
          }
          if (input.bmc.autoRepair && g.wear > 0 && gpuHealth(g) < input.bmc.healthBelow) {
            const cost = repairCost(g);
            if (w.cash >= cost) {
              w.cash -= cost;
              g.wear = 0;
              g.overheatSeconds = 0;
              acc.bmcRepaired += 1;
              acc.bmcSpent += cost;
            }
          }
        }

        const oc = rules.lockOverclock ? 0 : g.ocBonus;
        const hash = hashing
          ? model.hashrate * (1 + (oc > 0 ? oc * ocShare : oc)) * (clustered ? 1 + SYNERGY.clusterHash : 1) * (throttled ? 0.5 : 1) * (1 - g.wear) * brownout * mods.hashMul * surge
          : 0;
        rackHash += hash;
        rackMax = Math.max(rackMax, g.temp);
        hottest = Math.max(hottest, g.temp);
        if (hashing) {
          tempSum += g.temp;
          tempCount += 1;
        }
        roomHeat += heat;
        live.gpus[uid] = { hash, running: active, throttled, heat, load: active ? clamp(heat / model.power, 0, 2) : 0, clustered: clustered && hashing, preheating: preheat && active };
      });
      roomHeat += load > 0 ? topo.fanPower + (wall - load) : 0;
      roomHash += rackHash;
      if (rackHash > topRack.hash) {
        topRack.uid = rack.uid;
        topRack.hash = rackHash;
      }
      const allShutdown = powered && topo.gpuUids.length > 0 && topo.gpuUids.every((u) => w.gpus[u].shutdown);
      live.racks[rack.uid] = {
        status: allShutdown ? 'overheat' : status,
        load,
        wall,
        capacity: topo.capacity,
        hash: rackHash,
        maxTemp: rackMax,
        cooling: (PHYSICS.baseCooling * n + fanK) * room.coolingMul * mods.coolingMul * crewCooling,
        tariff,
        powerCost: wall * paidShare * tariff * price,
        clustered: powered ? cluster.size : 0,
        spill,
        idle,
        preheating,
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
      noise,
      ocCapped,
      wave,
      valley,
      gpuCap: room.maxGpus ?? null,
      gpusOverCap: overCap,
    };
  });

  // ── Mining yield ──
  const pool = POOLS[input.pool];
  const poolMul = poolYieldMul(input.pool);
  const diffOf = (coin: MineableCoin): number => eventDifficulty(coin) * hashDifficulty(coin, totalHash);
  const rateOf = (coin: MineableCoin): number => ((totalHash / 1e6) * coinPerMHs(coin)) / diffOf(coin);
  const baseRate = rateOf(coinId);
  let gain = 0;
  if (input.pool === 'public') {
    gain = baseRate * (1 - pool.fee) * dt;
  } else if (input.pool === 'solo') {
    if (opts.offline) gain = baseRate * pool.payoutMul * dt;
    else if (baseRate > 0 && Math.random() < dt / PHYSICS.soloBlockMeanSec) {
      gain = baseRate * PHYSICS.soloBlockMeanSec * pool.payoutMul * blockMulOf(input.buffs, now);
      acc.blocks += 1;
      if (topRack.uid) pushRackFx(acc, opts, { kind: 'block', rackUid: topRack.uid, value: gain, coin: coinId });
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
  live.avgTemp = tempCount > 0 ? tempSum / tempCount : 0;
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
  const acc: StepAccumulator = { ccMined: 0, coinMined: 0, electricity: 0, earnedCash: 0, gems: 0, blocks: 0, raids: 0, overheats: 0, bestTrade: 0, peakTemp: 0, botEarned: 0, messages: [], sounds: [], rackFx: [], bmcPasted: 0, bmcRepaired: 0, bmcSpent: 0 };
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

  if (!opts.offline && acc.bmcPasted + acc.bmcRepaired > 0) {
    acc.messages.push(gameMsg('info', 'SMART BMC: {paste} re-pasted, {repair} repaired (-${cost}).', { paste: acc.bmcPasted, repair: acc.bmcRepaired, cost: acc.bmcSpent.toFixed(0) }));
  }

  const gpuUpdates: Record<string, GpuThermalUpdate> = {};
  Object.values(w.gpus).forEach((g) => {
    gpuUpdates[g.uid] = { temp: g.temp, wear: g.wear, paste: g.paste, shutdown: g.shutdown, overheatSeconds: g.overheatSeconds, condensed: g.condensed };
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
    rackFx: acc.rackFx,
    bmc: { pasted: acc.bmcPasted, repaired: acc.bmcRepaired, spent: acc.bmcSpent },
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
