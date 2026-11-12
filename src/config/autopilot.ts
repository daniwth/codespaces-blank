/**
 * AI Farm Manager: a gem-bought autopilot that runs the farm for a while. The time only runs
 * down while the game is open (it cannot act on a closed game), so a plan is never wasted.
 */
export type AutopilotPlanId = 'h1' | 'h2' | 'd1';

export interface AutopilotPlan {
  id: AutopilotPlanId;
  label: string;
  seconds: number;
  gems: number;
}

export const AUTOPILOT_PLANS: AutopilotPlan[] = [
  { id: 'h1', label: '1 hour', seconds: 3_600, gems: 3 },
  { id: 'h2', label: '2 hours', seconds: 7_200, gems: 5 },
  { id: 'd1', label: '1 day', seconds: 86_400, gems: 25 },
];

export const AUTOPILOT_PLAN_BY_ID = Object.fromEntries(AUTOPILOT_PLANS.map((p) => [p.id, p])) as Record<AutopilotPlanId, AutopilotPlan>;

export const AUTOPILOT = {
  /** Banked time can never exceed this (7 days). */
  maxSeconds: 7 * 86_400,
  /** Real ms between two rounds of chores (claims, sales, maintenance). */
  actEveryMs: 1_500,
  /** Real ms between two investment decisions (each one simulates every candidate). */
  planEveryMs: 4_000,
  /** A tick never burns more than this much manager time (a sleeping tab is not charged). */
  maxTickSec: 5,
  /** Seconds of farm time each candidate is simulated for. */
  simSeconds: 900,
  /** Purchases that take longer than this to pay for themselves are never made. */
  maxPaybackSec: 4 * 3_600,
  /** Candidates may cost up to the cash plus this many seconds of net income. */
  reachSeconds: 600,
  /** Cash kept aside: this many seconds of the current electricity bill. */
  reserveBillSec: 120,
  /** Die temperature the cooling of a new build is sized for (°C). */
  targetTemp: 72,
  /** A rack running hotter than this gets a cooling upgrade candidate (°C). */
  hotTemp: 80,
  /** PSUs are sized so the load stays under this share of their capacity. */
  psuLoadShare: 0.9,
  /** Coins are sold at or above this multiple of their recent average price… */
  sellAtAverage: 0.98,
  /** …over this many candles, or anyway once the wallet is worth this many seconds of income. */
  averageCandles: 30,
  maxHoldSec: 600,
  /** Switch the mined coin only for a yield this much better (avoids flip-flopping). */
  coinSwitchGain: 1.1,
  /** Repair a GPU above this wear when it costs under this share of the spendable cash. */
  repairWear: 0.6,
  repairCashShare: 0.25,
  /** Hire a technician per this many mounted GPUs when it costs under this many seconds of income. */
  gpusPerTechnician: 6,
  technicianIncomeSec: 300,
} as const;
