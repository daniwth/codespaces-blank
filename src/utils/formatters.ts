import Decimal from 'break_infinity.js';
import type { BigNumLike } from './bignum';
import { toDecimal } from './bignum';

const METRIC_SUFFIXES = ['', 'K', 'M', 'B', 'T', 'Qa', 'Qi', 'Sx', 'Sp', 'Oc', 'No', 'Dc', 'UDc', 'DDc', 'TDc', 'QaDc', 'QiDc'];
const HASH_UNITS = ['H/s', 'KH/s', 'MH/s', 'GH/s', 'TH/s', 'PH/s', 'EH/s', 'ZH/s', 'YH/s'];
const POWER_UNITS = ['W', 'kW', 'MW', 'GW', 'TW'];

const trimFixed = (value: number, digits: number): string => {
  const fixed = value.toFixed(digits);
  return digits > 0 ? fixed.replace(/\.?0+$/, '') : fixed;
};

/** Metric notation (K, M, B, T, Qa, Qi, …) for numbers and BigNums. */
export function formatNumber(value: BigNumLike, digits = 2): string {
  const d = toDecimal(value);
  if (d.eq(0)) return '0';
  const sign = d.lt(0) ? '-' : '';
  const abs = d.abs();
  if (abs.lt(1000)) {
    const n = abs.toNumber();
    const shown = n < 10 ? trimFixed(n, digits) : n < 100 ? trimFixed(n, Math.min(digits, 1)) : n.toFixed(0);
    return sign + shown;
  }
  const exp = Math.floor(abs.log10());
  const tier = Math.floor(exp / 3);
  if (tier < METRIC_SUFFIXES.length) {
    const scaled = abs.div(Decimal.pow(10, tier * 3)).toNumber();
    const dec = scaled >= 100 ? 0 : scaled >= 10 ? 1 : digits;
    return `${sign}${trimFixed(scaled, dec)}${METRIC_SUFFIXES[tier]}`;
  }
  return `${sign}${abs.mantissa.toFixed(2)}e${abs.exponent}`;
}

export const formatCash = (value: BigNumLike, digits = 2): string => {
  const d = toDecimal(value);
  return d.lt(0) ? `-$${formatNumber(d.abs(), digits)}` : `$${formatNumber(d, digits)}`;
};

export const formatCoin = (value: BigNumLike, coin: string, digits = 2): string =>
  `${formatNumber(value, digits)} $${coin}`;

/** Hashrate with SI units (H/s … EH/s). Input in H/s. */
export function formatHashrate(hps: number): string {
  if (!Number.isFinite(hps) || hps <= 0) return '0 H/s';
  let unit = 0;
  let v = hps;
  while (v >= 1000 && unit < HASH_UNITS.length - 1) {
    v /= 1000;
    unit += 1;
  }
  return `${trimFixed(v, v >= 100 ? 0 : v >= 10 ? 1 : 2)} ${HASH_UNITS[unit]}`;
}

/** Power with SI units (W, kW, MW…). Input in watts. */
export function formatPower(watts: number): string {
  if (!Number.isFinite(watts) || watts <= 0) return '0 W';
  let unit = 0;
  let v = watts;
  while (v >= 1000 && unit < POWER_UNITS.length - 1) {
    v /= 1000;
    unit += 1;
  }
  return `${trimFixed(v, unit === 0 ? 0 : v >= 100 ? 0 : 1)} ${POWER_UNITS[unit]}`;
}

export const formatTemp = (celsius: number, digits = 0): string => `${celsius.toFixed(digits)}°C`;

export const formatPercent = (ratio: number, digits = 0): string => `${(ratio * 100).toFixed(digits)}%`;

/** Multipliers such as grid demand: x1.6, x17, x1.2K. */
export const formatMultiplier = (value: number): string => `x${formatNumber(value, value < 10 ? 1 : 2)}`;

export const formatPrice = (price: number): string => {
  if (price >= 100) return `$${price.toFixed(0)}`;
  if (price >= 1) return `$${price.toFixed(3)}`;
  if (price >= 0.01) return `$${price.toFixed(4)}`;
  return `$${price.toFixed(5)}`;
};

export function formatDuration(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (h > 0) return `${h}h ${m.toString().padStart(2, '0')}m`;
  if (m > 0) return `${m}m ${sec.toString().padStart(2, '0')}s`;
  return `${sec}s`;
}

/** "just now", "12 min ago", "3 h ago", "4 days ago"; older dates fall back to the locale date. */
export function formatAgo(timestamp: number, now = Date.now()): string {
  const sec = Math.max(0, (now - timestamp) / 1000);
  if (sec < 60) return 'just now';
  if (sec < 3600) return `${Math.floor(sec / 60)} min ago`;
  if (sec < 86_400) return `${Math.floor(sec / 3600)} h ago`;
  const days = Math.floor(sec / 86_400);
  if (days < 30) return days === 1 ? 'yesterday' : `${days} days ago`;
  return new Date(timestamp).toLocaleDateString();
}

/** Color ramp used by LEDs, bars and text: green → orange → red. */
export function tempColor(celsius: number): string {
  if (celsius >= 90) return '#ef4444';
  if (celsius >= 80) return '#f97316';
  if (celsius >= 70) return '#facc15';
  return '#22c55e';
}
