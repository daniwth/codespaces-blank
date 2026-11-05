import { useEffect, useRef } from 'react';
import { talentModifiers } from '../config/prestigeTree';
import { simulateOffline, simulateOnline } from '../store/gamePhysics';
import { selectSimInput, useGameStore } from '../store/useGameStore';
import type { WorkerRequest, WorkerResponse } from '../workers/gameTick.worker';

const TICK_MS = 250;
/** Gaps longer than this on load are resolved as offline progress. */
const OFFLINE_THRESHOLD_SEC = 30;

export type LoopMode = 'worker' | 'main-thread';

/**
 * Connects the simulation (Web Worker, or rAF fallback) to the Zustand store
 * and resolves offline earnings once on boot.
 */
export function useGameLoop(onMode?: (mode: LoopMode) => void): void {
  const onModeRef = useRef(onMode);
  onModeRef.current = onMode;

  useEffect(() => {
    let disposed = false;
    let worker: Worker | null = null;
    let inFlight = false;
    let reqId = 0;
    let interval: ReturnType<typeof setInterval> | null = null;
    let raf = 0;

    // ── Offline progress (resolved synchronously before the loop starts) ──
    const boot = useGameStore.getState();
    const now = Date.now();
    const gap = (now - boot.lastTick) / 1000;
    if (gap > OFFLINE_THRESHOLD_SEC && boot.settings.offlineProgress) {
      const cap = talentModifiers(boot.talents).offlineHours * 3600;
      const seconds = Math.min(gap, cap);
      const out = simulateOffline(selectSimInput(boot), seconds, now);
      boot.applyOffline(out, gap);
    } else {
      useGameStore.setState({ lastTick: now });
    }

    const apply = (res: WorkerResponse) => {
      if (disposed) return;
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
        if (!worker || inFlight) return;
        inFlight = true;
        reqId += 1;
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
        if (t - last >= TICK_MS) {
          last = t;
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
        if (document.visibilityState === 'hidden') {
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
  }, []);
}
