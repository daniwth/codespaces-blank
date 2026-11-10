import type { AltCoinId, AltWallets, CoinId, MineableCoin } from '../types/economy';
import { EVENT_EFFECTS, MARKET, PHYSICS } from './gameBalance';

/** Price-walk parameters of one coin (multiples of `base`). */
export interface CoinMarketCfg {
  base: number;
  sigma: number;
  theta: number;
  min: number;
  max: number;
}

export const COIN_MARKET: Record<CoinId, CoinMarketCfg> = {
  CC: MARKET.cc,
  MEME: MARKET.meme,
  BYT: MARKET.byt,
  NOVA: MARKET.nova,
};

export const ALT_COIN_IDS: AltCoinId[] = ['BYT', 'NOVA'];
export const COIN_IDS: CoinId[] = ['CC', 'MEME', 'BYT', 'NOVA'];
export const MINEABLE_COIN_IDS: MineableCoin[] = ['CC', 'BYT', 'NOVA'];

export const isCoinId = (v: unknown): v is CoinId => typeof v === 'string' && (COIN_IDS as string[]).includes(v);
export const isMineableCoin = (v: unknown): v is MineableCoin => typeof v === 'string' && (MINEABLE_COIN_IDS as string[]).includes(v);
export const isAltCoin = (v: unknown): v is AltCoinId => typeof v === 'string' && (ALT_COIN_IDS as string[]).includes(v);

export const emptyAlts = (): AltWallets => ({ BYT: { amount: 0, costBasis: 0 }, NOVA: { amount: 0, costBasis: 0 } });

export interface CoinInfo {
  id: CoinId;
  name: string;
  color: string;
  blurb: string;
}

export const COIN_INFO: Record<CoinId, CoinInfo> = {
  CC: { id: 'CC', name: 'CryptoCoin', color: '#22d3ee', blurb: 'Settlement coin your rigs mine. Mean-reverting around $1.' },
  MEME: { id: 'MEME', name: 'Shitcoin', color: '#e879f9', blurb: 'Pure degen fuel: swings from 0.1x to 10x. Pumps & dumps.' },
  BYT: { id: 'BYT', name: 'ByteCoin', color: '#a3e635', blurb: 'The steady one: low volatility, a fixed difficulty and a modest yield. Barely moves in a Bull Run or a Difficulty Spike.' },
  NOVA: { id: 'NOVA', name: 'Nova', color: '#c084fc', blurb: 'A young, volatile coin with a rich yield. Every extra GH/s of your farm raises its difficulty, so it shines for small farms and big price swings.' },
};

/**
 * How a mineable coin pays. `valueMul` is the dollar value of one MH/s per second at the coin's base
 * price relative to $CC (so BYT pays 80% and NOVA 130% of what $CC pays at base prices, before difficulty).
 */
export interface MineableDef {
  id: MineableCoin;
  valueMul: number;
  /** NOVA only: difficulty = max(1, (farm hashrate / hashKnee) ^ exponent). */
  difficulty: { hashKnee: number; exponent: number } | null;
}

export const MINEABLE: Record<MineableCoin, MineableDef> = {
  CC: { id: 'CC', valueMul: 1, difficulty: null },
  BYT: { id: 'BYT', valueMul: 0.8, difficulty: null },
  NOVA: { id: 'NOVA', valueMul: 1.3, difficulty: { hashKnee: 1e9, exponent: 0.12 } },
};

/** Coins minted per second per MH/s at difficulty 1. */
export const coinPerMHs = (coin: MineableCoin): number =>
  PHYSICS.rewardPerMHs * MINEABLE[coin].valueMul * (COIN_MARKET.CC.base / COIN_MARKET[coin].base);

/** Coin difficulty from the farm's own hashrate (1 for coins without hashrate scaling). */
export function hashDifficulty(coin: MineableCoin, totalHash: number): number {
  const d = MINEABLE[coin].difficulty;
  return d ? Math.max(1, (Math.max(0, totalHash) / d.hashKnee) ** d.exponent) : 1;
}

/** Network event multiplier on a coin's difficulty (BYT only feels a fraction of a Difficulty Spike). */
export const spikeDifficulty = (coin: MineableCoin): number => (coin === 'BYT' ? EVENT_EFFECTS.bytDifficultyMul : EVENT_EFFECTS.difficultyMul);

/** Mean the price walk of a coin is pulled towards during a Bull Run (1 = no pull). */
export const bullMeanMul = (coin: CoinId): number =>
  coin === 'CC' || coin === 'NOVA' ? EVENT_EFFECTS.bullMeanMul : coin === 'BYT' ? EVENT_EFFECTS.bytBullMeanMul : 1;

/** Estimated dollars per second a farm with `totalHash` would mint of `coin` at base price (no pool multiplier). */
export const baseValuePerSec = (coin: MineableCoin, totalHash: number): number =>
  ((totalHash / 1e6) * coinPerMHs(coin) / hashDifficulty(coin, totalHash)) * COIN_MARKET[coin].base;
