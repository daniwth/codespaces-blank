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

export type SideTab = 'shop' | 'rigs' | 'market' | 'pools' | 'halving' | 'vip' | 'trophies' | 'system';

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

export interface UiState {
  live: LiveMetrics;
  log: LogEntry[];
  selectedRack: string | null;
  biosGpu: string | null;
  offlineReport: OfflineReport | null;
  sideTab: SideTab;
  lottery: LotteryReveal | null;
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
}

export type GameStore = GameData & UiState & HardwareSlice & RoomsSlice & MarketSlice & EconomySlice & CoreActions;

export type SetState = (partial: Partial<GameStore> | ((state: GameStore) => Partial<GameStore>)) => void;
export type GetState = () => GameStore;
