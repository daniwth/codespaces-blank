import type {
  ActiveNetworkEvent,
  AltWallets,
  BigNum,
  MarketState,
  MineableCoin,
  PoolMode,
  TradingBot,
} from './economy';
import type { ContractBoard } from './contracts';
import type { CoolerInstance, GpuInstance, PsuInstance, RackInstance } from './hardware';

export type RoomId = 'bedroom' | 'garage' | 'warehouse' | 'arctic' | 'submarine';

/** Optional run modifiers chosen before a run starts (New game / The Halving). */
export type ChallengeId = 'no_overclock' | 'bronze_only' | 'single_room' | 'power_cap';

export interface ActiveChallenge {
  id: ChallengeId;
  /** Epoch ms when the challenge run began (completion time = reaching the Halving threshold minus this). */
  startedAt: number;
}

export interface ChallengeRecord {
  /** Times this challenge has been completed. */
  clears: number;
  /** Fastest completion in seconds. */
  bestTimeSec: number;
}

export type ChallengeRecords = Partial<Record<ChallengeId, ChallengeRecord>>;

/** Run-scoped research projects bought with cash in the Lab (wiped by The Halving). */
export type ResearchId = 'firmware' | 'airflow' | 'pfc' | 'paste' | 'grid' | 'logistics';

export type ResearchLevels = Partial<Record<ResearchId, number>>;

export interface ActiveResearch {
  id: ResearchId;
  /** Epoch ms. The level is granted once `endsAt` passes (also while offline). */
  startedAt: number;
  endsAt: number;
}

export interface ResearchState {
  levels: ResearchLevels;
  /** Project in progress: the Lab works on one at a time. */
  active: ActiveResearch | null;
}

/** Temporary hashrate surge (Overdrive airdrop). */
export interface HashBoost {
  mul: number;
  /** Epoch ms when the surge ends. */
  until: number;
}

/** Guided goal chain: `step` goals claimed so far; `ready` = the current goal is met and waits to be claimed. */
export interface RoadmapState {
  step: number;
  ready: boolean;
}

/** Daily bonus streak. `lastDay` is a local calendar day number (0 = never claimed). */
export interface DailyState {
  lastDay: number;
  streak: number;
}

export interface RoomTheme {
  wall: string;
  wallDark: string;
  floorA: string;
  floorB: string;
  trim: string;
  light: string;
}

export interface RoomDefinition {
  id: RoomId;
  name: string;
  subtitle: string;
  price: number;
  /** Base ambient temperature in °C. */
  ambient: number;
  /** Contracted electrical line in watts (wall power). */
  maxPowerW: number;
  /** Number of floor pads where racks can be placed. */
  pads: number;
  /** Electricity price multiplier. */
  priceMul: number;
  /** Multiplier on the heat transfer coefficient of every rack. */
  coolingMul: number;
  /** Room temperature rise per watt of waste heat (°C/W). */
  heatPerWatt: number;
  theme: RoomTheme;
}

export type TalentId =
  | 'hash_core'
  | 'power_discount'
  | 'thermal_mastery'
  | 'quick_start'
  | 'offline_ext'
  | 'silicon_luck'
  | 'market_insight'
  | 'tech_union'
  | 'vip_slots'
  | 'quantum_entanglement'
  | 'room_keeper'
  | 'drone_uplink'
  | 'lab_grant';

export type TalentIcon =
  | 'zap'
  | 'leaf'
  | 'snowflake'
  | 'coins'
  | 'moon'
  | 'cpu'
  | 'trending'
  | 'wrench'
  | 'crown'
  | 'atom'
  | 'building'
  | 'radar'
  | 'flask';

export interface TalentNode {
  id: TalentId;
  name: string;
  description: string;
  icon: TalentIcon;
  maxLevel: number;
  costBase: number;
  costGrowth: number;
  requires: TalentId[];
  col: number;
  row: number;
  /** Per-level effect magnitude used by the physics/economy layer. */
  effect: number;
  /** Human readable effect for a given level. */
  format: (level: number) => string;
}

export type TalentLevels = Partial<Record<TalentId, number>>;

export interface AchievementContext {
  totalHash: number;
  lifetimeEarnings: number;
  gpuCount: number;
  godGpus: number;
  roomsOwned: number;
  halvings: number;
  blocksFound: number;
  raids: number;
  bsods: number;
  technicians: number;
  goldRacks: number;
  stableOverclocks: number;
  bestTrade: number;
  contractsCompleted: number;
  /** Roadmap goals claimed and the length of the roadmap. */
  roadmapStep: number;
  roadmapTotal: number;
  researchDone: number;
  fusions: number;
  airdrops: number;
  bestStreak: number;
  /** Different altcoins held right now (0-2). */
  altsHeld: number;
  challengesCleared: number;
}

export interface AchievementDef {
  id: string;
  name: string;
  description: string;
  gems: number;
  check: (ctx: AchievementContext) => boolean;
}

export interface PlayerStats {
  blocksFound: number;
  halvings: number;
  raids: number;
  bsods: number;
  overheats: number;
  stableOverclocks: number;
  gpusBought: number;
  playTimeSec: number;
  maxHashrate: number;
  bestTrade: number;
  /** Contracts claimed, across every run. */
  contractsCompleted: number;
  /** Supply drones caught. */
  airdrops: number;
  /** GPU fusions done in the Silicon Forge. */
  fusions: number;
  /** Research levels completed, across every run. */
  researchDone: number;
  /** Longest daily-bonus streak. */
  bestStreak: number;
}

/** AI Farm Manager (gem-bought autopilot). */
export interface AutopilotState {
  /** Manager time left, in seconds of open game. */
  remainingSec: number;
  paused: boolean;
  /** Purchases made and cash spent by the manager, across every plan. */
  purchases: number;
  spent: number;
}

export interface VipState {
  goldRacksBought: number;
  aiDiagnostics: boolean;
  autoSellPeaks: boolean;
  autoSellEnabled: boolean;
}

export interface GameSettings {
  muted: boolean;
  volume: number;
  ambientHum: boolean;
  particles: boolean;
  offlineProgress: boolean;
}

/** Everything that is persisted to localStorage and exported in save files. */
export interface GameData {
  saveVersion: number;
  createdAt: number;
  lastTick: number;
  // Wallets
  cash: BigNum;
  cc: BigNum;
  meme: number;
  /** Total cash spent on the current $MEME bag (for P&L). */
  memeCostBasis: number;
  /** Cash spent on $CC that is still held (mined coins have no cost). */
  ccCostBasis: number;
  /** $BYT and $NOVA wallets. */
  alts: AltWallets;
  /** Coin the farm mines (every pool pays this one). */
  minedCoin: MineableCoin;
  gems: number;
  sc: number;
  scLifetime: number;
  runEarnings: BigNum;
  lifetimeEarnings: BigNum;
  /** Epoch ms when the current run started (first launch or last Halving). */
  runStartedAt: number;
  // Hardware (normalized by uid)
  gpus: Record<string, GpuInstance>;
  psus: Record<string, PsuInstance>;
  coolers: Record<string, CoolerInstance>;
  racks: Record<string, RackInstance>;
  // World
  ownedRooms: RoomId[];
  activeRoom: RoomId;
  roomTemps: Partial<Record<RoomId, number>>;
  technicians: number;
  // Network & market
  pool: PoolMode;
  market: MarketState;
  bots: TradingBot[];
  event: ActiveNetworkEvent | null;
  nextEventAt: number;
  // Progression
  talents: TalentLevels;
  vip: VipState;
  achievements: string[];
  stats: PlayerStats;
  settings: GameSettings;
  /** Contracts board (regenerated by The Halving). */
  contracts: ContractBoard;
  /** Challenge restricting the current run (null = free run). */
  challenge: ActiveChallenge | null;
  /** Completed challenges (survive Halvings). */
  challengeRecords: ChallengeRecords;
  /** Lab research of the current run (wiped by The Halving). */
  research: ResearchState;
  /** Overdrive hashrate surge from an airdrop (null = none). */
  boost: HashBoost | null;
  /** Epoch ms when the next supply drone may appear. */
  nextAirdropAt: number;
  /** Guided goals (survive Halvings). */
  roadmap: RoadmapState;
  /** Daily bonus streak (survives Halvings). */
  daily: DailyState;
  autopilot: AutopilotState;
}
