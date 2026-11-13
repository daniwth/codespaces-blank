import type { RoomDefinition, RoomId } from '../types/player';

/**
 * Progressive rooms. Each one adds rack pads, a bigger contracted power line,
 * cheaper electricity and a better thermal environment.
 */
export const ROOM_CATALOG: RoomDefinition[] = [
  {
    id: 'bedroom', name: 'Bedroom', subtitle: 'Mom says the PC is too loud',
    price: 0, ambient: 24, maxPowerW: 1_500, pads: 2, priceMul: 1, coolingMul: 1, heatPerWatt: 0.008,
    theme: { wall: '#3b2f5c', wallDark: '#261d40', floorA: '#6b4f3a', floorB: '#5c4331', trim: '#8b6b52', light: '#fde68a' },
  },
  {
    id: 'garage', name: 'Garage', subtitle: 'Summer heat: +35°C ambient',
    price: 2_500, ambient: 35, maxPowerW: 6_000, pads: 4, priceMul: 0.85, coolingMul: 1.05, heatPerWatt: 0.0016,
    theme: { wall: '#4b5563', wallDark: '#374151', floorA: '#57534e', floorB: '#44403c', trim: '#a16207', light: '#fef9c3' },
  },
  {
    id: 'warehouse', name: 'Industrial Warehouse', subtitle: 'Three-phase power & ceiling fans',
    price: 200_000, ambient: 22, maxPowerW: 60_000, pads: 6, priceMul: 0.65, coolingMul: 1.15, heatPerWatt: 0.00022,
    theme: { wall: '#334155', wallDark: '#1e293b', floorA: '#475569', floorB: '#3f4b5c', trim: '#f59e0b', light: '#e0f2fe' },
  },
  {
    id: 'arctic', name: 'Arctic Datacenter', subtitle: 'Free cooling at -10°C',
    price: 20_000_000, ambient: -10, maxPowerW: 400_000, pads: 10, priceMul: 0.45, coolingMul: 1.3, heatPerWatt: 0.00005,
    theme: { wall: '#cbd5e1', wallDark: '#94a3b8', floorA: '#e2e8f0', floorB: '#cfd8e3', trim: '#0ea5e9', light: '#f0f9ff' },
  },
  {
    id: 'submarine', name: 'Submarine Datacenter', subtitle: 'Abyssal cooling, but the hull holds 84 GPUs',
    price: 1_500_000_000, ambient: 4, maxPowerW: 2_000_000, pads: 13, priceMul: 0.3, coolingMul: 1.75, heatPerWatt: 0.000012, maxGpus: 84,
    theme: { wall: '#0c4a6e', wallDark: '#082f49', floorA: '#155e75', floorB: '#134e5e', trim: '#facc15', light: '#a5f3fc' },
  },
];

export const ROOM_BY_ID = Object.fromEntries(ROOM_CATALOG.map((r) => [r.id, r])) as Record<RoomId, RoomDefinition>;

export const ROOM_ORDER: RoomId[] = ROOM_CATALOG.map((r) => r.id);

/** Hard cap of pads that fit on the canvas floor (2 rows × 8). */
export const MAX_PADS = 16;

// ───────────────────────── Floor layout ─────────────────────────

/** Pads sit in one row up to six, in two rows beyond that. */
export function padRows(count: number): { rows: number; perRow: number } {
  const rows = count <= 6 ? 1 : 2;
  return { rows, perRow: Math.ceil(count / rows) };
}

/** True when two pads stand next to each other in the same row. */
export function padsAdjacent(a: number, b: number, count: number): boolean {
  const { perRow } = padRows(count);
  return Math.abs(a - b) === 1 && Math.floor(a / perRow) === Math.floor(b / perRow);
}

// ───────────────────────── Room identity ─────────────────────────

/**
 * What makes each room play differently, on top of its numbers above. Everything here is a pure
 * function of the wall clock, so the Web Worker, the offline catch-up and the UI agree on it.
 */
export const ROOM_MECHANICS = {
  /** Shared day/night clock: one full day lasts this long, the second half is night. */
  dayLengthSec: 600,
  /** Bedroom: with more fan noise than this at night, overclocks only deliver part of their bonus. */
  bedroom: { noiseLimit: 40, nightOcShare: 0.5 },
  /** Garage: every `everySec` a heat wave lasts `waveSec`, peaking `delta` °C above the usual ambient. */
  garage: { everySec: 420, waveSec: 90, delta: 7, offsetSec: 200 },
  /** Warehouse: a battery bank makes night-time (valley) power cheaper. */
  warehouse: { batteryPrice: 150_000, valleyMul: 0.6 },
  /**
   * Arctic: a die that sat powered off below `dewTemp` has condensation on it. When it is powered again it
   * runs a heater strip (fans off, no hashing) until it reaches `dryTemp`; a working die stays dry.
   */
  arctic: { dewTemp: 5, dryTemp: 15, preheatShare: 0.5, preheatMinW: 60 },
} as const;

/** Position inside the shared day, 0-1 (day is the first half, night the second). */
export function dayPhase(nowMs: number): number {
  const len = ROOM_MECHANICS.dayLengthSec * 1000;
  return (((nowMs % len) + len) % len) / len;
}

export const isNight = (nowMs: number): boolean => dayPhase(nowMs) >= 0.5;

/** Seconds until the next sunrise or sunset. */
export function secondsToDayFlip(nowMs: number): number {
  const p = dayPhase(nowMs);
  return (p < 0.5 ? 0.5 - p : 1 - p) * ROOM_MECHANICS.dayLengthSec;
}

/** Degrees the garage's heat wave adds right now (0 between waves, a smooth hump during one). */
export function garageWave(nowMs: number): number {
  const g = ROOM_MECHANICS.garage;
  const t = (((nowMs / 1000 + g.offsetSec) % g.everySec) + g.everySec) % g.everySec;
  return t < g.waveSec ? g.delta * Math.sin((Math.PI * t) / g.waveSec) : 0;
}

/** Seconds until the next garage heat wave starts (0 while one is on). */
export function secondsToGarageWave(nowMs: number): number {
  const g = ROOM_MECHANICS.garage;
  const t = (((nowMs / 1000 + g.offsetSec) % g.everySec) + g.everySec) % g.everySec;
  return t < g.waveSec ? 0 : g.everySec - t;
}
