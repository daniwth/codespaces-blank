import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AIRDROP, AIRDROP_KINDS, SPECIAL_AIRDROPS } from '../../src/config/airdrops';
import { BUFFS, emptyBuffs } from '../../src/config/buffs';
import { PHYSICS, SAVE_VERSION } from '../../src/config/gameBalance';
import { MAX_SAVE_VERSION } from '../../server/config';
import { FloatingTextLayer, WORLD_W } from '../../src/engine/PixelCanvas';
import { measurePixelText, thermalColor, THERMAL_STOPS } from '../../src/engine/SpriteManager';
import { AMBIENCE, ambienceFor, SILENT_AMBIENCE } from '../../src/hooks/useAudioFx';
import { hotkeyOf } from '../../src/hooks/useHotkeys';
import { repasteCooling, simulate, simulateOffline } from '../../src/store/gamePhysics';
import { createInitialData } from '../../src/store/initialState';
import { migrateSave } from '../../src/store/migrations';
import { rackFxLabel, useGameStore } from '../../src/store/useGameStore';
import { fxBus, type VisualFx } from '../../src/utils/eventBus';
import { starterWorld } from './helpers';

const NOW = 1_800_000_000_000;
const online = { offline: false, maxStep: 1 } as const;
const store = () => useGameStore.getState();

describe('FloatingTextLayer', () => {
  it('rises, fades and expires', () => {
    const layer = new FloatingTextLayer();
    const it0 = layer.spawn(100, 80, '+1.2 $CC', '#fff');
    expect(layer.items).toHaveLength(1);
    expect(FloatingTextLayer.alpha(it0)).toBe(0);
    layer.update(it0.life * 0.5);
    expect(it0.y).toBeLessThan(80);
    expect(FloatingTextLayer.alpha(it0)).toBe(1);
    layer.update(it0.life * 0.4);
    expect(FloatingTextLayer.alpha(it0)).toBeLessThan(1);
    layer.update(it0.life);
    expect(layer.items).toHaveLength(0);
  });

  it('stacks labels spawned on the same spot instead of overlapping them', () => {
    const layer = new FloatingTextLayer();
    const a = layer.spawn(100, 80, '88C!', '#f00');
    const b = layer.spawn(100, 80, 'BSOD', '#00f');
    const c = layer.spawn(100, 80, '-15C', '#0ff');
    expect(b.y).toBeLessThanOrEqual(a.y - 7);
    expect(c.y).toBeLessThanOrEqual(b.y - 7);
    // A label far away keeps its own height.
    expect(layer.spawn(300, 80, '88C!', '#f00').y).toBe(80);
  });

  it('keeps every label inside the world and caps how many are alive', () => {
    const layer = new FloatingTextLayer(4);
    const text = '+123.4K $NOVA';
    const half = measurePixelText(text, 2) / 2;
    expect(layer.spawn(-50, 40, text, '#fff', { big: true }).x).toBeGreaterThanOrEqual(half);
    expect(layer.spawn(WORLD_W + 50, 90, text, '#fff', { big: true }).x).toBeLessThanOrEqual(WORLD_W - half);
    for (let i = 0; i < 10; i += 1) layer.spawn(100 + i * 30, 200, 'X', '#fff');
    expect(layer.items).toHaveLength(4);
  });
});

describe('thermal palette', () => {
  it('hits every stop exactly and clamps outside the ramp', () => {
    THERMAL_STOPS.forEach(([temp, color]) => expect(thermalColor(temp)).toBe(color));
    expect(thermalColor(-200)).toBe(THERMAL_STOPS[0][1]);
    expect(thermalColor(500)).toBe('#ffffff');
    expect(thermalColor(Number.NaN)).toBe(THERMAL_STOPS[0][1]);
  });

  it('goes from green through yellow to red as a die heats up through the danger zone', () => {
    const green = (t: number) => parseInt(thermalColor(t).slice(3, 5), 16);
    const red = (t: number) => parseInt(thermalColor(t).slice(1, 3), 16);
    expect(red(60)).toBeLessThan(red(70));
    expect(green(70)).toBeGreaterThan(green(82));
    expect(green(82)).toBeGreaterThan(green(88));
    expect(thermalColor(87)).not.toBe(thermalColor(89));
  });
});

describe('rack events for floating labels', () => {
  it('flags a die crossing 88°C once, and its shutdown at 95°C', () => {
    const { input, gpuUid, rackUid } = starterWorld();
    input.racks[rackUid] = { ...input.racks[rackUid], fanSlots: [null] };
    input.gpus[gpuUid] = { ...input.gpus[gpuUid], temp: 87.9, paste: 0 };
    const out = simulate(input, 3, NOW, online);
    const hot = out.rackFx.filter((f) => f.kind === 'hot');
    expect(hot).toHaveLength(1);
    expect(hot[0].rackUid).toBe(rackUid);
    expect(hot[0].value).toBeGreaterThan(PHYSICS.wearTemp);
    input.gpus[gpuUid] = { ...input.gpus[gpuUid], temp: 96 };
    expect(simulate(input, 0.05, NOW, online).rackFx).toEqual([expect.objectContaining({ kind: 'shutdown', rackUid })]);
  });

  it('reports nothing offline and nothing for a cool farm', () => {
    const { input, gpuUid } = starterWorld();
    expect(simulate(input, 5, NOW, online).rackFx).toEqual([]);
    input.gpus[gpuUid] = { ...input.gpus[gpuUid], temp: 96 };
    expect(simulateOffline(input, 60, NOW).rackFx).toEqual([]);
  });

  it('a solo block is celebrated on the rack with the most hashrate, and the VIP drone doubles it', () => {
    const { input, rackUid } = starterWorld({ pool: 'solo' });
    // Every roll succeeds: the block is found on the first step.
    const spy = vi.spyOn(Math, 'random').mockReturnValue(1e-9);
    try {
      const plain = simulate(input, 0.25, NOW, online);
      const block = plain.rackFx.find((f) => f.kind === 'block');
      expect(plain.blocksFound).toBe(1);
      expect(block).toEqual(expect.objectContaining({ rackUid, coin: 'CC' }));
      expect(block?.value).toBeCloseTo(plain.coinMined, 10);
      const vip = simulate({ ...input, buffs: { ...emptyBuffs(), blockMulUntil: NOW + 60_000 } }, 0.25, NOW, online);
      expect(vip.coinMined).toBeCloseTo(plain.coinMined * BUFFS.vip.blockMul, 10);
      const expired = simulate({ ...input, buffs: { ...emptyBuffs(), blockMulUntil: NOW - 1 } }, 0.25, NOW, online);
      expect(expired.coinMined).toBeCloseTo(plain.coinMined, 10);
    } finally {
      spy.mockRestore();
    }
  });

  it('turns rack events into short canvas labels', () => {
    expect(rackFxLabel({ kind: 'block', rackUid: 'r', value: 1234.5, coin: 'NOVA' })).toEqual({ kind: 'rackText', rackUid: 'r', text: '+1.23K $NOVA', color: '#fde047', big: true });
    expect(rackFxLabel({ kind: 'hot', rackUid: 'r', value: 88.4 }).text).toBe('88C!');
    expect(rackFxLabel({ kind: 'shutdown', rackUid: 'r', value: 95.2 }).text).toBe('95C OFF!');
  });

  it('estimates what a re-paste takes off a die', () => {
    expect(repasteCooling(80, 30, 1)).toBe(0);
    // Dry paste keeps 60% of the heat transfer: the 50°C gap shrinks by 40%.
    expect(repasteCooling(80, 30, 0)).toBeCloseTo(50 * (1 - PHYSICS.pasteMinFactor), 10);
    expect(repasteCooling(20, 30, 0)).toBe(0);
  });
});

describe('crew rally and liquid nitrogen in the simulation', () => {
  it('a rallied crew restores paste faster and cools a little better', () => {
    const base = starterWorld({ technicians: 1 });
    base.input.gpus[base.gpuUid] = { ...base.input.gpus[base.gpuUid], paste: 0.5 };
    const calm = simulate(base.input, 20, NOW, online);
    const rally = simulate({ ...base.input, buffs: { ...emptyBuffs(), techUntil: NOW + 60_000 } }, 20, NOW, online);
    const gain = (out: typeof calm) => out.gpuUpdates[base.gpuUid].paste - 0.5;
    expect(gain(rally)).toBeGreaterThan(gain(calm) * 3);
    expect(rally.live.racks[base.rackUid].cooling).toBeCloseTo(calm.live.racks[base.rackUid].cooling * BUFFS.crew.coolingMul, 8);
    // No technicians, no rally.
    const nobody = simulate({ ...base.input, technicians: 0, buffs: { ...emptyBuffs(), techUntil: NOW + 60_000 } }, 20, NOW, online);
    expect(nobody.live.racks[base.rackUid].cooling).toBeCloseTo(calm.live.racks[base.rackUid].cooling, 8);
  });

  it('liquid nitrogen drops the ambient by 25°C while it lasts', () => {
    const { input } = starterWorld();
    const calm = simulate(input, 1, NOW, online);
    const cold = simulate({ ...input, buffs: { ...emptyBuffs(), nitroUntil: NOW + 60_000 } }, 1, NOW, online);
    expect(cold.live.rooms.bedroom?.ambient).toBe((calm.live.rooms.bedroom?.ambient ?? 0) + BUFFS.nitro.delta);
    const over = simulate({ ...input, buffs: { ...emptyBuffs(), nitroUntil: NOW - 1_000 } }, 1, NOW, online);
    expect(over.live.rooms.bedroom?.ambient).toBe(calm.live.rooms.bedroom?.ambient);
  });

  it('reports the mean temperature of the hashing dies', () => {
    const { input, gpuUid } = starterWorld();
    const out = simulate(input, 1, NOW, online);
    expect(out.live.avgTemp).toBeCloseTo(out.gpuUpdates[gpuUid].temp, 6);
    input.gpus[gpuUid] = { ...input.gpus[gpuUid], shutdown: true, temp: 80 };
    expect(simulate(input, 0.05, NOW, online).live.avgTemp).toBe(0);
  });
});

describe('store: crew rally, special drones and the audit bonus', () => {
  beforeEach(() => {
    useGameStore.setState({ ...createInitialData(), cash: '1000', airdrop: null, log: [], thermalView: false });
  });
  afterEach(() => vi.useRealTimers());

  it('rallying needs a technician, then goes on cooldown', () => {
    expect(store().rallyCrew()).toBe(false);
    useGameStore.setState({ technicians: 1 });
    const before = Date.now();
    expect(store().rallyCrew()).toBe(true);
    const b = store().buffs;
    expect(b.techUntil).toBeGreaterThanOrEqual(before + BUFFS.crew.durationSec * 1000);
    expect(b.techCooldownUntil).toBeGreaterThanOrEqual(before + BUFFS.crew.cooldownSec * 1000);
    expect(store().rallyCrew()).toBe(false);
    expect(store().buffs).toEqual(b);
    useGameStore.setState({ buffs: { ...b, techCooldownUntil: Date.now() - 1 } });
    expect(store().rallyCrew()).toBe(true);
  });

  const drop = (kind: (typeof AIRDROP_KINDS)[number]) =>
    useGameStore.setState({ airdrop: { id: 1, kind, spawnedAt: Date.now(), expiresAt: Date.now() + 10_000 } });

  it('special drones are rare and each gives its own boost', () => {
    const total = AIRDROP_KINDS.reduce((a, k) => a + AIRDROP.weights[k], 0);
    SPECIAL_AIRDROPS.forEach((k) => expect(AIRDROP.weights[k] / total, k).toBeLessThanOrEqual(0.05));

    const labels: VisualFx[] = [];
    const off = fxBus.on((fx) => labels.push(fx));
    drop('nitro');
    expect(store().claimAirdrop()).toBe(true);
    expect(store().buffs.nitroUntil).toBeGreaterThan(Date.now() + (BUFFS.nitro.durationSec - 2) * 1000);

    // VIP on a steady pool pays gems; on a per-block pool it multiplies blocks instead.
    const gems = store().gems;
    drop('vip');
    store().claimAirdrop();
    expect(store().gems).toBe(gems + BUFFS.vip.gems);
    expect(store().buffs.blockMulUntil).toBe(0);
    useGameStore.setState({ pool: 'solo' });
    drop('vip');
    store().claimAirdrop();
    expect(store().gems).toBe(gems + BUFFS.vip.gems);
    expect(store().buffs.blockMulUntil).toBeGreaterThan(Date.now() + (BUFFS.vip.durationSec - 2) * 1000);

    for (let i = 0; i < BUFFS.audit.maxClaims + 2; i += 1) {
      drop('audit');
      store().claimAirdrop();
    }
    expect(store().buffs.auditClaims).toBe(BUFFS.audit.maxClaims);
    off();
    expect(labels.filter((fx) => fx.kind === 'airdrop')).toHaveLength(3 + BUFFS.audit.maxClaims + 2);
    expect(store().stats.airdrops).toBe(3 + BUFFS.audit.maxClaims + 2);
  });

  it('an audited contract pays +50% cash once', () => {
    const board = store().contracts;
    const first = { ...board.slots[0], completedAt: Date.now(), reward: { ...board.slots[0].reward, cash: 200, gems: 0 } };
    const second = { ...board.slots[1], completedAt: Date.now(), reward: { ...board.slots[1].reward, cash: 200, gems: 0 } };
    useGameStore.setState({ cash: '0', contracts: { ...board, slots: [first, second, ...board.slots.slice(2)] }, buffs: { ...emptyBuffs(), auditClaims: 1 } });
    expect(store().claimContract(first.id)).toBe(true);
    expect(Number(store().cash)).toBeCloseTo(200 * BUFFS.audit.cashMul, 6);
    expect(store().buffs.auditClaims).toBe(0);
    expect(store().claimContract(second.id)).toBe(true);
    expect(Number(store().cash)).toBeCloseTo(200 * BUFFS.audit.cashMul + 200, 6);
  });

  it('BSOD and re-paste float a label over the rack', () => {
    const labels: VisualFx[] = [];
    const off = fxBus.on((fx) => labels.push(fx));
    const gpuUid = Object.keys(store().gpus)[0];
    const rackUid = Object.keys(store().racks)[0];
    useGameStore.setState((s) => ({ gpus: { ...s.gpus, [gpuUid]: { ...s.gpus[gpuUid], temp: 80, paste: 0.2 } }, roomTemps: { bedroom: 30 } }));
    expect(store().repasteGpu(gpuUid)).toBe(true);
    const drop = Math.round(repasteCooling(80, 30, 0.2));
    expect(labels).toContainEqual({ kind: 'rackText', rackUid, text: `-${drop}C`, color: '#7dd3fc' });
    // An impossible overclock always crashes.
    expect(store().applyOverclock(gpuUid, { core: 500, mem: 1500, voltage: 800 })).toBe('crash');
    off();
    expect(labels).toContainEqual(expect.objectContaining({ kind: 'rackText', rackUid, text: 'BSOD' }));
  });

  it('toggles the thermal view and never saves it', () => {
    expect(store().thermalView).toBe(false);
    store().toggleThermalView();
    expect(store().thermalView).toBe(true);
    expect(JSON.stringify(useGameStore.persist.getOptions().partialize?.(store()))).not.toContain('thermalView');
  });
});

describe('ambience synth mapping', () => {
  it('is silent without a running rack and stays within its quiet ranges', () => {
    expect(ambienceFor(1e9, 60, 0)).toBe(SILENT_AMBIENCE);
    expect(ambienceFor(0, 60, 2)).toBe(SILENT_AMBIENCE);
    [[1e6, 30], [1e9, 60], [1e15, 95], [1e30, 400]].forEach(([hash, temp]) => {
      const a = ambienceFor(hash, temp, 1);
      expect(a.gain).toBeGreaterThanOrEqual(AMBIENCE.gain[0]);
      expect(a.gain).toBeLessThanOrEqual(AMBIENCE.gain[1]);
      expect(a.cutoff).toBeGreaterThanOrEqual(AMBIENCE.cutoff[0]);
      expect(a.cutoff).toBeLessThanOrEqual(AMBIENCE.cutoff[1]);
      expect(a.whineFreq).toBeLessThanOrEqual(AMBIENCE.whine[1]);
    });
  });

  it('grows louder with hashrate and brighter with temperature', () => {
    expect(ambienceFor(1e12, 60, 1).gain).toBeGreaterThan(ambienceFor(1e7, 60, 1).gain);
    expect(ambienceFor(1e9, 85, 1).cutoff).toBeGreaterThan(ambienceFor(1e9, 45, 1).cutoff);
    expect(ambienceFor(1e9, 85, 1).whineFreq).toBeGreaterThan(ambienceFor(1e9, 45, 1).whineFreq);
  });
});

describe('save v9', () => {
  it('bumps the version on both sides', () => {
    expect(SAVE_VERSION).toBe(9);
    expect(MAX_SAVE_VERSION).toBe(SAVE_VERSION);
  });

  it('migrates a v8 save: no boosts, and the ambience starts at the old single volume', () => {
    const v8 = JSON.parse(JSON.stringify(createInitialData())) as Record<string, unknown>;
    v8.saveVersion = 8;
    delete v8.buffs;
    v8.settings = { muted: true, volume: 0.25, ambientHum: false, particles: false, offlineProgress: true };
    const m = migrateSave(v8, 8);
    expect(m.saveVersion).toBe(SAVE_VERSION);
    expect(m.buffs).toEqual(emptyBuffs());
    expect(m.settings).toEqual({ muted: true, volume: 0.25, ambientHum: false, ambientVolume: 0.25, particles: false, offlineProgress: true });
  });

  it('round-trips a v9 save and clamps tampered boosts and volumes', () => {
    const data = createInitialData();
    const now = Date.now();
    data.buffs = { techUntil: now + 10_000, techCooldownUntil: now + 100_000, nitroUntil: now + 30_000, blockMulUntil: now + 200_000, auditClaims: 2 };
    data.settings = { ...data.settings, ambientVolume: 0.35 };
    const back = migrateSave(JSON.parse(JSON.stringify(data)), SAVE_VERSION);
    expect(back.buffs).toEqual(data.buffs);
    expect(back.settings.ambientVolume).toBe(0.35);

    const bad = JSON.parse(JSON.stringify(data)) as Record<string, unknown>;
    bad.buffs = { techUntil: 9e15, techCooldownUntil: 'soon', nitroUntil: -5, blockMulUntil: Number.MAX_VALUE, auditClaims: 999 };
    bad.settings = { muted: 'yes', volume: 7, ambientHum: true, ambientVolume: -3, particles: true, offlineProgress: true };
    const clean = migrateSave(bad, SAVE_VERSION);
    expect(clean.buffs.techUntil).toBeLessThanOrEqual(Date.now() + BUFFS.crew.durationSec * 1000);
    expect(clean.buffs.techCooldownUntil).toBe(0);
    expect(clean.buffs.nitroUntil).toBe(0);
    expect(clean.buffs.blockMulUntil).toBeLessThanOrEqual(Date.now() + BUFFS.vip.durationSec * 1000);
    expect(clean.buffs.auditClaims).toBe(BUFFS.audit.maxClaims);
    expect(clean.settings).toEqual({ muted: false, volume: 1, ambientHum: true, ambientVolume: 0, particles: true, offlineProgress: true });
    expect(migrateSave({ ...bad, buffs: 'x' }, SAVE_VERSION).buffs).toEqual(emptyBuffs());
  });
});

describe('hotkeys', () => {
  const ev = (key: string, patch: Partial<KeyboardEvent> = {}) => ({ key, ctrlKey: false, metaKey: false, altKey: false, repeat: false, target: null, ...patch });

  it('names keys in lower case and ignores modified or repeated presses', () => {
    expect(hotkeyOf(ev('T'))).toBe('t');
    expect(hotkeyOf(ev('?'))).toBe('?');
    expect(hotkeyOf(ev('Escape'))).toBe('Escape');
    expect(hotkeyOf(ev('t', { ctrlKey: true }))).toBeNull();
    expect(hotkeyOf(ev('t', { metaKey: true }))).toBeNull();
    expect(hotkeyOf(ev('t', { repeat: true }))).toBeNull();
  });
});
