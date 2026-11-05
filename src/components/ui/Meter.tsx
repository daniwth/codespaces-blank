import { cn } from '../../utils/cn';

interface MeterProps {
  value: number;
  max: number;
  color?: string;
  segments?: number;
  className?: string;
  warnAt?: number;
  dangerAt?: number;
}

/** Segmented LED bar meter. */
export function Meter({ value, max, color = '#22d3ee', segments = 16, className, warnAt = 0.75, dangerAt = 0.92 }: MeterProps) {
  const ratio = max > 0 ? Math.max(0, Math.min(1.2, value / max)) : 0;
  const lit = Math.round(Math.min(1, ratio) * segments);
  return (
    <div className={cn('flex h-2.5 gap-[2px]', className)} role="meter" aria-valuenow={value} aria-valuemax={max}>
      {Array.from({ length: segments }, (_, i) => {
        const pos = (i + 1) / segments;
        const c = pos > dangerAt ? '#f43f5e' : pos > warnAt ? '#fbbf24' : color;
        const on = i < lit;
        return (
          <span
            key={i}
            className="flex-1"
            style={{ background: on ? c : '#1b1838', boxShadow: on ? `0 0 4px ${c}` : undefined, opacity: ratio > 1 && on ? 0.6 + 0.4 * ((Date.now() >> 8) % 2) : 1 }}
          />
        );
      })}
    </div>
  );
}
