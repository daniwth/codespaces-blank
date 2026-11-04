import { SAVE_VERSION } from '../config/gameBalance';
import { GPU_BY_ID, PSU_BY_ID, COOLER_BY_ID, RACK_BY_ID } from '../config/hardwareCatalog';
import { ROOM_BY_ID } from '../config/roomsCatalog';
import type { GameData } from '../types/player';
import { createInitialData } from './initialState';

type Json = Record<string, unknown>;

const isObject = (v: unknown): v is Json => typeof v === 'object' && v !== null && !Array.isArray(v);

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
  return (typeof raw === typeof defaults ? raw : defaults) as T;
}

/** Remove references to catalog entries that no longer exist. */
function sanitize(data: GameData): GameData {
  const gpus = Object.fromEntries(Object.entries(data.gpus).filter(([, g]) => !!GPU_BY_ID[g.modelId]));
  const psus = Object.fromEntries(Object.entries(data.psus).filter(([, p]) => !!PSU_BY_ID[p.modelId]));
  const coolers = Object.fromEntries(Object.entries(data.coolers).filter(([, c]) => !!COOLER_BY_ID[c.modelId]));
  const racks = Object.fromEntries(
    Object.entries(data.racks)
      .filter(([, r]) => !!RACK_BY_ID[r.modelId])
      .map(([k, r]) => [
        k,
        {
          ...r,
          gpuSlots: r.gpuSlots.map((u) => (u && gpus[u] ? u : null)),
          fanSlots: r.fanSlots.map((u) => (u && coolers[u] ? u : null)),
          psuUid: r.psuUid && psus[r.psuUid] ? r.psuUid : null,
        },
      ]),
  );
  const ownedRooms = data.ownedRooms.filter((id) => !!ROOM_BY_ID[id]);
  return {
    ...data,
    gpus,
    psus,
    coolers,
    racks,
    ownedRooms: ownedRooms.length ? ownedRooms : ['bedroom'],
    activeRoom: ownedRooms.includes(data.activeRoom) ? data.activeRoom : 'bedroom',
  };
}

/**
 * Versioned migration entry point (used by zustand persist and save import).
 * v1 → v2: added $MEME cost basis, VIP auto-sell toggle and ambient hum setting.
 */
export function migrateSave(raw: unknown, fromVersion: number): GameData {
  const defaults = createInitialData();
  const source: Json = isObject(raw) ? { ...raw } : {};
  if (fromVersion < 2) {
    source.memeCostBasis = 0;
    if (isObject(source.vip)) source.vip = { ...source.vip, autoSellEnabled: true };
  }
  const merged = mergeTyped(defaults, source);
  // uid-keyed records must be taken verbatim (defaults contain the starter rig).
  const dynamicKeys = ['gpus', 'psus', 'coolers', 'racks', 'roomTemps', 'talents'] as const;
  dynamicKeys.forEach((key) => {
    if (isObject(source[key])) (merged as unknown as Json)[key] = source[key];
  });
  merged.saveVersion = SAVE_VERSION;
  return sanitize(merged);
}
