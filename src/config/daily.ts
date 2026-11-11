/**
 * Daily bonus: one claim per local calendar day. Claiming on consecutive days climbs a 7-day
 * ladder (then it loops); skipping a day sends the streak back to day 1.
 */
export interface DailyReward {
  /** Cash worth this many minutes of the farm's estimated net income. */
  incomeMin: number;
  gems: number;
}

export const DAILY_REWARDS: DailyReward[] = [
  { incomeMin: 5, gems: 0 },
  { incomeMin: 8, gems: 0 },
  { incomeMin: 10, gems: 1 },
  { incomeMin: 15, gems: 0 },
  { incomeMin: 20, gems: 2 },
  { incomeMin: 25, gems: 0 },
  { incomeMin: 30, gems: 3 },
];

/** Cash rewards never drop below this (a brand new farm earns cents per second). */
export const DAILY_MIN_CASH = 50;

/** Local calendar day number (days since the Unix epoch in the player's time zone). */
export const localDay = (now: number = Date.now()): number =>
  Math.floor((now - new Date(now).getTimezoneOffset() * 60_000) / 86_400_000);

/** Reward of the `streak`-th consecutive day (1-based); the ladder loops after day 7. */
export const dailyRewardFor = (streak: number): DailyReward =>
  DAILY_REWARDS[(Math.max(1, Math.floor(streak)) - 1) % DAILY_REWARDS.length];

export const dailyCash = (reward: DailyReward, incomePerSec: number): number =>
  Math.max(DAILY_MIN_CASH, Math.round(reward.incomeMin * 60 * incomePerSec));
