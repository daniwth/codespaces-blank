/**
 * Off-thread game tick. The main thread posts a plain-JSON snapshot of the
 * simulation input; the worker integrates physics/economy and answers with
 * deltas that the store merges (so player actions made meanwhile are kept).
 */
import { simulateOffline, simulateOnline, type SimInput, type SimOutput } from '../store/gamePhysics';

export type WorkerRequest =
  | { type: 'tick'; id: number; input: SimInput; now: number }
  | { type: 'offline'; id: number; input: SimInput; seconds: number; now: number };

export interface WorkerResponse {
  id: number;
  type: WorkerRequest['type'];
  output: SimOutput;
  computeMs: number;
}

interface WorkerScope {
  onmessage: ((event: MessageEvent<WorkerRequest>) => void) | null;
  postMessage: (message: WorkerResponse) => void;
}

const scope = self as unknown as WorkerScope;

scope.onmessage = (event: MessageEvent<WorkerRequest>) => {
  const msg = event.data;
  const t0 = performance.now();
  const output =
    msg.type === 'tick'
      ? simulateOnline(msg.input, Math.max(0, (msg.now - msg.input.lastTick) / 1000), msg.now)
      : simulateOffline(msg.input, msg.seconds, msg.now);
  const response: WorkerResponse = { id: msg.id, type: msg.type, output, computeMs: performance.now() - t0 };
  scope.postMessage(response);
};
