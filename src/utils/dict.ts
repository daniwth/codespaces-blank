/**
 * Lookup tables are indexed with ids that come from saves, so with attacker-chosen strings. A plain
 * object answers `table["constructor"]` with a function; these helpers make "is this a known id?" mean
 * exactly that.
 */

/** A copy of `source` with no prototype: only its own keys ever resolve. */
export const dict = <T extends object>(source: T): T => Object.assign(Object.create(null) as T, source);

/** True when `key` is one of the object's own keys (never an inherited one such as `constructor`). */
export const hasKey = (table: object, key: unknown): key is string => typeof key === 'string' && Object.prototype.hasOwnProperty.call(table, key);

/** Keys that must never be used as the id of a record built from untrusted data. */
export const isUnsafeKey = (key: string): boolean => key === '__proto__' || key === 'constructor' || key === 'prototype';
