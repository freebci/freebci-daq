type Tone = 'idle' | 'active' | 'success' | 'warn' | 'error';

interface StatusDotProps {
  tone: Tone;
  label?: string;
  pulse?: boolean;
}

const TONE_DOT: Record<Tone, string> = {
  idle: 'bg-hint',
  active: 'bg-accent',
  success: 'bg-success',
  warn: 'bg-warn',
  error: 'bg-error',
};

const TONE_HALO: Record<Tone, string> = {
  idle: '',
  active: 'bg-accent',
  success: 'bg-success',
  warn: 'bg-warn',
  error: 'bg-error',
};

export function StatusDot({ tone, label, pulse = false }: StatusDotProps) {
  return (
    <span className="inline-flex items-center gap-2">
      <span className="relative inline-flex h-1.5 w-1.5 shrink-0">
        {tone !== 'idle' && (
          <span
            aria-hidden="true"
            className={`absolute -inset-0.5 rounded-full opacity-25 ${TONE_HALO[tone]}`}
          />
        )}
        <span
          aria-hidden="true"
          className={`relative inline-flex h-1.5 w-1.5 rounded-full ${TONE_DOT[tone]} ${pulse && tone !== 'idle' ? 'animate-pulse' : ''}`}
        />
      </span>
      {label && <span className="text-[0.85rem] text-ink">{label}</span>}
    </span>
  );
}
