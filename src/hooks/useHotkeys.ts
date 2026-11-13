import { useEffect } from 'react';
import { hasOpenLayer } from '../utils/modalStack';

/** A key the game reacts to: `key` is `KeyboardEvent.key` (letters are matched in lower case). */
export type HotkeyMap = Record<string, () => void>;

/** True when the event comes from somewhere the player is typing. */
export function isTypingTarget(target: EventTarget | null): boolean {
  if (typeof HTMLElement === 'undefined' || !(target instanceof HTMLElement)) return false;
  return target.isContentEditable || target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT';
}

/** The key of an event as hotkeys name it, or null when the event must be left alone. */
export function hotkeyOf(e: Pick<KeyboardEvent, 'key' | 'ctrlKey' | 'metaKey' | 'altKey' | 'repeat' | 'target'>): string | null {
  if (e.ctrlKey || e.metaKey || e.altKey || e.repeat || isTypingTarget(e.target)) return null;
  return e.key.length === 1 ? e.key.toLowerCase() : e.key;
}

/**
 * Global keyboard shortcuts of the game screen. They stay out of the way while the player types in a
 * field, holds a modifier, or has a dialog open (`always` lists the keys that still work then).
 */
export function useHotkeys(map: HotkeyMap, always: readonly string[] = []): void {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const key = hotkeyOf(e);
      if (!key) return;
      const run = map[key];
      if (!run || (hasOpenLayer() && !always.includes(key))) return;
      e.preventDefault();
      run();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });
}
