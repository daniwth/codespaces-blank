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

export const contractTitle = (c: Contract): string => CONTRACT_DEFS[c.kind].name;

export function rewardText(c: Contract): string {
  const parts = [formatCash(c.reward.cash)];
  if (c.reward.gems) parts.push(`${c.reward.gems} gem${c.reward.gems === 1 ? '' : 's'}`);
  if (c.reward.gpuModelId) parts.push(GPU_BY_ID[c.reward.gpuModelId].name);
  return parts.join(' + ');
}

export function createContractsSlice(set: SetState, get: GetState): ContractsSlice {
  const announceCompleted = (done: Contract[]) => {
    if (!done.length) return;
    const s = get();
    done.forEach((c) => s.pushLog(`CONTRACT COMPLETE: ${contractTitle(c)} — ${contractGoal(c)}. Claim ${rewardText(c)} in the Contracts tab.`, 'good'));
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
      const refill = refillBoard(res.board, contractContext(s, out.live), out.now);
      set({ contracts: refill.board });
      res.expired.forEach((c) => s.pushLog(`Contract expired: ${contractTitle(c)} (${contractGoal(c)}).`, 'warn'));
      if (!offline) refill.added.forEach((c) => s.pushLog(`New contract on the board: ${contractTitle(c)}.`, 'info'));
      announceCompleted(res.completed);
    },

    creditContractProfit: (amount) => {
      const res = creditProfit(get().contracts, amount, Date.now());
      if (res.board !== get().contracts) set({ contracts: res.board });
      announceCompleted(res.completed);
    },

    claimContract: (id) => {
      const s = get();
      const c = s.contracts.slots.find((x) => x.id === id);
      if (!c || c.completedAt === null) {
        sfxBus.emit('error');
        return false;
      }
      const now = Date.now();
      const patch: Partial<GameStore> = {
        contracts: removeContract(s.contracts, id, now),
        // A gift, not realized profit: it does not count towards run/lifetime earnings.
        cash: bnAdd(s.cash, c.reward.cash),
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
      }
      set(patch);
      s.pushLog(`Contract claimed: ${contractTitle(c)} → ${rewardText(c)}${model ? ' (in Rigs storage)' : ''}.`, 'good');
      sfxBus.emit('claim');
      fxBus.emit({ kind: 'sell', amount: c.reward.cash });
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
        s.pushLog(`Next reroll in ${formatDuration((s.contracts.rerollReadyAt - now) / 1000)}.`, 'warn');
        return false;
      }
      const ctx = ctxOf(s);
      const cost = rerollCost(ctx);
      if (!bnGte(s.cash, cost)) {
        sfxBus.emit('error');
        s.pushLog(`Rerolling a contract costs ${formatCash(cost)}.`, 'warn');
        return false;
      }
      const fresh = generateContract(ctx, now, s.contracts.slots.map((x) => x.kind));
      const slots = s.contracts.slots.slice();
      slots[idx] = fresh;
      set({
        cash: bnSub(s.cash, cost),
        contracts: { ...s.contracts, slots, rerollReadyAt: now + CONTRACTS.rerollCooldownSec * 1000 },
      });
      s.pushLog(`Contract rerolled for ${formatCash(cost)}: ${contractTitle(fresh)}.`, 'info');
      sfxBus.emit('switch');
      return true;
    },

    dismissContractToast: () => set({ contractToast: null }),
  };
}
