import type { CoinId, PoolMode, TradeResult, TradingBot } from '../types/economy';
import type { ComponentKind, GpuInstance, OverclockSettings, SiliconQuality } from '../types/hardware';
import type { GameData, GameSettings, RoomId, TalentId } from '../types/player';
import type { LiveMetrics, MessageTone, SimOutput } from './gamePhysics';

export interface LogEntry {
  id: number;
  t: number;
  text: string;
  tone: MessageTone;
}

export type SideTab = 'shop' | 'rigs' | 'market' | 'pools' | 'contracts' | 'halving' | 'vip' | 'trophies' | 'account' | 'system';

/** Top-level screen: the title menu (simulation paused) or the running game. */
export type AppScreen = 'menu' | 'game';

export interface OfflineReport {
  seconds: number;
  requested: number;
  ccMined: number;
  electricity: number;
  earnedCash: number;
  ccDelta: number;
  cashDelta: number;
}

export interface LotteryReveal {
  modelId: string;
  quality: SiliconQuality;
  t: number;
}

/** Small HUD banner shown when a contract is completed. */
export interface ContractToast {
  contractId: string;
  title: string;
  goal: string;
  t: number;
}

export interface UiState {
  live: LiveMetrics;
  log: LogEntry[];
  selectedRack: string | null;
  biosGpu: string | null;
  offlineReport: OfflineReport | null;
  sideTab: SideTab;
  lottery: LotteryReveal | null;
  contractToast: ContractToast | null;
  /** Title menu or game. Not persisted: every launch starts on the menu. */
  screen: AppScreen;
  /** "How to play" wiki overlay (reachable from the menu and in game). */
  wikiOpen: boolean;
}

export type OcResult = 'stable' | 'crash' | 'invalid';
export type VipItem = 'goldRack' | 'aiDiagnostics' | 'autoSellPeaks';

export interface HardwareSlice {
  buyGpu: (modelId: string) => GpuInstance | null;
  buyPsu: (modelId: string) => boolean;
  buyCooler: (modelId: string) => boolean;
  buyRack: (modelId: string) => boolean;
  sellItem: (kind: ComponentKind, uid: string) => boolean;
  installGpu: (rackUid: string, slot: number, gpuUid: string) => void;
  installCooler: (rackUid: string, slot: number, coolerUid: string) => void;
  installPsu: (rackUid: string, psuUid: string) => void;
  uninstallSlot: (rackUid: string, kind: 'gpu' | 'cooler' | 'psu', slot: number) => void;
  autoFillRack: (rackUid: string) => number;
  applyOverclock: (gpuUid: string, oc: OverclockSettings) => OcResult;
  autoTuneGpu: (gpuUid: string) => boolean;
  resetOverclock: (gpuUid: string) => void;
  repasteGpu: (gpuUid: string) => boolean;
  repairGpu: (gpuUid: string) => boolean;
}

export interface RoomsSlice {
  buyRoom: (roomId: RoomId) => boolean;
  setActiveRoom: (roomId: RoomId) => void;
  placeRack: (rackUid: string, roomId: RoomId, pad: number) => boolean;
  storeRack: (rackUid: string) => void;
  hireTechnician: () => boolean;
}

export interface MarketSlice {
  sellCoin: (coin: CoinId, amount: number) => TradeResult;
  buyCoin: (coin: CoinId, cash: number) => TradeResult;
  addBot: () => void;
  updateBot: (id: string, patch: Partial<TradingBot>) => void;
  removeBot: (id: string) => void;
  setPool: (pool: PoolMode) => boolean;
}

export interface EconomySlice {
  performHalving: () => boolean;
  buyTalent: (id: TalentId) => boolean;
  buyVip: (item: VipItem) => boolean;
  setAutoSellEnabled: (enabled: boolean) => void;
  checkAchievements: () => void;
}

export interface ContractsSlice {
  /** Pay out a completed contract (cash, gems and/or a GPU) and free its slot. */
  claimContract: (id: string) => boolean;
  /** Swap an unfinished contract for a new one (cooldown + small cash cost). */
  rerollContract: (id: string) => boolean;
  /** Current reroll price in cash. */
  contractRerollCost: () => number;
  /** Fold a merged simulation tick into the board (called by applyTick / applyOffline). */
  advanceContractBoard: (out: SimOutput, offline: boolean) => void;
  /** Credit realized profit from a manual market sale. */
  creditContractProfit: (amount: number) => void;
  dismissContractToast: () => void;
}

export interface CoreActions {
  applyTick: (out: SimOutput) => void;
  applyOffline: (out: SimOutput, requestedSeconds: number) => void;
  dismissOffline: () => void;
  pushLog: (text: string, tone?: MessageTone) => void;
  setSideTab: (tab: SideTab) => void;
  selectRack: (uid: string | null) => void;
  openBios: (uid: string | null) => void;
  dismissLottery: () => void;
  updateSettings: (patch: Partial<GameSettings>) => void;
  exportSave: () => Promise<string>;
  importSave: (text: string) => Promise<TradeResult>;
  hardReset: () => void;
  /** Leave the title menu and resume the local save (the game loop credits offline time on start). */
  continueGame: () => void;
  /** Wipe the local save for a fresh run (starter bench rig, lastTick = now) and enter the game. Settings are kept. */
  startNewGame: () => void;
  /** Flush the save and go back to the title menu (the game loop stops). */
  returnToMenu: () => void;
  setWikiOpen: (open: boolean) => void;
}

export type GameStore = GameData & UiState & HardwareSlice & RoomsSlice & MarketSlice & EconomySlice & ContractsSlice & CoreActions;

export type SetState = (partial: Partial<GameStore> | ((state: GameStore) => Partial<GameStore>)) => void;
export type GetState = () => GameStore;
