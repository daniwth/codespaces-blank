import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MAX_SAVE_VERSION } from '../../server/config';
import { FOUNDRY, FOUNDRY_BY_ID, FOUNDRY_IDS, FOUNDRY_NODES, SANDBOX, chipFamily, foundryModifiers, foundryState, legalFoundry } from '../../src/config/foundry';
import { NETWORK_EVENTS, PHYSICS, SAVE_VERSION, STARTING_CASH } from '../../src/config/gameBalance';
import { GPU_BY_ID, GPU_CATALOG } from '../../src/config/hardwareCatalog';
import { ES } from '../../src/i18n/es';
import { simulate } from '../../src/store/gamePhysics';
import { createGpu, createInitialData, createRack } from '../../src/store/initialState';
import { migrateSave } from '../../src/store/migrations';
import { lotteryLuck } from '../../src/store/slices/hardwareSlice';
import { useGameStore } from '../../src/store/useGameStore';
import type { FoundryNodeId, GameData } from '../../src/types/player';
import { bnToNumber } from '../../src/utils/bignum';
import { starterWorld } from './helpers';

const NOW = 1_800_000_000_000 - (1_800_000_000_000 % 600_000) + 60_000;
const online = { offline: false, maxStep: 1 } as const;
const store = () => useGameStore.getState();
const ASIC = GPU_CATALOG.find((g) => g.style === 'asic')!.id;

afterEach(() => vi.restoreAllMocks());

/** Starter world whose only card is replaced by `modelId`, with a PSU that carries it. */
function oneCard(modelId: string): { data: GameData; uid: string } {
  const w = starterWorld();
  const g = createGpu(modelId, 'bronze');
  delete w.data.gpus[w.gpuUid];
  w.data.gpus[g.uid] = g;
  const psu = Object.keys(w.data.psus)[0];
  w.data.psus[psu] = { uid: psu, modelId: 'psu30k' };
  w.data.racks[w.rackUid] = { ...w.data.racks[w.rackUid], gpuSlots: [g.uid, null] };
  return { data: w.data, uid: g.uid };
}

describe('Chip Foundry tree', () => {
  it('is one root and two three-step branches with exclusive capstones', () => {
    expect(FOUNDRY_NODES.filter((n) => n.branch === 'root').map((n) => n.id)).toEqual(['cleanroom']);
    (['card', 'asic'] as const).forEach((branch) => {
      const nodes = FOUNDRY_NODES.filter((n) => n.branch === branch);
      expect(nodes.map((n) => n.tier)).toEqual([1, 2, 3]);
      expect(nodes[0].requires).toBe('cleanroom');
      expect(nodes[1].requires).toBe(nodes[0].id);
      expect(nodes[2].requires).toBe(nodes[1].id);
      nodes.forEach((n, i) => i > 0 && expect(n.price).toBeGreaterThan(nodes[i - 1].price));
    });
    expect(FOUNDRY_BY_ID.gpu_ref.excludes).toBe('asic_tape');
    expect(FOUNDRY_BY_ID.asic_tape.excludes).toBe('gpu_ref');
    expect(chipFamily('card')).toBe('card');
    (['asic', 'photonic', 'singularity'] as const).forEach((s) => expect(chipFamily(s)).toBe('asic'));
  });

  it('a node needs its parent, and a capstone locks the other one', () => {
    expect(foundryState([], 'cleanroom')).toBe('available');
    expect(foundryState([], 'gpu_bin')).toBe('locked');
    expect(foundryState(['cleanroom'], 'gpu_bin')).toBe('available');
    expect(foundryState(['cleanroom'], 'asic_mask')).toBe('available');
    expect(foundryState(['cleanroom'], 'cleanroom')).toBe('owned');
    const cards: FoundryNodeId[] = ['cleanroom', 'gpu_bin', 'gpu_shroud', 'gpu_ref', 'asic_mask', 'asic_pack'];
    expect(foundryState(cards, 'asic_tape')).toBe('excluded');
    expect(foundryState(cards.filter((id) => id !== 'gpu_ref'), 'asic_tape')).toBe('available');
  });

  it('modifiers follow the nodes owned, and every text matches its number', () => {
    expect(foundryModifiers([])).toEqual({ luckMul: 1, hashMul: { card: 1, asic: 1 }, heatMul: { card: 1, asic: 1 } });
    expect(foundryModifiers()).toEqual(foundryModifiers([]));
    const all = foundryModifiers(['cleanroom', 'gpu_bin', 'gpu_shroud', 'gpu_ref', 'asic_mask', 'asic_pack', 'asic_tape']);
    expect(all.luckMul).toBeCloseTo(FOUNDRY.cleanroomLuck * FOUNDRY.binLuck, 12);
    expect(all.hashMul).toEqual({ card: FOUNDRY.cardHashMul, asic: FOUNDRY.asicHashMul * FOUNDRY.asicCapHashMul });
    expect(all.heatMul).toEqual({ card: FOUNDRY.cardHeatMul, asic: FOUNDRY.asicHeatMul });
    const numbers: Record<FoundryNodeId, number> = {
      cleanroom: FOUNDRY.cleanroomLuck, gpu_bin: FOUNDRY.binLuck, gpu_shroud: FOUNDRY.cardHeatMul, gpu_ref: FOUNDRY.cardHashMul,
      asic_mask: FOUNDRY.asicHeatMul, asic_pack: FOUNDRY.asicHashMul, asic_tape: FOUNDRY.asicCapHashMul,
    };
    FOUNDRY_NODES.forEach((n) => {
      expect(n.description).toContain(`${Math.round(Math.abs(numbers[n.id] - 1) * 100)}%`);
      expect(ES[n.name], n.name).toBeTruthy();
      expect(ES[n.description], n.description).toBeTruthy();
    });
  });

  it('the simulation applies hashrate and heat to the right chip family only', () => {
    const card = oneCard('px460');
    const asic = oneCard(ASIC);
    const run = (data: GameData, foundry: FoundryNodeId[]) => simulate({ ...data, foundry }, 0.01, NOW, online).live;
    const cardNodes: FoundryNodeId[] = ['cleanroom', 'gpu_bin', 'gpu_shroud', 'gpu_ref'];
    const asicNodes: FoundryNodeId[] = ['cleanroom', 'asic_mask', 'asic_pack', 'asic_tape'];
    const cardBase = run(card.data, []);
    const asicBase = run(asic.data, []);
    expect(run(card.data, cardNodes).totalHash).toBeCloseTo(cardBase.totalHash * FOUNDRY.cardHashMul, 6);
    expect(run(card.data, cardNodes).gpus[card.uid].heat).toBeCloseTo(cardBase.gpus[card.uid].heat * FOUNDRY.cardHeatMul, 9);
    expect(run(card.data, asicNodes).totalHash).toBeCloseTo(cardBase.totalHash, 9);
    expect(run(card.data, asicNodes).gpus[card.uid].heat).toBeCloseTo(cardBase.gpus[card.uid].heat, 9);
    expect(run(asic.data, asicNodes).totalHash).toBeCloseTo(asicBase.totalHash * FOUNDRY.asicHashMul * FOUNDRY.asicCapHashMul, 3);
    expect(run(asic.data, asicNodes).gpus[asic.uid].heat).toBeCloseTo(asicBase.gpus[asic.uid].heat * FOUNDRY.asicHeatMul, 9);
    expect(run(asic.data, cardNodes).totalHash).toBeCloseTo(asicBase.totalHash, 6);
    // Less heat means a cooler die once it settles.
    const settle = (foundry: FoundryNodeId[]) => simulate({ ...card.data, foundry }, 900, NOW, { offline: true, maxStep: 5 }).gpuUpdates[card.uid].temp;
    expect(settle(['cleanroom', 'gpu_bin', 'gpu_shroud'])).toBeLessThan(settle([]));
    expect(GPU_BY_ID[ASIC].style).toBe('asic');
  });

  it('the lottery luck multiplies the talent by the fab', () => {
    expect(lotteryLuck({ talents: {}, foundry: [] })).toBe(1);
    expect(lotteryLuck({ talents: {}, foundry: ['cleanroom'] })).toBeCloseTo(FOUNDRY.cleanroomLuck, 12);
    expect(lotteryLuck({ talents: { silicon_luck: 1 }, foundry: ['cleanroom', 'gpu_bin'] })).toBeCloseTo(1.6 * FOUNDRY.cleanroomLuck * FOUNDRY.binLuck, 12);
  });

  describe('store', () => {
    beforeEach(() => {
      useGameStore.setState({ ...starterWorld().data, cash: String(FOUNDRY_BY_ID.cleanroom.price + FOUNDRY_BY_ID.gpu_bin.price), screen: 'game' });
    });

    it('buys in order, for cash, once', () => {
      expect(store().buyFoundryNode('gpu_bin')).toBe(false);
      expect(store().buyFoundryNode('cleanroom')).toBe(true);
      expect(store().buyFoundryNode('cleanroom')).toBe(false);
      expect(store().buyFoundryNode('gpu_bin')).toBe(true);
      expect(store().foundry).toEqual(['cleanroom', 'gpu_bin']);
      expect(bnToNumber(store().cash)).toBe(0);
      expect(store().buyFoundryNode('asic_mask')).toBe(false);
      expect(store().foundry).toEqual(['cleanroom', 'gpu_bin']);
    });

    it('refuses the second capstone', () => {
      useGameStore.setState({ cash: '1e12', foundry: ['cleanroom', 'gpu_bin', 'gpu_shroud', 'asic_mask', 'asic_pack'] });
      expect(store().buyFoundryNode('asic_tape')).toBe(true);
      expect(store().buyFoundryNode('gpu_ref')).toBe(false);
      expect(store().foundry).not.toContain('gpu_ref');
    });
  });

  it('save: only a legal tree is kept, older saves have none and The Halving wipes it', () => {
    expect(legalFoundry(['gpu_ref', 'gpu_shroud', 'gpu_bin', 'cleanroom'])).toEqual(['cleanroom', 'gpu_bin', 'gpu_shroud', 'gpu_ref']);
    expect(legalFoundry(['gpu_bin', 'asic_tape'])).toEqual([]);
    expect(legalFoundry(['cleanroom', 'cleanroom', 'moon', 7, null])).toEqual(['cleanroom']);
    expect(legalFoundry([...FOUNDRY_IDS])).toHaveLength(FOUNDRY_IDS.length - 1);
    expect(legalFoundry([...FOUNDRY_IDS])).not.toContain('asic_tape');
    const raw: Record<string, unknown> = JSON.parse(JSON.stringify(createInitialData()));
    expect(migrateSave({ ...raw, foundry: ['cleanroom', 'asic_tape'] }, 12).foundry).toEqual(['cleanroom']);
    expect(migrateSave({ ...raw, foundry: ['cleanroom'] }, 11).foundry).toEqual([]);
    expect(migrateSave({ ...raw, foundry: 'all' }, 12).foundry).toEqual([]);
    expect(createInitialData({ foundry: ['cleanroom'] }).foundry).toEqual([]);
    expect(SAVE_VERSION).toBe(12);
    expect(MAX_SAVE_VERSION).toBe(SAVE_VERSION);
  });
});

describe('Sandbox mode', () => {
  it('hardware never wears or dries out; in a normal game it does', () => {
    const w = starterWorld();
    w.data.gpus[w.gpuUid] = { ...w.data.gpus[w.gpuUid], temp: PHYSICS.wearTemp + 4, paste: 0.8 };
    const normal = simulate(w.data, 5, NOW, online).gpuUpdates[w.gpuUid];
    const relaxed = simulate({ ...w.data, sandbox: true }, 5, NOW, online).gpuUpdates[w.gpuUid];
    expect(normal.wear).toBeGreaterThan(0);
    expect(normal.paste).toBeLessThan(0.8);
    expect(relaxed.wear).toBe(0);
    expect(relaxed.paste).toBe(0.8);
    expect(relaxed.overheatSeconds).toBe(0);
    // The physics are the same: the die is just as hot.
    expect(relaxed.temp).toBeCloseTo(normal.temp, 1);
  });

  it('only good network events arrive', () => {
    const due = { ...starterWorld().data, event: null, nextEventAt: NOW - 1 };
    const seen = new Set<string>();
    for (let i = 0; i < 40; i += 1) {
      vi.spyOn(Math, 'random').mockReturnValue((i + 0.5) / 40);
      const out = simulate({ ...due, sandbox: true }, 0.1, NOW, online);
      if (out.event) seen.add(out.event.id);
      vi.restoreAllMocks();
    }
    expect(seen.size).toBeGreaterThan(1);
    seen.forEach((id) => expect(NETWORK_EVENTS[id as keyof typeof NETWORK_EVENTS].positive).toBe(true));
    // A normal game also gets the bad ones.
    vi.spyOn(Math, 'random').mockReturnValue(0.999);
    expect(simulate(due, 0.1, NOW, online).event?.id).toBe('hard_fork');
  });

  it('no power surge and no raid', () => {
    const w = starterWorld();
    const g = createGpu('px460', 'bronze');
    const rack = createRack('bench', 2, 1);
    Object.assign(rack, { roomId: 'bedroom', pad: 1, gpuSlots: [g.uid, null], psuUid: 'psu-b' });
    w.data.gpus[g.uid] = g;
    w.data.psus['psu-b'] = { uid: 'psu-b', modelId: 'psu500' };
    w.data.racks[rack.uid] = rack;
    w.data.gpus[w.gpuUid] = { ...w.data.gpus[w.gpuUid], temp: PHYSICS.shutdownTemp + 5 };
    vi.spyOn(Math, 'random').mockReturnValue(0.25);
    expect(simulate(w.data, 0.5, NOW, online).surges).toBe(1);
    expect(simulate({ ...w.data, sandbox: true }, 0.5, NOW, online).surges).toBe(0);
    vi.restoreAllMocks();
    // Darknet pool: a tiny random draw raids a normal farm, never a sandbox one.
    vi.spyOn(Math, 'random').mockReturnValue(1e-9);
    const dark = { ...starterWorld().data, pool: 'darknet' as const };
    expect(simulate(dark, 1, NOW, online).raids).toBe(1);
    expect(simulate({ ...dark, sandbox: true }, 1, NOW, online).raids).toBe(0);
  });

  it('is chosen with the new game, starts richer, bars challenges and survives The Halving', () => {
    expect(createInitialData().sandbox).toBe(false);
    expect(bnToNumber(createInitialData().cash)).toBe(STARTING_CASH);
    const run = createInitialData({ sandbox: true }, 'power_cap');
    expect(run.sandbox).toBe(true);
    expect(bnToNumber(run.cash)).toBe(SANDBOX.startCash);
    expect(run.challenge).toBeNull();
    useGameStore.setState({ ...starterWorld().data, screen: 'menu' });
    store().startNewGame('power_cap', true);
    expect(store().sandbox).toBe(true);
    expect(store().challenge).toBeNull();
    expect(store().log.some((l) => l.key?.startsWith('Sandbox mode'))).toBe(true);
    store().startNewGame('power_cap');
    expect(store().sandbox).toBe(false);
    expect(store().challenge?.id).toBe('power_cap');
  });

  it('save: the mode is a strict flag and older saves are normal games', () => {
    const raw: Record<string, unknown> = JSON.parse(JSON.stringify(createInitialData()));
    expect(migrateSave({ ...raw, sandbox: true }, 12).sandbox).toBe(true);
    expect(migrateSave({ ...raw, sandbox: 'yes' }, 12).sandbox).toBe(false);
    expect(migrateSave({ ...raw, sandbox: true }, 11).sandbox).toBe(false);
    expect(migrateSave(raw, 12).sandbox).toBe(false);
  });
});
