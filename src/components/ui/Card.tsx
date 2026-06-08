import type { ReactNode } from 'react';

interface CardProps {
  children: ReactNode;
  className?: string;
  as?: 'section' | 'article' | 'div';
  ariaLabelledBy?: string;
  ariaLabel?: string;
}

export function Card({
  children,
  className = '',
  as: Tag = 'section',
  ariaLabelledBy,
  ariaLabel,
}: CardProps) {
  return (
    <Tag
      className={`relative rounded-sm border border-hairline bg-card ${className}`}
      aria-labelledby={ariaLabelledBy}
      aria-label={ariaLabel}
    >
      {children}
    </Tag>
  );
}

interface CardHeaderProps {
  eyebrow?: string;
  title: string;
  titleId?: string;
  trailing?: ReactNode;
}

export function CardHeader({ eyebrow, title, titleId, trailing }: CardHeaderProps) {
  return (
    <header className="flex items-center justify-between gap-4 border-b border-hairline bg-surface-2 px-5 py-2.5 min-h-[2.5rem] rounded-t-sm">
      <div className="flex min-w-0 flex-1 items-center gap-3">
        <h2
          id={titleId}
          className="m-0 text-[0.88rem] font-medium leading-tight tracking-tight text-ink truncate"
        >
          {title}
        </h2>
        {eyebrow && (
          <span className="font-mono text-[0.65rem] uppercase tracking-[0.08em] text-meta">
            {eyebrow}
          </span>
        )}
      </div>
      {trailing && <div className="shrink-0">{trailing}</div>}
    </header>
  );
}

interface CardBodyProps {
  children: ReactNode;
  className?: string;
}

export function CardBody({ children, className = '' }: CardBodyProps) {
  return <div className={`px-5 py-5 ${className}`}>{children}</div>;
}
