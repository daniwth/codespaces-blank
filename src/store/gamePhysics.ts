/**
 * Pure simulation layer. No React, no Zustand, no DOM: it runs identically in
 * the Web Worker and on the main thread (fallback / offline resolution).
 *
 * Thermal model (per GPU):   ΔT = ((Q_gen − Q_dis) / C) · Δt,  Q_dis = k · (T − T_amb)
 * Integrated analytically so large Δt (background tabs, offline progress) stay stable:
 *   T(t+Δt) = T_eq + (T − T_eq) · e^(−kΔt / C),  T_eq = T_amb + Q_gen / k
 */
import { COOLER_BY_ID, GPU_BY_ID, OC_LIMITS, PSU_BY_ID, RACK_BY_ID } from '../config/hardwareCatalog';
import { ROOM_BY_ID } from '../config/roomsCatalog';
import { talentModifiers, type TalentModifiers } from '../config/prestigeTree';
import {
  EVENT_EFFECTS,
  EVENT_INTERVAL,
  MARKET,
  NETWORK_EVENTS,
  PHYSICS,
  POOLS,
} from '../config/gameBalance';
import type { ActiveNetworkEvent, CoinId, MarketState, NetworkEventId } from '../types/economy';
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
  | 'cash' | 'cc' | 'ccCostBasis' | 'meme' | 'memeCostBasis' | 'lastTick'
>;

export type MessageTone = 'info' | 'good' | 'warn' | 'bad';
export type SoundCue = 'block' | 'alarm' | 'raid' | 'event' | 'shutdown' | 'sell' | 'restart';

export interface GameMessage {
  text: string;
  tone: MessageTone;
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

export interface LiveMetrics {
  totalHash: number;
  ccPerSec: number;
  electricityPerSec: number;
  difficulty: number;
  hottest: number;
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
  memeDelta: number;
  memeCostDelta: number;
  ccCostDelta: number;
  gemsDelta: number;
  earnedCash: number;
  ccMined: number;
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

export const pasteFactor = (paste: number): number =>
  PHYSICS.pasteMinFactor + (1 - PHYSICS.pasteMinFactor) * clamp(paste, 0, 1);

// ───────────────────────── Market helpers ─────────────────────────

export const sellPrice = (market: MarketState, coin: CoinId, mods: TalentModifiers): number =>
  market[coin].price * (1 + mods.sellBonus) * (1 - MARKET.fee);

export const buyPrice = (market: MarketState, coin: CoinId): number => market[coin].price * (1 + MARKET.fee);

function stepMarket(market: MarketState, dt: number, now: number, event: ActiveNetworkEvent | null, messages: GameMessage[], offline: boolean): void {
  (['CC', 'MEME'] as const).forEach((id) => {
    const coin = market[id];
    const cfg = id === 'CC' ? MARKET.cc : MARKET.meme;
    const mean = coin.basePrice * (id === 'CC' && event?.id === 'bull_run' ? EVENT_EFFECTS.bullMeanMul : 1);
    const sigma = cfg.sigma * (id === 'MEME' && event?.id === 'meme_mania' ? EVENT_EFFECTS.memeVolMul : 1);
    let logP = Math.log(coin.price);
    logP += cfg.theta * (Math.log(mean) - logP) * dt + sigma * Math.sqrt(dt) * gaussian();
    // $MEME pump & dump jumps
    if (id === 'MEME' && !offline && Math.random() < dt / 150) {
      const jump = Math.random() < 0.5 ? randRange(0.45, 0.75) : randRange(1.4, 2.6);
      logP += Math.log(jump);
      messages.push({ text: jump > 1 ? '$MEME PUMP! Whales are buying.' : '$MEME DUMP! Paper hands everywhere.', tone: jump > 1 ? 'good' : 'warn' });
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
    market: {
      CC: { ...input.market.CC, candles: input.market.CC.candles.slice(), current: { ...input.market.CC.current } },
      MEME: { ...input.market.MEME, candles: input.market.MEME.candles.slice(), current: { ...input.market.MEME.current } },
    },
    event: input.event ? { ...input.event } : null,
    nextEventAt: input.nextEventAt,
    botFires,
    cash: bnToNumber(input.cash),
    cc: bnToNumber(input.cc),
    meme: input.meme,
    memeCost: input.memeCostBasis,
    ccCost: input.ccCostBasis,
  };
}

function emptyLive(): LiveMetrics {
  return { totalHash: 0, ccPerSec: 0, electricityPerSec: 0, difficulty: 1, hottest: 0, rooms: {}, racks: {}, gpus: {} };
}

interface StepAccumulator {
  ccMined: number;
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

function sellCoin(w: World, coin: CoinId, amount: number, mods: TalentModifiers, acc: StepAccumulator): number {
  if (amount <= 0) return 0;
  const proceeds = amount * sellPrice(w.market, coin, mods);
  if (coin === 'CC') {
    const { earned, basis } = realizedEarnings(proceeds, w.cc, w.ccCost, amount);
    w.ccCost -= basis;
    w.cc -= amount;
    acc.earnedCash += earned;
  } else {
    const { earned, basis } = realizedEarnings(proceeds, w.meme, w.memeCost, amount);
    w.memeCost -= basis;
    w.meme -= amount;
    acc.bestTrade = Math.max(acc.bestTrade, proceeds - basis);
    acc.earnedCash += earned;
  }
  w.cash += proceeds;
  return proceeds;
}

function buyCoin(w: World, coin: CoinId, cashAmount: number): number {
  if (cashAmount <= 0) return 0;
  const qty = cashAmount / buyPrice(w.market, coin);
  w.cash -= cashAmount;
  if (coin === 'CC') {
    w.cc += qty;
    w.ccCost += cashAmount;
  } else {
    w.meme += qty;
    w.memeCost += cashAmount;
  }
  return qty;
}

function stepEvents(w: World, input: SimInput, now: number, acc: StepAccumulator): void {
  if (w.event && now >= w.event.endsAt) {
    acc.messages.push({ text: `Network event ended: ${NETWORK_EVENTS[w.event.id].name}.`, tone: 'info' });
    w.event = null;
    w.nextEventAt = now + randRange(EVENT_INTERVAL[0], EVENT_INTERVAL[1]) * 1000;
  }
  if (!w.event && now >= w.nextEventAt) {
    const pool: NetworkEventId[] = ['difficulty_spike', 'heatwave', 'cold_snap', 'bull_run', 'meme_mania', 'blackout'];
    const id = pick(pool);
    const def = NETWORK_EVENTS[id];
    const duration = randRange(def.duration[0], def.duration[1]) * 1000;
    const roomId = id === 'blackout' ? pick(input.ownedRooms) : null;
    w.event = { id, startedAt: now, endsAt: now + duration, roomId };
    acc.messages.push({
      text: `NETWORK EVENT: ${def.name}${roomId ? ` (${ROOM_BY_ID[roomId].name})` : ''}. ${def.description}`,
      tone: def.positive ? 'good' : 'bad',
    });
    acc.sounds.push('event');
  }
}

function step(w: World, input: SimInput, dt: number, now: number, mods: TalentModifiers, opts: SimOptions, acc: StepAccumulator, live: LiveMetrics): void {
  if (!opts.offline) stepEvents(w, input, now, acc);
  const ev = opts.offline ? null : w.event;
  const ambientDelta = ev?.id === 'heatwave' ? EVENT_EFFECTS.heatwaveDelta : ev?.id === 'cold_snap' ? EVENT_EFFECTS.coldSnapDelta : 0;
  const difficulty = ev?.id === 'difficulty_spike' ? EVENT_EFFECTS.difficultyMul : 1;

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
  live.difficulty = difficulty;
  let totalHash = 0;
  let electricityRate = 0;
  let hottest = 0;

  const racksByRoom: Partial<Record<RoomId, RackInstance[]>> = {};
  Object.values(w.racks).forEach((r) => {
    if (!r.roomId) {
      live.racks[r.uid] = { status: 'stored', load: 0, wall: 0, capacity: 0, hash: 0, maxTemp: 0, cooling: 0 };
      return;
    }
    (racksByRoom[r.roomId] ??= []).push(r);
  });

  input.ownedRooms.forEach((roomId) => {
    const room = ROOM_BY_ID[roomId];
    const racks = racksByRoom[roomId] ?? [];
    const blackout = ev?.id === 'blackout' && ev.roomId === roomId;
    const baseAmbient = room.ambient + ambientDelta;
    const roomTemp = w.roomTemps[roomId] ?? baseAmbient;

    // Pass 1: rack power status
    const rackInfo = racks.map((rack) => {
      const topo = rackTopology(rack, { gpus: w.gpus, psus: input.psus, coolers: input.coolers });
      let status: RackStatus;
      let load = 0;
      if (topo.gpuUids.length === 0) status = 'empty';
      else if (!topo.hasPsu) status = 'no_psu';
      else if (blackout && !topo.selfPowered) status = 'blackout';
      else if (rack.rebootUntil > now) status = 'rebooting';
      else {
        load = topo.fanPower + topo.gpuUids.reduce((a, u) => {
          const g = w.gpus[u];
          return a + (g.shutdown ? 0 : GPU_BY_ID[g.modelId].power * ocPowerMul(g.oc));
        }, 0);
        status = load > topo.capacity ? 'overload' : 'online';
      }
      if (status !== 'online') load = 0;
      const wall = topo.selfPowered ? 0 : load / topo.efficiency;
      return { rack, topo, status, load, wall };
    });

    const roomWall = rackInfo.reduce((a, r) => a + r.wall, 0);
    const brownout = roomWall > room.maxPowerW ? room.maxPowerW / roomWall : 1;
    const paidWall = Math.min(roomWall, room.maxPowerW);
    const elecRate = paidWall * PHYSICS.pricePerWattSec * room.priceMul * mods.electricityMul;
    electricityRate += elecRate;

    let roomHeat = 0;
    let roomHash = 0;
    let racksOnline = 0;

    // Pass 2: thermals + hashrate
    rackInfo.forEach(({ rack, topo, status, load, wall }) => {
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
        const powerMul = ocPowerMul(g.oc);
        const heat = running ? model.power * powerMul * mods.heatMul * rackModel.heatMul * brownout : 0;
        const k = (PHYSICS.baseCooling + fanK / n) * pasteFactor(g.paste) * room.coolingMul;
        const tEq = roomTemp + heat / k;
        g.temp = tEq + (g.temp - tEq) * Math.exp((-k * dt) / model.thermalMass);

        if (!g.shutdown && g.temp >= PHYSICS.shutdownTemp) {
          g.shutdown = true;
          acc.overheats += 1;
          acc.messages.push({ text: `THERMAL SHUTDOWN: ${model.name} hit ${g.temp.toFixed(0)}°C!`, tone: 'bad' });
          acc.sounds.push('shutdown');
        } else if (g.shutdown && g.temp <= PHYSICS.restartTemp) {
          g.shutdown = false;
          acc.messages.push({ text: `${model.name} cooled down and restarted.`, tone: 'info' });
          acc.sounds.push('restart');
        }

        // Re-evaluate after the thermal protection check: a GPU that just shut down stops hashing now.
        const active = powered && !g.shutdown;
        const throttled = active && g.temp > PHYSICS.throttleTemp;
        if (active && g.temp > PHYSICS.wearTemp) {
          g.overheatSeconds += dt;
          g.wear = Math.min(PHYSICS.maxWear, g.wear + (PHYSICS.wearPerMinute * dt) / 60);
        }
        if (active) g.paste = Math.max(0, g.paste - dt / PHYSICS.pasteLifetimeSec);
        if (techPaste > 0) g.paste = Math.min(1, g.paste + techPaste * dt);
        if (techRepair > 0 && g.wear > 0) g.wear = Math.max(0, g.wear - techRepair * dt);

        const hash = active
          ? model.hashrate * (1 + g.ocBonus) * (throttled ? 0.5 : 1) * (1 - g.wear) * brownout * mods.hashMul
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
        cooling: (PHYSICS.baseCooling * n + topo.fanCooling) * room.coolingMul,
      };
    });

    // Room air temperature relaxes towards its heat-loaded target
    const target = baseAmbient + roomHeat * room.heatPerWatt;
    w.roomTemps[roomId] = roomTemp + (target - roomTemp) * (1 - Math.exp(-dt / PHYSICS.roomTau));
    totalHash += roomHash;
    live.rooms[roomId] = {
      load: rackInfo.reduce((a, r) => a + r.load, 0),
      wall: roomWall,
      capacity: room.maxPowerW,
      brownout,
      ambient: baseAmbient,
      temp: w.roomTemps[roomId] ?? baseAmbient,
      hash: roomHash,
      blackout,
      racksOnline,
    };
  });

  // ── Mining yield ──
  const baseRate = (totalHash / 1e6) * PHYSICS.rewardPerMHs / difficulty;
  const pool = POOLS[input.pool];
  let ccGain = 0;
  if (input.pool === 'public') {
    ccGain = baseRate * (1 - pool.fee) * dt;
  } else if (input.pool === 'solo') {
    if (opts.offline) ccGain = baseRate * pool.payoutMul * dt;
    else if (baseRate > 0 && Math.random() < dt / PHYSICS.soloBlockMeanSec) {
      ccGain = baseRate * PHYSICS.soloBlockMeanSec * pool.payoutMul;
      acc.blocks += 1;
      const gem = Math.random() < 0.3;
      if (gem) acc.gems += 1;
      acc.messages.push({ text: `BLOCK FOUND! Solo jackpot of ${ccGain.toFixed(2)} $CC${gem ? ' + 1 gem' : ''}!`, tone: 'good' });
      acc.sounds.push('block');
    }
  } else {
    ccGain = baseRate * pool.payoutMul * dt;
    if (!opts.offline && baseRate > 0 && Math.random() < dt / PHYSICS.darknetRaidMeanSec) {
      const fine = Math.min(Math.max(0, w.cash), Math.max(w.cash * 0.12, baseRate * w.market.CC.price * 90));
      w.cash -= fine;
      acc.raids += 1;
      const roomId = pick(input.ownedRooms);
      Object.values(w.racks).forEach((r) => {
        if (r.roomId === roomId) r.rebootUntil = now + PHYSICS.inspectionRebootMs;
      });
      acc.messages.push({ text: `RAID! Electrical inspection in ${ROOM_BY_ID[roomId].name}. Fined $${fine.toFixed(0)}, rigs offline 30s.`, tone: 'bad' });
      acc.sounds.push('raid');
    }
  }
  w.cc += ccGain;
  acc.ccMined += ccGain;

  // ── Electricity bill (auto-debits $CC when cash runs dry) ──
  let bill = electricityRate * dt;
  acc.electricity += bill;
  const fromCash = Math.min(bill, Math.max(0, w.cash));
  w.cash -= fromCash;
  bill -= fromCash;
  if (bill > 0 && w.cc > 0) {
    const ccNeeded = Math.min(w.cc, bill / w.market.CC.price);
    w.ccCost *= w.cc > 0 ? (w.cc - ccNeeded) / w.cc : 0;
    w.cc -= ccNeeded;
  }

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
      const holding = bot.coin === 'CC' ? w.cc : w.meme;
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
      acc.messages.push({ text: `BOT #${bot.id.slice(-3)} ${bot.side.toUpperCase()} ${bot.coin} @ ${coin.price.toFixed(4)}`, tone: 'info' });
      acc.sounds.push('sell');
    }
  });
  if (input.vip.autoSellPeaks && input.vip.autoSellEnabled && w.cc > 0 && w.market.CC.price >= w.market.CC.basePrice * MARKET.vipPeakThreshold) {
    sellCoin(w, 'CC', w.cc, mods, acc);
  }

  live.totalHash = totalHash;
  live.ccPerSec = baseRate * (input.pool === 'public' ? 1 - pool.fee : pool.payoutMul);
  live.electricityPerSec = electricityRate;
  live.hottest = hottest;
  acc.peakTemp = Math.max(acc.peakTemp, hottest);
}

/** Advance the world by `dtSec` seconds ending at `now` (epoch ms). */
export function simulate(input: SimInput, dtSec: number, now: number, opts: SimOptions): SimOutput {
  const w = cloneWorld(input);
  const mods = talentModifiers(input.talents);
  const acc: StepAccumulator = { ccMined: 0, electricity: 0, earnedCash: 0, gems: 0, blocks: 0, raids: 0, overheats: 0, bestTrade: 0, peakTemp: 0, botEarned: 0, messages: [], sounds: [] };
  const live = emptyLive();
  const cash0 = w.cash;
  const cc0 = w.cc;
  const meme0 = w.meme;
  const memeCost0 = w.memeCost;
  const ccCost0 = w.ccCost;
  const rebootBefore: Record<string, number> = {};
  Object.values(w.racks).forEach((r) => {
    rebootBefore[r.uid] = r.rebootUntil;
  });

  const total = Math.max(0, dtSec);
  const steps = Math.max(1, Math.ceil(total / opts.maxStep));
  const h = total / steps;
  const start = now - total * 1000;
  for (let i = 1; i <= steps; i += 1) {
    step(w, input, h, start + i * h * 1000, mods, opts, acc, live);
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
    memeDelta: w.meme - meme0,
    memeCostDelta: w.memeCost - memeCost0,
    ccCostDelta: w.ccCost - ccCost0,
    gemsDelta: acc.gems,
    earnedCash: acc.earnedCash,
    ccMined: acc.ccMined,
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
