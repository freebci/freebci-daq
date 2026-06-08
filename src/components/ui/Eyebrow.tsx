import type { ReactNode } from 'react';

interface EyebrowProps {
  children: ReactNode;
  className?: string;
}

export function Eyebrow({ children, className = '' }: EyebrowProps) {
  return (
    <p
      className={`m-0 font-mono text-[0.65rem] font-medium uppercase tracking-[0.08em] text-meta ${className}`}
    >
      {children}
    </p>
  );
}
