import { useCallback, useEffect, useRef, useState } from 'react';
import { useDialogFocus } from '../../hooks/useDialogFocus';
import { isTopLayer, popLayer, pushLayer } from '../../utils/modalStack';
import { GPU_BY_ID, OC_LIMITS, QUALITY_DEFS } from '../../config/hardwareCatalog';
import { PHYSICS } from '../../config/gameBalance';
import { hash01 } from '../../engine/SpriteManager';
import { effectiveCoreHeadroom, ocHashBonus, ocPowerMul, STOCK_OC, voltageSaving } from '../../store/gamePhysics';
import { BIOS_PROFILE_IDS, BIOS_PROFILE_NAMES } from '../../config/synergy';
import { challengeBlocks } from '../../store/slices/challengesSlice';
import { useGameStore } from '../../store/useGameStore';
import type { OverclockSettings } from '../../types/hardware';
import { useT } from '../../i18n';
import { sfxBus } from '../../utils/eventBus';
import { clamp } from '../../utils/random';
import { formatHashrate, formatPower } from '../../utils/formatters';

type Phase = 'edit' | 'testing' | 'stable' | 'bsod';

const HEX = '0123456789ABCDEF';
const hexLine = () => Array.from({ length: 8 }, () => Array.from({ length: 4 }, () => HEX[Math.floor(Math.random() * 16)]).join('')).join(' ');

/**
 * Fuzzy stability estimate: share of the (noisy) headroom already consumed.
 * The silicon lottery is never fully revealed, so the gauge is ±30 MHz off.
 */
function estimateRisk(uid: string, coreHeadroom: number, memHeadroom: number, vFloor: number, oc: OverclockSettings): number {
  const estCore = coreHeadroom + (hash01(uid, 1) - 0.5) * 60;
  const estMem = memHeadroom + (hash01(uid, 2) - 0.5) * 240;
  const coreRisk = estCore <= 0 ? (oc.core >= estCore ? 1 : 0) : oc.core / estCore;
  const memRisk = estMem <= 0 ? 1 : oc.mem / estMem;
  // Undervolt: how much of the (fuzzy, ±15 mV) room above the chip's voltage floor is used up.
  const estFloor = vFloor + (hash01(uid, 3) - 0.5) * 30;
  const span = Math.max(1, OC_LIMITS.voltage.stock - estFloor);
  const voltRisk = oc.voltage >= OC_LIMITS.voltage.stock ? 0 : (OC_LIMITS.voltage.stock - oc.voltage) / span;
  return clamp(Math.max(coreRisk, memRisk, voltRisk), 0, 1);
}

const riskLabel = (r: number) =>
  r < 0.5 ? { text: 'LOW', color: '#55ff55' } : r < 0.8 ? { text: 'MEDIUM', color: '#ffff55' } : r < 1 ? { text: 'HIGH', color: '#ffaa00' } : { text: 'CRITICAL', color: '#ff5555' };

function BiosSlider({ label, value, min, max, step, unit, base, onChange, focus }: {
  label: string; value: number; min: number; max: number; step: number; unit: string; base?: number; onChange: (v: number) => void; focus: boolean;
}) {
  return (
    <label className="grid grid-cols-[1fr_auto] items-center gap-x-3 gap-y-1 py-1.5">
      <span className={focus ? 'bg-[#aaaaaa] px-1 text-[#0000aa]' : 'px-1 text-[#ffffff]'}>{label}</span>
      <span className="text-[#ffff55]">
        [{value > 0 && unit !== 'mV' ? '+' : ''}
        {value} {unit}]{base !== undefined && <span className="text-[#55ffff]"> = {base + value} {unit}</span>}
      </span>
      <input
        type="range"
        className="bios-range col-span-2"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => {
          onChange(Number(e.target.value));
          sfxBus.emit('click');
        }}
      />
    </label>
  );
}

export function BiosOverclockModal({ gpuUid }: { gpuUid: string }) {
  const t = useT();
  const gpu = useGameStore((s) => s.gpus[gpuUid]);
  const aiUnlocked = useGameStore((s) => s.vip.aiDiagnostics);
  const locked = useGameStore((s) => challengeBlocks(s, 'lockOverclock'));
  const { openBios, applyOverclock, autoTuneGpu, saveBiosProfile, applyProfileToModel } = useGameStore.getState();
  const profiles = useGameStore((s) => s.biosProfiles);
  const [batchMsg, setBatchMsg] = useState('');
  const [oc, setOc] = useState<OverclockSettings>(() => (gpu ? { ...gpu.oc } : { ...STOCK_OC }));
  const [phase, setPhase] = useState<Phase>('edit');
  const [lines, setLines] = useState<string[]>([]);
  const [progress, setProgress] = useState(0);
  const [focus, setFocus] = useState(0);
  const [rebootPct, setRebootPct] = useState(0);
  const timers = useRef<number[]>([]);

  const close = useCallback(() => {
    timers.current.forEach((id) => window.clearInterval(id));
    openBios(null);
  }, [openBios]);

  const runTest = useCallback(() => {
    if (phase !== 'edit') return;
    if (locked) {
      applyOverclock(gpuUid, oc);
      return;
    }
    setPhase('testing');
    setLines([]);
    setProgress(0);
    sfxBus.emit('boot');
    const started = performance.now();
    const id = window.setInterval(() => {
      const p = Math.min(1, (performance.now() - started) / 2600);
      setProgress(p);
      setLines((l) => [...l.slice(-9), `${(0x7c00 + Math.floor(p * 0xffff)).toString(16).toUpperCase().padStart(6, '0')}: ${hexLine()}`]);
      if (p >= 1) {
        window.clearInterval(id);
        const res = applyOverclock(gpuUid, oc);
        if (res === 'crash') {
          setPhase('bsod');
          const t0 = performance.now();
          const rid = window.setInterval(() => {
            const rp = Math.min(1, (performance.now() - t0) / PHYSICS.rebootMs);
            setRebootPct(rp);
            if (rp >= 1) {
              window.clearInterval(rid);
              setOc(useGameStore.getState().gpus[gpuUid]?.oc ?? { ...STOCK_OC });
              setPhase('edit');
              sfxBus.emit('boot');
            }
          }, 120);
          timers.current.push(rid);
        } else setPhase(res === 'stable' ? 'stable' : 'edit');
      }
    }, 90);
    timers.current.push(id);
  }, [phase, locked, applyOverclock, gpuUid, oc]);

  useEffect(() => () => timers.current.forEach((id) => window.clearInterval(id)), []);

  const layer = useRef(0);
  useEffect(() => {
    layer.current = pushLayer();
    const id = layer.current;
    return () => popLayer(id);
  }, []);
  // Focus lives inside the BIOS (or its BSOD) so Tab / Enter can't reach the rack modal underneath.
  const root = useRef<HTMLDivElement | null>(null);
  useDialogFocus(root, layer, phase === 'bsod');

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!isTopLayer(layer.current)) return;
      // The BIOS owns the keyboard while open (also during the BSOD).
      if (e.key === 'Escape') e.stopImmediatePropagation();
      if (phase !== 'edit' && phase !== 'stable') return;
      if (e.key === 'Escape') close();
      if (phase !== 'edit') return;
      if (e.key === 'F10') {
        e.preventDefault();
        runTest();
      } else if (e.key === 'F5') {
        e.preventDefault();
        setOc({ ...STOCK_OC });
        sfxBus.emit('switch');
      } else if (e.key === 'F9' && aiUnlocked) {
        e.preventDefault();
        if (autoTuneGpu(gpuUid)) setOc(useGameStore.getState().gpus[gpuUid]?.oc ?? oc);
      } else if (e.key === 'ArrowDown') {
        e.preventDefault();
        setFocus((f) => (f + 1) % 3);
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setFocus((f) => (f + 2) % 3);
      } else if (e.key === 'ArrowLeft' || e.key === 'ArrowRight' || e.key === '+' || e.key === '-') {
        e.preventDefault();
        const dir = e.key === 'ArrowRight' || e.key === '+' ? 1 : -1;
        setOc((cur) => {
          if (focus === 0) return { ...cur, core: clamp(cur.core + dir * 25, OC_LIMITS.core.min, OC_LIMITS.core.max) };
          if (focus === 1) return { ...cur, mem: clamp(cur.mem + dir * 100, OC_LIMITS.mem.min, OC_LIMITS.mem.max) };
          return { ...cur, voltage: clamp(cur.voltage + dir * 10, OC_LIMITS.voltage.min, OC_LIMITS.voltage.max) };
        });
        sfxBus.emit('click');
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [phase, close, runTest, aiUnlocked, autoTuneGpu, gpuUid, oc, focus]);

  if (!gpu) return null;
  const model = GPU_BY_ID[gpu.modelId];
  const q = QUALITY_DEFS[gpu.quality];
  const bonus = ocHashBonus(oc);
  const power = model.power * ocPowerMul(oc);
  const risk = estimateRisk(gpu.uid, effectiveCoreHeadroom(gpu.silicon, oc.voltage), gpu.silicon.memHeadroom, gpu.silicon.vFloor, oc);
  const saving = voltageSaving(oc.voltage);
  const sameModel = Object.values(useGameStore.getState().gpus).filter((g) => g.modelId === gpu.modelId).length;
  const rl = riskLabel(risk);
  const coreBase = 1400 + model.tier * 70;
  const memBase = 6000 + model.tier * 600;

  if (phase === 'bsod') {
    return (
      <div ref={root} tabIndex={-1} className="fixed inset-0 z-[60] flex flex-col items-start justify-center gap-6 bg-[#0078d7] p-8 font-term text-white outline-none sm:p-20" role="alertdialog" aria-modal="true">
        <div className="font-pixel text-6xl sm:text-8xl">:(</div>
        <p className="max-w-2xl text-2xl leading-tight sm:text-3xl">
          {t("Your rig ran into a problem and needs to restart. We're just collecting some error info, and then we'll restart for you.")}
        </p>
        <p className="font-pixel text-sm">{t('{pct}% complete', { pct: Math.round(rebootPct * 100) })}</p>
        <div className="flex items-center gap-4">
          <div className="grid size-20 grid-cols-5 grid-rows-5 bg-white p-1">
            {Array.from({ length: 25 }, (_, i) => (
              <span key={i} className={hash01(gpu.uid, i + 40) > 0.5 ? 'bg-[#0078d7]' : ''} />
            ))}
          </div>
          <div className="text-xl leading-tight">
            {t('For more information about this issue, ask your local silicon whisperer.')}
            <br />
            {t('Stop code:')} <span className="font-pixel text-xs">OVERCLOCK_WATCHDOG_TIMEOUT</span>
            <br />
            {t('What failed: {file}.sys', { file: model.name.replace(/\s/g, '_').toLowerCase() })}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div ref={root} tabIndex={-1} className="fixed inset-0 z-[55] flex items-center justify-center bg-black/80 p-2 outline-none" role="dialog" aria-modal="true" aria-label={t('GPU BIOS setup')}>
      <div className="pop-in w-full max-w-3xl bg-[#0000aa] font-term text-[19px] text-[#aaaaaa] shadow-[0_0_0_4px_#aaaaaa,0_0_0_6px_#000]">
        <div className="bg-[#aaaaaa] py-1 text-center text-[#0000aa]">PhoenixBits CMOS Setup Utility — Copyright (C) 1996 HashHarvest Inc.</div>
        <div className="text-center text-[#ffffff]">{t('GPU Frequency / Voltage Control')}</div>
        <div className="grid border-y-2 border-[#aaaaaa] sm:grid-cols-[1.5fr_1fr]">
          <div className="border-[#aaaaaa] p-3 sm:border-r-2">
            <div className="grid grid-cols-[auto_1fr] gap-x-3 pb-2">
              <span>{t('Device')}</span>
              <span className="text-[#ffffff]">{model.brand} {t(model.name)}</span>
              <span>{t('Silicon Grade')}</span>
              <span style={{ color: q.color }}>{t(q.label).toUpperCase()}</span>
              <span>{t('Serial No.')}</span>
              <span className="text-[#55ffff]">{gpu.uid.toUpperCase().slice(-12)}</span>
              <span>{t('Die Temp')}</span>
              <span className={gpu.temp > PHYSICS.throttleTemp ? 'text-[#ff5555]' : 'text-[#55ff55]'}>{gpu.temp.toFixed(1)} °C</span>
            </div>
            <BiosSlider label={t('Core Clock Offset')} unit="MHz" base={coreBase} value={oc.core} {...OC_LIMITS.core} focus={focus === 0} onChange={(v) => setOc({ ...oc, core: v })} />
            <BiosSlider label={t('Memory Clock Offset')} unit="MHz" base={memBase} value={oc.mem} {...OC_LIMITS.mem} focus={focus === 1} onChange={(v) => setOc({ ...oc, mem: v })} />
            <BiosSlider label={t('Core Voltage')} unit="mV" value={oc.voltage} min={OC_LIMITS.voltage.min} max={OC_LIMITS.voltage.max} step={OC_LIMITS.voltage.step} focus={focus === 2} onChange={(v) => setOc({ ...oc, voltage: v })} />
          </div>
          <div className="flex flex-col gap-1 p-3">
            <div className="text-center text-[#ffffff]">{t('Item Help')}</div>
            <div className="grid grid-cols-[1fr_auto] gap-x-2">
              <span>{t('Hash bonus')}</span>
              <span className={bonus >= 0 ? 'text-[#55ff55]' : 'text-[#ff5555]'}>{bonus >= 0 ? '+' : ''}{(bonus * 100).toFixed(1)}%</span>
              <span>{t('Hashrate')}</span>
              <span className="text-[#ffffff]">{formatHashrate(model.hashrate * (1 + bonus))}</span>
              <span>{t('Board power')}</span>
              <span className={power > model.power * 1.2 ? 'text-[#ffaa00]' : 'text-[#ffffff]'}>{formatPower(power)}</span>
              <span>{t('Heat output')}</span>
              <span className="text-[#ffffff]">x{(power / model.power).toFixed(2)}</span>
              <span>{t('Voltage mode')}</span>
              <span className={saving > 0.001 ? 'text-[#55ffff]' : saving < -0.001 ? 'text-[#ffaa00]' : 'text-[#ffffff]'} data-testid="bios-voltage-mode">
                {saving > 0.001 ? t('UNDERVOLT -{pct}% W', { pct: (saving * 100).toFixed(0) }) : saving < -0.001 ? t('OVERVOLT +{pct}% W', { pct: (-saving * 100).toFixed(0) }) : t('STOCK')}
              </span>
              <span>{t('Crash risk (est.)')}</span>
              <span style={{ color: rl.color }}>{t(rl.text)}</span>
            </div>
            <div className="mt-1 h-3 w-full bg-[#000055]">
              <div className="h-full" style={{ width: `${risk * 100}%`, background: rl.color }} />
            </div>
            <p className="mt-2 text-[16px] leading-tight">
              {t('More voltage unlocks core headroom but adds heat (∝V²). Undervolting saves power and heat, but every chip has a voltage floor: better silicon undervolts deeper. Unstable settings trigger a BSOD and a 10s reboot.')}
            </p>
            {locked && (
              <div className="mt-2 bg-[#aa0000] p-2 text-center text-[#ffffff]" data-testid="bios-locked">
                {t('BIOS LOCKED by the active challenge: stock clocks only.')}
              </div>
            )}
            {phase === 'testing' && (
              <div className="mt-2 bg-black p-1 text-[14px] leading-tight text-[#55ff55]">
                {lines.map((l, i) => (
                  <div key={i} className="truncate">{l}</div>
                ))}
                <div className="mt-1 text-[#ffff55]">
                  {t('STRESS TEST')} {'█'.repeat(Math.round(progress * 16)).padEnd(16, '░')} {Math.round(progress * 100)}%
                </div>
              </div>
            )}
            {phase === 'stable' && (
              <div className="mt-2 bg-black p-2 text-center text-[#55ff55]">
                {t('✓ SYSTEM STABLE — profile saved ({pct}% bonus)', { pct: (gpu.ocBonus * 100).toFixed(1) })}
              </div>
            )}
          </div>
        </div>
        <div className="border-b-2 border-[#aaaaaa] px-3 py-2" data-testid="bios-profiles">
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
            <span className="text-[#ffffff]">{t('Saved profiles')}</span>
            {BIOS_PROFILE_IDS.map((id) => (
              <span key={id} className="flex items-center gap-1">
                <button
                  type="button"
                  disabled={phase !== 'edit'}
                  className="bg-[#000055] px-1.5 text-[#ffff55] hover:bg-[#aaaaaa] hover:text-[#0000aa] disabled:opacity-50"
                  title={t('Load {core} MHz / {mem} MHz / {mv} mV into the sliders', { core: profiles[id].core, mem: profiles[id].mem, mv: profiles[id].voltage })}
                  onClick={() => { setOc({ ...profiles[id] }); sfxBus.emit('switch'); }}
                  data-testid={`bios-load-${id}`}
                >
                  {t(BIOS_PROFILE_NAMES[id])}
                </button>
                <button
                  type="button"
                  disabled={phase !== 'edit'}
                  className="px-1 text-[#55ffff] hover:text-[#ffffff] disabled:opacity-50"
                  title={t('Save the sliders into this profile')}
                  aria-label={t('Save the sliders into {name}', { name: t(BIOS_PROFILE_NAMES[id]) })}
                  onClick={() => saveBiosProfile(id, oc)}
                  data-testid={`bios-save-${id}`}
                >
                  [{t('SAVE')}]
                </button>
              </span>
            ))}
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1">
            <button
              type="button"
              disabled={phase !== 'edit' || locked}
              className="bg-[#aaaaaa] px-2 text-[#0000aa] hover:bg-[#ffff55] disabled:opacity-50"
              onClick={() => {
                const n = applyProfileToModel(gpu.modelId, oc);
                if (n > 0) {
                  setOc(useGameStore.getState().gpus[gpuUid]?.oc ?? oc);
                  setBatchMsg(t('Applied to {n} GPUs, each fitted to its own silicon (no stress test needed).', { n }));
                }
              }}
              data-testid="bios-apply-model"
            >
              {t('Apply to all {n}x {name}', { n: sameModel, name: t(model.name) })}
            </button>
            <span className="text-[16px] leading-tight text-[#55ff55]" aria-live="polite">{batchMsg}</span>
          </div>
        </div>
        <div className="flex flex-wrap justify-center gap-x-5 gap-y-1 px-2 py-2 text-[#ffffff]">
          <button type="button" disabled={phase !== 'edit' || locked} onClick={runTest} className="hover:text-[#ffff55] disabled:opacity-50">
            {t('F10: Save & Stress Test')}
          </button>
          <button type="button" disabled={phase !== 'edit'} onClick={() => { setOc({ ...STOCK_OC }); sfxBus.emit('switch'); }} className="hover:text-[#ffff55] disabled:opacity-50">
            {t('F5: Load Defaults')}
          </button>
          <button
            type="button"
            disabled={!aiUnlocked || phase !== 'edit' || locked}
            onClick={() => {
              if (autoTuneGpu(gpuUid)) setOc(useGameStore.getState().gpus[gpuUid]?.oc ?? oc);
            }}
            className="hover:text-[#ffff55] disabled:opacity-40"
            title={aiUnlocked ? t('Safe auto-overclock') : t('Unlock AI Diagnostics in the VIP zone')}
          >
            {t('F9: AI Auto-Tune')} {aiUnlocked ? '' : '(VIP)'}
          </button>
          {phase === 'stable' && (
            <button type="button" onClick={() => setPhase('edit')} className="hover:text-[#ffff55]">
              {t('ENTER: Keep tuning')}
            </button>
          )}
          <button type="button" disabled={phase === 'testing'} onClick={close} className="hover:text-[#ffff55] disabled:opacity-50">
            {t('ESC: Exit')}
          </button>
        </div>
        <div className="bg-[#aaaaaa] px-2 text-center text-[16px] text-[#0000aa]">{t('↑↓: Select item · ←→: Adjust · Drag sliders with the mouse')}</div>
      </div>
    </div>
  );
}
