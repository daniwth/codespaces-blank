/** Contracts board: rotating timed orders scaled to the player's progress. */

export type ContractKind =
  | 'deliver_cc'
  | 'earn_profit'
  | 'reach_hash'
  | 'keep_cool'
  | 'gpu_tier'
  | 'solo_block'
  | 'survive_event'
  | 'bot_profit';

export type ContractDifficulty = 1 | 2 | 3;

export interface ContractReward {
  /** Cash bonus (not counted as earnings: it is a gift, not realized profit). */
  cash: number;
  gems: number;
  /** A free GPU of this model (silicon lottery rolled on claim), or null. */
  gpuModelId: string | null;
}

/** survive_event bookkeeping: the network event being watched. */
export interface EventWatch {
  /** `startedAt` of the watched event (identifies it). */
  startedAt: number;
  /** No thermal shutdown happened while it was active (and it was not interrupted by offline time). */
  clean: boolean;
  /** The farm was hashing at some point during the event (an empty farm survives nothing). */
  sawHash: boolean;
}

export interface Contract {
  id: string;
  kind: ContractKind;
  difficulty: ContractDifficulty;
  createdAt: number;
  expiresAt: number;
  /**
   * Goal, in the kind's unit: $CC (deliver_cc), $ (earn_profit, bot_profit), H/s (reach_hash),
   * seconds of streak (keep_cool), GPUs (gpu_tier), blocks (solo_block) or events (survive_event).
   */
  target: number;
  /** Progress in the same unit. Gauges (reach_hash, gpu_tier) show the current value. */
  progress: number;
  /** keep_cool: max die temperature in °C. gpu_tier: minimum GPU tier. Otherwise 0. */
  param: number;
  /** keep_cool: running hashrate (H/s) the farm must keep for the streak to count. */
  minHash: number;
  watch: EventWatch | null;
  /** Set once the goal is met; completed contracts never expire and wait to be claimed. */
  completedAt: number | null;
  reward: ContractReward;
}

/** A Special Contract: three stages in a row, each paying more than the last. */
export interface ContractChain {
  /** Stage being worked on (0-2). */
  stage: number;
  current: Contract;
}

/** Standing with the clients: earned by claiming contracts, lost by letting them expire. */
export interface ReputationState {
  points: number;
  chain: ContractChain | null;
  /** Epoch ms when the next Special Contract can be accepted. */
  chainReadyAt: number;
  chainsDone: number;
}

export interface ContractBoard {
  /** Up to CONTRACTS.slots contracts. */
  slots: Contract[];
  /** When the next empty slot receives a new contract (epoch ms). */
  nextRefillAt: number;
  /** When the next reroll is allowed (epoch ms). */
  rerollReadyAt: number;
}
