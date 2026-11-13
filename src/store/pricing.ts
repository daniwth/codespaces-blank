import { coinPerMHs } from '../config/altcoins';
import { EVENT_EFFECTS } from '../config/gameBalance';
import { PSU_BY_ID, PSU_CATALOG } from '../config/hardwareCatalog';
import { researchModifiers } from '../config/research';
import type { MineableCoin } from '../types/economy';
import type { GpuModel } from '../types/hardware';
import type { GameData, RoomId } from '../types/player';
import { clamp } from '../utils/random';
import { gridTariff, wattPrice } from './gamePhysics';

type PriceView = Pick<GameData, 'research' | 'event'>;

/** Multiplier on GPU / PSU / cooler / rack list prices: Bulk Logistics research and the Flash Sale event. */
export const hardwarePriceMul = (s: PriceView): number =>
  researchModifiers(s.research.levels).hardwarePriceMul * (s.event?.id === 'flash_sale' ? EVENT_EFFECTS.flashSaleMul : 1);

/** What a piece of hardware costs right now (list price with the current discounts, to the cent). */
export const hardwarePrice = (listPrice: number, s: PriceView): number =>
  Math.max(0.01, Math.round(listPrice * hardwarePriceMul(s) * 100) / 100);

// ───────────────────────── Net return on a GPU ─────────────────────────

export interface GpuEconomicsCtx {
  roomId: RoomId;
  /** Talent + research multipliers of the run. */
  hashMul: number;
  electricityMul: number;
  /** Wall efficiency of the PSU that will feed the card (0-1]. */
  psuEfficiency: number;
  /** Coin being mined, its market price, its current difficulty and the pool's payout multiplier. */
  coin: MineableCoin;
  coinPrice: number;
  difficulty: number;
  poolMul: number;
}

export interface GpuEconomics {
  /** Dollars per second the card mints at the current price, pool and difficulty. */
  grossPerSec: number;
  /** Dollars per second of electricity: wall watts (board power / PSU efficiency) at the room price and the card's grid tariff. */
  powerPerSec: number;
  netPerSec: number;
  /** Seconds until `price` is paid back by the net income (Infinity when the card loses money here). */
  roiSec: number;
}

/** What one stock card earns and costs per second, and how long it takes to pay for itself. Pure. */
export function gpuEconomics(model: Pick<GpuModel, 'id' | 'hashrate' | 'power'>, price: number, ctx: GpuEconomicsCtx): GpuEconomics {
  const grossPerSec = ((model.hashrate * ctx.hashMul) / 1e6) * coinPerMHs(ctx.coin) / Math.max(1e-9, ctx.difficulty) * ctx.poolMul * ctx.coinPrice;
  const wall = model.power / clamp(ctx.psuEfficiency, 0.05, 1);
  const powerPerSec = wall * gridTariff(model.id) * wattPrice(ctx.roomId, { electricityMul: ctx.electricityMul });
  const netPerSec = grossPerSec - powerPerSec;
  return { grossPerSec, powerPerSec, netPerSec, roiSec: netPerSec > 0 ? price / netPerSec : Number.POSITIVE_INFINITY };
}

/**
 * Wall efficiency a new card would get in `roomId`: the capacity-weighted efficiency of the PSUs already
 * mounted there (self-powered racks draw nothing from the wall and are left out). With no PSU in the
 * room, the cheapest catalog PSU that can carry `boardPower` stands in.
 */
export function roomPsuEfficiency(data: Pick<GameData, 'racks' | 'psus'>, roomId: RoomId, boardPower = 0): number {
  let capacity = 0;
  let weighted = 0;
  Object.values(data.racks).forEach((rack) => {
    if (rack.roomId !== roomId || !rack.psuUid) return;
    const psu = PSU_BY_ID[data.psus[rack.psuUid]?.modelId ?? ''];
    if (!psu) return;
    capacity += psu.capacity;
    weighted += psu.capacity * psu.efficiency;
  });
  if (capacity > 0) return weighted / capacity;
  const fallback = PSU_CATALOG.find((p) => p.capacity >= boardPower) ?? PSU_CATALOG[PSU_CATALOG.length - 1];
  return fallback.efficiency;
}
