import type { ContractDifficulty, ContractKind } from '../types/contracts';

/** Contracts board tuning (data only). */
export const CONTRACTS = {
  slots: 3,
  /** Delay before an empty slot (claimed / expired) receives a new contract. */
  refillSec: 45,
  /** One reroll every few minutes... */
  rerollCooldownSec: 180,
  /** ...costing about this many seconds of the farm's estimated net income... */
  rerollIncomeSec: 120,
  /** ...and never less than this. */
  rerollMinCost: 25,
  /** keep_cool streaks only count while the farm keeps this share of the hashrate it had when the contract was issued. */
  keepCoolMinHashShare: 0.5,
  /** Cash rewards never drop below this. */
  minCashReward: 20,
  /** Share of gross mining income assumed to survive the power bill (for scaling). */
  netIncomeShare: 0.75,
  /** Floor for the income estimate ($/s) so a brand new farm still gets meaningful rewards. */
  minIncomePerSec: 0.25,
  /** Reference hashrate when nothing is mounted (one starter PX-460). */
  minHash: 25e6,
} as const;

export interface DifficultyDef {
  label: string;
  color: string;
  /** Chance to roll this difficulty. */
  weight: number;
  /** Chance of a gem reward, and how many gems it gives. */
  gemChance: number;
  gems: number;
  /** Chance of a bonus gem on top. */
  bonusGemChance: number;
  /** Chance of a free GPU (replaces half of the cash reward), and its tier relative to the best owned. */
  gpuChance: number;
  gpuTierOffset: number;
}

export const CONTRACT_DIFFICULTY: Record<ContractDifficulty, DifficultyDef> = {
  1: { label: 'Easy', color: '#a3e635', weight: 45, gemChance: 0, gems: 0, bonusGemChance: 0, gpuChance: 0, gpuTierOffset: 0 },
  2: { label: 'Medium', color: '#fbbf24', weight: 35, gemChance: 0.35, gems: 1, bonusGemChance: 0, gpuChance: 0.06, gpuTierOffset: -1 },
  3: { label: 'Hard', color: '#f43f5e', weight: 20, gemChance: 1, gems: 1, bonusGemChance: 0.25, gpuChance: 0.2, gpuTierOffset: 0 },
};

/** Values indexed by difficulty − 1. */
type ByDifficulty = readonly [number, number, number];

export interface ContractDef {
  kind: ContractKind;
  name: string;
  color: string;
  /** Relative pick weight. */
  weight: number;
  /** Player level needed before this kind is offered (pools / bots unlock). */
  minLevel: number;
  /** Deadline in minutes. */
  minutes: ByDifficulty;
  /** Kind-specific goal scale (see generateContract). */
  scale: ByDifficulty;
  /**
   * Cash reward = estimated net income over the deadline × this share. Kept at 12-40%: three
   * parallel contracts add roughly a third to a focused player's income, not double it.
   */
  rewardShare: ByDifficulty;
}

export const CONTRACT_DEFS: Record<ContractKind, ContractDef> = {
  // scale: share of the deadline the farm must mine at its current rate.
  deliver_cc: { kind: 'deliver_cc', name: 'Hash Delivery', color: '#22d3ee', weight: 12, minLevel: 1, minutes: [8, 12, 18], scale: [0.5, 0.7, 0.9], rewardShare: [0.12, 0.18, 0.25] },
  // scale: share of the deadline's estimated net income to realize as profit.
  earn_profit: { kind: 'earn_profit', name: 'Cash Out', color: '#facc15', weight: 10, minLevel: 1, minutes: [8, 12, 18], scale: [0.35, 0.5, 0.65], rewardShare: [0.12, 0.18, 0.25] },
  // scale: multiple of the current hashrate.
  reach_hash: { kind: 'reach_hash', name: 'Expansion Order', color: '#a3e635', weight: 10, minLevel: 1, minutes: [12, 20, 30], scale: [1.25, 1.6, 2.2], rewardShare: [0.2, 0.3, 0.4] },
  // scale: degrees below the current hottest die; the streak lasts 3/5/8 minutes.
  keep_cool: { kind: 'keep_cool', name: 'Cold Chain', color: '#38bdf8', weight: 9, minLevel: 1, minutes: [10, 15, 20], scale: [2, 6, 10], rewardShare: [0.15, 0.2, 0.3] },
  // scale: extra GPUs of the required tier on top of those already running.
  gpu_tier: { kind: 'gpu_tier', name: 'Fleet Upgrade', color: '#e879f9', weight: 8, minLevel: 1, minutes: [15, 25, 40], scale: [1, 2, 3], rewardShare: [0.2, 0.3, 0.4] },
  // scale: solo blocks to find (mean block time is 5 minutes).
  solo_block: { kind: 'solo_block', name: 'Block Bounty', color: '#fde047', weight: 7, minLevel: 3, minutes: [15, 20, 30], scale: [1, 1, 2], rewardShare: [0.15, 0.2, 0.3] },
  // scale: network events to sit through without a thermal shutdown.
  survive_event: { kind: 'survive_event', name: 'Storm Watch', color: '#f97316', weight: 8, minLevel: 1, minutes: [10, 14, 22], scale: [1, 1, 2], rewardShare: [0.15, 0.25, 0.35] },
  // scale: seconds of estimated net income to realize through bot sells.
  bot_profit: { kind: 'bot_profit', name: 'Algo Desk', color: '#4ade80', weight: 7, minLevel: 4, minutes: [12, 18, 25], scale: [120, 240, 420], rewardShare: [0.15, 0.2, 0.3] },
};

export const CONTRACT_KINDS = Object.keys(CONTRACT_DEFS) as ContractKind[];

/** keep_cool streak length in minutes, by difficulty. */
export const KEEP_COOL_STREAK_MIN: ByDifficulty = [3, 5, 8];
/** keep_cool thresholds stay in this °C range. */
export const KEEP_COOL_RANGE: readonly [number, number] = [20, 84];
/** gpu_tier: GPU price share added to the cash reward per extra GPU required. */
export const GPU_TIER_PRICE_SHARE = 0.3;
