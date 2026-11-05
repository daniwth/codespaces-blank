import type { TalentId, TalentLevels, TalentNode } from '../types/player';

const pct = (v: number) => `${Math.round(v * 100)}%`;

/** Smart Contract ($SC) permanent talent tree, unlocked by The Halving. */
export const PRESTIGE_TREE: TalentNode[] = [
  {
    id: 'hash_core', name: 'Hash Amplifier', icon: 'zap', col: 2, row: 0,
    description: 'Global hashrate bonus on every device.',
    maxLevel: 10, costBase: 1, costGrowth: 1.45, requires: [], effect: 0.1,
    format: (l) => `+${pct(l * 0.1)} hashrate`,
  },
  {
    id: 'power_discount', name: 'Green PPA', icon: 'leaf', col: 0, row: 1,
    description: 'Long-term renewable power purchase agreement.',
    maxLevel: 5, costBase: 2, costGrowth: 1.6, requires: ['hash_core'], effect: 0.08,
    format: (l) => `-${pct(l * 0.08)} electricity`,
  },
  {
    id: 'thermal_mastery', name: 'Thermal Mastery', icon: 'snowflake', col: 2, row: 1,
    description: 'Undervolt-friendly firmware: devices emit less heat.',
    maxLevel: 5, costBase: 2, costGrowth: 1.6, requires: ['hash_core'], effect: 0.06,
    format: (l) => `-${pct(l * 0.06)} heat`,
  },
  {
    id: 'quick_start', name: 'Seed Capital', icon: 'coins', col: 4, row: 1,
    description: 'Start every run with extra cash.',
    maxLevel: 5, costBase: 1, costGrowth: 2, requires: ['hash_core'], effect: 1,
    format: (l) => (l === 0 ? '+$0 start' : `+$${(250 * 4 ** l).toLocaleString('en-US')} start`),
  },
  {
    id: 'offline_ext', name: 'Night Shift', icon: 'moon', col: 0, row: 2,
    description: 'Extends the offline earnings window.',
    maxLevel: 4, costBase: 3, costGrowth: 1.8, requires: ['power_discount'], effect: 4,
    format: (l) => `+${l * 4}h offline cap`,
  },
  {
    id: 'silicon_luck', name: 'Silicon Whisperer', icon: 'cpu', col: 1, row: 2,
    description: 'Better odds in the silicon lottery.',
    maxLevel: 3, costBase: 4, costGrowth: 2, requires: ['thermal_mastery'], effect: 1,
    format: (l) => `x${(1 + l * 0.6).toFixed(1)} Gold/God odds`,
  },
  {
    id: 'market_insight', name: 'Insider Ticker', icon: 'trending', col: 3, row: 2,
    description: 'Sell coins at a premium.',
    maxLevel: 5, costBase: 3, costGrowth: 1.7, requires: ['quick_start'], effect: 0.03,
    format: (l) => `+${pct(l * 0.03)} sell price`,
  },
  {
    id: 'tech_union', name: 'Tech Union', icon: 'wrench', col: 4, row: 2,
    description: 'Free starting technician and faster maintenance.',
    maxLevel: 3, costBase: 4, costGrowth: 2, requires: ['quick_start'], effect: 0.25,
    format: (l) => `+${l} tech, +${pct(l * 0.25)} speed`,
  },
  {
    id: 'vip_slots', name: 'VIP Floor Plans', icon: 'crown', col: 1, row: 3,
    description: 'Extra rack pad in every room.',
    maxLevel: 3, costBase: 8, costGrowth: 2, requires: ['silicon_luck', 'offline_ext'], effect: 1,
    format: (l) => `+${l} rack pads`,
  },
  {
    id: 'quantum_entanglement', name: 'Quantum Entangle', icon: 'atom', col: 2, row: 3,
    description: 'Late-game multiplicative hashrate bonus.',
    maxLevel: 5, costBase: 15, costGrowth: 2.2, requires: ['silicon_luck', 'market_insight'], effect: 0.25,
    format: (l) => `x${(1 + l * 0.25).toFixed(2)} hashrate`,
  },
  {
    id: 'room_keeper', name: 'Real Estate Trust', icon: 'building', col: 3, row: 3,
    description: 'Keep purchased rooms through every Halving.',
    maxLevel: 1, costBase: 25, costGrowth: 1, requires: ['market_insight'], effect: 1,
    format: (l) => (l > 0 ? 'Rooms kept' : 'Rooms reset'),
  },
];

export const TALENT_BY_ID = Object.fromEntries(PRESTIGE_TREE.map((t) => [t.id, t])) as Record<TalentId, TalentNode>;

export const talentLevel = (talents: TalentLevels, id: TalentId): number => talents[id] ?? 0;

export const talentCost = (node: TalentNode, currentLevel: number): number =>
  Math.ceil(node.costBase * node.costGrowth ** currentLevel);

/** Smart Contracts awarded for a halving given the run's cash earnings. */
export const scForEarnings = (runEarnings: number): number =>
  runEarnings < HALVING_MIN_EARNINGS ? 0 : Math.floor(2 * Math.sqrt(runEarnings / 1e6));

export const HALVING_MIN_EARNINGS = 1e6;

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
  };
}
