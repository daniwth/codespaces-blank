import { tr } from '../../i18n';
import { ACHIEVEMENTS, VIP_COSTS } from '../../config/gameBalance';
import { MAX_TECHNICIANS, RACK_BY_ID } from '../../config/hardwareCatalog';
import { PRESTIGE_TREE, TALENT_BY_ID, scForEarnings, talentCost, talentLevel } from '../../config/prestigeTree';
import type { RackInstance } from '../../types/hardware';
import type { AchievementContext, GameData } from '../../types/player';
import { bnToNumber } from '../../utils/bignum';
import { fxBus, sfxBus } from '../../utils/eventBus';
import { createInitialData, createRack } from '../initialState';
import type { EconomySlice, GameStore, GetState, SetState } from '../storeTypes';
import { bumpWorldEpoch } from '../worldEpoch';

export function achievementContext(s: GameStore): AchievementContext {
  const gpus = Object.values(s.gpus);
  return {
    totalHash: s.live.totalHash,
    lifetimeEarnings: bnToNumber(s.lifetimeEarnings),
    gpuCount: gpus.length,
    godGpus: gpus.filter((g) => g.quality === 'god').length,
    roomsOwned: s.ownedRooms.length,
    halvings: s.stats.halvings,
    blocksFound: s.stats.blocksFound,
    raids: s.stats.raids,
    bsods: s.stats.bsods,
    technicians: s.technicians,
    goldRacks: s.vip.goldRacksBought,
    stableOverclocks: s.stats.stableOverclocks,
    bestTrade: s.stats.bestTrade,
    contractsCompleted: s.stats.contractsCompleted,
  };
}

export const halvingReward = (s: Pick<GameData, 'runEarnings'>): number => scForEarnings(bnToNumber(s.runEarnings));

export function createEconomySlice(set: SetState, get: GetState): EconomySlice {
  return {
    performHalving: () => {
      const s = get();
      const reward = halvingReward(s);
      if (reward <= 0) {
        sfxBus.emit('error');
        return false;
      }
      // Gold Edition racks survive, emptied and stored.
      const goldRacks: Record<string, RackInstance> = {};
      Object.values(s.racks)
        .filter((r) => RACK_BY_ID[r.modelId]?.vip)
        .forEach((r) => {
          const fresh = createRack(r.modelId, r.gpuSlots.length, r.fanSlots.length);
          goldRacks[r.uid] = { ...fresh, uid: r.uid };
        });
      const keepRooms = talentLevel(s.talents, 'room_keeper') > 0;
      const fresh = createInitialData({
        createdAt: s.createdAt,
        gems: s.gems + 5,
        sc: s.sc + reward,
        scLifetime: s.scLifetime + reward,
        lifetimeEarnings: s.lifetimeEarnings,
        racks: goldRacks,
        ownedRooms: keepRooms ? s.ownedRooms : ['bedroom'],
        market: s.market,
        bots: s.bots,
        talents: s.talents,
        vip: s.vip,
        achievements: s.achievements,
        stats: { ...s.stats, halvings: s.stats.halvings + 1 },
        settings: s.settings,
      });
      bumpWorldEpoch();
      set({ ...fresh, selectedRack: null, biosGpu: null, sideTab: 'halving' });
      get().pushLog(tr('THE HALVING! Your run is cashed out — you minted {reward} Smart Contracts ($SC) and +5 gems.', { reward }), 'good');
      sfxBus.emit('halving');
      fxBus.emit({ kind: 'confetti', intensity: 1 });
      return true;
    },

    buyTalent: (id) => {
      const s = get();
      const node = TALENT_BY_ID[id];
      const level = talentLevel(s.talents, id);
      if (level >= node.maxLevel) return false;
      const locked = node.requires.some((r) => talentLevel(s.talents, r) === 0);
      const cost = talentCost(node, level);
      if (locked || s.sc < cost) {
        sfxBus.emit('error');
        return false;
      }
      const talents = { ...s.talents, [id]: level + 1 };
      const patch: Partial<GameStore> = { sc: s.sc - cost, talents };
      // Immediate effects for talents that alter the current run.
      if (id === 'tech_union') patch.technicians = Math.min(MAX_TECHNICIANS, s.technicians + 1);
      set(patch);
      s.pushLog(tr('Smart Contract deployed: {name} Lv.{level}.', { name: tr(node.name), level: level + 1 }), 'good');
      sfxBus.emit('unlock');
      return true;
    },

    buyVip: (item) => {
      const s = get();
      const cost = item === 'goldRack' ? VIP_COSTS.goldRack : item === 'aiDiagnostics' ? VIP_COSTS.aiDiagnostics : VIP_COSTS.autoSellPeaks;
      if (s.gems < cost) {
        sfxBus.emit('error');
        s.pushLog(tr('Need {cost} gems.', { cost }), 'warn');
        return false;
      }
      if (item === 'goldRack') {
        if (s.vip.goldRacksBought >= VIP_COSTS.maxGoldRacks) return false;
        const model = RACK_BY_ID.gold;
        const rack = createRack('gold', model.slots, model.fanSlots);
        set({ gems: s.gems - cost, racks: { ...s.racks, [rack.uid]: rack }, vip: { ...s.vip, goldRacksBought: s.vip.goldRacksBought + 1 } });
        s.pushLog(tr('Gold Edition Rack delivered! Zero electricity, half the heat. Place it on a pad.'), 'good');
        fxBus.emit({ kind: 'confetti', intensity: 0.7 });
      } else if (item === 'aiDiagnostics') {
        if (s.vip.aiDiagnostics) return false;
        set({ gems: s.gems - cost, vip: { ...s.vip, aiDiagnostics: true } });
        s.pushLog(tr('AI Diagnostics online: safe auto-overclock available in every BIOS.'), 'good');
      } else {
        if (s.vip.autoSellPeaks) return false;
        set({ gems: s.gems - cost, vip: { ...s.vip, autoSellPeaks: true, autoSellEnabled: true } });
        s.pushLog(tr('Peak Auto-Seller armed: all $CC sells automatically above 1.3x.'), 'good');
      }
      sfxBus.emit('unlock');
      return true;
    },

    setAutoSellEnabled: (enabled) => {
      set((s) => ({ vip: { ...s.vip, autoSellEnabled: enabled } }));
      sfxBus.emit('switch');
    },

    checkAchievements: () => {
      const s = get();
      const ctx = achievementContext(s);
      const unlocked = ACHIEVEMENTS.filter((a) => !s.achievements.includes(a.id) && a.check(ctx));
      if (!unlocked.length) return;
      const gems = unlocked.reduce((acc, a) => acc + a.gems, 0);
      set({ achievements: [...s.achievements, ...unlocked.map((a) => a.id)], gems: s.gems + gems });
      unlocked.forEach((a) => s.pushLog(tr('ACHIEVEMENT: {name} (+{gems} gems)', { name: tr(a.name), gems: a.gems }), 'good'));
      sfxBus.emit('unlock');
      fxBus.emit({ kind: 'confetti', intensity: 0.4 });
    },
  };
}

export { PRESTIGE_TREE };
