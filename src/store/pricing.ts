import { EVENT_EFFECTS } from '../config/gameBalance';
import { researchModifiers } from '../config/research';
import type { GameData } from '../types/player';

type PriceView = Pick<GameData, 'research' | 'event'>;

/** Multiplier on GPU / PSU / cooler / rack list prices: Bulk Logistics research and the Flash Sale event. */
export const hardwarePriceMul = (s: PriceView): number =>
  researchModifiers(s.research.levels).hardwarePriceMul * (s.event?.id === 'flash_sale' ? EVENT_EFFECTS.flashSaleMul : 1);

/** What a piece of hardware costs right now (list price with the current discounts, to the cent). */
export const hardwarePrice = (listPrice: number, s: PriceView): number =>
  Math.max(0.01, Math.round(listPrice * hardwarePriceMul(s) * 100) / 100);
