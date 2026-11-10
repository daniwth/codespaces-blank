import { SAVE_VERSION } from '../config/gameBalance';
import { COOLER_BY_ID, GPU_BY_ID, OC_LIMITS, PSU_BY_ID, QUALITY_ORDER, RACK_BY_ID } from '../config/hardwareCatalog';
import { CHALLENGE_IDS, isChallengeId } from '../config/challenges';
import { ROOM_BY_ID } from '../config/roomsCatalog';
import { TALENT_BY_ID } from '../config/prestigeTree';
import type { CoinId, TradingBot } from '../types/economy';
import type { CoolerInstance, GpuInstance, PsuInstance, RackInstance, SiliconQuality } from '../types/hardware';
import type { ActiveChallenge, ChallengeRecords, GameData, RoomId, TalentId, TalentLevels } from '../types/player';
import { clamp } from '../utils/random';
import { contractContext, sanitizeBoard } from './contracts';
import { STOCK_OC } from './gamePhysics';
import { createInitialData } from './initialState';

type Json = Record<string, unknown>;

const isObject = (v: unknown): v is Json => typeof v === 'object' && v !== null && !Array.isArray(v);
const finite = (v: unknown, fallback: number): number => (typeof v === 'number' && Number.isFinite(v) ? v : fallback);
const str = (v: unknown): string | null => (typeof v === 'string' && v.length > 0 && v.length <= 128 ? v : null);

/** BigNum fields must be finite decimal strings (break_infinity throws otherwise). */
const BIGNUM_KEYS = ['cash', 'cc', 'runEarnings', 'lifetimeEarnings'] as const;
const BIGNUM_RE = /^-?(\d+\.?\d*|\.\d+)(e[+-]?\d+)?$/i;

/** Deep-merge `raw` over `defaults`, keeping only values whose type matches. */
function mergeTyped<T>(defaults: T, raw: unknown): T {
  if (raw === undefined || raw === null) return defaults;
  if (Array.isArray(defaults)) return (Array.isArray(raw) ? raw : defaults) as T;
  if (isObject(defaults)) {
    if (!isObject(raw)) return defaults;
    const out: Json = { ...defaults };
    // Records keyed by uid (hardware maps) are dynamic: take raw entries as-is.
    if (Object.keys(defaults).length === 0) return raw as T;
    Object.keys(defaults).forEach((key) => {
      out[key] = mergeTyped((defaults as Json)[key], raw[key]);
    });
    return out as T;
  }
  if (typeof defaults === 'number') return (typeof raw === 'number' && Number.isFinite(raw) ? raw : defaults) as T;
  return (typeof raw === typeof defaults ? raw : defaults) as T;
}

function sanitizeGpu(uid: string, raw: unknown): GpuInstance | null {
  if (!isObject(raw)) return null;
  const modelId = str(raw.modelId);
  if (!modelId || !GPU_BY_ID[modelId]) return null;
  const quality = QUALITY_ORDER.includes(raw.quality as SiliconQuality) ? (raw.quality as SiliconQuality) : 'bronze';
  const silicon = isObject(raw.silicon) ? raw.silicon : {};
  const oc = isObject(raw.oc) ? raw.oc : {};
  return {
    uid,
    modelId,
    quality,
    silicon: {
      coreHeadroom: finite(silicon.coreHeadroom, 60),
      memHeadroom: finite(silicon.memHeadroom, 250),
      vScale: finite(silicon.vScale, 8),
    },
    oc: {
      core: clamp(finite(oc.core, STOCK_OC.core), OC_LIMITS.core.min, OC_LIMITS.core.max),
      mem: clamp(finite(oc.mem, STOCK_OC.mem), OC_LIMITS.mem.min, OC_LIMITS.mem.max),
      voltage: clamp(finite(oc.voltage, STOCK_OC.voltage), OC_LIMITS.voltage.min, OC_LIMITS.voltage.max),
    },
    ocBonus: clamp(finite(raw.ocBonus, 0), -0.2, OC_LIMITS.maxBonus),
    temp: clamp(finite(raw.temp, 26), -40, 150),
    wear: clamp(finite(raw.wear, 0), 0, 0.6),
    paste: clamp(finite(raw.paste, 1), 0, 1),
    shutdown: raw.shutdown === true,
    overheatSeconds: Math.max(0, finite(raw.overheatSeconds, 0)),
  };
}

function sanitizeParts<T extends PsuInstance | CoolerInstance>(raw: unknown, valid: (modelId: string) => boolean): Record<string, T> {
  if (!isObject(raw)) return {};
  const out: Record<string, T> = {};
  Object.entries(raw).forEach(([uid, part]) => {
    const modelId = isObject(part) ? str(part.modelId) : null;
    if (modelId && valid(modelId)) out[uid] = { uid, modelId } as T;
  });
  return out;
}

function sanitizeRack(uid: string, raw: unknown, gpus: Record<string, unknown>, coolers: Record<string, unknown>, psus: Record<string, unknown>): RackInstance | null {
  if (!isObject(raw)) return null;
  const modelId = str(raw.modelId);
  const model = modelId ? RACK_BY_ID[modelId] : undefined;
  if (!model || !modelId) return null;
  const slots = (list: unknown, size: number, pool: Record<string, unknown>) =>
    Array.from({ length: size }, (_, i) => {
      const u = Array.isArray(list) ? list[i] : null;
      return typeof u === 'string' && pool[u] ? u : null;
    });
  const roomId = typeof raw.roomId === 'string' && ROOM_BY_ID[raw.roomId as RoomId] ? (raw.roomId as RoomId) : null;
  const pad = roomId && typeof raw.pad === 'number' && Number.isInteger(raw.pad) && raw.pad >= 0 ? raw.pad : null;
  return {
    uid,
    modelId,
    roomId: pad === null ? null : roomId,
    pad,
    gpuSlots: slots(raw.gpuSlots, model.slots, gpus),
    fanSlots: slots(raw.fanSlots, model.fanSlots, coolers),
    psuUid: typeof raw.psuUid === 'string' && psus[raw.psuUid] ? raw.psuUid : null,
    rebootUntil: finite(raw.rebootUntil, 0),
  };
}

function sanitizeBots(raw: unknown): TradingBot[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter(isObject)
    .filter((b) => str(b.id))
    .slice(0, 8)
    .map((b) => ({
      id: String(b.id),
      coin: (b.coin === 'MEME' ? 'MEME' : 'CC') as CoinId,
      side: b.side === 'buy' ? 'buy' : 'sell',
      trigger: b.trigger === 'below' ? 'below' : 'above',
      threshold: clamp(finite(b.threshold, 1.15), 0.1, 10),
      amountPct: clamp(finite(b.amountPct, 100), 1, 100),
      cooldownSec: clamp(finite(b.cooldownSec, 20), 5, 600),
      lastFiredAt: finite(b.lastFiredAt, 0),
      enabled: b.enabled !== false,
    }));
}

function sanitizeChallenge(raw: unknown, now: number): ActiveChallenge | null {
  if (!isObject(raw) || !isChallengeId(raw.id)) return null;
  return { id: raw.id, startedAt: Math.min(now, finite(raw.startedAt, now)) };
}

function sanitizeChallengeRecords(raw: unknown): ChallengeRecords {
  const out: ChallengeRecords = {};
  if (!isObject(raw)) return out;
  CHALLENGE_IDS.forEach((id) => {
    const rec = raw[id];
    if (!isObject(rec)) return;
    const clears = Math.floor(clamp(finite(rec.clears, 0), 0, 1_000_000));
    if (clears > 0) out[id] = { clears, bestTimeSec: Math.max(1, finite(rec.bestTimeSec, 1)) };
  });
  return out;
}

function sanitizeTalents(raw: unknown): TalentLevels {
  if (!isObject(raw)) return {};
  const out: TalentLevels = {};
  Object.entries(raw).forEach(([id, lvl]) => {
    const node = TALENT_BY_ID[id as TalentId];
    if (node) out[id as TalentId] = clamp(Math.floor(finite(lvl, 0)), 0, node.maxLevel);
  });
  return out;
}

/** Rebuilds every dynamic record from scratch so a tampered save can never crash the game. */
function sanitize(data: GameData, source: Json): GameData {
  const defaults = createInitialData();
  const useSource = (key: string) => isObject(source[key]);

  const gpus: Record<string, GpuInstance> = {};
  if (useSource('gpus')) {
    Object.entries(source.gpus as Json).forEach(([uid, g]) => {
      const clean = sanitizeGpu(uid, g);
      if (clean) gpus[uid] = clean;
    });
  } else Object.assign(gpus, defaults.gpus);
  const psus = useSource('psus') ? sanitizeParts<PsuInstance>(source.psus, (id) => !!PSU_BY_ID[id]) : defaults.psus;
  const coolers = useSource('coolers') ? sanitizeParts<CoolerInstance>(source.coolers, (id) => !!COOLER_BY_ID[id]) : defaults.coolers;
  const racks: Record<string, RackInstance> = {};
  if (useSource('racks')) {
    Object.entries(source.racks as Json).forEach(([uid, r]) => {
      const clean = sanitizeRack(uid, r, gpus, coolers, psus);
      if (clean) racks[uid] = clean;
    });
  } else Object.assign(racks, defaults.racks);

  const roomTemps: Partial<Record<RoomId, number>> = {};
  if (isObject(source.roomTemps)) {
    Object.entries(source.roomTemps).forEach(([id, t]) => {
      if (ROOM_BY_ID[id as RoomId] && typeof t === 'number' && Number.isFinite(t)) roomTemps[id as RoomId] = t;
    });
  }

  const big: Partial<GameData> = {};
  BIGNUM_KEYS.forEach((key) => {
    const v = data[key];
    big[key] = typeof v === 'string' && BIGNUM_RE.test(v.trim()) && Number.isFinite(Number(v.trim().replace(/e.*/i, ''))) ? v.trim() : defaults[key];
  });

  const ownedRooms = (Array.isArray(data.ownedRooms) ? data.ownedRooms : []).filter((id) => !!ROOM_BY_ID[id]);
  const clean: Omit<GameData, 'contracts'> = {
    ...data,
    ...big,
    gpus,
    psus,
    coolers,
    racks,
    roomTemps,
    bots: sanitizeBots(source.bots ?? data.bots),
    talents: sanitizeTalents(source.talents),
    challenge: sanitizeChallenge(source.challenge, Date.now()),
    challengeRecords: sanitizeChallengeRecords(source.challengeRecords),
    achievements: (Array.isArray(data.achievements) ? data.achievements : []).filter((a): a is string => typeof a === 'string'),
    technicians: clamp(Math.floor(finite(data.technicians, 0)), 0, 6),
    meme: Math.max(0, finite(data.meme, 0)),
    memeCostBasis: Math.max(0, finite(data.memeCostBasis, 0)),
    ccCostBasis: Math.max(0, finite(data.ccCostBasis, 0)),
    gems: Math.max(0, Math.floor(finite(data.gems, 0))),
    sc: Math.max(0, Math.floor(finite(data.sc, 0))),
    runStartedAt: Math.min(Date.now(), finite(data.runStartedAt, Date.now())),
    ownedRooms: ownedRooms.length ? Array.from(new Set(ownedRooms)) : ['bedroom'],
    activeRoom: ownedRooms.includes(data.activeRoom) ? data.activeRoom : 'bedroom',
  };
  // Contracts are rebuilt last: a missing/garbled board is regenerated, scaled to the sanitized farm.
  return { ...clean, contracts: sanitizeBoard(source.contracts, contractContext(clean), Date.now()) };
}

/**
 * Versioned migration entry point (used by zustand persist and save import).
 * v1 → v2: added $MEME cost basis, VIP auto-sell toggle and ambient hum setting.
 * v2 → v3: added $CC cost basis (earnings only count realized profit).
 * v3 → v4: added the Contracts board (generated from the migrated farm) and stats.contractsCompleted.
 * v4 → v5: added runStartedAt (for the Halving $SC/h readout); older runs are dated from their last tick.
 * v5 → v6: added challenge runs (challenge, challengeRecords): older saves are free runs with no clears.
 */
export function migrateSave(raw: unknown, fromVersion: number): GameData {
  const defaults = createInitialData();
  const source: Json = isObject(raw) ? { ...raw } : {};
  if (fromVersion < 2) {
    source.memeCostBasis = 0;
    if (isObject(source.vip)) source.vip = { ...source.vip, autoSellEnabled: true };
  }
  if (fromVersion < 3) source.ccCostBasis = 0;
  // No board before v4: sanitize() generates one scaled to the player's actual farm.
  if (fromVersion < 4) delete source.contracts;
  // The real run start is unknown: the last tick is the best lower bound on how long it has lasted.
  if (fromVersion < 5) source.runStartedAt = finite(source.lastTick, Date.now());
  // Challenge runs did not exist: a pre-v6 save is a free run with no recorded clears.
  if (fromVersion < 6) {
    source.challenge = null;
    source.challengeRecords = {};
  }
  const merged = mergeTyped(defaults, source);
  merged.saveVersion = SAVE_VERSION;
  return sanitize(merged, source);
}
