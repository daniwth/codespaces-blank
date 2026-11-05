/** Tiny typed pub/sub used to decouple the store from audio and visual FX. */
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
  | 'contract'
  | 'claim';

export type VisualFx =
  | { kind: 'confetti'; intensity: number }
  | { kind: 'block' }
  | { kind: 'sell'; amount: number }
  | { kind: 'lottery'; quality: string };

export const sfxBus = createBus<SfxCue>();
export const fxBus = createBus<VisualFx>();

export const makeUid = (prefix: string): string =>
  `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
