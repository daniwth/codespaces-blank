/**
 * Title-menu flows that touch both the game save and the account/cloud state.
 * Kept out of the slices so the game store never imports the account store
 * (the account store already depends on the game store).
 */
import type { CloudSaveMeta } from '../services/cloudApi';
import { useAccountStore } from './useAccountStore';
import { useGameStore } from './useGameStore';

/** Fresh run from zero. The cloud save (if any) is left alone: the next sync asks which progress to keep. */
export function startFreshRun(): void {
  useAccountStore.getState().detachLocalSave();
  useGameStore.getState().startNewGame();
}

/** Factory reset: like a new game, the wiped run must not silently overwrite the cloud save. */
export function factoryReset(): void {
  useAccountStore.getState().detachLocalSave();
  useGameStore.getState().hardReset();
}

/** Back to the title screen: flush the local save, stop the loop, and push it to the cloud when auto-sync is on. */
export function goToMainMenu(): void {
  useGameStore.getState().returnToMenu();
  const a = useAccountStore.getState();
  if (a.autoSync && a.user?.subscription.active && a.syncState !== 'conflict') void a.uploadSave({ silent: true });
}

/** Replace the local save with the cloud one and enter the game (import stamps lastTick, so no offline credit). */
export async function loadCloudAndPlay(): Promise<boolean> {
  const ok = await useAccountStore.getState().downloadSave();
  if (ok) useGameStore.getState().continueGame();
  return ok;
}

/**
 * Whether the title menu should offer "Load cloud save": the cloud holds a save
 * this device's progress is not based on. Our own upload whose response was lost
 * on unload (pendingChecksum) does not count.
 */
export function shouldOfferCloudLoad(a: { cloud: CloudSaveMeta | null; baseRevision: number | null; pendingChecksum: string | null }): boolean {
  if (!a.cloud || a.cloud.revision === a.baseRevision) return false;
  return !(a.cloud.checksum && a.cloud.checksum === a.pendingChecksum);
}
