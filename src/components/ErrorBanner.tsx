import { useEffect, useState } from 'react';
import { AlertTriangle, X } from 'lucide-react';
import type { Locale } from '../i18n';
import { t } from '../i18n';
import { useEegStore } from '../store/eegStore';

interface ErrorBannerProps {
  locale: Locale;
}

export function ErrorBanner({ locale }: ErrorBannerProps) {
  const errorMessage = useEegStore((state) => state.errorMessage);
  const setError = useEegStore((state) => state.setError);
  const [isVisible, setIsVisible] = useState(false);

  useEffect(() => {
    setIsVisible(Boolean(errorMessage));
  }, [errorMessage]);

  if (!errorMessage || !isVisible) {
    return null;
  }

  return (
    <div
      role="alert"
      aria-label={t(locale, 'error.aria')}
      className="fixed bottom-5 right-5 z-50 flex max-w-[26rem] items-start gap-3 rounded-sm border border-error/60 bg-card px-4 py-3"
    >
      <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center text-error">
        <AlertTriangle size={14} strokeWidth={1.75} />
      </span>
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <span className="font-mono text-[0.65rem] font-medium uppercase tracking-[0.08em] text-error">
          {t(locale, 'error.title')}
        </span>
        <span className="text-[0.85rem] text-ink leading-relaxed break-words">{errorMessage}</span>
      </div>
      <button
        type="button"
        onClick={() => {
          setIsVisible(false);
          setError(null);
        }}
        aria-label={t(locale, 'log.collapse')}
        className="ml-1 inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-sm text-meta hover:text-ink hover:bg-surface-2 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent"
      >
        <X size={13} strokeWidth={1.5} />
      </button>
    </div>
  );
}
