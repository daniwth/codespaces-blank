import { tr } from '../../i18n';
import { BUFFS } from '../../config/buffs';
import { collect } from '../../config/collection';
import { REPUTATION, reputationCashMul, reputationLevel } from '../../config/reputation';
import type { ContractBoard, ContractChain, ReputationState } from '../../types/contracts';
import { CONTRACT_DEFS, CONTRACTS } from '../../config/contracts';
import { GPU_BY_ID } from '../../config/hardwareCatalog';
import { talentModifiers } from '../../config/prestigeTree';
import type { Contract } from '../../types/contracts';
import { bnAdd, bnGte, bnSub } from '../../utils/bignum';
import { fxBus, sfxBus } from '../../utils/eventBus';
import { formatCash, formatDuration } from '../../utils/formatters';
import {
  advanceContracts,
  contractContext,
  contractGoal,
  creditProfit,
  generateContract,
  refillBoard,
  removeContract,
  rerollCost,
  runningGpuTiers,
} from '../contracts';
import { createGpu, rollQuality } from '../initialState';
import type { ContractsSlice, GameStore, GetState, SetState } from '../storeTypes';

export const contractTitle = (c: Contract): string => tr(CONTRACT_DEFS[c.kind].name);

export function rewardText(c: Contract): string {
  const parts = [formatCash(c.reward.cash)];
  if (c.reward.gems) parts.push(c.reward.gems === 1 ? tr('1 gem') : tr('{n} gems', { n: c.reward.gems }));
  if (c.reward.gpuModelId) parts.push(tr(GPU_BY_ID[c.reward.gpuModelId].name));
  return parts.join(' + ');
}

const addPoints = (rep: ReputationState, delta: number): ReputationState => ({ ...rep, points: Math.max(0, rep.points + delta) });

/** A one-slot board around the chain's stage, so it advances with the same rules as the board. */
const chainBoard = (chain: ContractChain): ContractBoard => ({ slots: [chain.current], nextRefillAt: Number.MAX_SAFE_INTEGER, rerollReadyAt: 0 });

/** Stage `stage` (0-2) of a Special Contract: a hard contract whose cash reward grows with the stage. */
export function chainStage(ctx: ReturnType<typeof contractContext>, now: number, stage: number, exclude: Contract['kind'][] = []): Contract {
  const base = generateContract(ctx, now, exclude, Math.random, { difficulty: 3 });
  return { ...base, id: `chain-${base.id}`, reward: { ...base.reward, cash: base.reward.cash * REPUTATION.stageMul[stage] } };
}

export function createContractsSlice(set: SetState, get: GetState): ContractsSlice {
  const announceCompleted = (done: Contract[]) => {
    if (!done.length) return;
    const s = get();
    done.forEach((c) => s.pushLog(tr('CONTRACT COMPLETE: {title} — {goal}. Claim {reward} in the Contracts tab.', { title: contractTitle(c), goal: contractGoal(c), reward: rewardText(c) }), 'good'));
    const last = done[done.length - 1];
    set({ contractToast: { contractId: last.id, title: contractTitle(last), goal: contractGoal(last), t: Date.now() } });
    sfxBus.emit('contract');
  };

  const ctxOf = (s: GameStore) => contractContext(s, s.live.totalHash > 0 ? s.live : undefined);

  return {
    advanceContractBoard: (out, offline) => {
      const s = get();
      const res = advanceContracts(s.contracts, {
        start: out.now - out.dt * 1000,
        end: out.now,
        offline,
        ccMined: out.ccMined,
        earnedCash: out.earnedCash,
        botEarned: out.botEarned,
        blocksFound: out.blocksFound,
        overheats: out.overheats,
        peakTemp: out.peakTemp,
        totalHash: out.live.totalHash,
        event: out.event,
        runningTiers: runningGpuTiers(s, out.live),
      });
      const facts = {
        start: out.now - out.dt * 1000, end: out.now, offline, ccMined: out.ccMined, earnedCash: out.earnedCash, botEarned: out.botEarned,
        blocksFound: out.blocksFound, overheats: out.overheats, peakTemp: out.peakTemp, totalHash: out.live.totalHash, event: out.event,
        runningTiers: runningGpuTiers(s, out.live),
      };
      const refill = refillBoard(res.board, contractContext(s, out.live), out.now);
      // An expired contract costs reputation; the Special Contract advances by the same facts.
      let reputation = res.expired.length ? addPoints(s.reputation, REPUTATION.expire * res.expired.length) : s.reputation;
      const chainDone: Contract[] = [];
      if (reputation.chain) {
        const step = advanceContracts(chainBoard(reputation.chain), facts);
        if (step.expired.length) {
          reputation = { ...addPoints(reputation, REPUTATION.chainFail), chain: null, chainReadyAt: out.now + REPUTATION.chainCooldownSec * 1000 };
          s.logT('SPECIAL CONTRACT FAILED: stage {n} expired. The chain is lost.', { n: (s.reputation.chain?.stage ?? 0) + 1 }, 'bad');
        } else if (step.board.slots[0] !== reputation.chain.current) {
          reputation = { ...reputation, chain: { ...reputation.chain, current: step.board.slots[0] } };
          chainDone.push(...step.completed);
        }
      }
      set({ contracts: refill.board, reputation });
      res.expired.forEach((c) => s.pushLog(tr('Contract expired: {title} ({goal}).', { title: contractTitle(c), goal: contractGoal(c) }), 'warn'));
      if (!offline) refill.added.forEach((c) => s.pushLog(tr('New contract on the board: {title}.', { title: contractTitle(c) }), 'info'));
      announceCompleted([...res.completed, ...chainDone]);
    },

    creditContractProfit: (amount) => {
      const res = creditProfit(get().contracts, amount, Date.now());
      if (res.board !== get().contracts) set({ contracts: res.board });
      const chain = get().reputation.chain;
      const step = chain ? creditProfit(chainBoard(chain), amount, Date.now()) : null;
      if (chain && step && step.board.slots[0] !== chain.current) set({ reputation: { ...get().reputation, chain: { ...chain, current: step.board.slots[0] } } });
      announceCompleted([...res.completed, ...(step?.completed ?? [])]);
    },

    claimContract: (id) => {
      const s = get();
      const chain = s.reputation.chain;
      const isChain = chain?.current.id === id;
      const c = isChain ? chain?.current : s.contracts.slots.find((x) => x.id === id);
      if (!c || c.completedAt === null) {
        sfxBus.emit('error');
        return false;
      }
      const now = Date.now();
      // Audit drone: the claim pays extra cash and uses one audit up.
      const audited = s.buffs.auditClaims > 0;
      // Reputation raises every payout a little.
      const cashReward = c.reward.cash * (audited ? BUFFS.audit.cashMul : 1) * reputationCashMul(s.reputation.points);
      const patch: Partial<GameStore> = {
        contracts: isChain ? s.contracts : removeContract(s.contracts, id, now),
        buffs: audited ? { ...s.buffs, auditClaims: s.buffs.auditClaims - 1 } : s.buffs,
        // A gift, not realized profit: it does not count towards run/lifetime earnings.
        cash: bnAdd(s.cash, cashReward),
        gems: s.gems + c.reward.gems,
        stats: { ...s.stats, contractsCompleted: s.stats.contractsCompleted + 1 },
        contractToast: s.contractToast?.contractId === id ? null : s.contractToast,
      };
      const model = c.reward.gpuModelId ? GPU_BY_ID[c.reward.gpuModelId] : undefined;
      if (model) {
        const quality = rollQuality(talentModifiers(s.talents).qualityLuck);
        const gpu = createGpu(model.id, quality);
        patch.gpus = { ...s.gpus, [gpu.uid]: gpu };
        patch.lottery = { modelId: model.id, quality, t: now };
        patch.collection = collect(s.collection, model.id, quality);
      }
      // Delivered on time: reputation grows with the difficulty. A chain stage hands over to the next one.
      let reputation = addPoints(s.reputation, REPUTATION.claim[c.difficulty - 1]);
      let chainFinished = false;
      if (isChain && chain) {
        const nextStage = chain.stage + 1;
        if (nextStage < REPUTATION.chainStages) {
          reputation = { ...reputation, chain: { stage: nextStage, current: chainStage(ctxOf(s), now, nextStage, [c.kind]) } };
        } else {
          chainFinished = true;
          reputation = { ...addPoints(reputation, REPUTATION.chainPoints), chain: null, chainsDone: reputation.chainsDone + 1, chainReadyAt: now + REPUTATION.chainCooldownSec * 1000 };
          patch.gems = (patch.gems ?? s.gems) + REPUTATION.chainGems;
        }
      }
      patch.reputation = reputation;
      const levelBefore = reputationLevel(s.reputation.points);
      set(patch);
      if (reputationLevel(reputation.points) > levelBefore) {
        s.logT('REPUTATION LEVEL {n}! Contracts pay +{pct}% cash.', { n: reputationLevel(reputation.points), pct: Math.round(reputationLevel(reputation.points) * REPUTATION.cashPerLevel * 100) }, 'good');
        if (reputationLevel(reputation.points) === REPUTATION.chainLevel) s.logT('Special Contracts unlocked: three stages in a row, each paying more.', undefined, 'good');
      }
      if (isChain && chain) {
        if (chainFinished) s.logT('SPECIAL CONTRACT COMPLETE! All {n} stages delivered: +{gems} gems.', { n: REPUTATION.chainStages, gems: REPUTATION.chainGems }, 'good');
        else s.logT('Special Contract: stage {n} of {max} delivered. The next one pays more.', { n: chain.stage + 1, max: REPUTATION.chainStages }, 'good');
      }
      s.pushLog(model
        ? tr('Contract claimed: {title} → {reward} (in Rigs storage).', { title: contractTitle(c), reward: rewardText(c) })
        : tr('Contract claimed: {title} → {reward}.', { title: contractTitle(c), reward: rewardText(c) }), 'good');
      if (audited) s.logT('Audit bonus: +{cash} on that contract.', { cash: formatCash(cashReward - c.reward.cash) }, 'good');
      sfxBus.emit('claim');
      fxBus.emit({ kind: 'sell', amount: cashReward });
      fxBus.emit({ kind: 'confetti', intensity: c.difficulty === 3 ? 0.5 : 0.25 });
      get().checkAchievements();
      return true;
    },

    contractRerollCost: () => rerollCost(ctxOf(get())),

    rerollContract: (id) => {
      const s = get();
      const idx = s.contracts.slots.findIndex((x) => x.id === id);
      const c = s.contracts.slots[idx];
      const now = Date.now();
      if (!c || c.completedAt !== null) return false;
      if (now < s.contracts.rerollReadyAt) {
        sfxBus.emit('error');
        s.pushLog(tr('Next reroll in {time}.', { time: formatDuration((s.contracts.rerollReadyAt - now) / 1000) }), 'warn');
        return false;
      }
      const ctx = ctxOf(s);
      const cost = rerollCost(ctx);
      if (!bnGte(s.cash, cost)) {
        sfxBus.emit('error');
        s.pushLog(tr('Rerolling a contract costs {price}.', { price: formatCash(cost) }), 'warn');
        return false;
      }
      const fresh = generateContract(ctx, now, s.contracts.slots.map((x) => x.kind));
      const slots = s.contracts.slots.slice();
      slots[idx] = fresh;
      set({
        cash: bnSub(s.cash, cost),
        contracts: { ...s.contracts, slots, rerollReadyAt: now + CONTRACTS.rerollCooldownSec * 1000 },
      });
      s.pushLog(tr('Contract rerolled for {price}: {title}.', { price: formatCash(cost), title: contractTitle(fresh) }), 'info');
      sfxBus.emit('switch');
      return true;
    },

    dismissContractToast: () => set({ contractToast: null }),

    acceptChain: () => {
      const s = get();
      const now = Date.now();
      if (s.reputation.chain || reputationLevel(s.reputation.points) < REPUTATION.chainLevel || now < s.reputation.chainReadyAt) {
        sfxBus.emit('error');
        return false;
      }
      set({ reputation: { ...s.reputation, chain: { stage: 0, current: chainStage(ctxOf(s), now, 0) } } });
      s.logT('Special Contract accepted: {n} stages, each paying more than the last. Miss one and the chain is lost.', { n: REPUTATION.chainStages }, 'info');
      sfxBus.emit('contract');
      return true;
    },
  };
}
