import Decimal from 'break_infinity.js';
import type { BigNum } from '../types/economy';

/**
 * Thin BigNum abstraction over break_infinity.js. Values travel through the
 * store as strings (JSON/structured-clone safe) and are lifted to Decimal only
 * when doing arithmetic.
 */
export type BigNumLike = BigNum | number | Decimal;

export const toDecimal = (v: BigNumLike): Decimal => (v instanceof Decimal ? v : new Decimal(v));

const serialize = (d: Decimal): BigNum => {
  if (!Number.isFinite(d.mantissa) || Number.isNaN(d.mantissa)) return '0';
  return d.toString();
};

export const bn = (v: BigNumLike): BigNum => serialize(toDecimal(v));
export const bnAdd = (a: BigNumLike, b: BigNumLike): BigNum => serialize(toDecimal(a).add(toDecimal(b)));
export const bnSub = (a: BigNumLike, b: BigNumLike): BigNum => serialize(toDecimal(a).sub(toDecimal(b)));
export const bnMul = (a: BigNumLike, b: BigNumLike): BigNum => serialize(toDecimal(a).mul(toDecimal(b)));
export const bnGte = (a: BigNumLike, b: BigNumLike): boolean => toDecimal(a).gte(toDecimal(b));
export const bnLt = (a: BigNumLike, b: BigNumLike): boolean => toDecimal(a).lt(toDecimal(b));
export const bnMax = (a: BigNumLike, b: BigNumLike): BigNum => serialize(Decimal.max(toDecimal(a), toDecimal(b)));
export const bnToNumber = (a: BigNumLike): number => toDecimal(a).toNumber();
export const bnIsZero = (a: BigNumLike): boolean => toDecimal(a).eq(0);
/** Subtract but never below zero. */
export const bnSubClamp = (a: BigNumLike, b: BigNumLike): BigNum => {
  const r = toDecimal(a).sub(toDecimal(b));
  return r.lt(0) ? '0' : serialize(r);
};

export { Decimal };
