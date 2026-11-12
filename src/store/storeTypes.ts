import type { AirdropKind } from '../config/airdrops';
import type { AutopilotPlanId } from '../config/autopilot';
import type { CoinId, MineableCoin, PoolMode, TradeResult, TradingBot } from '../types/economy';
import type { ComponentKind, GpuInstance, OverclockSettings, SiliconQuality } from '../types/hardware';
import type { ChallengeId, GameData, GameSettings, ResearchId, RoomId, TalentId } from '../types/player';
import type { LiveMetrics, MessageTone, SimOutput } from './gamePhysics';
import type { LogParams } from './logLine';

export interface LogEntry {
  id: number;
  t: number;
  /** Text as written when the line was logged (used when there is no `key`). */
  text: string;
  tone: MessageTone;
  /** English template + raw params: the log re-renders in the current language (see `logLine`). */
  key?: string;
  params?: LogParams;
}

export type SideTab = 'shop' | 'rigs' | 'lab' | 'market' | 'pools' | 'contracts' | 'halving' | 'vip' | 'trophies' | 'account' | 'system';

/** Supply drone currently over the room (session state, never saved). */
export interface Airdrop {
  id: number;
  kind: AirdropKind;
  spawnedAt: number;
  expiresAt: number;
}

/** One sample of the session history behind the Stats charts. */
export interface HistoryPoint {
  t: number;
  hash: number;
  /** Net income in $/s: mined value at the current price minus the power bill. */
  net: number;
}

/** Top-level screen: the title menu (simulation paused) or the running game. */
export type AppScreen = 'menu' | 'game';

export interface OfflineReport {
  seconds: number;
  requested: number;
  ccMined: number;
  /** Amount of the mined coin minted while away (equals ccMined when mining $CC). */
  coinMined: number;
  minedCoin: MineableCoin;
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

export interface AutopilotStatus {
  /** Translatable status line. */
  key: string;
  params?: LogParams;
  /** Saving progress towards the target (0-1), when there is one. */
  progress?: number;
  /** Simulated net income of the farm ($/s). */
  net: number;
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
  airdrop: Airdrop | null;
  /** Hashrate / net income samples of this session (Stats charts). */
  history: HistoryPoint[];
  /** Daily bonus dialog. */
  dailyOpen: boolean;
  /** What the AI Farm Manager is doing right now (shown in the VIP tab). */
  autopilotStatus: AutopilotStatus | null;
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
  /** Buy up to `qty` units of one catalog item (as many as the cash allows). Returns how many were bought. */
  buyMany: (kind: ComponentKind, modelId: string, qty: number) => number;
  /** Silicon Forge: melt 3 spare GPUs of one model and grade into 1 of the next grade. */
  fuseGpus: (modelId: string, quality: SiliconQuality) => GpuInstance | null;
  /** Auto-fill every placed rack from storage. Returns the parts installed. */
  autoFillAll: () => number;
  /** Re-paste every mounted GPU whose paste is below 60% (as many as the cash allows). Returns how many. */
  repasteAll: () => number;
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
  /** Choose which coin the farm mines (the pool pays this one). */
  setMinedCoin: (coin: MineableCoin) => boolean;
}

export interface EconomySlice {
  /** Cash out the run; `challenge` optionally restricts the next one. */
  performHalving: (challenge?: ChallengeId | null) => boolean;
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

export interface ChallengesSlice {
  /** Log a "refused by the challenge" warning (with the translated reason) and play the error cue. Always returns false. */
  denyByChallenge: (reason: string) => false;
  /** Drop the active challenge: the run keeps its normal Halving reward, without the challenge bonus. */
  abandonChallenge: () => boolean;
  /** Pay out and record the active challenge once the Halving threshold is reached (called every tick). */
  checkChallenge: () => boolean;
}

export interface ResearchSlice {
  /** Pay for the next level of a project and start its timer (one project at a time). */
  startResearch: (id: ResearchId) => boolean;
  /** Stop the project in progress and refund its cost. */
  cancelResearch: () => boolean;
  /** Finish the project in progress right now for gems. */
  rushResearch: () => boolean;
  /** Grant the level of a finished project (called every tick and after offline catch-up). */
  checkResearch: (now?: number) => boolean;
}

export interface ProgressSlice {
  /** Flag the current roadmap goal as ready to claim once its condition holds (called every tick). */
  checkRoadmap: () => boolean;
  claimRoadmap: () => boolean;
  /** Claim today's daily bonus (once per local calendar day). */
  claimDaily: () => boolean;
  setDailyOpen: (open: boolean) => void;
  /** Spawn and expire the supply drone (called every online tick). */
  tickAirdrop: (now: number) => void;
  /** Catch the drone that is over the room. */
  claimAirdrop: () => boolean;
}

export interface AutopilotSlice {
  /** Spend gems on manager time (plans stack up to a week). */
  buyAutopilot: (plan: AutopilotPlanId) => boolean;
  setAutopilotPaused: (paused: boolean) => void;
  /** Opt in or out of automatic Halvings (and talent purchases) while the manager works. */
  setAutopilotAutoHalving: (on: boolean) => void;
  /** Burn manager time and let it act (called every online tick with the tick's seconds). */
  autopilotTick: (dtSec: number, now?: number) => void;
}

export interface CoreActions {
  applyTick: (out: SimOutput) => void;
  applyOffline: (out: SimOutput, requestedSeconds: number) => void;
  dismissOffline: () => void;
  pushLog: (text: string, tone?: MessageTone) => void;
  /** Log a translatable line: English template + raw params (string params are translated when shown). */
  logT: (key: string, params?: LogParams, tone?: MessageTone) => void;
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
  startNewGame: (challenge?: ChallengeId | null) => void;
  /** Flush the save and go back to the title menu (the game loop stops). */
  returnToMenu: () => void;
  setWikiOpen: (open: boolean) => void;
}

export type GameStore = GameData & UiState & HardwareSlice & RoomsSlice & MarketSlice & EconomySlice & ContractsSlice & ChallengesSlice
  & ResearchSlice & ProgressSlice & AutopilotSlice & CoreActions;

export type SetState = (partial: Partial<GameStore> | ((state: GameStore) => Partial<GameStore>)) => void;
export type GetState = () => GameStore;
