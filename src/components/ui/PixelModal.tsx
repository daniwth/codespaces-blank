import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { X } from 'lucide-react';
import { cn } from '../../utils/cn';
import { isTopLayer, popLayer, pushLayer } from '../../utils/modalStack';

interface PixelModalProps {
  title: ReactNode;
  onClose: () => void;
  children: ReactNode;
  className?: string;
  accent?: string;
  hideClose?: boolean;
}

/**
 * Full-screen dimmed overlay with a pixel-bordered window. ESC closes it (top
 * layer only). Keyboard focus moves into the window on open (unless a child
 * used autoFocus) and returns to the opener on close.
 */
export function PixelModal({ title, onClose, children, className, accent = '#22d3ee', hideClose }: PixelModalProps) {
  const layer = useRef(0);
  const panel = useRef<HTMLDivElement | null>(null);
  const titleId = useId();
  // Captured during the first render, before any autoFocus child steals focus.
  const [opener] = useState(() => (document.activeElement instanceof HTMLElement ? document.activeElement : null));
  useEffect(() => {
    layer.current = pushLayer();
    const id = layer.current;
    if (panel.current && !panel.current.contains(document.activeElement)) panel.current.focus({ preventScroll: true });
    return () => {
      popLayer(id);
      // Only when focus was lost with the removed window (not during StrictMode's simulated unmount).
      const lost = !document.activeElement || document.activeElement === document.body;
      if (lost && opener?.isConnected && opener !== document.body) opener.focus({ preventScroll: true });
    };
  }, [opener]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !hideClose && isTopLayer(layer.current)) onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, hideClose]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-3 backdrop-blur-[1px]"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget && !hideClose) onClose();
      }}
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
    >
      <div ref={panel} tabIndex={-1} className={cn('pixel-box pop-in flex max-h-[92vh] w-full max-w-3xl flex-col outline-none', className)}>
        <div className="flex items-center justify-between gap-3 px-4 py-2" style={{ background: `linear-gradient(90deg, ${accent}33, transparent)` }}>
          <h2 id={titleId} className="font-pixel text-[11px] uppercase tracking-wide" style={{ color: accent }}>
            {title}
          </h2>
          {!hideClose && (
            <button type="button" onClick={onClose} className="p-1 text-dim hover:text-ink" aria-label="Close">
              <X size={18} />
            </button>
          )}
        </div>
        <div className="retro-scroll min-h-0 flex-1 overflow-y-auto p-4">{children}</div>
      </div>
    </div>
  );
}
