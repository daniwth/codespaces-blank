import type { FarmBuffs } from '../types/player';

/**
 * Short, player-triggered boosts: rallying the crew (click a technician) and the special supply drones.
 * They are plain timestamps in the save, read by the pure simulation.
 */
export const BUFFS = {
  /** Crew rally: maintenance runs faster and the crew's fans-and-ducts hustle adds a little cooling. */
  crew: { durationSec: 45, cooldownSec: 180, speedMul: 4, coolingMul: 1.12 },
  /** Liquid nitrogen drone: ambient temperature drop in every room. */
  nitro: { delta: -25, durationSec: 60 },
  /** VIP drone: gems, or a payout multiplier on every block found while it lasts. */
  vip: { gems: 3, blockMul: 2, durationSec: 300 },
  /** Audit drone: the next contract claims pay extra cash. */
  audit: { cashMul: 1.5, claims: 1, maxClaims: 3 },
} as const;

export const emptyBuffs = (): FarmBuffs => ({ techUntil: 0, techCooldownUntil: 0, nitroUntil: 0, blockMulUntil: 0, auditClaims: 0 });

export const crewRallied = (b: Pick<FarmBuffs, 'techUntil'>, now: number): boolean => now < b.techUntil;
export const crewReady = (b: Pick<FarmBuffs, 'techCooldownUntil'>, now: number): boolean => now >= b.techCooldownUntil;
export const nitroActive = (b: Pick<FarmBuffs, 'nitroUntil'>, now: number): boolean => now < b.nitroUntil;
export const blockMulOf = (b: Pick<FarmBuffs, 'blockMulUntil'>, now: number): number => (now < b.blockMulUntil ? BUFFS.vip.blockMul : 1);
