import type {
  ActiveNetworkEvent,
  BigNum,
  MarketState,
  PoolMode,
  TradingBot,
} from './economy';
import type { CoolerInstance, GpuInstance, PsuInstance, RackInstance } from './hardware';

export type RoomId = 'bedroom' | 'garage' | 'warehouse' | 'arctic' | 'submarine';

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
  | 'room_keeper';

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
  | 'building';

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
  gems: number;
  sc: number;
  scLifetime: number;
  runEarnings: BigNum;
  lifetimeEarnings: BigNum;
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
}
