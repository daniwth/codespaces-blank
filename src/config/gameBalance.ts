import type { NetworkEventDef, NetworkEventId, PoolDefinition, PoolMode } from '../types/economy';
import type { AchievementDef } from '../types/player';

export const SAVE_VERSION = 7;
export const SAVE_KEY = 'hash-harvest-tycoon';
export const SAVE_SALT = 'HHT::pixel-rigs::v1';

/** Simulation constants. */
export const PHYSICS = {
  /** Passive heat transfer of a bare GPU heatsink (W/°C). */
  baseCooling: 1.2,
  throttleTemp: 85,
  wearTemp: 88,
  shutdownTemp: 95,
  restartTemp: 60,
  /** Efficiency lost per minute above wearTemp. */
  wearPerMinute: 0.01,
  maxWear: 0.6,
  /** Seconds for thermal paste to fully dry out. */
  pasteLifetimeSec: 2_400,
  /** Paste factor range: k *= lerp(min, 1, paste). */
  pasteMinFactor: 0.6,
  /** Seconds for room air to settle towards its target temperature. */
  roomTau: 40,
  /** Electricity price in $ per watt-second of wall power. */
  pricePerWattSec: 0.0008,
  /** CC minted per second per MH/s at difficulty 1. */
  rewardPerMHs: 0.02,
  /** Technician restoration rates per second per technician. */
  techPastePerSec: 1 / 300,
  techWearRepairPerSec: 0.0004,
  rebootMs: 10_000,
  inspectionRebootMs: 30_000,
  soloBlockMeanSec: 300,
  soloEvMul: 1.15,
  darknetRaidMeanSec: 420,
} as const;

/**
 * Grid demand: dense, high-hash hardware is billed at industrial demand rates.
 * Each GPU model pays pricePerWattSec × (its hash per watt / PX-460 hash per watt) ^ tariffExponent
 * for every wall watt it draws. Hash per watt grows ~3x per tier, so a flat tariff
 * made the power bill vanish after the first hour; with this curve electricity
 * stays ~10-25% of gross mining revenue on every tier (in its natural room / PSU),
 * so PSU efficiency, cheaper rooms and Green PPA keep paying off, while no device
 * is ever net-negative (worst case, the Bedroom on the weakest PSU that carries it: <75%).
 */
export const GRID = {
  tariffExponent: 1.05,
} as const;

export const POOLS: Record<PoolMode, PoolDefinition> = {
  public: {
    id: 'public', name: 'Public Stable Pool', tagline: 'Steady shares',
    description: 'Constant payouts for every valid share. The pool keeps a 2% fee.',
    payoutMul: 1, fee: 0.02, unlockLevel: 1, color: '#22c55e',
  },
  solo: {
    id: 'solo', name: 'Solo Mining', tagline: 'Jackpot or nothing',
    description: 'Zero income between blocks, but every block found pays a massive jackpot (+15% EV) and may drop a gem.',
    payoutMul: PHYSICS.soloEvMul, fee: 0, unlockLevel: 3, color: '#facc15',
  },
  darknet: {
    id: 'darknet', name: 'Darknet Anon Pool', tagline: 'Unregulated coins',
    description: '+75% yield on unregulated coins, but random fines and electrical inspections shut your rigs down.',
    payoutMul: 1.75, fee: 0, unlockLevel: 6, color: '#f43f5e',
  },
};

export const POOL_ORDER: PoolMode[] = ['public', 'solo', 'darknet'];

export const NETWORK_EVENTS: Record<NetworkEventId, NetworkEventDef> = {
  difficulty_spike: {
    id: 'difficulty_spike', name: 'Difficulty Spike', positive: false, color: '#f97316',
    description: 'A whale joined the network: difficulty +40% ($BYT only +15%).', duration: [45, 90],
  },
  blackout: {
    id: 'blackout', name: 'Zonal Blackout', positive: false, color: '#64748b',
    description: 'The grid failed in one of your rooms. Rigs are offline.', duration: [20, 40],
  },
  heatwave: {
    id: 'heatwave', name: 'Summer Heatwave', positive: false, color: '#ef4444',
    description: 'Ambient temperature +12°C in every room.', duration: [60, 120],
  },
  cold_snap: {
    id: 'cold_snap', name: 'Cold Snap', positive: true, color: '#38bdf8',
    description: 'Ambient temperature -8°C. Free cooling!', duration: [60, 120],
  },
  bull_run: {
    id: 'bull_run', name: 'Bull Run', positive: true, color: '#22c55e',
    description: '$CC and $NOVA hype: prices drift towards 1.6x ($BYT only 1.15x).', duration: [60, 120],
  },
  meme_mania: {
    id: 'meme_mania', name: 'Meme Mania', positive: true, color: '#e879f9',
    description: '$MEME volatility goes parabolic.', duration: [45, 90],
  },
  flash_sale: {
    id: 'flash_sale', name: 'Flash Sale', positive: true, color: '#facc15',
    description: 'Suppliers dump stock: GPUs, PSUs, coolers and racks are 20% off.', duration: [45, 75],
  },
};

export const EVENT_INTERVAL: [number, number] = [90, 180];

export const EVENT_EFFECTS = {
  difficultyMul: 1.4,
  heatwaveDelta: 12,
  coldSnapDelta: -8,
  bullMeanMul: 1.6,
  /** $BYT barely reacts to a Bull Run and shrugs off most of a Difficulty Spike. */
  bytBullMeanMul: 1.15,
  bytDifficultyMul: 1.15,
  memeVolMul: 2.6,
  /** Flash Sale: multiplier on hardware prices in the Shop. */
  flashSaleMul: 0.8,
};

export const MARKET = {
  candleMs: 5_000,
  maxCandles: 72,
  fee: 0.005,
  cc: { base: 1, sigma: 0.022, theta: 0.012, min: 0.25, max: 4 },
  /** min/max are multiples of the base price (MEME swings 0.1x – 10x). */
  meme: { base: 0.01, sigma: 0.07, theta: 0.004, min: 0.1, max: 10 },
  /** $BYT: steady, low volatility, strongly mean-reverting. */
  byt: { base: 0.25, sigma: 0.008, theta: 0.03, min: 0.6, max: 1.6 },
  /** $NOVA: young and volatile, 0.2x - 6x. */
  nova: { base: 4, sigma: 0.045, theta: 0.006, min: 0.2, max: 6 },
  maxBots: 4,
  vipPeakThreshold: 1.3,
} as const;

export const VIP_COSTS = {
  goldRack: 25,
  aiDiagnostics: 15,
  autoSellPeaks: 10,
  maxGoldRacks: 4,
} as const;

export const STARTING_CASH = 40;

/** Player level derived from lifetime cash earnings. */
export const levelFromEarnings = (lifetime: number): number =>
  Math.max(1, Math.floor(Math.log10(Math.max(1, lifetime)) * 1.6) + 1);

export const earningsForLevel = (level: number): number => 10 ** ((level - 1) / 1.6);

export const BOT_UNLOCK_LEVEL = 4;

export const ACHIEVEMENTS: AchievementDef[] = [
  { id: 'first_hash', name: 'Hello Blockchain', description: 'Reach 50 MH/s.', gems: 2, check: (c) => c.totalHash >= 50e6 },
  { id: 'gh', name: 'Giga Farmer', description: 'Reach 1 GH/s.', gems: 4, check: (c) => c.totalHash >= 1e9 },
  { id: 'th', name: 'Tera Tycoon', description: 'Reach 1 TH/s.', gems: 8, check: (c) => c.totalHash >= 1e12 },
  { id: 'ph', name: 'Peta Overlord', description: 'Reach 1 PH/s.', gems: 15, check: (c) => c.totalHash >= 1e15 },
  { id: 'k', name: 'Pocket Money', description: 'Earn $1K lifetime.', gems: 2, check: (c) => c.lifetimeEarnings >= 1e3 },
  { id: 'm', name: 'Millionaire Miner', description: 'Earn $1M lifetime.', gems: 6, check: (c) => c.lifetimeEarnings >= 1e6 },
  { id: 'b', name: 'Billion Byte Baron', description: 'Earn $1B lifetime.', gems: 12, check: (c) => c.lifetimeEarnings >= 1e9 },
  { id: 'gpu10', name: 'Rig Builder', description: 'Own 10 mining devices.', gems: 3, check: (c) => c.gpuCount >= 10 },
  { id: 'god', name: 'Silicon God', description: 'Pull a Silicon God GPU.', gems: 5, check: (c) => c.godGpus >= 1 },
  { id: 'rooms3', name: 'Real Estate Mogul', description: 'Own 3 rooms.', gems: 5, check: (c) => c.roomsOwned >= 3 },
  { id: 'halving', name: 'The First Halving', description: 'Perform The Halving.', gems: 10, check: (c) => c.halvings >= 1 },
  { id: 'block', name: 'Block Hunter', description: 'Find a solo block.', gems: 3, check: (c) => c.blocksFound >= 1 },
  { id: 'block10', name: 'Lucky Streak', description: 'Find 10 solo blocks.', gems: 6, check: (c) => c.blocksFound >= 10 },
  { id: 'raid', name: 'Wanted', description: 'Survive a darknet raid.', gems: 2, check: (c) => c.raids >= 1 },
  { id: 'bsod', name: 'Blue Screen Veteran', description: 'Crash a rig with a bad overclock.', gems: 1, check: (c) => c.bsods >= 1 },
  { id: 'oc5', name: 'Overclock Artisan', description: 'Apply 5 stable overclocks.', gems: 4, check: (c) => c.stableOverclocks >= 5 },
  { id: 'tech3', name: 'Crew Chief', description: 'Hire 3 technicians.', gems: 3, check: (c) => c.technicians >= 3 },
  { id: 'trade', name: 'Diamond Hands', description: 'Profit $1K in a single trade.', gems: 3, check: (c) => c.bestTrade >= 1_000 },
  { id: 'contracts10', name: 'Reliable Contractor', description: 'Claim 10 contracts.', gems: 3, check: (c) => c.contractsCompleted >= 10 },
  { id: 'rooms5', name: 'Deep Six', description: 'Own all 5 rooms.', gems: 10, check: (c) => c.roomsOwned >= 5 },
  { id: 'halving10', name: 'Serial Halver', description: 'Perform The Halving 10 times.', gems: 10, check: (c) => c.halvings >= 10 },
  { id: 'research10', name: 'Lab Rat', description: 'Complete 10 research levels.', gems: 4, check: (c) => c.researchDone >= 10 },
  { id: 'fusion5', name: 'Silicon Alchemist', description: 'Fuse GPUs 5 times in the Silicon Forge.', gems: 4, check: (c) => c.fusions >= 5 },
  { id: 'airdrops10', name: 'Drone Hunter', description: 'Catch 10 supply drones.', gems: 3, check: (c) => c.airdrops >= 10 },
  { id: 'streak7', name: 'Regular', description: 'Claim the daily bonus 7 days in a row.', gems: 7, check: (c) => c.bestStreak >= 7 },
  { id: 'alts', name: 'Diversified', description: 'Hold $BYT and $NOVA at the same time.', gems: 3, check: (c) => c.altsHeld >= 2 },
  { id: 'challenge1', name: 'Challenger', description: 'Complete a challenge run.', gems: 4, check: (c) => c.challengesCleared >= 1 },
  { id: 'challenge4', name: 'Iron Miner', description: 'Complete every challenge run.', gems: 12, check: (c) => c.challengesCleared >= 4 },
  { id: 'roadmap', name: 'Roadmap Graduate', description: 'Claim every goal of the roadmap.', gems: 10, check: (c) => c.roadmapTotal > 0 && c.roadmapStep >= c.roadmapTotal },
];
