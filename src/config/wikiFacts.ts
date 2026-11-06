/**
 * Shared helpers and derived facts of the in-game wiki (used by both languages).
 * Every number is read from the balance config, so the guide follows the game
 * when the catalogs change.
 */
import { PHYSICS, POOLS } from './gameBalance';
import { COOLER_BY_ID, GPU_CATALOG, PSU_BY_ID, RACK_BY_ID } from './hardwareCatalog';
import { BASE_OFFLINE_HOURS, TALENT_BY_ID } from './prestigeTree';
import { ROOM_BY_ID } from './roomsCatalog';
import * as T from './wikiTables';
import type { WikiBlock, WikiTable, WikiTone } from './wikiTypes';
import { aiAutoTune } from '../store/gamePhysics';
import { formatDuration, formatPercent } from '../utils/formatters';

// ───────────────────────── Block helpers ─────────────────────────

export const p = (text: string): WikiBlock => ({ type: 'p', text });
export const list = (...items: string[]): WikiBlock => ({ type: 'list', items });
export const steps = (...items: string[]): WikiBlock => ({ type: 'steps', items });
export const note = (tone: WikiTone, text: string): WikiBlock => ({ type: 'callout', tone, text });
export const tip = (text: string) => note('tip', text);
export const warn = (text: string) => note('warn', text);
export const info = (text: string) => note('info', text);
export const formula = (text: string): WikiBlock => ({ type: 'formula', text });
export const table = (t: WikiTable): WikiBlock => ({ type: 'table', table: t });

export const pct = (ratio: number, digits = 0) => formatPercent(ratio, digits);
export const min = (sec: number) => formatDuration(sec);

// ───────────────────────── Derived facts ─────────────────────────

export const starterGpu = GPU_CATALOG[0];
export const secondGpu = GPU_CATALOG[1];
export const bench = RACK_BY_ID.bench;
export const steel = RACK_BY_ID.steel;
export const bedroom = ROOM_BY_ID.bedroom;
export const garage = ROOM_BY_ID.garage;
export const starterPsu = PSU_BY_ID.psu500;
export const starterFan = COOLER_BY_ID.fan80;
export const publicFee = POOLS.public.fee;
export const starterCcPerSec = T.grossCcPerSec(starterGpu.id) * (1 - publicFee);
/** GPUs whose paste one technician keeps at 100% (they work at full speed on up to 8 mounted GPUs). */
export const TECH_FULL_SPEED_GPUS = 8;
export const gpusPerTechPaste = Math.floor(TECH_FULL_SPEED_GPUS * PHYSICS.techPastePerSec * PHYSICS.pasteLifetimeSec);
export const whisperer = TALENT_BY_ID.silicon_luck;
export const nightShift = TALENT_BY_ID.offline_ext;
export const maxOfflineHours = BASE_OFFLINE_HOURS + nightShift.maxLevel * nightShift.effect;
/** Voltage of the VIP Auto-Tune profile (fixed, whatever the silicon). */
export const autoTuneVoltage = aiAutoTune({ coreHeadroom: 0, memHeadroom: 0, vScale: 0 }).voltage;
export const peak = T.scMilestones().reduce((a, b) => (b.scPerHour > a.scPerHour ? b : a));

