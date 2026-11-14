/** Tiny typed pub/sub used to decouple the store from audio and visual FX. */
import type { RoomId } from '../types/player';

export interface Bus<T> {
  emit: (payload: T) => void;
  on: (listener: (payload: T) => void) => () => void;
}

export function createBus<T>(): Bus<T> {
  const listeners = new Set<(payload: T) => void>();
  return {
    emit: (payload) => listeners.forEach((l) => l(payload)),
    on: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}

export type SfxCue =
  | 'click'
  | 'switch'
  | 'buy'
  | 'sell'
  | 'coin'
  | 'block'
  | 'alarm'
  | 'raid'
  | 'event'
  | 'shutdown'
  | 'restart'
  | 'error'
  | 'bsod'
  | 'success'
  | 'halving'
  | 'install'
  | 'unlock'
  | 'boot'
  | 'start'
  | 'contract'
  | 'claim'
  | 'drone'
  | 'fuse'
  | 'rally'
  | 'frost'
  | 'news';

export type VisualFx =
  | { kind: 'confetti'; intensity: number }
  | { kind: 'block' }
  | { kind: 'sell'; amount: number }
  | { kind: 'lottery'; quality: string }
  /** Darknet raid: electrical inspection of `roomId` until epoch ms `until`. */
  | { kind: 'raid'; roomId: RoomId; until: number }
  /** A supply drone was caught: `label` floats up from where it was. */
  | { kind: 'airdrop'; label: string; color: string }
  /** Floating label over one rack: a mined block, a re-paste, a thermal alert, a crashed overclock. */
  | { kind: 'rackText'; rackUid: string; text: string; color: string; big?: boolean };

export const sfxBus = createBus<SfxCue>();
export const fxBus = createBus<VisualFx>();

export const makeUid = (prefix: string): string =>
  `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
