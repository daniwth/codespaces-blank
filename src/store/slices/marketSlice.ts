import { BOT_UNLOCK_LEVEL, MARKET, POOLS, levelFromEarnings } from '../../config/gameBalance';
import { talentModifiers } from '../../config/prestigeTree';
import type { TradingBot } from '../../types/economy';
import { bnAdd, bnGte, bnSub, bnSubClamp, bnToNumber } from '../../utils/bignum';
import { fxBus, makeUid, sfxBus } from '../../utils/eventBus';
import { formatCash, formatNumber } from '../../utils/formatters';
import { buyPrice, sellPrice } from '../gamePhysics';
import type { GetState, MarketSlice, SetState } from '../storeTypes';

export function createMarketSlice(set: SetState, get: GetState): MarketSlice {
  return {
    sellCoin: (coin, amount) => {
      const s = get();
      const holding = coin === 'CC' ? bnToNumber(s.cc) : s.meme;
      const qty = Math.min(amount, holding);
      if (!(qty > 0)) return { ok: false, message: `No $${coin} to sell.` };
      const proceeds = qty * sellPrice(s.market, coin, talentModifiers(s.talents));
      let bestTrade = s.stats.bestTrade;
      const patch = coin === 'CC'
        ? { cc: bnSubClamp(s.cc, qty) }
        : (() => {
          const share = s.meme > 0 ? qty / s.meme : 1;
          const basis = s.memeCostBasis * share;
          bestTrade = Math.max(bestTrade, proceeds - basis);
          return { meme: Math.max(0, s.meme - qty), memeCostBasis: Math.max(0, s.memeCostBasis - basis) };
        })();
      set({
        ...patch,
        cash: bnAdd(s.cash, proceeds),
        runEarnings: bnAdd(s.runEarnings, proceeds),
        lifetimeEarnings: bnAdd(s.lifetimeEarnings, proceeds),
        stats: { ...s.stats, bestTrade },
      });
      sfxBus.emit('sell');
      fxBus.emit({ kind: 'sell', amount: proceeds });
      const msg = `Sold ${formatNumber(qty)} $${coin} for ${formatCash(proceeds)}.`;
      s.pushLog(msg, 'good');
      return { ok: true, message: msg };
    },

    buyCoin: (coin, cash) => {
      const s = get();
      if (!(cash > 0) || !bnGte(s.cash, cash)) {
        sfxBus.emit('error');
        return { ok: false, message: 'Not enough cash.' };
      }
      const qty = cash / buyPrice(s.market, coin);
      set(coin === 'CC'
        ? { cash: bnSub(s.cash, cash), cc: bnAdd(s.cc, qty) }
        : { cash: bnSub(s.cash, cash), meme: s.meme + qty, memeCostBasis: s.memeCostBasis + cash });
      sfxBus.emit('buy');
      const msg = `Bought ${formatNumber(qty)} $${coin} for ${formatCash(cash)}.`;
      s.pushLog(msg, 'info');
      return { ok: true, message: msg };
    },

    addBot: () => {
      const s = get();
      if (s.bots.length >= MARKET.maxBots) return;
      if (levelFromEarnings(bnToNumber(s.lifetimeEarnings)) < BOT_UNLOCK_LEVEL) {
        s.pushLog(`Trading bots unlock at level ${BOT_UNLOCK_LEVEL}.`, 'warn');
        return;
      }
      const bot: TradingBot = {
        id: makeUid('bot'), coin: 'CC', side: 'sell', trigger: 'above', threshold: 1.15,
        amountPct: 100, cooldownSec: 20, lastFiredAt: 0, enabled: true,
      };
      set({ bots: [...s.bots, bot] });
      sfxBus.emit('install');
    },

    updateBot: (id, patch) => {
      set((s) => ({ bots: s.bots.map((b) => (b.id === id ? { ...b, ...patch } : b)) }));
    },

    removeBot: (id) => {
      set((s) => ({ bots: s.bots.filter((b) => b.id !== id) }));
      sfxBus.emit('switch');
    },

    setPool: (pool) => {
      const s = get();
      const def = POOLS[pool];
      if (levelFromEarnings(bnToNumber(s.lifetimeEarnings)) < def.unlockLevel) {
        sfxBus.emit('error');
        s.pushLog(`${def.name} unlocks at level ${def.unlockLevel}.`, 'warn');
        return false;
      }
      set({ pool });
      s.pushLog(`Switched to ${def.name}.`, 'info');
      sfxBus.emit('switch');
      return true;
    },
  };
}
