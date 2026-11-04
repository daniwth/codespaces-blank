import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { sfxBus } from '../../utils/eventBus';
import { cn } from '../../utils/cn';

type Variant = 'primary' | 'secondary' | 'danger' | 'gold' | 'ghost' | 'success';
type Size = 'xs' | 'sm' | 'md' | 'lg';

const VARIANTS: Record<Variant, { face: string; edge: string; text: string; hi: string; lo: string }> = {
  primary: { face: '#0e7490', edge: '#22d3ee', text: '#ecfeff', hi: '#67e8f9', lo: '#164e63' },
  secondary: { face: '#2a2550', edge: '#5b52a8', text: '#e9e6ff', hi: '#4a4290', lo: '#151230' },
  danger: { face: '#9f1239', edge: '#f43f5e', text: '#ffe4e6', hi: '#fb7185', lo: '#4c0519' },
  gold: { face: '#a16207', edge: '#facc15', text: '#fefce8', hi: '#fde047', lo: '#422006' },
  success: { face: '#3f6212', edge: '#a3e635', text: '#f7fee7', hi: '#bef264', lo: '#1a2e05' },
  ghost: { face: 'transparent', edge: '#3a3470', text: '#c4bff0', hi: 'transparent', lo: 'transparent' },
};

const SIZES: Record<Size, string> = {
  xs: 'px-2 py-0.5 text-[8px]',
  sm: 'px-2.5 py-1 text-[9px]',
  md: 'px-3.5 py-2 text-[10px]',
  lg: 'px-5 py-3 text-xs',
};

export interface PixelButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  icon?: ReactNode;
  silent?: boolean;
}

/** Chunky bevelled button with notched pixel corners and a mechanical click. */
export function PixelButton({
  variant = 'secondary',
  size = 'md',
  icon,
  silent,
  className,
  children,
  style,
  onClick,
  disabled,
  ...rest
}: PixelButtonProps) {
  const v = VARIANTS[variant];
  return (
    <button
      type="button"
      {...rest}
      disabled={disabled}
      onClick={(e) => {
        if (!silent) sfxBus.emit('click');
        onClick?.(e);
      }}
      className={cn(
        'relative inline-flex select-none items-center justify-center gap-1.5 font-pixel uppercase leading-none tracking-tight',
        'transition-transform active:translate-y-[2px] disabled:cursor-not-allowed disabled:opacity-40 disabled:active:translate-y-0',
        'focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-neon',
        SIZES[size],
        className,
      )}
      style={{
        background: v.face,
        color: v.text,
        margin: 2,
        boxShadow: `0 -2px 0 0 ${v.edge}, 0 2px 0 0 ${v.edge}, -2px 0 0 0 ${v.edge}, 2px 0 0 0 ${v.edge}, inset 2px 2px 0 0 ${v.hi}, inset -2px -2px 0 0 ${v.lo}`,
        ...style,
      }}
    >
      {icon}
      {children}
    </button>
  );
}
