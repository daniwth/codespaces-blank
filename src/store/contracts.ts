/**
 * Contracts board — pure logic (no React / Zustand / DOM).
 *
 * Where progress is tracked: on the main thread, from each merged SimOutput.
 * The board is deliberately NOT part of SimInput: the player claims and rerolls
 * contracts at any time, and a worker answer computed from an older snapshot
 * would otherwise revert those edits (the same race `editLedger` solves for GPU
 * fields). Instead the simulation reports per-tick *facts* that only it can know
 * (coins mined, realized profit, bot profit, blocks, shutdowns, the hottest die
 * at any integration step) and this module folds them into the board as deltas,
 * exactly once per tick. Gauges (hashrate, running GPUs) read the tick's live
 * metrics.
 *
 * Rules:
 * - Earnings-based goals only count realized profit over the coins' cost basis
 *   (`earnedCash` / `botEarned` from `realizedEarnings`), so buy→sell wash
 *   trading cannot fill them. $CC deliveries count mined coins only (sold or
 *   held); coins bought on the market never count.
 * - Accumulated progress is pro-rated to the part of the tick window that lies
 *   inside the contract's lifetime, so a long offline gap cannot credit income
 *   earned after the deadline.
 * - Offline time never counts for "keep under X °C" (the offline integrator uses
 *   coarse steps and has no heatwaves): the streak resets to zero. It also voids
 *   the network event being watched by "survive an event".
 * - Completed contracts never expire; active ones expire at their deadline and
 *   the slot is refilled after CONTRACTS.refillSec.
 */
import {
  CONTRACT_DEFS,
  CONTRACT_DIFFICULTY,
  CONTRACT_KINDS,
  CONTRACTS,
  GPU_TIER_PRICE_SHARE,
  KEEP_COOL_RANGE,
  KEEP_COOL_STREAK_MIN,
} from '../config/contracts';
import { MARKET, PHYSICS, POOLS, levelFromEarnings } from '../config/gameBalance';
import { GPU_BY_ID, GPU_CATALOG } from '../config/hardwareCatalog';
import { talentModifiers } from '../config/prestigeTree';
import type { Contract, ContractBoard, ContractDifficulty, ContractKind, ContractReward, EventWatch } from '../types/contracts';
import type { ActiveNetworkEvent } from '../types/economy';
import type { GameData } from '../types/player';
import { bnToNumber } from '../utils/bignum';
import { formatCash, formatDuration, formatHashrate, formatNumber } from '../utils/formatters';
import { clamp } from '../utils/random';
import type { LiveMetrics } from './gamePhysics';

export type Rng = () => number;

// ───────────────────────── Context (progress scaling) ─────────────────────────

/** Snapshot of the player's progress used to scale new contracts. */
export interface ContractContext {
  /** Reference hashrate (H/s). */
  hash: number;
  /** Expected $CC per second at that hashrate in the current pool. */
  ccPerSec: number;
  /** Estimated net income ($/s) after the power bill. */
  incomePerSec: number;
  /** Hottest die right now (°C), 0 when unknown. */
  hottest: number;
  level: number;
  /** Best GPU tier owned (0 = none). */
  bestTier: number;
  /** Tiers of the GPUs currently running (or mounted, without live data). */
  runningTiers: number[];
}

export type ContractDataView = Pick<GameData, 'gpus' | 'racks' | 'pool' | 'lifetimeEarnings' | 'talents'>;

function mountedGpuUids(data: Pick<GameData, 'gpus' | 'racks'>): string[] {
  const out: string[] = [];
  Object.values(data.racks).forEach((r) => {
    if (!r.roomId) return;
    r.gpuSlots.forEach((u) => {
      if (u && data.gpus[u]) out.push(u);
    });
  });
  return out;
}

/** Tiers of the GPUs that are mounted in a placed rack and actually hashing this tick. */
export function runningGpuTiers(data: Pick<GameData, 'gpus' | 'racks'>, live: LiveMetrics): number[] {
  return mountedGpuUids(data)
    .filter((u) => live.gpus[u]?.running)
    .map((u) => GPU_BY_ID[data.gpus[u].modelId]?.tier ?? 0);
}

export function contractContext(data: ContractDataView, live?: LiveMetrics): ContractContext {
  const mounted = mountedGpuUids(data);
  const mods = talentModifiers(data.talents);
  let hash: number;
  let runningTiers: number[];
  let hottest = 0;
  if (live && live.totalHash > 0) {
    hash = live.totalHash;
    runningTiers = runningGpuTiers(data, live);
    hottest = live.hottest;
  } else {
    hash = mounted.reduce((acc, u) => {
      const g = data.gpus[u];
      const model = GPU_BY_ID[g.modelId];
      return acc + (model ? model.hashrate * (1 + g.ocBonus) * (1 - g.wear) * mods.hashMul : 0);
    }, 0);
    runningTiers = mounted.map((u) => GPU_BY_ID[data.gpus[u].modelId]?.tier ?? 0);
  }
  hash = Math.max(CONTRACTS.minHash, hash);
  const pool = POOLS[data.pool];
  const ccPerSec = (hash / 1e6) * PHYSICS.rewardPerMHs * (data.pool === 'public' ? 1 - pool.fee : pool.payoutMul);
  const bestTier = Object.values(data.gpus).reduce((acc, g) => Math.max(acc, GPU_BY_ID[g.modelId]?.tier ?? 0), 0);
  return {
    hash,
    ccPerSec,
    incomePerSec: Math.max(CONTRACTS.minIncomePerSec, ccPerSec * MARKET.cc.base * CONTRACTS.netIncomeShare),
    hottest,
    level: levelFromEarnings(bnToNumber(data.lifetimeEarnings)),
    bestTier,
    runningTiers,
  };
}

// ───────────────────────── Generation ─────────────────────────

/** Round up to two significant figures (1234 → 1300, 0.0456 → 0.046). */
export function niceCeil(x: number): number {
  if (!(x > 0) || !Number.isFinite(x)) return 0;
  const p = 10 ** (Math.floor(Math.log10(x)) - 1);
  return Number((Math.ceil(x / p - 1e-9) * p).toPrecision(2));
}

function weighted<T>(items: { item: T; weight: number }[], rng: Rng): T {
  const total = items.reduce((a, i) => a + i.weight, 0);
  let roll = rng() * total;
  for (const i of items) {
    roll -= i.weight;
    if (roll <= 0) return i.item;
  }
  return items[items.length - 1].item;
}

const gpuOfTier = (tier: number) => GPU_CATALOG.find((m) => m.tier === clamp(tier, 1, GPU_CATALOG.length)) ?? GPU_CATALOG[0];

let idCounter = 0;
const contractId = (now: number, rng: Rng): string => {
  idCounter += 1;
  return `ct-${now.toString(36)}-${idCounter.toString(36)}${Math.floor(rng() * 36 ** 4).toString(36)}`;
};

export function eligibleKinds(ctx: ContractContext): ContractKind[] {
  return CONTRACT_KINDS.filter((k) => ctx.level >= CONTRACT_DEFS[k].minLevel);
}

/** Procedurally generate one contract scaled to `ctx`, avoiding the kinds in `exclude` when possible. */
export function generateContract(
  ctx: ContractContext,
  now: number,
  exclude: readonly ContractKind[] = [],
  rng: Rng = Math.random,
  forced?: { kind?: ContractKind; difficulty?: ContractDifficulty },
): Contract {
  const eligible = eligibleKinds(ctx);
  const fresh = eligible.filter((k) => !exclude.includes(k));
  const pool = fresh.length ? fresh : eligible;
  const kind = forced?.kind ?? weighted(pool.map((k) => ({ item: k, weight: CONTRACT_DEFS[k].weight })), rng);
  const difficulty = forced?.difficulty
    ?? weighted(([1, 2, 3] as const).map((d) => ({ item: d, weight: CONTRACT_DIFFICULTY[d].weight })), rng);
  const def = CONTRACT_DEFS[kind];
  const diff = CONTRACT_DIFFICULTY[difficulty];
  const i = difficulty - 1;
  const durSec = def.minutes[i] * 60;
  const scale = def.scale[i];

  let target = 1;
  let param = 0;
  let minHash = 0;
  let cash = ctx.incomePerSec * durSec * def.rewardShare[i];
  switch (kind) {
    case 'deliver_cc':
      target = niceCeil(ctx.ccPerSec * durSec * scale);
      break;
    case 'earn_profit':
      target = niceCeil(ctx.incomePerSec * durSec * scale);
      break;
    case 'bot_profit':
      target = niceCeil(ctx.incomePerSec * scale);
      break;
    case 'reach_hash':
      target = niceCeil(ctx.hash * scale);
      break;
    case 'keep_cool': {
      const ref = ctx.hottest > 0 ? ctx.hottest : 75;
      param = clamp(Math.floor((ref - scale) / 5) * 5, KEEP_COOL_RANGE[0], KEEP_COOL_RANGE[1]);
      target = KEEP_COOL_STREAK_MIN[i] * 60;
      minHash = ctx.hash * CONTRACTS.keepCoolMinHashShare;
      break;
    }
    case 'gpu_tier': {
      const tier = Math.max(1, difficulty === 1 ? ctx.bestTier - 1 : ctx.bestTier);
      const have = ctx.runningTiers.filter((t) => t >= tier).length;
      param = tier;
      target = have + scale;
      cash += gpuOfTier(tier).price * scale * GPU_TIER_PRICE_SHARE;
      break;
    }
    case 'solo_block':
    case 'survive_event':
      target = scale;
      break;
    default:
      break;
  }

  const reward: ContractReward = { cash: 0, gems: 0, gpuModelId: null };
  if (rng() < diff.gemChance) reward.gems = diff.gems + (rng() < diff.bonusGemChance ? 1 : 0);
  if (rng() < diff.gpuChance) {
    reward.gpuModelId = gpuOfTier(Math.max(1, ctx.bestTier + diff.gpuTierOffset)).id;
    cash /= 2;
  }
  reward.cash = Math.max(CONTRACTS.minCashReward, niceCeil(cash));

  return {
    id: contractId(now, rng),
    kind,
    difficulty,
    createdAt: now,
    expiresAt: now + durSec * 1000,
    target: target > 0 ? target : 1,
    progress: 0,
    param,
    minHash,
    watch: null,
    completedAt: null,
    reward,
  };
}

export function createBoard(ctx: ContractContext, now: number, rng: Rng = Math.random): ContractBoard {
  return refillBoard({ slots: [], nextRefillAt: 0, rerollReadyAt: 0 }, ctx, now, rng).board;
}

/** Fill empty slots whose refill time has come. */
export function refillBoard(board: ContractBoard, ctx: ContractContext, now: number, rng: Rng = Math.random): { board: ContractBoard; added: Contract[] } {
  if (board.slots.length >= CONTRACTS.slots || now < board.nextRefillAt) return { board, added: [] };
  const slots = board.slots.slice();
  const added: Contract[] = [];
  let next = board.nextRefillAt;
  while (slots.length < CONTRACTS.slots && now >= next) {
    const c = generateContract(ctx, now, slots.map((s) => s.kind), rng);
    slots.push(c);
    added.push(c);
    next += CONTRACTS.refillSec * 1000;
  }
  return { board: { ...board, slots, nextRefillAt: next }, added };
}

/** Remove a contract; a full board starts its refill countdown now. */
export function removeContract(board: ContractBoard, id: string, now: number): ContractBoard {
  const wasFull = board.slots.length >= CONTRACTS.slots;
  return {
    ...board,
    slots: board.slots.filter((c) => c.id !== id),
    nextRefillAt: wasFull ? now + CONTRACTS.refillSec * 1000 : board.nextRefillAt,
  };
}

/** Reroll price: about two minutes of the farm's estimated net income. */
export const rerollCost = (ctx: ContractContext): number =>
  Math.max(CONTRACTS.rerollMinCost, niceCeil(ctx.incomePerSec * CONTRACTS.rerollIncomeSec));

// ───────────────────────── Progress ─────────────────────────

/** Per-tick facts reported by the simulation (plus the live gauges after it). */
export interface ContractFacts {
  /** Simulated window [start, end] in epoch ms. */
  start: number;
  end: number;
  offline: boolean;
  ccMined: number;
  /** Realized profit from sim-side sells (bots, VIP auto-sell). */
  earnedCash: number;
  botEarned: number;
  blocksFound: number;
  overheats: number;
  peakTemp: number;
  totalHash: number;
  event: ActiveNetworkEvent | null;
  runningTiers: number[];
}

/** Share of the tick window that falls inside the contract's lifetime (0-1). */
export function windowShare(c: Pick<Contract, 'createdAt' | 'expiresAt'>, start: number, end: number): number {
  if (end <= start) return end >= c.createdAt && end < c.expiresAt ? 1 : 0;
  const overlap = Math.min(end, c.expiresAt) - Math.max(start, c.createdAt);
  return clamp(overlap / (end - start), 0, 1);
}

function stepWatch(c: Contract, f: ContractFacts): { watch: EventWatch | null; survived: number } {
  if (f.offline) {
    // Offline time voids the event in progress: it can no longer be "survived".
    return { watch: f.event ? { startedAt: f.event.startedAt, clean: false, sawHash: false } : null, survived: 0 };
  }
  let watch = c.watch;
  let survived = 0;
  if (watch && (!f.event || f.event.startedAt !== watch.startedAt)) {
    if (watch.clean && watch.sawHash) survived = 1;
    watch = null;
  }
  if (f.event && !watch && f.event.startedAt >= c.createdAt && f.event.startedAt < c.expiresAt) {
    watch = { startedAt: f.event.startedAt, clean: true, sawHash: false };
  }
  if (watch && f.event && f.event.startedAt === watch.startedAt) {
    watch = { ...watch, clean: watch.clean && f.overheats === 0, sawHash: watch.sawHash || f.totalHash > 0 };
  }
  return { watch, survived };
}

function progressed(c: Contract, f: ContractFacts, share: number): Contract {
  const next: Contract = { ...c };
  switch (c.kind) {
    case 'deliver_cc':
      next.progress += f.ccMined * share;
      break;
    case 'earn_profit':
      next.progress += f.earnedCash * share;
      break;
    case 'bot_profit':
      next.progress += f.botEarned * share;
      break;
    case 'solo_block':
      if (share > 0) next.progress += f.blocksFound;
      break;
    case 'reach_hash':
      if (share > 0) next.progress = f.totalHash;
      break;
    case 'gpu_tier':
      if (share > 0) next.progress = f.runningTiers.filter((t) => t >= c.param).length;
      break;
    case 'keep_cool': {
      const ok = !f.offline && f.peakTemp > 0 && f.peakTemp < c.param && f.totalHash >= c.minHash;
      next.progress = ok ? next.progress + ((f.end - f.start) / 1000) * share : 0;
      break;
    }
    case 'survive_event': {
      const { watch, survived } = stepWatch(c, f);
      next.watch = watch;
      next.progress += survived;
      break;
    }
    default:
      break;
  }
  return next;
}

export interface AdvanceResult {
  board: ContractBoard;
  completed: Contract[];
  expired: Contract[];
}

/** Fold one tick of simulation facts into the board. */
export function advanceContracts(board: ContractBoard, f: ContractFacts): AdvanceResult {
  const completed: Contract[] = [];
  const expired: Contract[] = [];
  const slots: Contract[] = [];
  board.slots.forEach((c) => {
    if (c.completedAt !== null) {
      slots.push(c);
      return;
    }
    const next = f.end < c.createdAt ? c : progressed(c, f, windowShare(c, f.start, f.end));
    if (next.progress >= next.target && f.start < next.expiresAt) {
      const done = { ...next, progress: next.target, completedAt: Math.min(f.end, next.expiresAt), watch: null };
      completed.push(done);
      slots.push(done);
    } else if (f.end >= next.expiresAt) {
      expired.push(next);
    } else {
      slots.push(next);
    }
  });
  const wasFull = board.slots.length >= CONTRACTS.slots;
  const nextRefillAt = expired.length && wasFull ? f.end + CONTRACTS.refillSec * 1000 : board.nextRefillAt;
  return { board: { ...board, slots, nextRefillAt }, completed, expired };
}

/** Credit realized profit from a manual market sale (never the gross proceeds). */
export function creditProfit(board: ContractBoard, amount: number, now: number): { board: ContractBoard; completed: Contract[] } {
  if (!(amount > 0)) return { board, completed: [] };
  const completed: Contract[] = [];
  const slots = board.slots.map((c) => {
    if (c.kind !== 'earn_profit' || c.completedAt !== null || now < c.createdAt || now >= c.expiresAt) return c;
    const next = { ...c, progress: c.progress + amount };
    if (next.progress < next.target) return next;
    const done = { ...next, progress: next.target, completedAt: now };
    completed.push(done);
    return done;
  });
  return { board: { ...board, slots }, completed };
}

// ───────────────────────── Text ─────────────────────────

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

export function contractGoal(c: Contract): string {
  switch (c.kind) {
    case 'deliver_cc':
      return `Mine ${formatNumber(c.target)} $CC (sold or held)`;
    case 'earn_profit':
      return `Realize ${formatCash(c.target)} of trading profit`;
    case 'bot_profit':
      return `Earn ${formatCash(c.target)} profit from trading bots`;
    case 'reach_hash':
      return `Reach ${formatHashrate(c.target)} of hashrate`;
    case 'keep_cool':
      return `Keep every die under ${c.param}°C for ${formatDuration(c.target)}`;
    case 'gpu_tier':
      return `Run ${plural(c.target, 'GPU')} of tier ${c.param}+ at once`;
    case 'solo_block':
      return `Find ${plural(c.target, 'solo block')}`;
    case 'survive_event':
      return `Survive ${plural(c.target, 'network event')} with no thermal shutdown`;
    default:
      return '';
  }
}

export function contractHint(c: Contract): string {
  switch (c.kind) {
    case 'deliver_cc':
      return 'Only mined coins count; bought $CC does not.';
    case 'earn_profit':
      return 'Only profit over what you paid for the coins counts.';
    case 'bot_profit':
      return 'Realized profit from bot sells (Market tab).';
    case 'reach_hash':
      return 'Live hashrate, measured every tick.';
    case 'keep_cool':
      return `Streak needs ${formatHashrate(c.minHash)}+ running. Offline time resets it.`;
    case 'gpu_tier':
      return `Tier ${c.param}: ${gpuOfTier(c.param).name} or better, mounted and hashing.`;
    case 'solo_block':
      return 'Switch to the Solo pool (Pools tab).';
    case 'survive_event':
      return 'From the start of an event to its end. Offline time voids it.';
    default:
      return '';
  }
}

export function contractProgressText(c: Contract): string {
  const p = Math.min(c.progress, c.target);
  switch (c.kind) {
    case 'deliver_cc':
      return `${formatNumber(p)} / ${formatNumber(c.target)} $CC`;
    case 'earn_profit':
    case 'bot_profit':
      return `${formatCash(p)} / ${formatCash(c.target)}`;
    case 'reach_hash':
      return `${formatHashrate(p)} / ${formatHashrate(c.target)}`;
    case 'keep_cool':
      return `${formatDuration(p)} / ${formatDuration(c.target)}`;
    default:
      return `${Math.floor(p)} / ${c.target}`;
  }
}

// ───────────────────────── Save sanitizing ─────────────────────────

type Json = Record<string, unknown>;
const isObject = (v: unknown): v is Json => typeof v === 'object' && v !== null && !Array.isArray(v);
const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);

function sanitizeContract(raw: unknown): Contract | null {
  if (!isObject(raw)) return null;
  const kind = raw.kind as ContractKind;
  if (!CONTRACT_KINDS.includes(kind)) return null;
  const difficulty = raw.difficulty === 1 || raw.difficulty === 2 || raw.difficulty === 3 ? raw.difficulty : null;
  const createdAt = num(raw.createdAt);
  const expiresAt = num(raw.expiresAt);
  const target = num(raw.target);
  if (!difficulty || createdAt === null || expiresAt === null || target === null || target <= 0 || expiresAt <= createdAt) return null;
  if (typeof raw.id !== 'string' || !raw.id || raw.id.length > 64) return null;
  const reward = isObject(raw.reward) ? raw.reward : {};
  const gpu = typeof reward.gpuModelId === 'string' && GPU_BY_ID[reward.gpuModelId] ? reward.gpuModelId : null;
  const w = isObject(raw.watch) ? raw.watch : null;
  const watchStart = w ? num(w.startedAt) : null;
  return {
    id: raw.id,
    kind,
    difficulty,
    createdAt,
    expiresAt,
    target,
    progress: clamp(num(raw.progress) ?? 0, 0, target),
    param: num(raw.param) ?? 0,
    minHash: Math.max(0, num(raw.minHash) ?? 0),
    watch: w && watchStart !== null ? { startedAt: watchStart, clean: w.clean === true, sawHash: w.sawHash === true } : null,
    completedAt: num(raw.completedAt),
    reward: {
      cash: Math.max(0, num(reward.cash) ?? 0),
      gems: clamp(Math.floor(num(reward.gems) ?? 0), 0, 10),
      gpuModelId: gpu,
    },
  };
}

/** Rebuild a persisted board defensively; anything unusable becomes a fresh board. */
export function sanitizeBoard(raw: unknown, ctx: ContractContext, now: number): ContractBoard {
  if (!isObject(raw) || !Array.isArray(raw.slots)) return createBoard(ctx, now);
  const seen = new Set<string>();
  const slots = raw.slots
    .map(sanitizeContract)
    .filter((c): c is Contract => {
      if (!c || seen.has(c.id)) return false;
      seen.add(c.id);
      return true;
    })
    .slice(0, CONTRACTS.slots);
  return {
    slots,
    nextRefillAt: num(raw.nextRefillAt) ?? 0,
    rerollReadyAt: clamp(num(raw.rerollReadyAt) ?? 0, 0, now + CONTRACTS.rerollCooldownSec * 1000),
  };
}
