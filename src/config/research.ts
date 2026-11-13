import type { ResearchId, ResearchLevels } from '../types/player';

/**
 * Lab research: run-scoped upgrades bought with cash that take real time to finish
 * (they keep running offline). One project at a time; The Halving wipes them.
 *
 * Costs grow ~10x per level so every level becomes worth buying roughly one "income decade"
 * after the previous one: a +4% hashrate level pays back in a few minutes once the farm's
 * income is ~1/100 of its price per second, like a GPU of the matching tier.
 */
export type ResearchIcon = 'chip' | 'fan' | 'bolt' | 'drop' | 'pylon' | 'truck' | 'robot';

/** Translatable effect line: an English template with `{placeholders}` plus its values. */
export interface ResearchEffect {
  key: string;
  params: Record<string, string | number>;
}

export interface ResearchDef {
  id: ResearchId;
  name: string;
  description: string;
  icon: ResearchIcon;
  color: string;
  maxLevel: number;
  /** Cash cost of the first level and its growth per level. */
  costBase: number;
  costGrowth: number;
  /** Seconds to research the first level and their growth per level. */
  timeBase: number;
  timeGrowth: number;
  /** Per-level effect magnitude used by the simulation. */
  effect: number;
  /** Total effect at a level, as a translatable line. */
  effectOf: (level: number) => ResearchEffect;
}

const pctOf = (v: number): number => Math.round(v * 100);

export const RESEARCH: ResearchDef[] = [
  {
    id: 'firmware', name: 'Firmware Tuning', icon: 'chip', color: '#a3e635',
    description: 'Hand-tuned mining firmware: every device hashes faster.',
    maxLevel: 5, costBase: 400, costGrowth: 10, timeBase: 60, timeGrowth: 2.5, effect: 0.04,
    effectOf: (l) => ({ key: '+{pct}% hashrate', params: { pct: pctOf(l * 0.04) } }),
  },
  {
    id: 'airflow', name: 'Airflow Engineering', icon: 'fan', color: '#38bdf8',
    description: 'Ducting, blanking plates and fan curves: every heatsink and cooler moves more heat.',
    maxLevel: 5, costBase: 300, costGrowth: 8, timeBase: 45, timeGrowth: 2.5, effect: 0.06,
    effectOf: (l) => ({ key: '+{pct}% cooling', params: { pct: pctOf(l * 0.06) } }),
  },
  {
    id: 'pfc', name: 'Power Factor Correction', icon: 'bolt', color: '#fbbf24',
    description: 'Capacitor banks clean up the load: the utility bills fewer watts.',
    maxLevel: 5, costBase: 200, costGrowth: 8, timeBase: 60, timeGrowth: 2.5, effect: 0.05,
    effectOf: (l) => ({ key: '-{pct}% electricity', params: { pct: pctOf(l * 0.05) } }),
  },
  {
    id: 'paste', name: 'Paste Chemistry', icon: 'drop', color: '#e879f9',
    description: 'A thermal compound that takes far longer to dry out.',
    maxLevel: 3, costBase: 250, costGrowth: 12, timeBase: 40, timeGrowth: 3, effect: 0.5,
    effectOf: (l) => ({ key: '+{pct}% paste life', params: { pct: pctOf(l * 0.5) } }),
  },
  {
    id: 'grid', name: 'Line Upgrade', icon: 'pylon', color: '#fb923c',
    description: 'Thicker feeders and a bigger breaker panel: every room line carries more power. Disabled by the Power Cap and Single Room challenges.',
    maxLevel: 5, costBase: 800, costGrowth: 9, timeBase: 90, timeGrowth: 2.5, effect: 0.1,
    effectOf: (l) => ({ key: '+{pct}% room power line', params: { pct: pctOf(l * 0.1) } }),
  },
  {
    id: 'logistics', name: 'Bulk Logistics', icon: 'truck', color: '#22d3ee',
    description: 'Wholesale supplier deals: GPUs, PSUs, coolers and racks cost less.',
    maxLevel: 5, costBase: 1_000, costGrowth: 12, timeBase: 120, timeGrowth: 2.5, effect: 0.02,
    effectOf: (l) => ({ key: '-{pct}% hardware prices', params: { pct: pctOf(l * 0.02) } }),
  },
  {
    id: 'bmc', name: 'Smart BMC', icon: 'robot', color: '#f472b6',
    description: 'A baseboard controller on every rack: it re-pastes and repairs GPUs on its own once they cross your thresholds, paying the normal price in cash.',
    maxLevel: 1, costBase: 6_000, costGrowth: 1, timeBase: 150, timeGrowth: 1, effect: 1,
    effectOf: () => ({ key: 'automatic re-paste and repair', params: {} }),
  },
];

export const RESEARCH_BY_ID = Object.fromEntries(RESEARCH.map((r) => [r.id, r])) as Record<ResearchId, ResearchDef>;
export const RESEARCH_IDS: ResearchId[] = RESEARCH.map((r) => r.id);

export const isResearchId = (v: unknown): v is ResearchId => typeof v === 'string' && v in RESEARCH_BY_ID;

export const researchLevel = (levels: ResearchLevels, id: ResearchId): number => levels[id] ?? 0;

/** Cash cost of the next level (`currentLevel` → `currentLevel + 1`). */
export const researchCost = (def: ResearchDef, currentLevel: number): number =>
  Math.round(def.costBase * def.costGrowth ** currentLevel);

/** Seconds the next level takes; `timeMul` is the R&D Grant talent (1 = none). */
export const researchTime = (def: ResearchDef, currentLevel: number, timeMul = 1): number =>
  Math.max(5, Math.round(def.timeBase * def.timeGrowth ** currentLevel * timeMul));

/** Gems that finish the active project right now: 1 per started 10 minutes left. */
export const RUSH_SECONDS_PER_GEM = 600;
export const rushCost = (remainingSec: number): number => Math.max(1, Math.ceil(remainingSec / RUSH_SECONDS_PER_GEM));

export interface ResearchModifiers {
  hashMul: number;
  /** Multiplier on the heat transfer coefficient of every GPU. */
  coolingMul: number;
  electricityMul: number;
  /** Multiplier on how long thermal paste lasts. */
  pasteLifeMul: number;
  /** Multiplier on every room's contracted power line. */
  lineMul: number;
  /** Multiplier on GPU / PSU / cooler / rack prices. */
  hardwarePriceMul: number;
  /** Smart BMC researched: automatic maintenance is available. */
  smartBmc: boolean;
}

export function researchModifiers(levels: ResearchLevels): ResearchModifiers {
  const l = (id: ResearchId) => Math.min(RESEARCH_BY_ID[id].maxLevel, Math.max(0, researchLevel(levels, id)));
  return {
    hashMul: 1 + l('firmware') * RESEARCH_BY_ID.firmware.effect,
    coolingMul: 1 + l('airflow') * RESEARCH_BY_ID.airflow.effect,
    electricityMul: 1 - l('pfc') * RESEARCH_BY_ID.pfc.effect,
    pasteLifeMul: 1 + l('paste') * RESEARCH_BY_ID.paste.effect,
    lineMul: 1 + l('grid') * RESEARCH_BY_ID.grid.effect,
    hardwarePriceMul: 1 - l('logistics') * RESEARCH_BY_ID.logistics.effect,
    smartBmc: l('bmc') > 0,
  };
}

/** Sum of every researched level (roadmap / stats). */
export const totalResearchLevels = (levels: ResearchLevels): number =>
  RESEARCH_IDS.reduce((acc, id) => acc + researchLevel(levels, id), 0);
