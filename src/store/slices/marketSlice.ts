import { tr } from '../../i18n';
import { BOT_UNLOCK_LEVEL, MARKET, POOLS, levelFromEarnings } from '../../config/gameBalance';
import { COIN_INFO } from '../../config/altcoins';
import { talentModifiers } from '../../config/prestigeTree';
import type { TradingBot } from '../../types/economy';
import { bnAdd, bnGte, bnSub, bnToNumber } from '../../utils/bignum';
import { fxBus, makeUid, sfxBus } from '../../utils/eventBus';
import { formatCash, formatNumber } from '../../utils/formatters';
import { buyPrice, realizedEarnings, sellPrice } from '../gamePhysics';
import { costBasisOf, holdingOf, walletPatch } from '../wallets';
import type { GetState, MarketSlice, SetState } from '../storeTypes';

export function createMarketSlice(set: SetState, get: GetState): MarketSlice {
  return {
    sellCoin: (coin, amount) => {
      const s = get();
      const holding = holdingOf(s, coin);
      const qty = Math.min(amount, holding);
      if (!(qty > 0)) return { ok: false, message: tr('No {coin} to sell.', { coin: `$${coin}` }) };
      const proceeds = qty * sellPrice(s.market, coin, talentModifiers(s.talents));
      const { earned, basis } = realizedEarnings(proceeds, holding, costBasisOf(s, coin), qty);
      set({
        ...walletPatch(s, coin, -qty, -basis),
        cash: bnAdd(s.cash, proceeds),
        runEarnings: bnAdd(s.runEarnings, earned),
        lifetimeEarnings: bnAdd(s.lifetimeEarnings, earned),
        stats: { ...s.stats, bestTrade: coin === 'MEME' ? Math.max(s.stats.bestTrade, proceeds - basis) : s.stats.bestTrade },
      });
      get().creditContractProfit(earned);
      sfxBus.emit('sell');
      fxBus.emit({ kind: 'sell', amount: proceeds });
      const msg = tr('Sold {qty} {coin} for {price}.', { qty: formatNumber(qty), coin: `$${coin}`, price: formatCash(proceeds) });
      s.pushLog(msg, 'good');
      return { ok: true, message: msg };
    },

    buyCoin: (coin, cash) => {
      const s = get();
      if (!(cash > 0) || !bnGte(s.cash, cash)) {
        sfxBus.emit('error');
        return { ok: false, message: tr('Not enough cash.') };
      }
      const qty = cash / buyPrice(s.market, coin);
      set({ ...walletPatch(s, coin, qty, cash), cash: bnSub(s.cash, cash) });
      sfxBus.emit('buy');
      const msg = tr('Bought {qty} {coin} for {price}.', { qty: formatNumber(qty), coin: `$${coin}`, price: formatCash(cash) });
      s.pushLog(msg, 'info');
      return { ok: true, message: msg };
    },

    addBot: () => {
      const s = get();
      if (s.bots.length >= MARKET.maxBots) return;
      if (levelFromEarnings(bnToNumber(s.lifetimeEarnings)) < BOT_UNLOCK_LEVEL) {
        s.pushLog(tr('Trading bots unlock at level {level}.', { level: BOT_UNLOCK_LEVEL }), 'warn');
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
        s.pushLog(tr('{name} unlocks at level {level}.', { name: tr(def.name), level: def.unlockLevel }), 'warn');
        return false;
      }
      set({ pool });
      s.pushLog(tr('Switched to {name}.', { name: tr(def.name) }), 'info');
      sfxBus.emit('switch');
      return true;
    },

    setMinedCoin: (coin) => {
      const s = get();
      if (s.minedCoin === coin) return true;
      set({ minedCoin: coin });
      s.pushLog(tr('Now mining {name} (${coin}).', { name: tr(COIN_INFO[coin].name), coin }), 'info');
      sfxBus.emit('switch');
      return true;
    },
  };
}
