import type { ReactNode } from 'react';

interface StatProps {
  label: string;
  value: ReactNode;
  hint?: ReactNode;
  emphasis?: 'default' | 'accent';
  align?: 'left' | 'right';
}

export function Stat({
  label,
  value,
  hint,
  emphasis = 'default',
  align = 'left',
}: StatProps) {
  const valueClass =
    emphasis === 'accent'
      ? 'font-mono text-2xl font-medium leading-none tabular text-accent'
      : 'font-mono text-base font-medium leading-tight text-ink tabular';

  return (
    <div
      className={`min-w-0 ${align === 'right' ? 'text-right' : 'text-left'} flex flex-col gap-1.5`}
    >
      <div className="font-mono text-[0.65rem] font-medium uppercase tracking-[0.08em] text-meta">
        {label}
      </div>
      <div className={`${valueClass} break-words`}>{value}</div>
      {hint && <div className="text-[0.78rem] text-hint leading-tight">{hint}</div>}
    </div>
  );
}
