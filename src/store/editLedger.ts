import type { GpuThermalUpdate } from './gamePhysics';

/**
 * Player edits to fields the simulation also writes (paste, wear, temp…).
 * The worker answers with absolute values computed from a snapshot taken when
 * the tick was posted; an edit made after that snapshot must win the merge,
 * otherwise "re-paste" or "repair" would be silently reverted by that tick.
 */
const edits = new Map<string, { at: number; fields: Partial<GpuThermalUpdate> }>();

export function recordGpuEdit(uid: string, fields: Partial<GpuThermalUpdate>): void {
  const prev = edits.get(uid);
  edits.set(uid, { at: Date.now(), fields: { ...prev?.fields, ...fields } });
}

/** Applies edits made at/after `snapshotAt` on top of a simulation update. */
export function reconcileGpuUpdate(uid: string, update: GpuThermalUpdate, snapshotAt: number): GpuThermalUpdate {
  const edit = edits.get(uid);
  return edit && edit.at >= snapshotAt ? { ...update, ...edit.fields } : update;
}

/** Edits older than this snapshot are already part of the simulated state. */
export function pruneGpuEdits(snapshotAt: number): void {
  edits.forEach((edit, uid) => {
    if (edit.at < snapshotAt) edits.delete(uid);
  });
}
