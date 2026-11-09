import { useEffect, useRef } from 'react';
import { talentModifiers } from '../config/prestigeTree';
import { simulateOffline, simulateOnline } from '../store/gamePhysics';
import { selectSimInput, useGameStore } from '../store/useGameStore';
import { currentWorldEpoch } from '../store/worldEpoch';
import type { WorkerRequest, WorkerResponse } from '../workers/gameTick.worker';

const TICK_MS = 250;
/** Gaps longer than this on load are resolved as offline progress. */
const OFFLINE_THRESHOLD_SEC = 30;
/** While running, gaps beyond what one online tick integrates (sleep/hibernate) become offline progress. */
const LIVE_GAP_SEC = 600;

export type LoopMode = 'worker' | 'main-thread';

/** The simulation only runs on the game screen; the title menu freezes the save. */
const inGame = (): boolean => useGameStore.getState().screen === 'game';

/**
 * Connects the simulation (Web Worker, or rAF fallback) to the Zustand store
 * while the game screen is up, and resolves offline earnings each time it starts
 * (on Continue / New game). On the title menu nothing ticks: no worker, no
 * offline credit, `lastTick` stays frozen.
 */
export function useGameLoop(onMode?: (mode: LoopMode) => void): void {
  const onModeRef = useRef(onMode);
  onModeRef.current = onMode;
  const running = useGameStore((s) => s.screen === 'game');

  useEffect(() => {
    if (!running) return undefined;
    let disposed = false;
    let worker: Worker | null = null;
    let inFlight = false;
    let reqId = 0;
    /** World epoch the tick in flight was computed from. */
    let postedEpoch = 0;
    let interval: ReturnType<typeof setInterval> | null = null;
    let raf = 0;

    /**
     * Resolves a long gap (tab reopened, laptop woke up from sleep) as offline
     * progress with its "welcome back" report. Returns true when it did.
     */
    const resolveLongGap = (thresholdSec: number): boolean => {
      if (disposed || !inGame()) return false;
      const state = useGameStore.getState();
      const now = Date.now();
      const gap = (now - state.lastTick) / 1000;
      if (gap <= thresholdSec || !state.settings.offlineProgress) return false;
      const cap = talentModifiers(state.talents).offlineHours * 3600;
      state.applyOffline(simulateOffline(selectSimInput(state), Math.min(gap, cap), now), gap);
      return true;
    };

    // Boot: anything shorter than the threshold is simply simulated by the first tick.
    // With offline earnings off, time spent away (or on the title menu) earns nothing.
    if (inGame() && !useGameStore.getState().settings.offlineProgress) useGameStore.setState({ lastTick: Date.now() });
    else resolveLongGap(OFFLINE_THRESHOLD_SEC);

    const apply = (res: WorkerResponse) => {
      // A tick still in flight when the player left for the menu must not land.
      if (disposed || !inGame()) return;
      // Nor may one computed before a reset, import or Halving replaced the world.
      if (postedEpoch !== currentWorldEpoch()) return;
      useGameStore.getState().applyTick(res.output);
    };

    // ── Preferred path: Web Worker ──
    try {
      if (typeof Worker === 'undefined') throw new Error('no worker');
      worker = new Worker(new URL('../workers/gameTick.worker.ts', import.meta.url), { type: 'module' });
      worker.onmessage = (e: MessageEvent<WorkerResponse>) => {
        inFlight = false;
        apply(e.data);
      };
      worker.onerror = () => {
        // Worker crashed (e.g. CSP): degrade to main thread.
        worker?.terminate();
        worker = null;
        startFallback();
      };
      interval = setInterval(() => {
        if (!worker || inFlight || !inGame()) return;
        if (resolveLongGap(LIVE_GAP_SEC)) return;
        inFlight = true;
        reqId += 1;
        postedEpoch = currentWorldEpoch();
        const msg: WorkerRequest = { type: 'tick', id: reqId, input: selectSimInput(useGameStore.getState()), now: Date.now() };
        worker.postMessage(msg);
      }, TICK_MS);
      onModeRef.current?.('worker');
    } catch {
      startFallback();
    }

    // ── Fallback: requestAnimationFrame accumulator on the main thread ──
    function startFallback() {
      if (interval) clearInterval(interval);
      interval = null;
      onModeRef.current?.('main-thread');
      let last = performance.now();
      const loop = (t: number) => {
        if (disposed) return;
        if (t - last >= TICK_MS && inGame()) {
          last = t;
          resolveLongGap(LIVE_GAP_SEC);
          const state = useGameStore.getState();
          const tickNow = Date.now();
          const out = simulateOnline(selectSimInput(state), Math.max(0, (tickNow - state.lastTick) / 1000), tickNow);
          state.applyTick(out);
        }
        raf = requestAnimationFrame(loop);
      };
      raf = requestAnimationFrame(loop);
      // rAF pauses in background tabs: keep a slow timer so dt catches up.
      interval = setInterval(() => {
        if (document.visibilityState === 'hidden' && !disposed && inGame()) {
          resolveLongGap(LIVE_GAP_SEC);
          const state = useGameStore.getState();
          const tickNow = Date.now();
          state.applyTick(simulateOnline(selectSimInput(state), Math.max(0, (tickNow - state.lastTick) / 1000), tickNow));
        }
      }, 5000);
    }

    return () => {
      disposed = true;
      if (interval) clearInterval(interval);
      cancelAnimationFrame(raf);
      worker?.terminate();
    };
  }, [running]);
}
