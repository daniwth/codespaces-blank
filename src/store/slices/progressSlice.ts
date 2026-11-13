import { AIRDROP } from '../../config/airdrops';
import { BUFFS, crewReady } from '../../config/buffs';
import { POOLS } from '../../config/gameBalance';
import { CHALLENGE_IDS } from '../../config/challenges';
import { dailyCash, dailyRewardFor, localDay } from '../../config/daily';
import { talentModifiers } from '../../config/prestigeTree';
import { ROADMAP, currentGoal, goalMet, type RoadmapCtx } from '../../config/roadmap';
import type { DailyState, GameData } from '../../types/player';
import { bnAdd, bnToNumber } from '../../utils/bignum';
import { fxBus, sfxBus } from '../../utils/eventBus';
import { formatCash, formatNumber } from '../../utils/formatters';
import { randRange, weightedPick } from '../../utils/random';
import { contractContext } from '../contracts';
import type { GameStore, GetState, ProgressSlice, SetState } from '../storeTypes';
import { walletPatch } from '../wallets';

/** Facts the roadmap goals look at, read from the whole store. */
export function roadmapContext(s: GameStore): RoadmapCtx {
  let mountedGpus = 0;
  let placedRacks = 0;
  Object.values(s.racks).forEach((r) => {
    if (!r.roomId) return;
    placedRacks += 1;
    mountedGpus += r.gpuSlots.filter((u) => u && s.gpus[u]).length;
  });
  return {
    lifetimeEarnings: bnToNumber(s.lifetimeEarnings),
    gpuCount: Object.keys(s.gpus).length,
    mountedGpus,
    placedRacks,
    peakHash: Math.max(s.stats.maxHashrate, s.live.totalHash),
    roomsOwned: s.ownedRooms.length,
    technicians: s.technicians,
    contractsCompleted: s.stats.contractsCompleted,
    stableOverclocks: s.stats.stableOverclocks,
    bots: s.bots.length,
    airdrops: s.stats.airdrops,
    blocksFound: s.stats.blocksFound,
    altsHeld: s.alts.BYT.amount > 0 || s.alts.NOVA.amount > 0 ? 1 : 0,
    fusions: s.stats.fusions,
    researchDone: s.stats.researchDone,
    halvings: s.stats.halvings,
    talentLevels: Object.values(s.talents).reduce((a, l) => a + (l ?? 0), 0),
    challengesCleared: CHALLENGE_IDS.filter((id) => (s.challengeRecords[id]?.clears ?? 0) > 0).length,
    goldRacks: s.vip.goldRacksBought,
    dailyClaimed: s.daily.lastDay > 0 ? 1 : 0,
  };
}

/** Net income estimate ($/s) that sizes gifts: the same yardstick contract rewards use. */
export const giftIncomePerSec = (s: GameStore): number =>
  contractContext(s, s.live.totalHash > 0 ? s.live : undefined).incomePerSec;

export const dailyAvailable = (s: Pick<GameData, 'daily'>, now: number = Date.now()): boolean => localDay(now) > s.daily.lastDay;

/** Streak day the next claim would be: consecutive days climb, a skipped day restarts at 1. */
export const nextDailyStreak = (daily: DailyState, today: number): number =>
  daily.lastDay > 0 && today === daily.lastDay + 1 ? daily.streak + 1 : 1;

let airdropSeq = 0;

export function createProgressSlice(set: SetState, get: GetState): ProgressSlice {
  return {
    checkRoadmap: () => {
      const s = get();
      const goal = currentGoal(s.roadmap.step);
      if (!goal || s.roadmap.ready || !goalMet(goal, roadmapContext(s))) return false;
      set({ roadmap: { ...s.roadmap, ready: true } });
      s.logT('Roadmap goal reached: {title}. Claim your reward!', { title: goal.title }, 'good');
      sfxBus.emit('contract');
      return true;
    },

    claimRoadmap: () => {
      const s = get();
      const goal = currentGoal(s.roadmap.step);
      if (!goal || !(s.roadmap.ready || goalMet(goal, roadmapContext(s)))) {
        sfxBus.emit('error');
        return false;
      }
      set({
        cash: bnAdd(s.cash, goal.cash),
        gems: s.gems + goal.gems,
        roadmap: { step: s.roadmap.step + 1, ready: false },
      });
      const cash = formatCash(goal.cash);
      if (goal.cash > 0 && goal.gems > 0) s.logT('GOAL COMPLETE: {title} (+{cash} and +{gems} gems).', { title: goal.title, cash, gems: goal.gems }, 'good');
      else if (goal.gems > 0) s.logT('GOAL COMPLETE: {title} (+{gems} gems).', { title: goal.title, gems: goal.gems }, 'good');
      else s.logT('GOAL COMPLETE: {title} (+{cash}).', { title: goal.title, cash }, 'good');
      if (s.roadmap.step + 1 >= ROADMAP.length) {
        s.logT('ROADMAP COMPLETE! You have seen everything the farm has to offer. The rest is up to you.', undefined, 'good');
        fxBus.emit({ kind: 'confetti', intensity: 1 });
      } else fxBus.emit({ kind: 'confetti', intensity: 0.25 });
      sfxBus.emit('claim');
      if (goal.cash > 0) fxBus.emit({ kind: 'sell', amount: goal.cash });
      get().checkRoadmap();
      get().checkAchievements();
      return true;
    },

    claimDaily: () => {
      const s = get();
      const today = localDay();
      if (today <= s.daily.lastDay) {
        sfxBus.emit('error');
        return false;
      }
      const streak = nextDailyStreak(s.daily, today);
      const reward = dailyRewardFor(streak);
      const cash = dailyCash(reward, giftIncomePerSec(s));
      set({
        // A gift like contract prizes: it never counts as earnings.
        cash: bnAdd(s.cash, cash),
        gems: s.gems + reward.gems,
        daily: { lastDay: today, streak },
        stats: { ...s.stats, bestStreak: Math.max(s.stats.bestStreak, streak) },
      });
      if (reward.gems > 0) s.logT('DAILY BONUS, day {day}: +{cash} and +{gems} gems.', { day: streak, cash: formatCash(cash), gems: reward.gems }, 'good');
      else s.logT('DAILY BONUS, day {day}: +{cash}.', { day: streak, cash: formatCash(cash) }, 'good');
      sfxBus.emit('claim');
      fxBus.emit({ kind: 'sell', amount: cash });
      fxBus.emit({ kind: 'confetti', intensity: reward.gems > 0 ? 0.5 : 0.25 });
      get().checkRoadmap();
      get().checkAchievements();
      return true;
    },

    setDailyOpen: (open) => set({ dailyOpen: open }),

    tickAirdrop: (now) => {
      const s = get();
      if (s.airdrop) {
        if (now < s.airdrop.expiresAt) return;
        set({ airdrop: null });
        s.logT('The supply drone flew off with its crate.', undefined, 'info');
        return;
      }
      if (now < s.nextAirdropAt) return;
      airdropSeq += 1;
      const kind = weightedPick(AIRDROP.weights);
      set({
        airdrop: { id: airdropSeq, kind, spawnedAt: now, expiresAt: now + AIRDROP.lifetimeSec * 1000 },
        nextAirdropAt: now + randRange(AIRDROP.interval[0], AIRDROP.interval[1]) * 1000,
      });
      if (kind === 'nitro') s.logT('A LIQUID NITROGEN DRONE is crossing the room: catch it to chill every room!', undefined, 'good');
      else if (kind === 'vip') s.logT('A VIP DRONE is crossing the room: catch it before it leaves!', undefined, 'good');
      else if (kind === 'audit') s.logT('An AUDIT DRONE is crossing the room: catch it for a contract bonus!', undefined, 'good');
      else s.logT('A supply drone is crossing the room: catch it before it leaves!', undefined, 'good');
      sfxBus.emit('drone');
    },

    claimAirdrop: () => {
      const s = get();
      const drop = s.airdrop;
      const now = Date.now();
      if (!drop || now >= drop.expiresAt) return false;
      const mul = talentModifiers(s.talents).airdropMul;
      const stats = { ...s.stats, airdrops: s.stats.airdrops + 1 };
      // A coin crate needs a running farm; without hashrate it pays cash instead.
      const kind = drop.kind === 'coins' && !(s.live.coinPerSec > 0) ? 'cash' : drop.kind;
      let label: string;
      let color = '#facc15';
      if (kind === 'cash') {
        const cash = Math.max(AIRDROP.minCash, AIRDROP.cashIncomeSec * giftIncomePerSec(s)) * mul;
        set({ airdrop: null, stats, cash: bnAdd(s.cash, cash) });
        s.logT('DRONE CRATE: {cash} in cash!', { cash: formatCash(cash) }, 'good');
        label = `+${formatCash(cash)}`;
        fxBus.emit({ kind: 'sell', amount: cash });
      } else if (kind === 'coins') {
        const amount = AIRDROP.coinsSec * s.live.coinPerSec * mul;
        // Mined-like coins: the amount grows, the cost basis does not.
        set({ airdrop: null, stats, ...walletPatch(s, s.minedCoin, amount, 0) });
        s.logT('DRONE CRATE: {amount} ${coin}!', { amount: formatNumber(amount), coin: s.minedCoin }, 'good');
        label = `+${formatNumber(amount)} ${s.minedCoin}`;
        color = '#22d3ee';
      } else if (kind === 'overdrive') {
        const seconds = AIRDROP.overdriveSec * mul;
        const from = s.boost && s.boost.until > now ? s.boost.until : now;
        const until = Math.min(from + seconds * 1000, now + AIRDROP.overdriveMaxSec * 1000);
        set({ airdrop: null, stats, boost: { mul: AIRDROP.overdriveMul, until } });
        s.logT('DRONE CRATE: OVERDRIVE! Hashrate x{mul} for {sec}s.', { mul: AIRDROP.overdriveMul, sec: Math.round((until - now) / 1000) }, 'good');
        label = `OVERDRIVE X${AIRDROP.overdriveMul}`;
        color = '#a3e635';
      } else if (kind === 'nitro') {
        set({ airdrop: null, stats, buffs: { ...s.buffs, nitroUntil: now + BUFFS.nitro.durationSec * 1000 } });
        s.logT('LIQUID NITROGEN DRONE: ambient {delta}°C in every room for {sec}s.', { delta: BUFFS.nitro.delta, sec: BUFFS.nitro.durationSec }, 'good');
        label = `${BUFFS.nitro.delta}C LN2`;
        color = '#7dd3fc';
        sfxBus.emit('frost');
      } else if (kind === 'vip') {
        // A block multiplier only helps a pool that pays per block; steady pools get gems instead.
        if (POOLS[s.pool].scheme !== 'pps') {
          set({ airdrop: null, stats, buffs: { ...s.buffs, blockMulUntil: Math.max(s.buffs.blockMulUntil, now) + BUFFS.vip.durationSec * 1000 } });
          s.logT('VIP DRONE: every block pays x{mul} for {min} min.', { mul: BUFFS.vip.blockMul, min: BUFFS.vip.durationSec / 60 }, 'good');
          label = `BLOCKS X${BUFFS.vip.blockMul}`;
        } else {
          set({ airdrop: null, stats, gems: s.gems + BUFFS.vip.gems });
          s.logT('VIP DRONE: {n} gems!', { n: BUFFS.vip.gems }, 'good');
          label = `+${BUFFS.vip.gems} GEMS`;
        }
        color = '#fde047';
        fxBus.emit({ kind: 'confetti', intensity: 0.3 });
      } else if (kind === 'audit') {
        set({ airdrop: null, stats, buffs: { ...s.buffs, auditClaims: Math.min(BUFFS.audit.maxClaims, s.buffs.auditClaims + BUFFS.audit.claims) } });
        s.logT('AUDIT DRONE: clean books. Your next contract claim pays +{pct}% cash.', { pct: Math.round((BUFFS.audit.cashMul - 1) * 100) }, 'good');
        label = `AUDIT +${Math.round((BUFFS.audit.cashMul - 1) * 100)}%`;
        color = '#fb923c';
      } else {
        set({ airdrop: null, stats, gems: s.gems + AIRDROP.gems });
        s.logT('DRONE CRATE: a gem!', undefined, 'good');
        label = '+1 GEM';
        color = '#e879f9';
      }
      sfxBus.emit('claim');
      fxBus.emit({ kind: 'airdrop', label, color });
      get().checkRoadmap();
      get().checkAchievements();
      return true;
    },

    rallyCrew: () => {
      const s = get();
      const now = Date.now();
      if (s.technicians <= 0) return false;
      if (!crewReady(s.buffs, now)) {
        sfxBus.emit('error');
        return false;
      }
      set({ buffs: { ...s.buffs, techUntil: now + BUFFS.crew.durationSec * 1000, techCooldownUntil: now + BUFFS.crew.cooldownSec * 1000 } });
      s.logT('CREW RALLY! Maintenance x{mul} and +{pct}% cooling for {sec}s.', { mul: BUFFS.crew.speedMul, pct: Math.round((BUFFS.crew.coolingMul - 1) * 100), sec: BUFFS.crew.durationSec }, 'good');
      sfxBus.emit('rally');
      return true;
    },
  };
}
