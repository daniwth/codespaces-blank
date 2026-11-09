import { describe, expect, it } from 'vitest';
import { MARKET, PHYSICS, POOLS, STARTING_CASH } from '../../src/config/gameBalance';
import { GPU_BY_ID, GPU_CATALOG, PSU_CATALOG, RACK_BY_ID } from '../../src/config/hardwareCatalog';
import { ROOM_BY_ID } from '../../src/config/roomsCatalog';
import { gridTariff, simulate } from '../../src/store/gamePhysics';
import { createGpu, createRack } from '../../src/store/initialState';
import type { RoomId } from '../../src/types/player';
import { starterWorld } from './helpers';

const NOW = 1_800_000_000_000;
const CC_PER_MHS = PHYSICS.rewardPerMHs * (1 - POOLS.public.fee) * (1 - MARKET.fee);

/** Net $/s of one device at $1 CC, on the cheapest PSU that powers a full steel rack of it (grid demand included). */
function netPerSec(modelId: string, room: RoomId = 'bedroom'): number {
  const m = GPU_BY_ID[modelId];
  const psu = PSU_CATALOG.find((p) => p.capacity >= m.power * 4) ?? PSU_CATALOG[PSU_CATALOG.length - 1];
  const elec = (m.power / psu.efficiency) * PHYSICS.pricePerWattSec * gridTariff(modelId) * ROOM_BY_ID[room].priceMul;
  return (m.hashrate / 1e6) * CC_PER_MHS - elec;
}

/**
 * Fill every pad of `room` with a full cabinet of `modelId` cooled by `coolerId` (technicians keep
 * the paste fresh) and run to steady state. Returns whether any device throttled or shut down.
 */
function fullRoomDegraded(modelId: string, coolerId: string, room: RoomId): boolean {
  const { data } = starterWorld();
  const cab = RACK_BY_ID.cabinet;
  data.gpus = {};
  data.coolers = {};
  data.psus = {};
  data.racks = {};
  for (let pad = 0; pad < ROOM_BY_ID[room].pads; pad += 1) {
    const rack = { ...createRack('cabinet', cab.slots, cab.fanSlots), roomId: room, pad };
    for (let i = 0; i < cab.slots; i += 1) {
      const g = createGpu(modelId, 'bronze');
      data.gpus[g.uid] = g;
      rack.gpuSlots[i] = g.uid;
    }
    for (let i = 0; i < cab.fanSlots; i += 1) {
      const uid = `${rack.uid}-c${i}`;
      data.coolers[uid] = { uid, modelId: coolerId };
      rack.fanSlots[i] = uid;
    }
    const psu = `${rack.uid}-p`;
    data.psus[psu] = { uid: psu, modelId: PSU_CATALOG[PSU_CATALOG.length - 1].id };
    rack.psuUid = psu;
    data.racks[rack.uid] = rack;
  }
  data.ownedRooms = [room];
  data.technicians = 6;
  const out = simulate(data, 600, NOW, { offline: true, maxStep: 5 });
  return Object.values(out.live.gpus).some((g) => g.throttled || !g.running);
}

describe('economy pacing invariants', () => {
  it('the first GPU purchase is affordable within 2 minutes', () => {
    const secs = Math.max(0, GPU_BY_ID.px460.price - STARTING_CASH) / netPerSec('px460');
    expect(secs).toBeLessThan(120);
  });

  it('a second PX-460 on the starter bench (stock 80mm fan) does not throttle', () => {
    const { data, rackUid } = starterWorld();
    const extra = createGpu('px460', 'bronze');
    data.gpus[extra.uid] = { ...extra, paste: 0.75 };
    data.racks[rackUid] = { ...data.racks[rackUid], gpuSlots: [data.racks[rackUid].gpuSlots[0], extra.uid] };
    data.gpus[data.racks[rackUid].gpuSlots[0]!] = { ...data.gpus[data.racks[rackUid].gpuSlots[0]!], paste: 0.8 };
    data.gpus[extra.uid] = { ...data.gpus[extra.uid], paste: 0.8 };
    // ~7 thermal time constants; paste wears from 0.8 to ~0.7 meanwhile (a repaste is due around 0.5).
    const out = simulate(data, 240, NOW, { offline: true, maxStep: 2 });
    Object.values(out.live.gpus).forEach((g) => expect(g.running && !g.throttled).toBe(true));
  });

  it('each GPU tier pays back 1.4-1.6x slower than the previous one', () => {
    const paybacks = GPU_CATALOG.map((m) => m.price / netPerSec(m.id));
    for (let i = 1; i < paybacks.length; i += 1) {
      const ratio = paybacks[i] / paybacks[i - 1];
      expect(ratio, GPU_CATALOG[i].id).toBeGreaterThanOrEqual(1.4);
      expect(ratio, GPU_CATALOG[i].id).toBeLessThanOrEqual(1.6);
    }
  });

  it('the cooling ladder has no dead rung: a full Warehouse of Hydras needs immersion, a full Arctic of Singularities needs cryo', () => {
    expect(fullRoomDegraded('hydra', 'aio', 'warehouse')).toBe(true);
    expect(fullRoomDegraded('hydra', 'immersion', 'warehouse')).toBe(false);
    expect(fullRoomDegraded('singularity', 'immersion', 'arctic')).toBe(true);
    expect(fullRoomDegraded('singularity', 'cryo', 'arctic')).toBe(false);
  });
});
