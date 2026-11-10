import type { CoinId } from '../types/economy';
import type { GameData } from '../types/player';
import { bnAdd, bnSubClamp, bnToNumber } from '../utils/bignum';

type Wallets = Pick<GameData, 'cc' | 'ccCostBasis' | 'meme' | 'memeCostBasis' | 'alts'>;

/** Amount held of any coin ($CC is a BigNum string, the rest plain numbers). */
export function holdingOf(s: Wallets, coin: CoinId): number {
  return coin === 'CC' ? bnToNumber(s.cc) : coin === 'MEME' ? s.meme : s.alts[coin].amount;
}

/** Cash spent on the coins still held. */
export function costBasisOf(s: Wallets, coin: CoinId): number {
  return coin === 'CC' ? s.ccCostBasis : coin === 'MEME' ? s.memeCostBasis : s.alts[coin].costBasis;
}

/**
 * State patch that moves `amount` coins (negative to sell) and `cost` cash of basis in one wallet.
 * Holdings and basis never go below zero.
 */
export function walletPatch(s: Wallets, coin: CoinId, amount: number, cost: number): Partial<GameData> {
  if (coin === 'CC') {
    return { cc: amount >= 0 ? bnAdd(s.cc, amount) : bnSubClamp(s.cc, -amount), ccCostBasis: Math.max(0, s.ccCostBasis + cost) };
  }
  if (coin === 'MEME') {
    return { meme: Math.max(0, s.meme + amount), memeCostBasis: Math.max(0, s.memeCostBasis + cost) };
  }
  const w = s.alts[coin];
  return { alts: { ...s.alts, [coin]: { amount: Math.max(0, w.amount + amount), costBasis: Math.max(0, w.costBasis + cost) } } };
}
