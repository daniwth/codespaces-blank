/**
 * Supply drones: every few minutes a drone crosses the active room carrying a mystery crate.
 * Catching it (click the drone, or the CATCH button) pays one of four rewards scaled to the farm.
 * Purely an active-play bonus: nothing spawns while the game is closed.
 */
export type AirdropKind = 'cash' | 'coins' | 'overdrive' | 'gem' | 'nitro' | 'vip' | 'audit';

export const AIRDROP = {
  /** Seconds between drones (uniform), counted from the previous spawn. */
  interval: [150, 270] as [number, number],
  /** A new run sees its first drone early. */
  firstDelaySec: 75,
  /** Seconds the drone stays over the room before flying off. */
  lifetimeSec: 16,
  /**
   * Relative odds of each crate. The three special drones are rare: Liquid Nitrogen (ambient drop),
   * VIP (gems, or a block payout multiplier when the pool pays per block) and Audit (contract bonus).
   */
  weights: { cash: 42, coins: 23, overdrive: 22, gem: 4, nitro: 4, vip: 2, audit: 3 } as Record<AirdropKind, number>,
  /** Cash crate: this many seconds of the farm's estimated net income, never below `minCash`. */
  cashIncomeSec: 60,
  minCash: 15,
  /** Coin crate: this many seconds of mining, paid in the coin being mined. */
  coinsSec: 90,
  /** Overdrive: hashrate multiplier and seconds per crate; stacked crates extend it up to `overdriveMaxSec`. */
  overdriveMul: 2,
  overdriveSec: 30,
  overdriveMaxSec: 120,
  gems: 1,
} as const;

export const AIRDROP_KINDS: AirdropKind[] = ['cash', 'coins', 'overdrive', 'gem', 'nitro', 'vip', 'audit'];
/** Rare drones with their own look and reward. */
export const SPECIAL_AIRDROPS: AirdropKind[] = ['nitro', 'vip', 'audit'];
export const isSpecialAirdrop = (kind: AirdropKind): boolean => SPECIAL_AIRDROPS.includes(kind);
