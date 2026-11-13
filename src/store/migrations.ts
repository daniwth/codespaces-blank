import { SAVE_VERSION } from '../config/gameBalance';
import { COOLER_BY_ID, GPU_BY_ID, OC_LIMITS, PSU_BY_ID, QUALITY_DEFS, QUALITY_ORDER, RACK_BY_ID } from '../config/hardwareCatalog';
import { BIOS_PROFILE_IDS, BMC_LIMITS, DEFAULT_BIOS_PROFILES, DEFAULT_BMC, defaultBiosProfiles } from '../config/synergy';
import { AIRDROP } from '../config/airdrops';
import { ALT_COIN_IDS, COIN_IDS, emptyAlts, isCoinId, isMineableCoin } from '../config/altcoins';
import { CHALLENGE_IDS, isChallengeId } from '../config/challenges';
import { AUTOPILOT } from '../config/autopilot';
import { BUFFS, emptyBuffs } from '../config/buffs';
import { localDay } from '../config/daily';
import { RESEARCH_BY_ID, RESEARCH_IDS, isResearchId } from '../config/research';
import { ROADMAP } from '../config/roadmap';
import { ROOM_BY_ID } from '../config/roomsCatalog';
import { TALENT_BY_ID } from '../config/prestigeTree';
import type { AltWallets, Candle, CoinMarket, MarketState, MineableCoin, TradingBot } from '../types/economy';
import type { CoolerInstance, GpuInstance, OverclockSettings, PsuInstance, RackInstance, SiliconQuality } from '../types/hardware';
import type {
  ActiveChallenge, AutopilotState, BiosProfileId, BmcConfig, ChallengeRecords, RoomUpgrades, DailyState, FarmBuffs, GameData, GameSettings, HashBoost, ResearchLevels, ResearchState, RoadmapState, RoomId, TalentId, TalentLevels,
} from '../types/player';
import { clamp, unitHash } from '../utils/random';
import { contractContext, sanitizeBoard } from './contracts';
import { STOCK_OC } from './gamePhysics';
import { createInitialData, DEFAULT_SETTINGS } from './initialState';

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

/** Undervolt floor of a chip that has none saved: deterministic per uid, inside the range of its grade. */
export function defaultVFloor(uid: string, quality: SiliconQuality): number {
  const [lo, hi] = QUALITY_DEFS[quality].vFloor;
  return Math.round(lo + (hi - lo) * unitHash(uid, 7));
}

function sanitizeOc(raw: unknown, fallback: OverclockSettings): OverclockSettings {
  const oc = isObject(raw) ? raw : {};
  return {
    core: clamp(finite(oc.core, fallback.core), OC_LIMITS.core.min, OC_LIMITS.core.max),
    mem: clamp(finite(oc.mem, fallback.mem), OC_LIMITS.mem.min, OC_LIMITS.mem.max),
    voltage: clamp(finite(oc.voltage, fallback.voltage), OC_LIMITS.voltage.min, OC_LIMITS.voltage.max),
  };
}

function sanitizeBiosProfiles(raw: unknown): Record<BiosProfileId, OverclockSettings> {
  const src = isObject(raw) ? raw : {};
  const out = defaultBiosProfiles();
  BIOS_PROFILE_IDS.forEach((id) => {
    out[id] = sanitizeOc(src[id], DEFAULT_BIOS_PROFILES[id]);
  });
  return out;
}

function sanitizeBmc(raw: unknown): BmcConfig {
  const src = isObject(raw) ? raw : {};
  const flag = (v: unknown, fallback: boolean): boolean => (typeof v === 'boolean' ? v : fallback);
  return {
    enabled: flag(src.enabled, DEFAULT_BMC.enabled),
    autoPaste: flag(src.autoPaste, DEFAULT_BMC.autoPaste),
    pasteBelow: clamp(finite(src.pasteBelow, DEFAULT_BMC.pasteBelow), BMC_LIMITS.paste[0], BMC_LIMITS.paste[1]),
    autoRepair: flag(src.autoRepair, DEFAULT_BMC.autoRepair),
    healthBelow: clamp(finite(src.healthBelow, DEFAULT_BMC.healthBelow), BMC_LIMITS.health[0], BMC_LIMITS.health[1]),
  };
}

/** The battery bank only exists in a farm that owns the Warehouse. */
function sanitizeUpgrades(raw: unknown, ownedRooms: RoomId[]): RoomUpgrades {
  return { battery: isObject(raw) && raw.battery === true && ownedRooms.includes('warehouse') };
}

function sanitizeGpu(uid: string, raw: unknown): GpuInstance | null {
  if (!isObject(raw)) return null;
  const modelId = str(raw.modelId);
  if (!modelId || !GPU_BY_ID[modelId]) return null;
  const quality = QUALITY_ORDER.includes(raw.quality as SiliconQuality) ? (raw.quality as SiliconQuality) : 'bronze';
  const silicon = isObject(raw.silicon) ? raw.silicon : {};
  return {
    uid,
    modelId,
    quality,
    silicon: {
      coreHeadroom: finite(silicon.coreHeadroom, 60),
      memHeadroom: finite(silicon.memHeadroom, 250),
      vScale: finite(silicon.vScale, 8),
      // Chips minted before v9 have no undervolt floor: each gets a fixed roll inside its grade's range.
      vFloor: clamp(finite(silicon.vFloor, defaultVFloor(uid, quality)), OC_LIMITS.voltage.min, OC_LIMITS.voltage.stock),
    },
    oc: sanitizeOc(raw.oc, STOCK_OC),
    ocBonus: clamp(finite(raw.ocBonus, 0), -0.2, OC_LIMITS.maxBonus),
    temp: clamp(finite(raw.temp, 26), -40, 150),
    wear: clamp(finite(raw.wear, 0), 0, 0.6),
    paste: clamp(finite(raw.paste, 1), 0, 1),
    shutdown: raw.shutdown === true,
    overheatSeconds: Math.max(0, finite(raw.overheatSeconds, 0)),
    condensed: raw.condensed === true,
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
      coin: isCoinId(b.coin) ? b.coin : 'CC',
      side: b.side === 'buy' ? 'buy' : 'sell',
      trigger: b.trigger === 'below' ? 'below' : 'above',
      threshold: clamp(finite(b.threshold, 1.15), 0.1, 10),
      amountPct: clamp(finite(b.amountPct, 100), 1, 100),
      cooldownSec: clamp(finite(b.cooldownSec, 20), 5, 600),
      lastFiredAt: finite(b.lastFiredAt, 0),
      enabled: b.enabled !== false,
    }));
}

const isCandle = (c: unknown): c is Candle =>
  isObject(c) && [c.t, c.o, c.h, c.l, c.c].every((v) => typeof v === 'number' && Number.isFinite(v)) && (c.o as number) > 0 && (c.c as number) > 0;

const isCoinMarket = (m: unknown): m is CoinMarket =>
  isObject(m) &&
  typeof m.price === 'number' && Number.isFinite(m.price) && m.price > 0 &&
  typeof m.basePrice === 'number' && Number.isFinite(m.basePrice) && m.basePrice > 0 &&
  Array.isArray(m.candles) && m.candles.every(isCandle) && isCandle(m.current);

/** Every coin must carry a usable price series; a missing or garbled one (older saves have no altcoins) is regenerated. */
function sanitizeMarket(raw: unknown, defaults: MarketState): MarketState {
  const src = isObject(raw) ? raw : {};
  const out = { ...defaults };
  COIN_IDS.forEach((id) => {
    const m = src[id];
    if (isCoinMarket(m)) out[id] = { ...m, id };
  });
  return out;
}

function sanitizeAlts(raw: unknown): AltWallets {
  const out = emptyAlts();
  const src = isObject(raw) ? raw : {};
  ALT_COIN_IDS.forEach((id) => {
    const w = src[id];
    if (!isObject(w)) return;
    out[id] = { amount: Math.max(0, finite(w.amount, 0)), costBasis: Math.max(0, finite(w.costBasis, 0)) };
  });
  return out;
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

/** Research levels are clamped to their caps; a project in progress must still have a level left to grant. */
function sanitizeResearch(raw: unknown, now: number): ResearchState {
  const src = isObject(raw) ? raw : {};
  const rawLevels = isObject(src.levels) ? src.levels : {};
  const levels: ResearchLevels = {};
  RESEARCH_IDS.forEach((id) => {
    const lvl = clamp(Math.floor(finite(rawLevels[id], 0)), 0, RESEARCH_BY_ID[id].maxLevel);
    if (lvl > 0) levels[id] = lvl;
  });
  const a = src.active;
  if (!isObject(a) || !isResearchId(a.id) || (levels[a.id] ?? 0) >= RESEARCH_BY_ID[a.id].maxLevel) return { levels, active: null };
  // No project lasts longer than a week: a tampered end date cannot freeze the Lab forever.
  const endsAt = Math.min(finite(a.endsAt, now), now + 7 * 86_400_000);
  return { levels, active: { id: a.id, startedAt: Math.min(finite(a.startedAt, endsAt), endsAt), endsAt } };
}

function sanitizeBoost(raw: unknown, now: number): HashBoost | null {
  if (!isObject(raw)) return null;
  const until = Math.min(finite(raw.until, 0), now + AIRDROP.overdriveMaxSec * 1000);
  if (until <= now) return null;
  return { mul: clamp(finite(raw.mul, AIRDROP.overdriveMul), 1, AIRDROP.overdriveMul), until };
}

function sanitizeRoadmap(raw: unknown): RoadmapState {
  if (!isObject(raw)) return { step: 0, ready: false };
  const step = clamp(Math.floor(finite(raw.step, 0)), 0, ROADMAP.length);
  return { step, ready: raw.ready === true && step < ROADMAP.length };
}

/** A claim day in the future (clock moved back, tampering) would lock the bonus: it is clamped to today. */
function sanitizeDaily(raw: unknown, now: number): DailyState {
  if (!isObject(raw)) return { lastDay: 0, streak: 0 };
  const lastDay = clamp(Math.floor(finite(raw.lastDay, 0)), 0, localDay(now));
  return { lastDay, streak: lastDay > 0 ? clamp(Math.floor(finite(raw.streak, 1)), 1, 100_000) : 0 };
}

function sanitizeAutopilot(raw: unknown): AutopilotState {
  if (!isObject(raw)) return { remainingSec: 0, paused: false, purchases: 0, spent: 0, autoHalving: false };
  return {
    remainingSec: clamp(finite(raw.remainingSec, 0), 0, AUTOPILOT.maxSeconds),
    paused: raw.paused === true,
    purchases: Math.max(0, Math.floor(finite(raw.purchases, 0))),
    spent: Math.max(0, finite(raw.spent, 0)),
    autoHalving: raw.autoHalving === true,
  };
}

/** No boost outlives its own duration from now: a tampered deadline cannot make one permanent. */
function sanitizeBuffs(raw: unknown, now: number): FarmBuffs {
  if (!isObject(raw)) return emptyBuffs();
  const until = (v: unknown, maxSec: number): number => clamp(finite(v, 0), 0, now + maxSec * 1000);
  return {
    techUntil: until(raw.techUntil, BUFFS.crew.durationSec),
    techCooldownUntil: until(raw.techCooldownUntil, BUFFS.crew.cooldownSec),
    nitroUntil: until(raw.nitroUntil, BUFFS.nitro.durationSec),
    blockMulUntil: until(raw.blockMulUntil, BUFFS.vip.durationSec),
    auditClaims: clamp(Math.floor(finite(raw.auditClaims, 0)), 0, BUFFS.audit.maxClaims),
  };
}

function sanitizeSettings(raw: unknown): GameSettings {
  const src = isObject(raw) ? raw : {};
  const flag = (key: keyof GameSettings): boolean => (typeof src[key] === 'boolean' ? (src[key] as boolean) : (DEFAULT_SETTINGS[key] as boolean));
  return {
    muted: flag('muted'),
    volume: clamp(finite(src.volume, DEFAULT_SETTINGS.volume), 0, 1),
    ambientHum: flag('ambientHum'),
    // Older saves had one volume for everything: the ambience starts at that same level.
    ambientVolume: clamp(finite(src.ambientVolume, finite(src.volume, DEFAULT_SETTINGS.ambientVolume)), 0, 1),
    particles: flag('particles'),
    offlineProgress: flag('offlineProgress'),
  };
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
  const now = Date.now();
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
    market: sanitizeMarket(source.market, defaults.market),
    alts: sanitizeAlts(source.alts),
    minedCoin: (isMineableCoin(source.minedCoin) ? source.minedCoin : 'CC') as MineableCoin,
    challenge: sanitizeChallenge(source.challenge, now),
    challengeRecords: sanitizeChallengeRecords(source.challengeRecords),
    research: sanitizeResearch(source.research, now),
    boost: sanitizeBoost(source.boost, now),
    // A drone is never more than one interval away, whatever the save says.
    nextAirdropAt: Math.min(finite(data.nextAirdropAt, now), now + AIRDROP.interval[1] * 1000),
    roadmap: sanitizeRoadmap(source.roadmap),
    daily: sanitizeDaily(source.daily, now),
    autopilot: sanitizeAutopilot(source.autopilot),
    buffs: sanitizeBuffs(source.buffs, now),
    upgrades: sanitizeUpgrades(source.upgrades, ownedRooms),
    bmc: sanitizeBmc(source.bmc),
    biosProfiles: sanitizeBiosProfiles(source.biosProfiles),
    settings: sanitizeSettings(source.settings),
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
 * v5 → v6: added challenge runs (challenge, challengeRecords): older saves are free runs with no clears;
 *            and altcoins ($BYT/$NOVA wallets, minedCoin and their markets): older saves hold none and mine $CC.
 * v6 → v7: added Lab research, the Overdrive surge and supply drones, the roadmap, the daily bonus and four
 *            stats counters: older saves start with no research, the roadmap at its first goal and no streak.
 * v7 → v8: added the AI Farm Manager.
 * v8 → v9: added the crew rally and special drone boosts (`buffs`), a separate ambience volume, the
 *            undervolt floor of every chip (`silicon.vFloor`), room upgrades, the Smart BMC thresholds
 *            and the saved BIOS profiles.
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
    source.alts = emptyAlts();
    source.minedCoin = 'CC';
  }
  // Nothing of the v7 systems existed: sanitize() fills research, roadmap, daily and drones with their defaults.
  if (fromVersion < 7) {
    delete source.research;
    delete source.boost;
    delete source.roadmap;
    delete source.daily;
    delete source.nextAirdropAt;
  }
  // v7 → v8: the AI Farm Manager did not exist; sanitize() gives it no time left.
  if (fromVersion < 8) delete source.autopilot;
  // v8 → v9: none of the v9 systems existed; sanitize() fills each with its "nothing yet" default.
  if (fromVersion < 9) {
    delete source.buffs;
    delete source.upgrades;
    delete source.bmc;
    delete source.biosProfiles;
  }
  const merged = mergeTyped(defaults, source);
  merged.saveVersion = SAVE_VERSION;
  return sanitize(merged, source);
}
