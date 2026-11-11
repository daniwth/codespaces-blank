import { talentModifiers } from '../../config/prestigeTree';
import { RESEARCH_BY_ID, researchCost, researchLevel, researchTime, rushCost } from '../../config/research';
import type { ResearchId, ResearchLevels, TalentLevels } from '../../types/player';
import { bnAdd, bnGte, bnSub } from '../../utils/bignum';
import { fxBus, sfxBus } from '../../utils/eventBus';
import { formatCash, formatDuration } from '../../utils/formatters';
import type { GetState, ResearchSlice, SetState } from '../storeTypes';

/** Seconds the next level of a project takes for this player (R&D Grant included). */
export const researchSeconds = (id: ResearchId, levels: ResearchLevels, talents: TalentLevels): number =>
  researchTime(RESEARCH_BY_ID[id], researchLevel(levels, id), talentModifiers(talents).researchTimeMul);

export function createResearchSlice(set: SetState, get: GetState): ResearchSlice {
  return {
    startResearch: (id) => {
      const s = get();
      const def = RESEARCH_BY_ID[id];
      const level = researchLevel(s.research.levels, id);
      if (!def || level >= def.maxLevel) return false;
      if (s.research.active) {
        s.logT('The Lab is busy with {name}. One project at a time.', { name: RESEARCH_BY_ID[s.research.active.id].name }, 'warn');
        sfxBus.emit('error');
        return false;
      }
      const cost = researchCost(def, level);
      if (!bnGte(s.cash, cost)) {
        s.logT('Not enough cash for {label} ({price}).', { label: def.name, price: formatCash(cost) }, 'warn');
        sfxBus.emit('error');
        return false;
      }
      const now = Date.now();
      const seconds = researchSeconds(id, s.research.levels, s.talents);
      set({ cash: bnSub(s.cash, cost), research: { ...s.research, active: { id, startedAt: now, endsAt: now + seconds * 1000 } } });
      s.logT('Research started: {name} Lv.{level} ({time}).', { name: def.name, level: level + 1, time: formatDuration(seconds) }, 'info');
      sfxBus.emit('install');
      return true;
    },

    cancelResearch: () => {
      const s = get();
      const active = s.research.active;
      if (!active) return false;
      const def = RESEARCH_BY_ID[active.id];
      const refund = researchCost(def, researchLevel(s.research.levels, active.id));
      set({ cash: bnAdd(s.cash, refund), research: { ...s.research, active: null } });
      s.logT('Research cancelled: {name}. {price} refunded.', { name: def.name, price: formatCash(refund) }, 'info');
      sfxBus.emit('switch');
      return true;
    },

    rushResearch: () => {
      const s = get();
      const active = s.research.active;
      if (!active) return false;
      const now = Date.now();
      const cost = rushCost(Math.max(0, (active.endsAt - now) / 1000));
      if (s.gems < cost) {
        s.logT('Need {cost} gems.', { cost }, 'warn');
        sfxBus.emit('error');
        return false;
      }
      set({ gems: s.gems - cost, research: { ...s.research, active: { ...active, endsAt: now } } });
      return get().checkResearch(now);
    },

    checkResearch: (now = Date.now()) => {
      const s = get();
      const active = s.research.active;
      if (!active || now < active.endsAt) return false;
      const def = RESEARCH_BY_ID[active.id];
      const level = Math.min(def.maxLevel, researchLevel(s.research.levels, active.id) + 1);
      set({
        research: { levels: { ...s.research.levels, [active.id]: level }, active: null },
        stats: { ...s.stats, researchDone: s.stats.researchDone + 1 },
      });
      s.logT('RESEARCH COMPLETE: {name} Lv.{level} ({effect}).', { name: def.name, level, effect: def.effectOf(level) }, 'good');
      sfxBus.emit('unlock');
      fxBus.emit({ kind: 'confetti', intensity: 0.3 });
      return true;
    },
  };
}
