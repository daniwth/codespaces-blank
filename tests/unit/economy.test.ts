import { describe, expect, it } from 'vitest';
import { scForEarnings } from '../../src/config/prestigeTree';
import { migrateSave } from '../../src/store/migrations';
import { bnAdd, bnGte, bnSubClamp } from '../../src/utils/bignum';
import { formatHashrate, formatNumber, formatPower } from '../../src/utils/formatters';
import { decodeSave, encodeSave, sha256 } from '../../src/utils/saveCodec';
import { createInitialData } from '../../src/store/initialState';

describe('BigNum & formatters', () => {
  it('handles values far beyond float range', () => {
    const big = bnAdd('1e400', '1e400');
    expect(bnGte(big, '1e400')).toBe(true);
    expect(bnSubClamp('5', '10')).toBe('0');
    expect(formatNumber('2e400')).toMatch(/e400/);
  });
  it('formats metric, hashrate and power units', () => {
    expect(formatNumber(1_500_000)).toBe('1.5M');
    expect(formatNumber(2.5e15)).toBe('2.5Qa');
    expect(formatHashrate(2.4e12)).toBe('2.4 TH/s');
    expect(formatPower(1500)).toBe('1.5 kW');
  });
});

describe('save codec', () => {
  it('round-trips and rejects tampering', async () => {
    const data = createInitialData();
    const code = await encodeSave(data);
    const ok = await decodeSave(code);
    expect(ok.ok).toBe(true);
    const json = JSON.parse(Buffer.from(code, 'base64').toString());
    json.data.gems = 9999;
    const bad = await decodeSave(Buffer.from(JSON.stringify(json)).toString('base64'));
    expect(bad.ok).toBe(false);
  });
  it('sha256 matches a known vector', async () => {
    expect(await sha256('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  });
});

describe('migrations', () => {
  it('fills missing fields and drops unknown hardware', () => {
    const migrated = migrateSave(
      { cash: '42', gpus: { g1: { uid: 'g1', modelId: 'does-not-exist' } }, racks: {}, ownedRooms: ['bedroom', 'moonbase'] },
      1,
    );
    expect(migrated.cash).toBe('42');
    expect(migrated.memeCostBasis).toBe(0);
    expect(Object.keys(migrated.gpus)).toHaveLength(0);
    expect(migrated.ownedRooms).toEqual(['bedroom']);
  });
});

describe('prestige', () => {
  it('awards Smart Contracts only past $1M', () => {
    expect(scForEarnings(999_999)).toBe(0);
    expect(scForEarnings(4e6)).toBe(4);
  });
});
