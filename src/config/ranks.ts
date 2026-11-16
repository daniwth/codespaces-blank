import { levelFromEarnings } from './gameBalance';

/**
 * Ranks: titles earned by level (so by lifetime earnings: they survive Halvings). The first ranks are
 * milestones with a gem reward; from Farm Operator on they unlock abilities and add permanent bonuses.
 */
export type AbilityId = 'flash' | 'partner';

export interface RankDef {
  id: string;
  name: string;
  /** Level at which the rank is reached. */
  level: number;
  color: string;
  /** Gems paid once, when the rank is reached. */
  gems: number;
  /** Total bonuses at this rank (not on top of the previous one). */
  hashMul: number;
  electricityMul: number;
  /** Ability unlocked on reaching the rank. */
  unlock?: AbilityId;
}

export const RANKS: RankDef[] = [
  { id: 'kiddie', name: 'Script Kiddie', level: 1, color: '#8f89c4', gems: 0, hashMul: 1, electricityMul: 1 },
  { id: 'hobby', name: 'Hobby Miner', level: 4, color: '#a3e635', gems: 1, hashMul: 1, electricityMul: 1 },
  { id: 'builder', name: 'Rig Builder', level: 7, color: '#22d3ee', gems: 2, hashMul: 1, electricityMul: 1 },
  { id: 'operator', name: 'Farm Operator', level: 10, color: '#38bdf8', gems: 3, hashMul: 1, electricityMul: 1, unlock: 'flash' },
  { id: 'baron', name: 'Hash Baron', level: 13, color: '#c084fc', gems: 5, hashMul: 1.03, electricityMul: 1, unlock: 'partner' },
  { id: 'tycoon', name: 'Grid Tycoon', level: 16, color: '#fb923c', gems: 8, hashMul: 1.05, electricityMul: 0.96 },
  { id: 'magnate', name: 'Block Magnate', level: 20, color: '#facc15', gems: 12, hashMul: 1.08, electricityMul: 0.93 },
  { id: 'legend', name: 'Chain Legend', level: 25, color: '#f472b6', gems: 20, hashMul: 1.12, electricityMul: 0.9 },
];

/** Index in `RANKS` of the rank held at a level. */
export function rankIndex(level: number): number {
  let i = 0;
  while (i + 1 < RANKS.length && level >= RANKS[i + 1].level) i += 1;
  return i;
}

export const rankOf = (level: number): RankDef => RANKS[rankIndex(level)];
export const nextRank = (level: number): RankDef | null => RANKS[rankIndex(level) + 1] ?? null;
export const rankOfEarnings = (lifetime: number): RankDef => rankOf(levelFromEarnings(lifetime));

/** Level that unlocks an ability. */
export const abilityLevel = (id: AbilityId): number => RANKS.find((r) => r.unlock === id)?.level ?? Number.POSITIVE_INFINITY;
export const abilityUnlocked = (id: AbilityId, level: number): boolean => level >= abilityLevel(id);

/**
 * Rank abilities.
 * Flash Mining rents remote hashrate for a few minutes: the fee is paid up front and is most of what
 * that hashrate is expected to mine at the current price, so it pays off when the price climbs or the
 * pool gets lucky. Pool Partner is an exclusivity deal with the current pool: a better payout while it
 * lasts, and a reputation penalty for leaving early.
 */
export const ABILITIES = {
  flash: { durationSec: 300, cooldownSec: 900, hashShare: 1, feeShare: 0.9 },
  partner: { durationSec: 1800, cooldownSec: 600, payoutMul: 1.08, breakPoints: 6 },
} as const;
