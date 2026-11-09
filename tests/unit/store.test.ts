import { beforeEach, describe, expect, it } from 'vitest';
import { GPU_BY_ID } from '../../src/config/hardwareCatalog';
import { createInitialData, createRack } from '../../src/store/initialState';
import { useGameStore } from '../../src/store/useGameStore';
import { currentWorldEpoch } from '../../src/store/worldEpoch';

const store = () => useGameStore.getState();

beforeEach(() => {
  useGameStore.setState({ ...createInitialData(), cash: '1000000' });
});

describe('game store', () => {
  it('buys a GPU, rolls silicon quality and charges cash', () => {
    const gpu = store().buyGpu('px580');
    expect(gpu).not.toBeNull();
    expect(Number(store().cash)).toBeCloseTo(1_000_000 - GPU_BY_ID.px580.price);
    expect(['bronze', 'silver', 'gold', 'god']).toContain(gpu?.quality);
  });

  it('refuses purchases it cannot afford', () => {
    useGameStore.setState({ cash: '10' });
    expect(store().buyGpu('px580')).toBeNull();
    expect(store().cash).toBe('10');
  });

  it('installs, moves and uninstalls parts without duplicating them', () => {
    const gpu = store().buyGpu('px460');
    const rackUid = Object.keys(store().racks)[0];
    if (!gpu) throw new Error('no gpu');
    store().installGpu(rackUid, 1, gpu.uid);
    store().installGpu(rackUid, 0, gpu.uid);
    const slots = store().racks[rackUid].gpuSlots;
    expect(slots.filter((u) => u === gpu.uid)).toHaveLength(1);
    store().uninstallSlot(rackUid, 'gpu', 0);
    expect(store().racks[rackUid].gpuSlots[0]).toBeNull();
  });

  it('rooms must be bought in order', () => {
    expect(store().buyRoom('warehouse')).toBe(false);
    expect(store().buyRoom('garage')).toBe(true);
    expect(store().ownedRooms).toContain('garage');
  });

  it('The Halving resets the run but keeps progression', () => {
    useGameStore.setState({ runEarnings: '4000000', gems: 3 });
    expect(store().performHalving()).toBe(true);
    expect(store().sc).toBe(4);
    expect(store().gems).toBe(8);
    expect(store().ownedRooms).toEqual(['bedroom']);
    expect(store().stats.halvings).toBe(1);
  });

  it('a Gold rack carried through a Halving keeps one uid, so uid lookups and reboots find it', () => {
    const gold = createRack('gold', 8, 4);
    useGameStore.setState({ racks: { ...store().racks, [gold.uid]: gold }, runEarnings: '4000000' });
    expect(store().performHalving()).toBe(true);
    const kept = Object.entries(store().racks).filter(([, r]) => r.modelId === 'gold');
    expect(kept).toHaveLength(1);
    expect(kept[0][0]).toBe(kept[0][1].uid);
    expect(kept[0][0]).toBe(gold.uid);
  });

  it('bumps the world epoch when the world is replaced, so in-flight ticks are dropped', () => {
    const e0 = currentWorldEpoch();
    store().hardReset();
    expect(currentWorldEpoch()).toBe(e0 + 1);
    store().startNewGame();
    expect(currentWorldEpoch()).toBe(e0 + 2);
    useGameStore.setState({ runEarnings: '4000000' });
    store().performHalving();
    expect(currentWorldEpoch()).toBe(e0 + 3);
  });
});
