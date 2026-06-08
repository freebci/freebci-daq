import { useEffect } from 'react';
import { X } from 'lucide-react';
import type { Locale } from '../i18n';
import { t } from '../i18n';
import { useEegStore } from '../store/eegStore';
import type { AcquisitionDiagnosticStatus } from '../types/acquisition';

interface DiagnosticsPanelProps {
  locale: Locale;
  isOpen: boolean;
  onClose: () => void;
}

function formatDiagnosticStatus(status: AcquisitionDiagnosticStatus, locale: Locale): string {
  switch (status) {
    case 'running':
      return t(locale, 'diagnostics.statusRunning');
    case 'success':
      return t(locale, 'diagnostics.statusSuccess');
    case 'error':
      return t(locale, 'diagnostics.statusError');
    case 'info':
      return t(locale, 'diagnostics.statusInfo');
  }
}

function statusToneClass(status: AcquisitionDiagnosticStatus): string {
  switch (status) {
    case 'error':
      return 'text-error';
    case 'success':
      return 'text-success';
    case 'running':
      return 'text-accent';
    default:
      return 'text-meta';
  }
}

function formatTimestamp(timestamp: string, locale: Locale): string {
  return new Intl.DateTimeFormat(locale, {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).format(new Date(timestamp));
}

export function DiagnosticsPanel({ locale, isOpen, onClose }: DiagnosticsPanelProps) {
  const diagnostics = useEegStore((state) => state.diagnostics);
  const clearDiagnostics = useEegStore((state) => state.clearDiagnostics);

  useEffect(() => {
    if (!isOpen) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const summary = t(locale, 'log.summary', { count: diagnostics.length });

  return (
    <div className="fixed inset-0 z-40" role="dialog" aria-modal="true" aria-labelledby="diagnostics-title">
      <div
        className="absolute inset-0 bg-paper/70 backdrop-blur-sm"
        onClick={onClose}
        aria-hidden="true"
      />
      <aside className="absolute right-0 top-0 flex h-full w-[min(30rem,92vw)] flex-col border-l border-hairline bg-card">
        <header className="flex items-center justify-between gap-3 border-b border-hairline px-5 h-10">
          <div className="flex items-center gap-3">
            <h2
              id="diagnostics-title"
              className="m-0 text-[0.88rem] font-medium tracking-tight text-ink"
            >
              {t(locale, 'diagnostics.title')}
            </h2>
            <span className="font-mono text-[0.65rem] uppercase tracking-[0.08em] text-meta">
              {t(locale, 'diagnostics.eyebrow')}
            </span>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label={t(locale, 'chart.tooltipClose')}
            className="inline-flex h-7 w-7 items-center justify-center rounded-sm border border-hairline bg-card text-meta hover:text-ink hover:bg-surface-2 hover:border-meta"
          >
            <X size={13} strokeWidth={1.5} />
          </button>
        </header>

        <div className="flex flex-1 flex-col overflow-y-auto bg-paper">
          {diagnostics.length === 0 && (
            <p className="m-0 px-5 py-4 text-[0.85rem] text-meta">{t(locale, 'diagnostics.empty')}</p>
          )}

          {diagnostics.length > 0 && (
            <>
              <div className="flex items-center justify-between gap-3 border-b border-hairline px-5 py-2.5 bg-card">
                <span className="font-mono text-[0.7rem] uppercase tracking-[0.08em] text-meta">
                  {summary}
                </span>
                <button
                  type="button"
                  onClick={clearDiagnostics}
                  className="font-mono text-[0.7rem] uppercase tracking-[0.08em] text-meta underline-offset-2 hover:text-ink hover:underline"
                >
                  {t(locale, 'log.clear')}
                </button>
              </div>
              <ol className="flex flex-col list-none m-0 p-0 font-mono">
                {diagnostics.map((entry) => (
                  <li
                    key={entry.id}
                    className="flex flex-col gap-1 border-b border-hairline px-5 py-2.5 hover:bg-card/50"
                  >
                    <div className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5 text-[0.72rem]">
                      <span className="text-meta tabular shrink-0">
                        {formatTimestamp(entry.timestamp, locale)}
                      </span>
                      <span
                        className={`uppercase tracking-[0.06em] shrink-0 ${statusToneClass(entry.status)}`}
                      >
                        {formatDiagnosticStatus(entry.status, locale)}
                      </span>
                      <span className="text-ink">{entry.phase}</span>
                    </div>
                    <p className="m-0 text-[0.82rem] text-ink leading-relaxed font-sans">
                      {entry.message}
                    </p>
                    {entry.detail && (
                      <code className="text-[0.74rem] text-meta break-all">{entry.detail}</code>
                    )}
                    {entry.durationMs !== undefined && (
                      <span className="text-[0.7rem] text-hint">
                        {t(locale, 'diagnostics.duration', { duration: entry.durationMs })}
                      </span>
                    )}
                  </li>
                ))}
              </ol>
            </>
          )}
        </div>
      </aside>
    </div>
  );
}
