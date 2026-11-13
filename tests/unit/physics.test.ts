import { describe, expect, it } from 'vitest';
import { PHYSICS } from '../../src/config/gameBalance';
import { GPU_BY_ID } from '../../src/config/hardwareCatalog';
import { crashChance, ocHashBonus, simulate, simulateOffline, aiAutoTune } from '../../src/store/gamePhysics';
import { starterWorld } from './helpers';

const NOW = 1_800_000_000_000;
const online = { offline: false, maxStep: 1 } as const;

describe('thermal model', () => {
  it('starter rig settles to a safe steady-state temperature', () => {
    const { input, gpuUid } = starterWorld();
    const out = simulate(input, 900, NOW, online);
    const t = out.gpuUpdates[gpuUid].temp;
    expect(t).toBeGreaterThan(55);
    expect(t).toBeLessThan(PHYSICS.throttleTemp);
    expect(out.live.gpus[gpuUid].throttled).toBe(false);
  });

  it('throttles to 50% hashrate above 85°C', () => {
    const { input, gpuUid, rackUid } = starterWorld();
    input.gpus[gpuUid] = { ...input.gpus[gpuUid], temp: 90 };
    input.racks[rackUid] = { ...input.racks[rackUid], fanSlots: [null] };
    const out = simulate(input, 0.05, NOW, online);
    expect(out.live.gpus[gpuUid].throttled).toBe(true);
    expect(out.live.gpus[gpuUid].hash).toBeCloseTo(GPU_BY_ID.px460.hashrate * 0.5, -5);
  });

  it('shuts down at 95°C and restarts once cooled below 60°C', () => {
    const { input, gpuUid } = starterWorld();
    input.gpus[gpuUid] = { ...input.gpus[gpuUid], temp: 96 };
    const hot = simulate(input, 0.05, NOW, online);
    expect(hot.gpuUpdates[gpuUid].shutdown).toBe(true);
    expect(hot.live.totalHash).toBe(0);
    input.gpus[gpuUid] = { ...input.gpus[gpuUid], ...hot.gpuUpdates[gpuUid] };
    const cooled = simulate(input, 600, NOW + 600_000, online);
    expect(cooled.gpuUpdates[gpuUid].shutdown).toBe(false);
  });

  it('accumulates silicon wear only above 88°C', () => {
    const { input, gpuUid, rackUid } = starterWorld();
    input.racks[rackUid] = { ...input.racks[rackUid], fanSlots: [null] };
    input.gpus[gpuUid] = { ...input.gpus[gpuUid], temp: 89.5 };
    const out = simulate(input, 1, NOW, online);
    expect(out.gpuUpdates[gpuUid].wear).toBeGreaterThan(0);
  });

  it('stays numerically stable with huge time steps (offline)', () => {
    const { input, gpuUid } = starterWorld();
    const out = simulateOffline(input, 8 * 3600, NOW);
    expect(Number.isFinite(out.gpuUpdates[gpuUid].temp)).toBe(true);
    expect(out.ccMined).toBeGreaterThan(0);
    expect(out.event).toBeNull();
    expect(out.raids).toBe(0);
  });
});

describe('power', () => {
  it('a rack without PSU produces nothing', () => {
    const { input, rackUid } = starterWorld();
    input.racks[rackUid] = { ...input.racks[rackUid], psuUid: null };
    const out = simulate(input, 1, NOW, online);
    expect(out.live.racks[rackUid].status).toBe('no_psu');
    expect(out.live.totalHash).toBe(0);
  });

  it('trips the rack when GPUs exceed PSU capacity', () => {
    const { input, rackUid, gpuUid } = starterWorld();
    const second = { ...input.gpus[gpuUid], uid: 'gpu-extra', modelId: 'vx3080' };
    input.gpus = { ...input.gpus, [gpuUid]: { ...input.gpus[gpuUid], modelId: 'vx3080' }, 'gpu-extra': second };
    input.racks[rackUid] = { ...input.racks[rackUid], gpuSlots: [gpuUid, 'gpu-extra'] };
    const out = simulate(input, 1, NOW, online);
    expect(out.live.racks[rackUid].status).toBe('overload');
    expect(out.live.totalHash).toBe(0);
  });

  it('charges electricity proportional to wall draw', () => {
    const { input } = starterWorld();
    const out = simulate(input, 10, NOW, online);
    expect(out.electricityPaid).toBeGreaterThan(0);
    expect(out.cashDelta).toBeLessThan(0);
  });
});

describe('overclocking', () => {
  it('caps the hash bonus at +40%', () => {
    expect(ocHashBonus({ core: 500, mem: 1500, voltage: 1200 })).toBeCloseTo(0.4);
  });

  it('stock settings never crash and AI auto-tune is always safe', () => {
    for (const quality of [40, 120, 250, 400]) {
      const silicon = { coreHeadroom: quality, memHeadroom: quality * 4, vScale: 8, vFloor: 900 };
      expect(crashChance(silicon, { core: 0, mem: 0, voltage: 1000 })).toBe(0);
      expect(crashChance(silicon, aiAutoTune(silicon))).toBe(0);
    }
  });

  it('overclocking past the silicon headroom always crashes', () => {
    expect(crashChance({ coreHeadroom: 100, memHeadroom: 400, vScale: 8, vFloor: 900 }, { core: 400, mem: 0, voltage: 1000 })).toBe(1);
  });
});
