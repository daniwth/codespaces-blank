import { useEffect, useState } from 'react';
import { cn } from '../../utils/cn';

interface NumberFieldProps {
  value: number;
  min: number;
  max: number;
  step?: number;
  onCommit: (value: number) => void;
  /** Commit valid values while typing (default: only on blur / Enter). */
  live?: boolean;
  className?: string;
  'aria-label': string;
}

/**
 * Numeric input that lets the player type freely ("0.", "", "3" on the way to
 * "30"). The value is committed (clamped to range) when the field loses focus
 * or Enter is pressed, so half-typed numbers never reach game logic.
 */
export function NumberField({ value, min, max, step, onCommit, live = false, className, ...rest }: NumberFieldProps) {
  const [draft, setDraft] = useState(String(value));
  const [focused, setFocused] = useState(false);

  useEffect(() => {
    if (!focused) setDraft(String(value));
  }, [value, focused]);

  const parse = (text: string): number | null => {
    if (text.trim() === '') return null;
    const n = Number(text);
    return Number.isFinite(n) ? n : null;
  };

  const finish = () => {
    const n = parse(draft);
    const next = n === null ? value : Math.min(max, Math.max(min, n));
    setDraft(String(next));
    if (next !== value) onCommit(next);
  };

  return (
    <input
      {...rest}
      className={cn('retro-input', className)}
      type="number"
      inputMode="decimal"
      min={min}
      max={max}
      step={step}
      value={draft}
      onFocus={() => setFocused(true)}
      onChange={(e) => {
        setDraft(e.target.value);
        const n = parse(e.target.value);
        if (live && n !== null && n >= min && n <= max && n !== value) onCommit(n);
      }}
      onBlur={() => {
        setFocused(false);
        finish();
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
      }}
    />
  );
}
