import type { ReputationState } from '../types/contracts';

/**
 * Contract reputation. Claiming a contract (it was delivered on time) earns points by difficulty;
 * letting one expire costs a point. Levels unlock Special Contracts: three stages in a row, each
 * paying more than the last, with a gem bonus for finishing the chain.
 */
export const REPUTATION = {
  /** Points earned per claimed contract, by difficulty (1-3). */
  claim: [1, 2, 3] as const,
  expire: -1,
  /** Points needed for level n (level 0 = 0 points): 4, 10, 18, 28… */
  levelPoints: (level: number): number => level * (level + 3),
  maxLevel: 10,
  /** Level that unlocks Special Contracts. */
  chainLevel: 2,
  chainStages: 3,
  /** Reward multiplier of each stage over a normal hard contract. */
  stageMul: [1.5, 2.5, 4] as const,
  /** Gems for finishing the whole chain, and reputation for it. */
  chainGems: 3,
  chainPoints: 5,
  /** Reputation lost when a stage expires (the chain is lost with it). */
  chainFail: -2,
  /** Seconds before another Special Contract can be accepted. */
  chainCooldownSec: 300,
  /** Extra cash on every contract per reputation level. */
  cashPerLevel: 0.03,
} as const;

export const emptyReputation = (): ReputationState => ({ points: 0, chain: null, chainReadyAt: 0, chainsDone: 0 });

export function reputationLevel(points: number): number {
  let level = 0;
  while (level < REPUTATION.maxLevel && points >= REPUTATION.levelPoints(level + 1)) level += 1;
  return level;
}

/** Progress (0-1) from the current level to the next. */
export function reputationProgress(points: number): number {
  const level = reputationLevel(points);
  if (level >= REPUTATION.maxLevel) return 1;
  const from = REPUTATION.levelPoints(level);
  return Math.max(0, Math.min(1, (points - from) / (REPUTATION.levelPoints(level + 1) - from)));
}

/** Cash multiplier on contract rewards from reputation. */
export const reputationCashMul = (points: number): number => 1 + reputationLevel(points) * REPUTATION.cashPerLevel;
