import { describe, expect, it } from 'vitest';
import { challengeRules } from '../../src/config/challenges';
import { COOLER_CATALOG, GPU_CATALOG, PSU_CATALOG, RACK_CATALOG } from '../../src/config/hardwareCatalog';
import { HALVING_MIN_EARNINGS } from '../../src/config/prestigeTree';
import { ROOM_BY_ID, ROOM_ORDER } from '../../src/config/roomsCatalog';
import { aiAutoTune, ocHashBonus, simulate } from '../../src/store/gamePhysics';
import { createGpu, createInitialData, createRack } from '../../src/store/initialState';
import type { ChallengeId, GameData, RoomId, } from '../../src/types/player';
import type { SiliconQuality } from '../../src/types/hardware';

const T0 = 1_800_000_000_000;
const QUALS: [SiliconQuality, number][] = [['bronze', 0.5], ['silver', 0.3], ['gold', 0.15], ['god', 0.05]];

interface Kit { room: RoomId; rack: string; gpu: string; cooler: string; psu: string; n: number; fill: number; cost: number; net: number; gross: number }

function psuFor(w: number) {
  return (PSU_CATALOG.find((p) => p.capacity >= w * 1.1) ?? PSU_CATALOG[PSU_CATALOG.length - 1]).id;
}

/** Quality sequence follows the lottery mean: weighted pick by index so a farm has the expected mix. */
function qualityAt(i: number, bronzeOnly: boolean): SiliconQuality {
  if (bronzeOnly) return 'bronze';
  const x = ((i * 0.6180339887) % 1);
  let acc = 0;
  for (const [q, w] of QUALS) {
    acc += w;
    if (x < acc) return q;
  }
  return 'bronze';
}

function evalKit(room: RoomId, rackId: string, gpuId: string, coolerId: string, n: number, fill: number, ch: ChallengeId | null): Kit | null {
  const rules = challengeRules(ch);
  const rm = RACK_CATALOG.find((r) => r.id === rackId)!;
  const g = GPU_CATALOG.find((x) => x.id === gpuId)!;
  const c = COOLER_CATALOG.find((x) => x.id === coolerId)!;
  const d: GameData = createInitialData({}, ch);
  d.nextEventAt = Number.MAX_SAFE_INTEGER;
  d.racks = {}; d.gpus = {}; d.coolers = {}; d.psus = {};
  d.ownedRooms = ROOM_ORDER.slice(0, ROOM_ORDER.indexOf(room) + 1);
  d.technicians = 4;
  d.market.CC.price = 1;
  const psuId = psuFor((g.power * fill * 1.3 + c.power * rm.fanSlots));
  const psu = PSU_CATALOG.find((p) => p.id === psuId)!;
  let qi = 0;
  for (let k = 0; k < n; k += 1) {
    const rack = { ...createRack(rackId, rm.slots, rm.fanSlots), roomId: room, pad: k };
    for (let i = 0; i < fill; i += 1) {
      const gi = createGpu(gpuId, qualityAt(qi, rules.bronzeOnly));
      qi += 1;
      if (!rules.lockOverclock) { gi.oc = aiAutoTune(gi.silicon); gi.ocBonus = ocHashBonus(gi.oc); }
      d.gpus[gi.uid] = gi; rack.gpuSlots[i] = gi.uid;
    }
    for (let i = 0; i < rm.fanSlots; i += 1) { const u = `${rack.uid}c${i}`; d.coolers[u] = { uid: u, modelId: coolerId }; rack.fanSlots[i] = u; }
    const pu = `${rack.uid}p`; d.psus[pu] = { uid: pu, modelId: psuId }; rack.psuUid = pu;
    d.racks[rack.uid] = rack;
  }
  const warm = simulate(d, 600, T0, { offline: true, maxStep: 25 });
  Object.entries(warm.gpuUpdates).forEach(([uid, u]) => { d.gpus[uid] = { ...d.gpus[uid], ...u }; });
  d.roomTemps = warm.roomTemps;
  const out = simulate(d, 200, T0 + 200_000, { offline: true, maxStep: 20 });
  const bad = Object.values(out.live.gpus).some((x) => !x.running || x.throttled) || Object.values(out.live.racks).some((r) => r.status !== 'online' || r.maxTemp > 85 || r.load > r.capacity * 0.97);
  if (bad) return null;
  const cost = n * (rm.price + g.price * fill + c.price * rm.fanSlots + psu.price);
  return { room, rack: rackId, gpu: gpuId, cooler: coolerId, psu: psuId, n, fill, cost, net: (out.ccMined * 0.995 - out.electricityPaid) / 200, gross: (out.ccMined * 0.995) / 200 };
}

const kitCache = new Map<string, Kit[]>();
function kitsFor(ch: ChallengeId | null, room: RoomId): Kit[] {
  const key = `${ch}:${room}`;
  const hit = kitCache.get(key);
  if (hit) return hit;
  const out: Kit[] = [];
  const pads = ROOM_BY_ID[room].pads;
  for (const r of RACK_CATALOG.filter((x) => !x.vip)) {
    for (const g of GPU_CATALOG) {
      for (const c of COOLER_CATALOG) {
        if (Math.abs(c.tier - g.tier) > 1) continue;
        for (const fill of [1, Math.ceil(r.slots / 2), r.slots]) {
          for (const n of Array.from(new Set([1, 2, Math.ceil(pads / 2), pads]))) {
            if (n > pads || fill > r.slots) continue;
            const k = evalKit(room, r.id, g.id, c.id, n, fill, ch);
            if (k) out.push(k);
          }
        }
      }
    }
  }
  kitCache.set(key, out);
  return out;
}

function bestRate(ch: ChallengeId | null, budget: number, rooms: RoomId[]): { net: number; gross: number; kit: Kit | null } {
  let best = { net: 0, gross: 0, kit: null as Kit | null };
  rooms.forEach((room) => {
    const roomCost = ROOM_ORDER.slice(1, ROOM_ORDER.indexOf(room) + 1).reduce((a, r) => a + ROOM_BY_ID[r].price, 0);
    kitsFor(ch, room).forEach((k) => {
      if (k.cost + roomCost <= budget && k.net > best.net) best = { net: k.net, gross: k.gross, kit: k };
    });
  });
  return best;
}

function timeToThreshold(ch: ChallengeId | null): { min: number; rooms: string; kit: string } {
  const rules = challengeRules(ch);
  const rooms: RoomId[] = rules.singleRoom ? ['bedroom'] : [...ROOM_ORDER];
  let cap = 150; // bootstrap: starter rig plus the first few minutes of mining
  let earned = 0;
  let t = 600;
  let last = '';
  while (earned < HALVING_MIN_EARNINGS && t < 40 * 3600) {
    const b = bestRate(ch, cap * 0.75, rooms);
    cap += b.net * 20;
    earned += b.gross * 20;
    t += 20;
    if (b.kit) last = `${b.kit.room}/${b.kit.rack}x${b.kit.n}/${b.kit.gpu}`;
  }
  return { min: t / 60, rooms: rooms.join(','), kit: last };
}

/**
 * Capital-growth model of an ideal run: at every step the best fully simulated farm kit the
 * (rule-restricted) budget can buy is built, and the net profit is reinvested. It measures how much
 * slower each challenge is than a free run and that every challenge stays beatable.
 */
describe('challenge difficulty (capital-growth model)', () => {
  const free = timeToThreshold(null);
  const results = Object.fromEntries(
    (['bronze_only', 'no_overclock', 'power_cap', 'single_room'] as const).map((id) => [id, timeToThreshold(id)]),
  );

  it('a free run reaches the Halving threshold in a few hours of ideal play', () => {
    expect(free.min).toBeGreaterThan(90);
    expect(free.min).toBeLessThan(300);
  });

  it('every challenge is beatable: within 3x the free run and under 10 hours', () => {
    Object.values(results).forEach((r) => {
      expect(r.min).toBeLessThan(free.min * 3);
      expect(r.min).toBeLessThan(600);
    });
  });

  it('no challenge is faster than a free run (within model noise) and Single Room is the hardest', () => {
    Object.values(results).forEach((r) => expect(r.min).toBeGreaterThan(free.min * 0.97));
    expect(results.single_room.min).toBeGreaterThan(free.min * 1.4);
    expect(results.power_cap.min).toBeGreaterThan(free.min * 1.02);
    expect(results.single_room.min).toBeGreaterThan(results.power_cap.min);
  });
});

