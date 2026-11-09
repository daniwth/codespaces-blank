import { createInitialData } from '../../src/store/initialState';
import type { SimInput } from '../../src/store/gamePhysics';
import type { GameData } from '../../src/types/player';

/** Fresh starter world (bench rack, PX-460, 80mm fan, 500W PSU) as simulation input. */
export function starterWorld(patch: Partial<GameData> = {}): { data: GameData; input: SimInput; gpuUid: string; rackUid: string } {
  const data = { ...createInitialData(), ...patch };
  const rackUid = Object.keys(data.racks)[0];
  const gpuUid = Object.keys(data.gpus)[0];
  // Freeze the network: no random events during unit tests.
  data.nextEventAt = Number.MAX_SAFE_INTEGER;
  return { data, input: data, gpuUid, rackUid };
}
