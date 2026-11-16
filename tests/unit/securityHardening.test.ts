import { afterEach, describe, expect, it, vi } from 'vitest';
import { isPublicDeployment } from '../../server/config';
import { ipBucket } from '../../server/net';
import { CHALLENGE_BY_ID, isChallengeId } from '../../src/config/challenges';
import { isPpaPlan } from '../../src/config/energy';
import { isFoundryNode } from '../../src/config/foundry';
import { GPU_BY_ID, PSU_BY_ID, RACK_BY_ID } from '../../src/config/hardwareCatalog';
import { isMarketPhase, isNewsId } from '../../src/config/marketCycle';
import { TALENT_BY_ID } from '../../src/config/prestigeTree';
import { isResearchId } from '../../src/config/research';
import { MAX_PADS, ROOM_BY_ID } from '../../src/config/roomsCatalog';
import { simulateOffline, simulateOnline } from '../../src/store/gamePhysics';
import { createInitialData } from '../../src/store/initialState';
import { SAVE_CAPS, migrateSave } from '../../src/store/migrations';
import { BROKEN_SAVE_KEY, safeMigrate, useGameStore } from '../../src/store/useGameStore';
import { SAVE_VERSION } from '../../src/config/gameBalance';
import type { GameData } from '../../src/types/player';
import { dict, hasKey, isUnsafeKey } from '../../src/utils/dict';

const NOW = Date.now();
const INHERITED = ['constructor', 'toString', '__proto__', 'hasOwnProperty', 'valueOf', 'prototype'];
const base = (): Record<string, unknown> => JSON.parse(JSON.stringify(createInitialData()));
const starterGpu = (raw: Record<string, unknown>): Record<string, unknown> => Object.values(raw.gpus as Record<string, Record<string, unknown>>)[0];
const starterRack = (raw: Record<string, unknown>): Record<string, unknown> => Object.values(raw.racks as Record<string, Record<string, unknown>>)[0];

/** Path of the first NaN in a value, or null. */
function firstNaN(value: unknown, path = 'out', depth = 0): string | null {
  if (typeof value === 'number') return Number.isNaN(value) ? path : null;
  if (value && typeof value === 'object' && depth < 8) {
    for (const [k, v] of Object.entries(value)) {
      const bad = firstNaN(v, `${path}.${k}`, depth + 1);
      if (bad) return bad;
    }
  }
  return null;
}

/** A hostile save must load, and the farm it produces must simulate without throwing or NaN. */
function survives(raw: unknown, version = SAVE_VERSION): GameData {
  const data = migrateSave(raw, version);
  const online = simulateOnline(data, 1, NOW);
  expect(firstNaN(online)).toBeNull();
  const offline = simulateOffline(data, 3600, NOW);
  expect(firstNaN(offline)).toBeNull();
  return data;
}

afterEach(() => vi.restoreAllMocks());

describe('lookup tables only know their own ids', () => {
  it('inherited object keys are never a catalog entry', () => {
    INHERITED.forEach((key) => {
      [GPU_BY_ID, PSU_BY_ID, RACK_BY_ID, ROOM_BY_ID, TALENT_BY_ID, CHALLENGE_BY_ID].forEach((table) => {
        expect((table as Record<string, unknown>)[key], key).toBeUndefined();
        expect(hasKey(table, key), key).toBe(false);
      });
      [isChallengeId, isResearchId, isFoundryNode, isPpaPlan, isMarketPhase, isNewsId].forEach((guard) => expect(guard(key), key).toBe(false));
    });
    expect(GPU_BY_ID.px460.id).toBe('px460');
    expect(Object.keys(ROOM_BY_ID)).toContain('bedroom');
    expect(isChallengeId('power_cap')).toBe(true);
  });

  it('dict, hasKey and isUnsafeKey', () => {
    const table = dict({ a: 1 });
    expect(table.a).toBe(1);
    expect(Object.getPrototypeOf(table)).toBeNull();
    expect(hasKey({ a: 1 }, 'a')).toBe(true);
    expect(hasKey({ a: 1 }, 'toString')).toBe(false);
    expect(hasKey({ a: 1 }, 5)).toBe(false);
    expect(['__proto__', 'constructor', 'prototype'].every(isUnsafeKey)).toBe(true);
    expect(isUnsafeKey('gpu-1')).toBe(false);
  });
});

describe('hostile saves from the security audit', () => {
  it('ids that are inherited object keys are dropped everywhere', () => {
    INHERITED.forEach((key) => {
      const raw = base();
      starterGpu(raw).modelId = key;
      expect(Object.keys(survives(raw).gpus), key).toHaveLength(0);

      const parts = base();
      Object.values(parts.psus as Record<string, Record<string, unknown>>)[0].modelId = key;
      Object.values(parts.coolers as Record<string, Record<string, unknown>>)[0].modelId = key;
      const cleanParts = survives(parts);
      expect(Object.keys(cleanParts.psus)).toHaveLength(0);
      expect(Object.keys(cleanParts.coolers)).toHaveLength(0);

      const rack = base();
      starterRack(rack).modelId = key;
      expect(Object.keys(survives(rack).racks), key).toHaveLength(0);

      const room = base();
      room.ownedRooms = ['bedroom', key];
      starterRack(room).roomId = key;
      const cleanRoom = survives(room);
      expect(cleanRoom.ownedRooms).toEqual(['bedroom']);
      expect(Object.values(cleanRoom.racks)[0].roomId).toBeNull();

      expect(survives({ ...base(), pool: key }).pool).toBe('public');
      expect(survives({ ...base(), challenge: { id: key, startedAt: NOW } }).challenge).toBeNull();
      expect(Object.keys(survives({ ...base(), collection: { [key]: ['gold'] } }).collection)).not.toContain(key);
      expect(Object.keys(survives({ ...base(), talents: { [key]: 99 } }).talents)).toHaveLength(0);
      expect(survives({ ...base(), partner: { pool: key, until: NOW + 60_000 } }).partner).toBeNull();
    });
  });

  it('a uid named like an object key cannot replace the prototype of a hardware map', () => {
    const raw = base();
    const gpu = { ...starterGpu(raw) };
    const text = JSON.stringify(raw).replace('"gpus":{', `"gpus":{"__proto__":${JSON.stringify(gpu)},"constructor":${JSON.stringify(gpu)},`);
    const hostile: Record<string, unknown> = JSON.parse(text);
    starterRack(hostile).gpuSlots = ['oc', 'silicon'];
    const data = survives(hostile);
    expect(Object.getPrototypeOf(data.gpus)).toBe(Object.prototype);
    expect(Object.keys(data.gpus).some(isUnsafeKey)).toBe(false);
    expect(Object.values(data.racks)[0].gpuSlots).toEqual([null, null]);
    expect(({} as Record<string, unknown>).modelId).toBeUndefined();
  });

  it('the network event is validated: unknown ids, endless events and foreign rooms', () => {
    expect(survives({ ...base(), event: { id: 'nope', endsAt: 0 } }).event).toBeNull();
    expect(survives({ ...base(), event: { id: 'constructor', endsAt: NOW + 5000 } }).event).toBeNull();
    expect(survives({ ...base(), event: 'flash_sale' }).event).toBeNull();
    const endless = survives({ ...base(), event: { id: 'flash_sale', startedAt: NOW, endsAt: 1e300, roomId: null } }).event;
    expect(endless?.id).toBe('flash_sale');
    expect((endless?.endsAt ?? 0) - Date.now()).toBeLessThanOrEqual(120_000 + 50);
    expect(survives({ ...base(), event: { id: 'flash_sale', endsAt: NOW - 1 } }).event).toBeNull();
    expect(survives({ ...base(), event: { id: 'blackout', endsAt: NOW + 10_000, roomId: 'submarine' } }).event).toBeNull();
    expect(survives({ ...base(), event: { id: 'blackout', endsAt: NOW + 10_000, roomId: 'bedroom' } }).event?.roomId).toBe('bedroom');
    expect(survives({ ...base(), nextEventAt: 1e300 }).nextEventAt).toBeLessThanOrEqual(Date.now() + 180_000 + 50);
  });

  it('wallets must be finite, non-negative numbers', () => {
    const fresh = createInitialData();
    ['1e999999999999999999999999', '1e99999', '-500', 'NaN', 'Infinity', '1e+', '', '0x10', `${'9'.repeat(400)}`].forEach((value) => {
      const data = survives({ ...base(), cash: value, cc: value, lifetimeEarnings: value });
      expect(data.cash, value).toBe(fresh.cash);
      expect(data.cc, value).toBe(fresh.cc);
      expect(data.lifetimeEarnings, value).toBe(fresh.lifetimeEarnings);
    });
    expect(survives({ ...base(), cash: '1.5e+25' }).cash).toBe('1.5e+25');
    expect(survives({ ...base(), cash: '12345.67' }).cash).toBe('12345.67');
  });

  it('one part is mounted once, one rack stands on one pad, and pads exist', () => {
    const raw = base();
    const gpuUid = Object.keys(raw.gpus as object)[0];
    const psuUid = Object.keys(raw.psus as object)[0];
    const template = starterRack(raw);
    const racks: Record<string, unknown> = {};
    for (let i = 0; i < 50; i += 1) racks[`rack-${i}`] = { ...template, uid: `rack-${i}`, pad: i % 3, gpuSlots: [gpuUid, gpuUid], psuUid };
    racks.far = { ...template, uid: 'far', pad: MAX_PADS + 4, gpuSlots: [null, null], psuUid: null };
    const data = survives({ ...raw, racks });
    const all = Object.values(data.racks);
    expect(all.flatMap((r) => r.gpuSlots).filter((u) => u === gpuUid)).toHaveLength(1);
    expect(all.filter((r) => r.psuUid === psuUid)).toHaveLength(1);
    const placed = all.filter((r) => r.roomId);
    expect(new Set(placed.map((r) => `${r.roomId}:${r.pad}`)).size).toBe(placed.length);
    expect(placed).toHaveLength(3);
    expect(data.racks.far.roomId).toBeNull();
    // The hashrate is that of one card, not fifty.
    expect(simulateOnline(data, 1, NOW).live.totalHash).toBeCloseTo(GPU_BY_ID.px460.hashrate, -3);
  });

  it('a save cannot hold more hardware than the caps, and stays fast to load', () => {
    const raw = base();
    const gpu = starterGpu(raw);
    const rack = starterRack(raw);
    const gpus: Record<string, unknown> = {};
    const racks: Record<string, unknown> = {};
    const psus: Record<string, unknown> = {};
    for (let i = 0; i < 20_000; i += 1) gpus[`g${i}`] = { ...gpu, uid: `g${i}` };
    for (let i = 0; i < 10_000; i += 1) {
      racks[`r${i}`] = { ...rack, uid: `r${i}`, pad: i % MAX_PADS, gpuSlots: [`g${i * 2}`, `g${i * 2 + 1}`], psuUid: `p${i}` };
      psus[`p${i}`] = { uid: `p${i}`, modelId: 'psu500' };
    }
    const started = performance.now();
    const data = migrateSave({ ...raw, gpus, racks, psus }, SAVE_VERSION);
    expect(Object.keys(data.gpus).length).toBeLessThanOrEqual(SAVE_CAPS.gpus);
    expect(Object.keys(data.racks).length).toBeLessThanOrEqual(SAVE_CAPS.racks);
    expect(Object.keys(data.psus).length).toBeLessThanOrEqual(SAVE_CAPS.parts);
    expect(Object.values(data.racks).filter((r) => r.roomId).length).toBeLessThanOrEqual(MAX_PADS);
    const out = simulateOffline(data, 8 * 3600, NOW);
    expect(firstNaN(out.live)).toBeNull();
    expect(performance.now() - started).toBeLessThan(15_000);
  });

  it('counters, silicon and timers are bounded', () => {
    const raw = base();
    Object.assign(starterGpu(raw), { silicon: { coreHeadroom: 1e9, memHeadroom: 1e9, vScale: 1e9, vFloor: -5 }, overheatSeconds: 1e300 });
    starterRack(raw).rebootUntil = 1e300;
    const data = survives({
      ...raw, gems: 1e308, sc: 1e308, scLifetime: -4,
      vip: { goldRacksBought: 1e308, aiDiagnostics: true, autoSellPeaks: true, autoSellEnabled: true },
      stats: { ...(raw.stats as object), playTimeSec: -50, blocksFound: 1e300 },
      achievements: ['first_hash', 'first_hash', 'made-up', 7],
    });
    expect(data.gems).toBeLessThanOrEqual(1e12);
    expect(data.sc).toBeLessThanOrEqual(1e12);
    expect(data.scLifetime).toBe(0);
    expect(data.vip.goldRacksBought).toBeLessThanOrEqual(10_000);
    expect(data.stats.playTimeSec).toBe(0);
    expect(data.stats.blocksFound).toBeLessThanOrEqual(1e18);
    expect(data.achievements).toEqual(['first_hash']);
    const gpu = Object.values(data.gpus)[0];
    expect(gpu.silicon.coreHeadroom).toBeLessThanOrEqual(500);
    expect(gpu.silicon.vScale).toBeLessThanOrEqual(40);
    expect(gpu.overheatSeconds).toBeLessThanOrEqual(1e9);
    expect(Object.values(data.racks)[0].rebootUntil).toBeLessThanOrEqual(Date.now() + 600_000);
  });

  it('garbage at the top level still gives a playable farm', () => {
    [null, undefined, 7, 'save', [], [1, 2], { gpus: 5, racks: 'x', psus: null, coolers: [], market: 3, stats: [], settings: 1, vip: 'a', research: 9, buffs: [], bmc: 'x', cycle: 4, upgrades: 2 }].forEach((raw) => {
      const data = survives(raw, 1);
      expect(data.saveVersion).toBe(SAVE_VERSION);
      expect(data.ownedRooms).toContain('bedroom');
    });
    // A self-referencing object (it cannot come from JSON, but nothing should hang on it).
    const loop: Record<string, unknown> = base();
    loop.self = loop;
    (loop.gpus as Record<string, unknown>).loop = loop;
    survives(loop);
  });
});

describe('a save that cannot be read is set aside, not destroyed', () => {
  it('safeMigrate never throws and keeps the raw save under a backup key', () => {
    const stored = new Map<string, string>();
    vi.stubGlobal('localStorage', { setItem: (k: string, v: string) => void stored.set(k, v), getItem: (k: string) => stored.get(k) ?? null, removeItem: (k: string) => void stored.delete(k) });
    const good = safeMigrate(base(), SAVE_VERSION);
    expect(good.saveVersion).toBe(SAVE_VERSION);
    expect(stored.has(BROKEN_SAVE_KEY)).toBe(false);
    // Force the failure path with a value whose getter throws while it is being read.
    const trap = { get gpus(): never { throw new Error('boom'); } };
    const fresh = safeMigrate(trap, SAVE_VERSION);
    expect(Object.keys(fresh.gpus)).toHaveLength(1);
    vi.unstubAllGlobals();
  });

  it('importing garbage is refused with a message instead of crashing', async () => {
    const result = await useGameStore.getState().importSave('not a save');
    expect(result.ok).toBe(false);
    expect(result.message.length).toBeGreaterThan(0);
  });
});

describe('server helpers', () => {
  it('a live Stripe key always means a public deployment', () => {
    expect(isPublicDeployment(undefined, 'http://localhost:5173', '')).toBe(false);
    expect(isPublicDeployment(undefined, 'http://localhost:5173', 'sk_test_123')).toBe(false);
    expect(isPublicDeployment(undefined, 'http://localhost:5173', 'sk_live_123')).toBe(true);
    expect(isPublicDeployment(undefined, 'http://localhost:5173', 'rk_live_123')).toBe(true);
    expect(isPublicDeployment('production', 'http://localhost:5173', '')).toBe(true);
    expect(isPublicDeployment(undefined, 'https://game.example.com', '')).toBe(true);
  });

  it('rate limits count an IPv6 customer by its /64 and IPv4 by address', () => {
    expect(ipBucket('203.0.113.7')).toBe('203.0.113.7');
    expect(ipBucket('::ffff:203.0.113.7')).toBe('203.0.113.7');
    expect(ipBucket('2001:db8:1:2:aaaa:bbbb:cccc:dddd')).toBe(ipBucket('2001:db8:1:2::1'));
    expect(ipBucket('2001:db8:1:2::1')).toBe(ipBucket('2001:0db8:0001:0002:ffff:ffff:ffff:ffff'));
    expect(ipBucket('2001:db8:1:2::1')).not.toBe(ipBucket('2001:db8:1:3::1'));
    expect(ipBucket('::1')).toBe(ipBucket('::2'));
    expect(ipBucket('unknown')).toBe('unknown');
  });
});
