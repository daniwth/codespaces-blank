import { tr } from '../../i18n';
import { BOT_UNLOCK_LEVEL, MARKET, POOLS, levelFromEarnings } from '../../config/gameBalance';
import { COIN_INFO } from '../../config/altcoins';
import { talentModifiers } from '../../config/prestigeTree';
import type { TradeOrder, TradingBot } from '../../types/economy';
import { PPA_PLANS, ppaActive, ppaCancelFee, ppaQuote } from '../../config/energy';
import { ORDERS } from '../../config/marketCycle';
import { ABILITIES, RANKS, abilityUnlocked } from '../../config/ranks';
import { researchModifiers } from '../../config/research';
import { bnAdd, bnGte, bnSub, bnToNumber } from '../../utils/bignum';
import { fxBus, makeUid, sfxBus } from '../../utils/eventBus';
import { formatCash, formatDuration, formatHashrate, formatNumber, formatPrice } from '../../utils/formatters';
import { buyPrice, flashQuote, realizedEarnings, sellPrice } from '../gamePhysics';
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
      // Leaving a partner pool early breaks the deal: it costs reputation and the pool will not sign again for a while.
      const now = Date.now();
      const broken = s.partner !== null && now < s.partner.until && s.partner.pool !== pool && s.pool === s.partner.pool;
      if (broken) {
        set({
          partner: null,
          reputation: { ...s.reputation, points: Math.max(0, s.reputation.points - ABILITIES.partner.breakPoints) },
          buffs: { ...s.buffs, partnerCooldownUntil: now + ABILITIES.partner.cooldownSec * 1000 },
        });
        s.logT('You broke your Pool Partner deal: -{points} reputation.', { points: ABILITIES.partner.breakPoints }, 'bad');
      }
      // Shares waiting for a PPLNS block are settled at par before leaving the pool.
      set({ pool, poolPending: 0, ...(s.poolPending > 0 ? walletPatch(s, s.minedCoin, s.poolPending, 0) : {}) });
      s.pushLog(tr('Switched to {name}.', { name: tr(def.name) }), 'info');
      sfxBus.emit('switch');
      return true;
    },

    addOrder: (coin, kind, price, amountPct) => {
      const s = get();
      if (!researchModifiers(s.research.levels).orderDesk) {
        s.logT('Research the Order Desk in the Lab to place orders.', undefined, 'warn');
        sfxBus.emit('error');
        return false;
      }
      if (s.orders.length >= ORDERS.max || !(price > 0) || !Number.isFinite(price)) {
        sfxBus.emit('error');
        return false;
      }
      const order: TradeOrder = { id: makeUid('ord'), coin, kind, price, amountPct: Math.min(ORDERS.maxPct, Math.max(ORDERS.minPct, Math.round(amountPct))), createdAt: Date.now() };
      set({ orders: [...s.orders, order] });
      s.logT(kind === 'tp' ? 'Take-profit placed: sell {pct}% of ${coin} at {price} or more.' : 'Stop-loss placed: sell {pct}% of ${coin} at {price} or less.', { pct: order.amountPct, coin, price: formatPrice(price) }, 'info');
      sfxBus.emit('install');
      return true;
    },

    rentHashrate: (now = Date.now()) => {
      const s = get();
      if (!abilityUnlocked('flash', levelFromEarnings(bnToNumber(s.lifetimeEarnings)))) {
        s.logT('{ability} unlocks at the rank {rank}.', { ability: 'Flash Mining', rank: RANKS.find((r) => r.unlock === 'flash')?.name ?? '' }, 'warn');
        sfxBus.emit('error');
        return false;
      }
      if (now < s.buffs.rentCooldownUntil) {
        sfxBus.emit('error');
        return false;
      }
      const quote = flashQuote(s.live, s.pool, s.minedCoin, s.market[s.minedCoin].price);
      if (!(quote.hash > 0)) {
        s.logT('Flash Mining needs a farm that is hashing.', undefined, 'warn');
        sfxBus.emit('error');
        return false;
      }
      if (!bnGte(s.cash, quote.fee)) {
        s.logT('Not enough cash for {label} ({price}).', { label: 'Flash Mining', price: formatCash(quote.fee) }, 'warn');
        sfxBus.emit('error');
        return false;
      }
      set({
        cash: bnSub(s.cash, quote.fee),
        buffs: { ...s.buffs, rentHash: quote.hash, rentUntil: now + ABILITIES.flash.durationSec * 1000, rentCooldownUntil: now + ABILITIES.flash.cooldownSec * 1000 },
      });
      s.logT('FLASH MINING: rented {hash} for {time}. Fee {fee}.', { hash: formatHashrate(quote.hash), time: formatDuration(ABILITIES.flash.durationSec), fee: formatCash(quote.fee) }, 'good');
      sfxBus.emit('install');
      return true;
    },

    signPartner: (now = Date.now()) => {
      const s = get();
      if (!abilityUnlocked('partner', levelFromEarnings(bnToNumber(s.lifetimeEarnings)))) {
        s.logT('{ability} unlocks at the rank {rank}.', { ability: 'Pool Partner', rank: RANKS.find((r) => r.unlock === 'partner')?.name ?? '' }, 'warn');
        sfxBus.emit('error');
        return false;
      }
      if ((s.partner && now < s.partner.until) || now < s.buffs.partnerCooldownUntil) {
        sfxBus.emit('error');
        return false;
      }
      set({ partner: { pool: s.pool, until: now + ABILITIES.partner.durationSec * 1000 } });
      s.logT('Pool Partner deal signed with {pool}: +{pct}% payout for {time}. Leaving early costs reputation.', { pool: POOLS[s.pool].name, pct: Math.round((ABILITIES.partner.payoutMul - 1) * 100), time: formatDuration(ABILITIES.partner.durationSec) }, 'good');
      sfxBus.emit('install');
      return true;
    },

    signPpa: (plan, now = Date.now()) => {
      const s = get();
      if (!researchModifiers(s.research.levels).energyDesk) {
        s.logT('Research the Energy Desk in the Lab to sign power contracts.', undefined, 'warn');
        sfxBus.emit('error');
        return false;
      }
      if (ppaActive(s.ppa, now)) {
        s.logT('A power contract is already in force.', undefined, 'warn');
        sfxBus.emit('error');
        return false;
      }
      const def = PPA_PLANS[plan];
      const rate = ppaQuote(plan, now);
      set({ ppa: { plan, rate, signedAt: now, endsAt: now + def.durationSec * 1000, saved: 0 } });
      s.logT('Power contract signed: {name} at {pct}% of the retail tariff for {time}.', { name: def.name, pct: Math.round(rate * 100), time: formatDuration(def.durationSec) }, 'good');
      sfxBus.emit('install');
      return true;
    },

    cancelPpa: (now = Date.now()) => {
      const s = get();
      if (!ppaActive(s.ppa, now)) return false;
      const fee = ppaCancelFee(s.ppa, s.live.electricityPerSec, now);
      if (!bnGte(s.cash, fee)) {
        s.logT('Not enough cash for {label} ({price}).', { label: 'Termination fee', price: formatCash(fee) }, 'warn');
        sfxBus.emit('error');
        return false;
      }
      set({ ppa: null, cash: bnSub(s.cash, fee) });
      s.logT('Power contract cancelled for a {fee} fee.', { fee: formatCash(fee) }, 'warn');
      sfxBus.emit('switch');
      return true;
    },

    removeOrder: (id) => {
      set((s) => ({ orders: s.orders.filter((o) => o.id !== id) }));
      sfxBus.emit('switch');
    },

    setMinedCoin: (coin) => {
      const s = get();
      if (s.minedCoin === coin) return true;
      set({ minedCoin: coin, poolPending: 0, ...(s.poolPending > 0 ? walletPatch(s, s.minedCoin, s.poolPending, 0) : {}) });
      s.pushLog(tr('Now mining {name} (${coin}).', { name: tr(COIN_INFO[coin].name), coin }), 'info');
      sfxBus.emit('switch');
      return true;
    },
  };
}
