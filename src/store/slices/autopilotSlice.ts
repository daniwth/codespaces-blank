import { MINEABLE_COIN_IDS } from '../../config/altcoins';
import { AUTOPILOT, AUTOPILOT_PLAN_BY_ID } from '../../config/autopilot';
import { GPU_BY_ID, MAX_TECHNICIANS } from '../../config/hardwareCatalog';
import { PRESTIGE_TREE, earningsForSc, scForEarnings, talentCost, talentModifiers } from '../../config/prestigeTree';
import { bnToNumber } from '../../utils/bignum';
import { sfxBus } from '../../utils/eventBus';
import { formatCash, formatDuration } from '../../utils/formatters';
import { NEW_RACK, plan, type AutopilotOp, type Evaluated, type Plan } from '../autopilot/planner';
import { aiAutoTune, ocPowerMul, rackTopology, usableRooms } from '../gamePhysics';
import type { GameData } from '../../types/player';
import type { AutopilotSlice, AutopilotStatus, GameStore, GetState, SetState } from '../storeTypes';
import { holdingOf } from '../wallets';
import { challengeBlocks } from './challengesSlice';
import { FUSE_COUNT, REPASTE_ALL_BELOW, fusableGroups, mountedUids, repairCost, repasteCost } from './hardwareSlice';
import { dailyAvailable } from './progressSlice';
import { padCount, technicianCost } from './roomsSlice';

let lastActAt = 0;
let lastPlanAt = 0;

/** Forget the pacing timers (tests, and a manager that was just bought acts at once). */
export function resetAutopilotClock(): void {
  lastActAt = 0;
  lastPlanAt = 0;
}

export const autopilotActive = (s: Pick<GameStore, 'autopilot'>): boolean => s.autopilot.remainingSec > 0 && !s.autopilot.paused;

const newKey = (before: Record<string, unknown>, after: Record<string, unknown>): string | undefined =>
  Object.keys(after).find((k) => !(k in before));

/**
 * Run a planned purchase through the real store actions (so prices, the Silicon Lottery, challenge
 * rules and stats all apply). Returns false if a step failed; whatever was bought stays in storage.
 */
export function executeOps(get: GetState, ops: AutopilotOp[]): boolean {
  let rackUid = '';
  const target = (uid: string): string => (uid === NEW_RACK ? rackUid : uid);
  for (const o of ops) {
    const s = get();
    if (o.op === 'room') {
      if (!s.buyRoom(o.roomId)) return false;
    } else if (o.op === 'rack') {
      if (!s.buyRack(o.modelId)) return false;
      const uid = newKey(s.racks, get().racks);
      if (!uid || !get().placeRack(uid, o.roomId, o.pad)) return false;
      rackUid = uid;
    } else if (o.op === 'psu') {
      const rack = s.racks[target(o.rackUid)];
      if (!rack || !s.buyPsu(o.modelId)) return false;
      const uid = newKey(s.psus, get().psus);
      if (!uid) return false;
      get().installPsu(rack.uid, uid);
      if (rack.psuUid) get().sellItem('psu', rack.psuUid);
    } else if (o.op === 'cooler') {
      const rack = s.racks[target(o.rackUid)];
      if (!rack || !s.buyCooler(o.modelId)) return false;
      const uid = newKey(s.coolers, get().coolers);
      if (!uid) return false;
      const old = rack.fanSlots[o.slot];
      get().installCooler(rack.uid, o.slot, uid);
      if (old) get().sellItem('cooler', old);
    } else {
      const rack = s.racks[target(o.rackUid)];
      if (!rack) return false;
      const gpu = s.buyGpu(o.modelId);
      if (!gpu) return false;
      const old = rack.gpuSlots[o.slot];
      get().installGpu(rack.uid, o.slot, gpu.uid);
      if (old) get().sellItem('gpu', old);
    }
  }
  return true;
}

/** Free chores: claims, placing stored racks, mounting spares, maintenance, the Forge. */
function chores(get: GetState): void {
  let s = get();
  if (s.airdrop) s.claimAirdrop();
  if (s.roadmap.ready) s.claimRoadmap();
  if (dailyAvailable(s)) s.claimDaily();
  s.contracts.slots.filter((c) => c.completedAt !== null).forEach((c) => get().claimContract(c.id));

  // Stored racks go on the first free pad of the best room.
  s = get();
  const rooms = [...usableRooms(s)].reverse();
  Object.values(s.racks).filter((r) => r.roomId === null).forEach((rack) => {
    const now = get();
    for (const roomId of rooms) {
      const taken = new Set(Object.values(now.racks).filter((r) => r.roomId === roomId).map((r) => r.pad));
      for (let pad = 0; pad < padCount(roomId, now.talents); pad += 1) {
        if (!taken.has(pad) && now.placeRack(rack.uid, roomId, pad)) return;
      }
    }
  });

  // Spare parts with somewhere to go get mounted.
  s = get();
  const mounted = mountedUids(s.racks);
  const placed = Object.values(s.racks).filter((r) => r.roomId !== null);
  const spare = (rec: Record<string, { uid: string }>): boolean => Object.keys(rec).some((uid) => !mounted.has(uid));
  const room =
    (spare(s.gpus) && placed.some((r) => r.gpuSlots.some((u) => !u))) ||
    (spare(s.coolers) && placed.some((r) => r.fanSlots.some((u) => !u))) ||
    (spare(s.psus) && placed.some((r) => !r.psuUid && !rackTopology(r, s).selfPowered));
  if (room) s.autoFillAll();

  // Maintenance: dry paste, then badly worn silicon.
  s = get();
  const cash = bnToNumber(s.cash);
  const dry = Object.values(s.gpus).filter((g) => mounted.has(g.uid) && g.paste < REPASTE_ALL_BELOW);
  if (dry.some((g) => repasteCost(g) <= cash)) s.repasteAll();
  const worn = Object.values(get().gpus)
    .filter((g) => mounted.has(g.uid) && g.wear >= AUTOPILOT.repairWear)
    .sort((a, b) => b.wear - a.wear)[0];
  if (worn && repairCost(worn) <= bnToNumber(get().cash) * AUTOPILOT.repairCashShare) get().repairGpu(worn.uid);

  // Forge: three identical spares are worth more as one better card.
  s = get();
  if (!challengeBlocks(s, 'bronzeOnly')) {
    const group = fusableGroups(s).find((g) => g.count >= FUSE_COUNT);
    if (group) s.fuseGpus(group.modelId, group.quality);
  }

  // Safe overclock (AI Self-Diagnostics owned): one cool, stock card at a time, if its PSU has room.
  s = get();
  if (s.vip.aiDiagnostics && !challengeBlocks(s, 'lockOverclock')) {
    for (const rack of Object.values(s.racks)) {
      if (!rack.roomId) continue;
      const topo = rackTopology(rack, s);
      const live = s.live.racks[rack.uid];
      const uid = topo.gpuUids.find((u) => s.gpus[u].ocBonus === 0 && s.gpus[u].temp < 65);
      if (!uid || !live || live.status !== 'online') continue;
      const g = s.gpus[uid];
      const extra = GPU_BY_ID[g.modelId].power * (ocPowerMul(aiAutoTune(g.silicon)) - 1);
      if (live.load + extra <= topo.capacity * AUTOPILOT.psuLoadShare) {
        s.autoTuneGpu(uid);
        break;
      }
    }
  }
}

/** Mine the coin that pays best and sell what was mined at a fair price (or when the cash is needed). */
function trade(get: GetState, needCash: number): void {
  let s = get();
  const best = MINEABLE_COIN_IDS.reduce((a, b) => (s.live.yields[b].valuePerSec > s.live.yields[a].valuePerSec ? b : a));
  if (best !== s.minedCoin && s.live.yields[best].valuePerSec > s.live.yields[s.minedCoin].valuePerSec * AUTOPILOT.coinSwitchGain) s.setMinedCoin(best);

  const income = s.live.yields[s.minedCoin].valuePerSec;
  MINEABLE_COIN_IDS.forEach((coin) => {
    s = get();
    const amount = holdingOf(s, coin);
    if (!(amount > 0)) return;
    const m = s.market[coin];
    const recent = m.candles.slice(-AUTOPILOT.averageCandles);
    const average = recent.length ? recent.reduce((a, c) => a + c.c, 0) / recent.length : m.price;
    const value = amount * m.price;
    const fair = m.price >= average * AUTOPILOT.sellAtAverage;
    const hoarding = value >= income * AUTOPILOT.maxHoldSec;
    const needed = needCash > 0 && value >= needCash * 0.25;
    if (fair || hoarding || needed) s.sellCoin(coin, amount);
  });
}

function hireIfUseful(get: GetState, net: number): void {
  const s = get();
  if (s.technicians >= MAX_TECHNICIANS) return;
  const mounted = Object.values(s.racks).reduce((a, r) => a + (r.roomId ? r.gpuSlots.filter(Boolean).length : 0), 0);
  const cost = technicianCost(s.technicians, talentModifiers(s.talents).startTechnicians);
  if (mounted >= AUTOPILOT.gpusPerTechnician * (s.technicians + 1) && cost <= net * AUTOPILOT.technicianIncomeSec && cost <= bnToNumber(s.cash)) s.hireTechnician();
}

/**
 * Marginal-value rule for The Halving: the run is worth `sc / hours` right now. Waiting for one more
 * $SC only pays if `(sc + 1) / (hours + time to earn it)` is higher; once it is not, reset.
 * `incomePerSec` is what the farm earns per second (mined coins are sold for their full value).
 */
export function shouldHalve(s: Pick<GameData, 'runEarnings' | 'runStartedAt'>, incomePerSec: number, now: number): boolean {
  const earnings = bnToNumber(s.runEarnings);
  const sc = scForEarnings(earnings);
  if (sc <= 0) return false;
  const runSec = Math.max(1, (now - s.runStartedAt) / 1000);
  if (!(incomePerSec > 0)) return true;
  const waitSec = Math.max(0, earningsForSc(sc + 1) - earnings) / incomePerSec;
  return (sc + 1) / (runSec + waitSec) <= sc / runSec;
}

/** Spend $SC on the cheapest talent available, again and again, until nothing is affordable. */
function buyTalents(get: GetState): number {
  let bought = 0;
  for (let guard = 0; guard < 200; guard += 1) {
    const s = get();
    const next = PRESTIGE_TREE
      .filter((n) => (s.talents[n.id] ?? 0) < n.maxLevel && n.requires.every((r) => (s.talents[r] ?? 0) > 0))
      .map((n) => ({ id: n.id, cost: talentCost(n, s.talents[n.id] ?? 0) }))
      .filter((n) => n.cost <= s.sc)
      .sort((a, b) => a.cost - b.cost)[0];
    if (!next || !s.buyTalent(next.id)) break;
    bought += 1;
  }
  return bought;
}

function statusOf(p: Plan, bought: Evaluated | null): AutopilotStatus {
  if (bought) return { key: 'Bought {what}.', params: { what: bought.label }, net: p.baseNet };
  if (!p.target) return { key: 'Nothing worth buying right now: selling coins and keeping the farm healthy.', net: p.baseNet };
  const progress = Math.max(0, Math.min(1, p.spendable / p.target.cost));
  return { key: 'Saving for {what} ({price}).', params: { what: p.target.label, price: formatCash(p.target.cost) }, progress, net: p.baseNet };
}

export function createAutopilotSlice(set: SetState, get: GetState): AutopilotSlice {
  return {
    buyAutopilot: (planId) => {
      const s = get();
      const def = AUTOPILOT_PLAN_BY_ID[planId];
      if (!def) return false;
      if (s.gems < def.gems) {
        s.logT('Need {cost} gems.', { cost: def.gems }, 'warn');
        sfxBus.emit('error');
        return false;
      }
      if (s.autopilot.remainingSec + def.seconds > AUTOPILOT.maxSeconds) {
        s.logT('The AI Farm Manager cannot bank more than {time}.', { time: formatDuration(AUTOPILOT.maxSeconds) }, 'warn');
        sfxBus.emit('error');
        return false;
      }
      set({ gems: s.gems - def.gems, autopilot: { ...s.autopilot, remainingSec: s.autopilot.remainingSec + def.seconds, paused: false } });
      resetAutopilotClock();
      s.logT('AI FARM MANAGER online for {time}. Sit back.', { time: formatDuration(get().autopilot.remainingSec) }, 'good');
      sfxBus.emit('unlock');
      return true;
    },

    setAutopilotPaused: (paused) => {
      const s = get();
      if (s.autopilot.paused === paused) return;
      set({ autopilot: { ...s.autopilot, paused } });
      s.logT(paused ? 'AI Farm Manager paused: its time stops too.' : 'AI Farm Manager resumed.', undefined, 'info');
      sfxBus.emit('switch');
    },

    setAutopilotAutoHalving: (on) => {
      const s = get();
      if (s.autopilot.autoHalving === on) return;
      set({ autopilot: { ...s.autopilot, autoHalving: on } });
      s.logT(on ? 'AI Farm Manager: automatic Halving ON. It will reset the run when that earns more $SC per hour.' : 'AI Farm Manager: automatic Halving OFF.', undefined, 'info');
      sfxBus.emit('switch');
    },

    autopilotTick: (dtSec, now = Date.now()) => {
      const s = get();
      if (!autopilotActive(s)) return;
      const remainingSec = Math.max(0, s.autopilot.remainingSec - Math.min(Math.max(0, dtSec), AUTOPILOT.maxTickSec));
      set({ autopilot: { ...s.autopilot, remainingSec } });
      if (remainingSec <= 0) {
        set({ autopilotStatus: null });
        s.logT('AI FARM MANAGER offline: its time ran out. It made {n} purchases worth {spent}.', { n: s.autopilot.purchases, spent: formatCash(s.autopilot.spent) }, 'warn');
        sfxBus.emit('shutdown');
        return;
      }
      if (now - lastActAt < AUTOPILOT.actEveryMs) return;
      lastActAt = now;
      chores(get);

      if (now - lastPlanAt < AUTOPILOT.planEveryMs) {
        trade(get, 0);
        return;
      }
      lastPlanAt = now;
      // Opt-in: reset the run when one more $SC is no longer worth the wait, then invest the $SC.
      const pre = get();
      if (pre.autopilot.autoHalving && shouldHalve(pre, pre.live.yields[pre.minedCoin].valuePerSec, now)) {
        const reward = scForEarnings(bnToNumber(pre.runEarnings));
        if (pre.performHalving()) {
          const talents = buyTalents(get);
          get().logT('AI MANAGER: The Halving done for +{sc} $SC; {n} talent levels bought. Rebuilding the farm.', { sc: reward, n: talents }, 'good');
          set({ autopilotStatus: { key: 'The Halving done: rebuilding the farm.', net: 0 } });
          return;
        }
      }
      let p = plan(get(), now);
      // Coins are sold first when they would bring the target within reach.
      trade(get, p.target ? Math.max(0, p.target.cost - p.spendable) : 0);
      if (p.target && p.target.wait > 0) p = plan(get(), now);
      hireIfUseful(get, p.baseNet);

      let bought: Evaluated | null = null;
      const pick = p.buyNow;
      if (pick) {
        const before = bnToNumber(get().cash);
        const ok = pick.research ? get().startResearch(pick.research) : executeOps(get, pick.ops);
        const spent = Math.max(0, before - bnToNumber(get().cash));
        if (ok) {
          bought = pick;
          const a = get().autopilot;
          set({ autopilot: { ...a, purchases: a.purchases + 1, spent: a.spent + spent } });
          get().logT('AI MANAGER: {what} for {price}, pays for itself in {time}.', { what: pick.label, price: formatCash(spent), time: formatDuration(Math.ceil(pick.payback)) }, 'good');
        }
      }
      set({ autopilotStatus: statusOf(p, bought) });
    },
  };
}
