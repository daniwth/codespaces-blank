import { useEffect, useState, type RefObject } from 'react';
import { isTopLayer } from '../utils/modalStack';

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

const focusables = (root: HTMLElement): HTMLElement[] =>
  Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE)).filter((el) => el.getClientRects().length > 0);

/**
 * Modal keyboard focus: moves focus into `container` when it opens (unless a child
 * already took it), keeps Tab / Shift+Tab cycling inside it while it is the top
 * modal layer, and returns focus to the opener when it closes.
 *
 * `container` must be focusable itself (tabIndex={-1}). `refocusKey` re-runs the
 * "move focus inside" step when the dialog swaps its content (e.g. BIOS → BSOD).
 */
export function useDialogFocus(container: RefObject<HTMLElement | null>, layer: RefObject<number>, refocusKey?: unknown): void {
  // Captured during the first render, before any autoFocus child steals focus.
  const [opener] = useState(() => (typeof document !== 'undefined' && document.activeElement instanceof HTMLElement ? document.activeElement : null));

  useEffect(() => {
    const el = container.current;
    if (el && !el.contains(document.activeElement)) el.focus({ preventScroll: true });
  }, [container, refocusKey]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Tab' || !isTopLayer(layer.current)) return;
      const root = container.current;
      if (!root) return;
      const items = focusables(root);
      const active = document.activeElement;
      if (items.length === 0) {
        e.preventDefault();
        root.focus({ preventScroll: true });
        return;
      }
      const first = items[0];
      const last = items[items.length - 1];
      const inside = active instanceof HTMLElement && root.contains(active);
      if (e.shiftKey && (!inside || active === first || active === root)) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && (!inside || active === last)) {
        e.preventDefault();
        first.focus();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [container, layer]);

  useEffect(
    () => () => {
      // Only when focus was lost with the removed window (not during StrictMode's simulated unmount).
      const lost = !document.activeElement || document.activeElement === document.body;
      if (lost && opener?.isConnected && opener !== document.body) opener.focus({ preventScroll: true });
    },
    [opener],
  );
}
