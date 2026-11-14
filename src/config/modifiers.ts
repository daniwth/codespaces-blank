import type { GameData, ResearchLevels, TalentLevels } from '../types/player';
import { perkModifiers } from './collection';
import { talentModifiers, type TalentModifiers } from './prestigeTree';
import { researchModifiers, type ResearchModifiers } from './research';

/**
 * Everything that scales the current run: permanent talents ($SC tree) combined with the
 * run-scoped Lab research. Shared multipliers (hashrate, electricity) stack multiplicatively.
 */
/** Permanent perks outside the talent tree: challenge relics and the Silicon Collection. */
export type PerkSource = Partial<Pick<GameData, 'challengeRecords' | 'collection'>>;

export type RunModifiers = TalentModifiers & Pick<ResearchModifiers, 'coolingMul' | 'pasteLifeMul' | 'lineMul' | 'hardwarePriceMul' | 'smartBmc' | 'orderDesk'>;

export function runModifiers(talents: TalentLevels, research: ResearchLevels = {}, perks: PerkSource = {}): RunModifiers {
  const t = talentModifiers(talents);
  const r = researchModifiers(research);
  const p = perkModifiers(perks.challengeRecords, perks.collection);
  return {
    ...t,
    hashMul: t.hashMul * r.hashMul * p.hashMul,
    electricityMul: t.electricityMul * r.electricityMul * p.electricityMul,
    heatMul: t.heatMul * p.heatMul,
    techSpeed: t.techSpeed * p.techSpeedMul,
    coolingMul: r.coolingMul,
    pasteLifeMul: r.pasteLifeMul,
    lineMul: r.lineMul,
    hardwarePriceMul: r.hardwarePriceMul,
    smartBmc: r.smartBmc,
    orderDesk: r.orderDesk,
  };
}
