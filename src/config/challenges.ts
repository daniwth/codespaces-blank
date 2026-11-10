import type { ChallengeId } from '../types/player';

/** Restrictions a challenge puts on a run (enforced by the pure simulation and the store actions). */
export interface ChallengeRules {
  /** BIOS locked at stock: overclocks are refused and ignored by the simulation. */
  lockOverclock: boolean;
  /** Only Bronze silicon: the lottery always rolls Bronze and higher grades do not mine. */
  bronzeOnly: boolean;
  /** Only the Bedroom can be used: other rooms cannot be bought, built in or mined in. */
  singleRoom: boolean;
  /** Multiplier on every room's contracted power line. */
  powerCapMul: number;
}

export interface ChallengeDef {
  id: ChallengeId;
  name: string;
  tagline: string;
  description: string;
  color: string;
  rules: ChallengeRules;
  /** One-time bonus the first time the challenge is completed. */
  firstSc: number;
  firstGems: number;
  /** Smaller bonus for every repeat clear. */
  repeatSc: number;
  repeatGems: number;
}

export const NO_RULES: ChallengeRules = { lockOverclock: false, bronzeOnly: false, singleRoom: false, powerCapMul: 1 };

/** Power Cap: share of every room's contracted line that stays available. */
export const POWER_CAP_MUL = 0.35;

/**
 * Completing a challenge means reaching the Halving threshold (HALVING_MIN_EARNINGS of run earnings)
 * while its restriction holds. Bonus sizes follow how much slower the restricted run is
 * (measured with the capital-growth model in tests/unit/challengeBalance.test.ts: Bronze Only and No
 * Overclock cost ~2-5% of run time, Power Cap ~10%, Single Room ~80%), on top of the 4+ $SC a normal Halving pays.
 */

export const CHALLENGES: ChallengeDef[] = [
  {
    id: 'bronze_only', name: 'Bronze Only', tagline: 'No silicon lottery',
    description: 'Only Bronze silicon counts: every purchase rolls Bronze and any higher grade stays idle. Overclock headroom is the lowest.',
    color: '#d97706', rules: { ...NO_RULES, bronzeOnly: true },
    firstSc: 2, firstGems: 3, repeatSc: 1, repeatGems: 1,
  },
  {
    id: 'no_overclock', name: 'No Overclock', tagline: 'Stock BIOS only',
    description: 'The BIOS is locked at stock clocks: no overclocks and no AI tuning. Every card runs at its base hashrate.',
    color: '#38bdf8', rules: { ...NO_RULES, lockOverclock: true },
    firstSc: 3, firstGems: 4, repeatSc: 1, repeatGems: 2,
  },
  {
    id: 'power_cap', name: 'Power Cap', tagline: 'A third of the grid',
    description: 'Every room line is cut to 35%. Overdraw causes brownouts, so hashrate per watt, PSUs and cooling decide the run.',
    color: '#fbbf24', rules: { ...NO_RULES, powerCapMul: POWER_CAP_MUL },
    firstSc: 5, firstGems: 8, repeatSc: 2, repeatGems: 3,
  },
  {
    id: 'single_room', name: 'Single Room', tagline: 'Bedroom or bust',
    description: 'You cannot buy or use any room except the Bedroom. Squeeze the whole run out of two pads and a 1.5 kW line.',
    color: '#f43f5e', rules: { ...NO_RULES, singleRoom: true },
    firstSc: 8, firstGems: 12, repeatSc: 3, repeatGems: 5,
  },
];

export const CHALLENGE_BY_ID = Object.fromEntries(CHALLENGES.map((c) => [c.id, c])) as Record<ChallengeId, ChallengeDef>;
export const CHALLENGE_IDS: ChallengeId[] = CHALLENGES.map((c) => c.id);

export const isChallengeId = (v: unknown): v is ChallengeId => typeof v === 'string' && v in CHALLENGE_BY_ID;

export const challengeRules = (id: ChallengeId | null | undefined): ChallengeRules => (id ? CHALLENGE_BY_ID[id].rules : NO_RULES);
