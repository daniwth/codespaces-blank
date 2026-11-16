import type { PowerContract, PpaPlanId } from '../types/economy';

/**
 * Wholesale power (Energy Desk research). Without the research the farm pays the flat retail
 * tariff. With it, the bill follows a spot index that is cheaper on average but swings; a power
 * purchase agreement (PPA) swaps the index for a fixed rate for a while.
 *
 * The index is a pure function of the wall clock (like day and night), so the worker, the UI
 * forecast and the tests agree on it. Offline catch-up bills the long-run mean.
 */
export const ENERGY = {
  /** Long-run average of the index: wholesale is this much of the retail tariff. */
  mean: 0.92,
  /** Slow swing plus a faster ripple. */
  waves: [
    { amp: 0.18, periodSec: 900, phase: 0 },
    { amp: 0.1, periodSec: 217, phase: 1.3 },
  ],
  /** Breaking a contract costs this share of what it would still bill at the current draw. */
  cancelFee: 0.15,
} as const;

const SWING = ENERGY.waves.reduce<number>((a, w) => a + w.amp, 0);
export const SPOT_MIN = ENERGY.mean - SWING;
export const SPOT_MAX = ENERGY.mean + SWING;

/** Spot index at a moment: multiplier on the retail price per watt. */
export function gridSpot(nowMs: number): number {
  const t = nowMs / 1000;
  return ENERGY.waves.reduce<number>((a, w) => a + w.amp * Math.sin((2 * Math.PI * t) / w.periodSec + w.phase), ENERGY.mean);
}

export interface PpaPlan {
  id: PpaPlanId;
  name: string;
  durationSec: number;
  /** How much of the gap between spot and mean the quote follows (1 = spot itself). */
  follow: number;
  /** Margin the supplier adds on top. */
  premium: number;
}

export const PPA_PLANS: Record<PpaPlanId, PpaPlan> = {
  short: { id: 'short', name: 'Flex 15', durationSec: 15 * 60, follow: 0.6, premium: 0.01 },
  long: { id: 'long', name: 'Baseload 120', durationSec: 120 * 60, follow: 0.3, premium: 0.025 },
};
export const PPA_PLAN_IDS: PpaPlanId[] = ['short', 'long'];
export const isPpaPlan = (v: unknown): v is PpaPlanId => typeof v === 'string' && v in PPA_PLANS;

/**
 * Fixed rate a supplier offers right now: it leans towards the spot price of the moment, so
 * signing in a trough locks a cheap rate and signing on a peak locks an expensive one.
 */
export function ppaQuote(plan: PpaPlanId, nowMs: number): number {
  const p = PPA_PLANS[plan];
  return Math.round((ENERGY.mean + (gridSpot(nowMs) - ENERGY.mean) * p.follow + p.premium) * 1000) / 1000;
}

/** Cheapest and dearest rate a plan can ever quote (sanitizing bounds). */
export const ppaRateBounds = (plan: PpaPlanId): [number, number] => {
  const p = PPA_PLANS[plan];
  return [ENERGY.mean + (SPOT_MIN - ENERGY.mean) * p.follow + p.premium, ENERGY.mean + (SPOT_MAX - ENERGY.mean) * p.follow + p.premium];
};

export const ppaActive = (ppa: PowerContract | null, nowMs: number): ppa is PowerContract => ppa !== null && nowMs < ppa.endsAt;

/** Fee to break a contract now, given what the farm is being billed per second. */
export const ppaCancelFee = (ppa: PowerContract, billPerSec: number, nowMs: number): number =>
  Math.max(0, Math.round(((ppa.endsAt - nowMs) / 1000) * billPerSec * ENERGY.cancelFee));
