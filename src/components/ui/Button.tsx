import type { ButtonHTMLAttributes, ReactNode } from 'react';

type Variant = 'primary' | 'ghost' | 'quiet' | 'danger' | 'critical';
type Size = 'sm' | 'md';

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  children: ReactNode;
}

const VARIANT_CLASSES: Record<Variant, string> = {
  primary:
    'bg-accent text-white border border-accent hover:bg-cyan-800 hover:border-cyan-800 disabled:bg-accent/40 disabled:border-accent/40 disabled:text-white/60',
  ghost:
    'bg-transparent text-ink border border-hairline hover:bg-surface-2 hover:border-meta disabled:opacity-40',
  quiet:
    'bg-transparent text-meta border border-transparent hover:text-ink hover:bg-surface-2 disabled:opacity-40',
  danger:
    'bg-transparent text-error border border-error/60 hover:bg-error hover:text-white hover:border-error disabled:opacity-40',
  critical:
    'bg-error text-white border border-error font-mono uppercase tracking-[0.08em] hover:bg-red-700 hover:border-red-700 disabled:opacity-40',
};

const SIZE_CLASSES: Record<Size, string> = {
  sm: 'h-8 px-3 text-[0.78rem]',
  md: 'h-10 px-4 text-[0.85rem]',
};

export function Button({
  variant = 'primary',
  size = 'md',
  className = '',
  children,
  type = 'button',
  ...rest
}: ButtonProps) {
  return (
    <button
      type={type}
      className={`inline-flex items-center justify-center gap-2 rounded-sm font-medium tracking-tight transition-colors duration-150 active:scale-[0.98] disabled:cursor-not-allowed disabled:active:scale-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent ${VARIANT_CLASSES[variant]} ${SIZE_CLASSES[size]} ${className}`}
      {...rest}
    >
      {children}
    </button>
  );
}
