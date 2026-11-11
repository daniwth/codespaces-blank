import type { ResearchLevels, TalentLevels } from '../types/player';
import { talentModifiers, type TalentModifiers } from './prestigeTree';
import { researchModifiers, type ResearchModifiers } from './research';

/**
 * Everything that scales the current run: permanent talents ($SC tree) combined with the
 * run-scoped Lab research. Shared multipliers (hashrate, electricity) stack multiplicatively.
 */
export type RunModifiers = TalentModifiers & Pick<ResearchModifiers, 'coolingMul' | 'pasteLifeMul' | 'lineMul' | 'hardwarePriceMul'>;

export function runModifiers(talents: TalentLevels, research: ResearchLevels = {}): RunModifiers {
  const t = talentModifiers(talents);
  const r = researchModifiers(research);
  return {
    ...t,
    hashMul: t.hashMul * r.hashMul,
    electricityMul: t.electricityMul * r.electricityMul,
    coolingMul: r.coolingMul,
    pasteLifeMul: r.pasteLifeMul,
    lineMul: r.lineMul,
    hardwarePriceMul: r.hardwarePriceMul,
  };
}
