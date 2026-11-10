import type { RoomId } from './player';

/**
 * Serialized arbitrary precision number (break_infinity.js Decimal string).
 * Kept as a string in the store so state stays JSON / structured-clone safe
 * across localStorage, save exports and the Web Worker boundary.
 */
export type BigNum = string;

/** Altcoins the farm can mine instead of $CC; they live in `GameData.alts`. */
export type AltCoinId = 'BYT' | 'NOVA';
export type CoinId = 'CC' | 'MEME' | AltCoinId;
/** Coins a pool can pay out (everything but the shitcoin). */
export type MineableCoin = 'CC' | AltCoinId;

/** Holding of a mined/traded altcoin (a plain number, like $MEME). */
export interface AltWallet {
  amount: number;
  /** Cash spent on the coins still held (mined coins cost nothing). */
  costBasis: number;
}

export type AltWallets = Record<AltCoinId, AltWallet>;

export interface Candle {
  /** Candle open time (epoch ms). */
  t: number;
  o: number;
  h: number;
  l: number;
  c: number;
}

export interface CoinMarket {
  id: CoinId;
  price: number;
  /** Long-run mean price the random walk reverts to. */
  basePrice: number;
  candles: Candle[];
  current: Candle;
}

export type MarketState = Record<CoinId, CoinMarket>;

export type PoolMode = 'public' | 'solo' | 'darknet';

export interface PoolDefinition {
  id: PoolMode;
  name: string;
  tagline: string;
  description: string;
  /** Multiplier on the expected base yield. */
  payoutMul: number;
  fee: number;
  unlockLevel: number;
  color: string;
}

export type BotSide = 'buy' | 'sell';
export type BotTrigger = 'above' | 'below';

export interface TradingBot {
  id: string;
  coin: CoinId;
  side: BotSide;
  trigger: BotTrigger;
  /** Threshold as a multiple of the coin's base price. */
  threshold: number;
  /** Percentage of holdings (sell) or cash (buy) traded each fire. */
  amountPct: number;
  cooldownSec: number;
  lastFiredAt: number;
  enabled: boolean;
}

export type NetworkEventId =
  | 'difficulty_spike'
  | 'blackout'
  | 'heatwave'
  | 'cold_snap'
  | 'bull_run'
  | 'meme_mania';

export interface NetworkEventDef {
  id: NetworkEventId;
  name: string;
  description: string;
  duration: [number, number];
  color: string;
  positive: boolean;
}

export interface ActiveNetworkEvent {
  id: NetworkEventId;
  startedAt: number;
  endsAt: number;
  roomId: RoomId | null;
}

export interface TradeResult {
  ok: boolean;
  message: string;
}
