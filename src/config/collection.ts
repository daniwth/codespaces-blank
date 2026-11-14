import type { SiliconQuality } from '../types/hardware';
import type { ChallengeId, ChallengeRecords, SiliconCollection } from '../types/player';
import { GPU_CATALOG, QUALITY_ORDER } from './hardwareCatalog';

// ───────────────────────── Silicon Collection album ─────────────────────────

/** A family is one brand: completing every model of it in all four silicon grades pays a permanent bonus. */
export interface CollectionFamily {
  brand: string;
  modelIds: string[];
}

export const COLLECTION_FAMILIES: CollectionFamily[] = (() => {
  const byBrand = new Map<string, string[]>();
  GPU_CATALOG.forEach((g) => byBrand.set(g.brand, [...(byBrand.get(g.brand) ?? []), g.id]));
  return [...byBrand.entries()].map(([brand, modelIds]) => ({ brand, modelIds }));
})();

export const COLLECTION = {
  /** Permanent hashrate bonus per completed family. */
  familyHash: 0.02,
  /** Extra bonus for completing the whole album. */
  albumHash: 0.05,
} as const;

export const hasGrade = (c: SiliconCollection, modelId: string, quality: SiliconQuality): boolean => !!c[modelId]?.includes(quality);

/** The album with one more entry (the same object when it was already there). */
export function collect(c: SiliconCollection, modelId: string, quality: SiliconQuality): SiliconCollection {
  if (hasGrade(c, modelId, quality)) return c;
  const grades = [...(c[modelId] ?? []), quality].sort((a, b) => QUALITY_ORDER.indexOf(a) - QUALITY_ORDER.indexOf(b));
  return { ...c, [modelId]: grades };
}

export const modelComplete = (c: SiliconCollection, modelId: string): boolean => QUALITY_ORDER.every((q) => hasGrade(c, modelId, q));
export const familyComplete = (c: SiliconCollection, family: CollectionFamily): boolean => family.modelIds.every((id) => modelComplete(c, id));

export interface CollectionProgress {
  entries: number;
  total: number;
  families: number;
  /** Permanent hashrate multiplier earned by the album. */
  hashMul: number;
}

export function collectionProgress(c: SiliconCollection): CollectionProgress {
  const total = GPU_CATALOG.length * QUALITY_ORDER.length;
  const entries = GPU_CATALOG.reduce((acc, g) => acc + QUALITY_ORDER.filter((q) => hasGrade(c, g.id, q)).length, 0);
  const families = COLLECTION_FAMILIES.filter((f) => familyComplete(c, f)).length;
  const hashMul = 1 + families * COLLECTION.familyHash + (entries >= total ? COLLECTION.albumHash : 0);
  return { entries, total, families, hashMul };
}

// ───────────────────────── Challenge relics ─────────────────────────

/** Permanent passive earned the first time a challenge is completed. */
export interface RelicDef {
  challenge: ChallengeId;
  name: string;
  description: string;
  color: string;
  hashMul?: number;
  heatMul?: number;
  electricityMul?: number;
  techSpeedMul?: number;
}

export const RELICS: Record<ChallengeId, RelicDef> = {
  bronze_only: { challenge: 'bronze_only', name: 'Bronze Idol', color: '#d97706', description: '+3% hashrate on every device, forever.', hashMul: 1.03 },
  no_overclock: { challenge: 'no_overclock', name: 'Factory Seal', color: '#38bdf8', description: '-4% heat from every device, forever.', heatMul: 0.96 },
  power_cap: { challenge: 'power_cap', name: 'Copper Fuse', color: '#fbbf24', description: '-5% electricity bill, forever.', electricityMul: 0.95 },
  single_room: { challenge: 'single_room', name: 'House Key', color: '#f43f5e', description: '+25% technician speed, forever.', techSpeedMul: 1.25 },
};

export const RELIC_IDS = Object.keys(RELICS) as ChallengeId[];
export const relicOwned = (records: ChallengeRecords, id: ChallengeId): boolean => (records[id]?.clears ?? 0) > 0;

export interface PerkModifiers {
  hashMul: number;
  heatMul: number;
  electricityMul: number;
  techSpeedMul: number;
}

/** Everything permanent that is not a talent: relics of cleared challenges and the collection album. */
export function perkModifiers(records: ChallengeRecords = {}, collection: SiliconCollection = {}): PerkModifiers {
  const out: PerkModifiers = { hashMul: collectionProgress(collection).hashMul, heatMul: 1, electricityMul: 1, techSpeedMul: 1 };
  RELIC_IDS.forEach((id) => {
    if (!relicOwned(records, id)) return;
    const r = RELICS[id];
    out.hashMul *= r.hashMul ?? 1;
    out.heatMul *= r.heatMul ?? 1;
    out.electricityMul *= r.electricityMul ?? 1;
    out.techSpeedMul *= r.techSpeedMul ?? 1;
  });
  return out;
}
