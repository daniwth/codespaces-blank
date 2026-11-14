import type { TalentId, TalentLevels, TalentNode } from '../types/player';

const pct = (v: number) => `${Math.round(v * 100)}%`;

/**
 * Smart Contract ($SC) permanent talent tree, unlocked by The Halving.
 * Priced for the diminishing-returns reward (≈4–9 $SC per run): ~280 $SC buys
 * the whole tree, so it fills over a few dozen runs with Quantum Entangle last.
 */
export const PRESTIGE_TREE: TalentNode[] = [
  {
    id: 'hash_core', name: 'Hash Amplifier', icon: 'zap', col: 2, row: 0,
    description: 'Global hashrate bonus on every device.',
    maxLevel: 10, costBase: 1, costGrowth: 1.2, requires: [], effect: 0.1,
    format: (l) => `+${pct(l * 0.1)} hashrate`,
  },
  {
    id: 'power_discount', name: 'Green PPA', icon: 'leaf', col: 0, row: 1,
    description: 'Long-term renewable power purchase agreement.',
    maxLevel: 5, costBase: 1, costGrowth: 1.4, requires: ['hash_core'], effect: 0.08,
    format: (l) => `-${pct(l * 0.08)} electricity`,
  },
  {
    id: 'thermal_mastery', name: 'Thermal Mastery', icon: 'snowflake', col: 2, row: 1,
    description: 'Undervolt-friendly firmware: devices emit less heat.',
    maxLevel: 5, costBase: 1, costGrowth: 1.4, requires: ['hash_core'], effect: 0.06,
    format: (l) => `-${pct(l * 0.06)} heat`,
  },
  {
    id: 'quick_start', name: 'Seed Capital', icon: 'coins', col: 4, row: 1,
    description: 'Start every run with extra cash.',
    maxLevel: 5, costBase: 1, costGrowth: 1.5, requires: ['hash_core'], effect: 1,
    format: (l) => (l === 0 ? '+$0 start' : `+$${(250 * 4 ** l).toLocaleString('en-US')} start`),
  },
  {
    id: 'offline_ext', name: 'Night Shift', icon: 'moon', col: 0, row: 2,
    description: 'Extends the offline earnings window.',
    maxLevel: 4, costBase: 2, costGrowth: 1.4, requires: ['power_discount'], effect: 4,
    format: (l) => `+${l * 4}h offline cap`,
  },
  {
    id: 'silicon_luck', name: 'Silicon Whisperer', icon: 'cpu', col: 1, row: 2,
    description: 'Better odds in the silicon lottery.',
    maxLevel: 3, costBase: 2, costGrowth: 1.6, requires: ['thermal_mastery'], effect: 1,
    format: (l) => `x${(1 + l * 0.6).toFixed(1)} Gold/God odds`,
  },
  {
    id: 'market_insight', name: 'Insider Ticker', icon: 'trending', col: 3, row: 2,
    description: 'Sell coins at a premium.',
    maxLevel: 5, costBase: 2, costGrowth: 1.4, requires: ['quick_start'], effect: 0.03,
    format: (l) => `+${pct(l * 0.03)} sell price`,
  },
  {
    id: 'tech_union', name: 'Tech Union', icon: 'wrench', col: 4, row: 2,
    description: 'Free starting technician and faster maintenance.',
    maxLevel: 3, costBase: 2, costGrowth: 1.6, requires: ['quick_start'], effect: 0.25,
    format: (l) => `+${l} tech, +${pct(l * 0.25)} speed`,
  },
  {
    id: 'vip_slots', name: 'VIP Floor Plans', icon: 'crown', col: 1, row: 3,
    description: 'Extra rack pad in every room.',
    maxLevel: 3, costBase: 4, costGrowth: 1.6, requires: ['silicon_luck', 'offline_ext'], effect: 1,
    format: (l) => `+${l} rack pads`,
  },
  {
    id: 'quantum_entanglement', name: 'Quantum Entangle', icon: 'atom', col: 2, row: 3,
    description: 'Late-game multiplicative hashrate bonus.',
    maxLevel: 5, costBase: 6, costGrowth: 1.5, requires: ['silicon_luck', 'market_insight'], effect: 0.25,
    format: (l) => `x${(1 + l * 0.25).toFixed(2)} hashrate`,
  },
  {
    id: 'room_keeper', name: 'Real Estate Trust', icon: 'building', col: 3, row: 3,
    description: 'Keep purchased rooms through every Halving.',
    maxLevel: 1, costBase: 10, costGrowth: 1, requires: ['market_insight'], effect: 1,
    format: (l) => (l > 0 ? 'Rooms kept' : 'Rooms reset'),
  },
  {
    id: 'drone_uplink', name: 'Drone Uplink', icon: 'radar', col: 0, row: 3,
    description: 'Supply drones carry bigger payloads.',
    maxLevel: 3, costBase: 3, costGrowth: 1.6, requires: ['offline_ext'], effect: 0.5,
    format: (l) => `+${pct(l * 0.5)} drone loot`,
  },
  {
    id: 'lab_grant', name: 'R&D Grant', icon: 'flask', col: 4, row: 3,
    description: 'A standing research grant: Lab projects finish sooner.',
    maxLevel: 3, costBase: 3, costGrowth: 1.6, requires: ['tech_union'], effect: 0.15,
    format: (l) => `-${pct(l * 0.15)} research time`,
  },
  {
    id: 'used_market', name: 'Grey Market', icon: 'recycle', col: 1, row: 4,
    description: 'Unlocks used GPUs in the Shop: 45% off, with random wear and tired paste.',
    maxLevel: 1, costBase: 6, costGrowth: 1, requires: ['vip_slots'], effect: 1,
    format: (l) => (l > 0 ? 'Used GPUs on sale' : 'No used market'),
  },
  {
    id: 'forge_mastery', name: 'Forge Mastery', icon: 'hammer', col: 2, row: 4,
    description: 'The Silicon Forge may need only 2 cards instead of 3.',
    maxLevel: 3, costBase: 4, costGrowth: 1.6, requires: ['quantum_entanglement'], effect: 0.2,
    format: (l) => `${pct(l * 0.2)} chance of a 2-card fusion`,
  },
  {
    id: 'solo_luck', name: 'Lone Wolf', icon: 'dice', col: 3, row: 4,
    description: 'Bigger jackpots for every block found Solo Mining.',
    maxLevel: 3, costBase: 4, costGrowth: 1.6, requires: ['room_keeper'], effect: 0.15,
    format: (l) => `+${pct(l * 0.15)} solo block payout`,
  },
];

export const TALENT_BY_ID = Object.fromEntries(PRESTIGE_TREE.map((t) => [t.id, t])) as Record<TalentId, TalentNode>;

export const talentLevel = (talents: TalentLevels, id: TalentId): number => talents[id] ?? 0;

export const talentCost = (node: TalentNode, currentLevel: number): number =>
  Math.ceil(node.costBase * node.costGrowth ** currentLevel);

export const HALVING_MIN_EARNINGS = 4e6;
/** $SC minted by a Halving right at the unlock threshold. */
export const HALVING_BASE_SC = 4;

/**
 * Smart Contracts awarded for a halving given the run's cash earnings.
 * 4 $SC at $4M, then every extra $SC needs ×2, ×3, ×4… more earnings
 * ($8M → 5, $24M → 6, $96M → 7, $480M → 8, $2.88B → 9…).
 *
 * Run earnings grow roughly like a power of run time, so these diminishing
 * returns make $SC per hour of run time peak a little after the threshold
 * and then decline: cashing out has a best moment instead of "always wait".
 */
export function scForEarnings(runEarnings: number): number {
  if (!(runEarnings >= HALVING_MIN_EARNINGS)) return 0;
  let sc = HALVING_BASE_SC;
  let next = HALVING_MIN_EARNINGS * 2;
  // `next` overflows to Infinity after ~170 milestones, which also stops the loop for E = Infinity.
  while (Number.isFinite(next) && runEarnings >= next) {
    sc += 1;
    next *= sc - HALVING_BASE_SC + 2;
  }
  return sc;
}

/** Run earnings needed to mint `sc` Smart Contracts (the threshold for anything ≤ HALVING_BASE_SC). */
export function earningsForSc(sc: number): number {
  let e = HALVING_MIN_EARNINGS;
  for (let m = 1; m <= sc - HALVING_BASE_SC; m += 1) e *= m + 1;
  return e;
}

/** Run earnings at which the Halving reward grows by one more $SC. */
export const nextScMilestone = (runEarnings: number): number => {
  const sc = scForEarnings(runEarnings);
  return sc <= 0 ? HALVING_MIN_EARNINGS : earningsForSc(sc + 1);
};

export interface TalentModifiers {
  hashMul: number;
  electricityMul: number;
  heatMul: number;
  startCash: number;
  offlineHours: number;
  qualityLuck: number;
  sellBonus: number;
  startTechnicians: number;
  techSpeed: number;
  extraPads: number;
  keepRooms: boolean;
  /** Multiplier on supply drone rewards. */
  airdropMul: number;
  /** Multiplier on Lab research time. */
  researchTimeMul: number;
  /** Used GPUs can be bought in the Shop. */
  usedMarket: boolean;
  /** Chance (0-1) that a fusion consumes 2 cards instead of 3. */
  forgeSave: number;
  /** Multiplier on Solo Mining block payouts. */
  soloMul: number;
}

export const BASE_OFFLINE_HOURS = 8;

export function talentModifiers(talents: TalentLevels): TalentModifiers {
  const l = (id: TalentId) => talentLevel(talents, id);
  return {
    hashMul: (1 + l('hash_core') * 0.1) * (1 + l('quantum_entanglement') * 0.25),
    electricityMul: 1 - l('power_discount') * 0.08,
    heatMul: 1 - l('thermal_mastery') * 0.06,
    startCash: l('quick_start') > 0 ? 250 * 4 ** l('quick_start') : 0,
    offlineHours: BASE_OFFLINE_HOURS + l('offline_ext') * 4,
    qualityLuck: 1 + l('silicon_luck') * 0.6,
    sellBonus: l('market_insight') * 0.03,
    startTechnicians: l('tech_union'),
    techSpeed: 1 + l('tech_union') * 0.25,
    extraPads: l('vip_slots'),
    keepRooms: l('room_keeper') > 0,
    airdropMul: 1 + l('drone_uplink') * 0.5,
    researchTimeMul: 1 - l('lab_grant') * 0.15,
    usedMarket: l('used_market') > 0,
    forgeSave: l('forge_mastery') * 0.2,
    soloMul: 1 + l('solo_luck') * 0.15,
  };
}
