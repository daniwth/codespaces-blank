import { useCallback, useEffect, useRef, useState } from 'react';
import { useDialogFocus } from '../../hooks/useDialogFocus';
import { isTopLayer, popLayer, pushLayer } from '../../utils/modalStack';
import { GPU_BY_ID, OC_LIMITS, QUALITY_DEFS } from '../../config/hardwareCatalog';
import { PHYSICS } from '../../config/gameBalance';
import { hash01 } from '../../engine/SpriteManager';
import { effectiveCoreHeadroom, ocHashBonus, ocPowerMul, STOCK_OC } from '../../store/gamePhysics';
import { useGameStore } from '../../store/useGameStore';
import type { OverclockSettings } from '../../types/hardware';
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
function estimateRisk(uid: string, coreHeadroom: number, memHeadroom: number, oc: OverclockSettings): number {
  const estCore = coreHeadroom + (hash01(uid, 1) - 0.5) * 60;
  const estMem = memHeadroom + (hash01(uid, 2) - 0.5) * 240;
  const coreRisk = estCore <= 0 ? (oc.core >= estCore ? 1 : 0) : oc.core / estCore;
  const memRisk = estMem <= 0 ? 1 : oc.mem / estMem;
  return clamp(Math.max(coreRisk, memRisk), 0, 1);
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
  const gpu = useGameStore((s) => s.gpus[gpuUid]);
  const aiUnlocked = useGameStore((s) => s.vip.aiDiagnostics);
  const { openBios, applyOverclock, autoTuneGpu } = useGameStore.getState();
  const [oc, setOc] = useState<OverclockSettings>(() => (gpu ? { ...gpu.oc } : { ...STOCK_OC }));
  const [phase, setPhase] = useState<Phase>('edit');
  const [lines, setLines] = useState<string[]>([]);
  const [progress, setProgress] = useState(0);
  const [focus, setFocus] = useState(0);
  const [rebootPct, setRebootPct] = useState(0);
  const timers = useRef<number[]>([]);

  const close = useCallback(() => {
    timers.current.forEach((t) => window.clearInterval(t));
    openBios(null);
  }, [openBios]);

  const runTest = useCallback(() => {
    if (phase !== 'edit') return;
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
        } else setPhase('stable');
      }
    }, 90);
    timers.current.push(id);
  }, [phase, applyOverclock, gpuUid, oc]);

  useEffect(() => () => timers.current.forEach((t) => window.clearInterval(t)), []);

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
  const risk = estimateRisk(gpu.uid, effectiveCoreHeadroom(gpu.silicon, oc.voltage), gpu.silicon.memHeadroom, oc);
  const rl = riskLabel(risk);
  const coreBase = 1400 + model.tier * 70;
  const memBase = 6000 + model.tier * 600;

  if (phase === 'bsod') {
    return (
      <div ref={root} tabIndex={-1} className="fixed inset-0 z-[60] flex flex-col items-start justify-center gap-6 bg-[#0078d7] p-8 font-term text-white outline-none sm:p-20" role="alertdialog" aria-modal="true">
        <div className="font-pixel text-6xl sm:text-8xl">:(</div>
        <p className="max-w-2xl text-2xl leading-tight sm:text-3xl">
          Your rig ran into a problem and needs to restart. We're just collecting some error info, and then we'll restart for you.
        </p>
        <p className="font-pixel text-sm">{Math.round(rebootPct * 100)}% complete</p>
        <div className="flex items-center gap-4">
          <div className="grid size-20 grid-cols-5 grid-rows-5 bg-white p-1">
            {Array.from({ length: 25 }, (_, i) => (
              <span key={i} className={hash01(gpu.uid, i + 40) > 0.5 ? 'bg-[#0078d7]' : ''} />
            ))}
          </div>
          <div className="text-xl leading-tight">
            For more information about this issue, ask your local silicon whisperer.
            <br />
            Stop code: <span className="font-pixel text-xs">OVERCLOCK_WATCHDOG_TIMEOUT</span>
            <br />
            What failed: {model.name.replace(/\s/g, '_').toLowerCase()}.sys
          </div>
        </div>
      </div>
    );
  }

  return (
    <div ref={root} tabIndex={-1} className="fixed inset-0 z-[55] flex items-center justify-center bg-black/80 p-2 outline-none" role="dialog" aria-modal="true" aria-label="GPU BIOS setup">
      <div className="pop-in w-full max-w-3xl bg-[#0000aa] font-term text-[19px] text-[#aaaaaa] shadow-[0_0_0_4px_#aaaaaa,0_0_0_6px_#000]">
        <div className="bg-[#aaaaaa] py-1 text-center text-[#0000aa]">PhoenixBits CMOS Setup Utility — Copyright (C) 1996 HashHarvest Inc.</div>
        <div className="text-center text-[#ffffff]">GPU Frequency / Voltage Control</div>
        <div className="grid border-y-2 border-[#aaaaaa] sm:grid-cols-[1.5fr_1fr]">
          <div className="border-[#aaaaaa] p-3 sm:border-r-2">
            <div className="grid grid-cols-[auto_1fr] gap-x-3 pb-2">
              <span>Device</span>
              <span className="text-[#ffffff]">{model.brand} {model.name}</span>
              <span>Silicon Grade</span>
              <span style={{ color: q.color }}>{q.label.toUpperCase()}</span>
              <span>Serial No.</span>
              <span className="text-[#55ffff]">{gpu.uid.toUpperCase().slice(-12)}</span>
              <span>Die Temp</span>
              <span className={gpu.temp > PHYSICS.throttleTemp ? 'text-[#ff5555]' : 'text-[#55ff55]'}>{gpu.temp.toFixed(1)} °C</span>
            </div>
            <BiosSlider label="Core Clock Offset" unit="MHz" base={coreBase} value={oc.core} {...OC_LIMITS.core} focus={focus === 0} onChange={(v) => setOc({ ...oc, core: v })} />
            <BiosSlider label="Memory Clock Offset" unit="MHz" base={memBase} value={oc.mem} {...OC_LIMITS.mem} focus={focus === 1} onChange={(v) => setOc({ ...oc, mem: v })} />
            <BiosSlider label="Core Voltage" unit="mV" value={oc.voltage} min={OC_LIMITS.voltage.min} max={OC_LIMITS.voltage.max} step={OC_LIMITS.voltage.step} focus={focus === 2} onChange={(v) => setOc({ ...oc, voltage: v })} />
          </div>
          <div className="flex flex-col gap-1 p-3">
            <div className="text-center text-[#ffffff]">Item Help</div>
            <div className="grid grid-cols-[1fr_auto] gap-x-2">
              <span>Hash bonus</span>
              <span className={bonus >= 0 ? 'text-[#55ff55]' : 'text-[#ff5555]'}>{bonus >= 0 ? '+' : ''}{(bonus * 100).toFixed(1)}%</span>
              <span>Hashrate</span>
              <span className="text-[#ffffff]">{formatHashrate(model.hashrate * (1 + bonus))}</span>
              <span>Board power</span>
              <span className={power > model.power * 1.2 ? 'text-[#ffaa00]' : 'text-[#ffffff]'}>{formatPower(power)}</span>
              <span>Heat output</span>
              <span className="text-[#ffffff]">x{(power / model.power).toFixed(2)}</span>
              <span>Crash risk (est.)</span>
              <span style={{ color: rl.color }}>{rl.text}</span>
            </div>
            <div className="mt-1 h-3 w-full bg-[#000055]">
              <div className="h-full" style={{ width: `${risk * 100}%`, background: rl.color }} />
            </div>
            <p className="mt-2 text-[16px] leading-tight">
              More voltage unlocks core headroom but adds heat (∝V²). Undervolting runs cooler. Unstable settings trigger a BSOD and a 10s reboot.
            </p>
            {phase === 'testing' && (
              <div className="mt-2 bg-black p-1 text-[14px] leading-tight text-[#55ff55]">
                {lines.map((l, i) => (
                  <div key={i} className="truncate">{l}</div>
                ))}
                <div className="mt-1 text-[#ffff55]">
                  STRESS TEST {'█'.repeat(Math.round(progress * 16)).padEnd(16, '░')} {Math.round(progress * 100)}%
                </div>
              </div>
            )}
            {phase === 'stable' && (
              <div className="mt-2 bg-black p-2 text-center text-[#55ff55]">
                ✓ SYSTEM STABLE — profile saved ({(gpu.ocBonus * 100).toFixed(1)}% bonus)
              </div>
            )}
          </div>
        </div>
        <div className="flex flex-wrap justify-center gap-x-5 gap-y-1 px-2 py-2 text-[#ffffff]">
          <button type="button" disabled={phase !== 'edit'} onClick={runTest} className="hover:text-[#ffff55] disabled:opacity-50">
            F10: Save &amp; Stress Test
          </button>
          <button type="button" disabled={phase !== 'edit'} onClick={() => { setOc({ ...STOCK_OC }); sfxBus.emit('switch'); }} className="hover:text-[#ffff55] disabled:opacity-50">
            F5: Load Defaults
          </button>
          <button
            type="button"
            disabled={!aiUnlocked || phase !== 'edit'}
            onClick={() => {
              if (autoTuneGpu(gpuUid)) setOc(useGameStore.getState().gpus[gpuUid]?.oc ?? oc);
            }}
            className="hover:text-[#ffff55] disabled:opacity-40"
            title={aiUnlocked ? 'Safe auto-overclock' : 'Unlock AI Diagnostics in the VIP zone'}
          >
            F9: AI Auto-Tune {aiUnlocked ? '' : '(VIP)'}
          </button>
          {phase === 'stable' && (
            <button type="button" onClick={() => setPhase('edit')} className="hover:text-[#ffff55]">
              ENTER: Keep tuning
            </button>
          )}
          <button type="button" disabled={phase === 'testing'} onClick={close} className="hover:text-[#ffff55] disabled:opacity-50">
            ESC: Exit
          </button>
        </div>
        <div className="bg-[#aaaaaa] px-2 text-center text-[16px] text-[#0000aa]">↑↓: Select item · ←→: Adjust · Drag sliders with the mouse</div>
      </div>
    </div>
  );
}
