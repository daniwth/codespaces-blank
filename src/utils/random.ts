export const randRange = (min: number, max: number): number => min + Math.random() * (max - min);

export const randInt = (min: number, max: number): number => Math.floor(randRange(min, max + 1));

/** Standard normal sample (Box–Muller). */
export function gaussian(): number {
  let u = 0;
  let v = 0;
  while (u === 0) u = Math.random();
  while (v === 0) v = Math.random();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

export function weightedPick<T extends string>(weights: Record<T, number>): T {
  const entries = Object.entries(weights) as [T, number][];
  const total = entries.reduce((acc, [, w]) => acc + w, 0);
  let roll = Math.random() * total;
  for (const [key, w] of entries) {
    roll -= w;
    if (roll <= 0) return key;
  }
  return entries[entries.length - 1][0];
}

export const pick = <T,>(list: readonly T[]): T => list[Math.floor(Math.random() * list.length)];

/** Deterministic value in [0, 1) from a string (FNV-1a): stable per uid, no RNG state. */
export function unitHash(seed: string, salt = 0): number {
  let h = 2166136261 ^ salt;
  for (let k = 0; k < seed.length; k += 1) {
    h ^= seed.charCodeAt(k);
    h = Math.imul(h, 16777619);
  }
  h ^= h >>> 13;
  h = Math.imul(h, 0x5bd1e995);
  return ((h ^ (h >>> 15)) >>> 0) / 4294967296;
}

export const clamp = (v: number, min: number, max: number): number => Math.min(max, Math.max(min, v));
