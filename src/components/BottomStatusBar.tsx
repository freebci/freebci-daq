import { useEffect, useState } from 'react';
import { ExternalLink, ScrollText } from 'lucide-react';
import type { Locale } from '../i18n';
import { t } from '../i18n';
import { useEegStore } from '../store/eegStore';
import { getEffectiveEegHardwareSampleRateHz } from '../transport/eegHardwareConfig';
import { LanguageToggle } from './ui';

interface BottomStatusBarProps {
  locale: Locale;
  onOpenDiagnostics: () => void;
  onToggleLocale: () => void;
}

type SegmentTone = 'default' | 'meta' | 'accent' | 'success' | 'warn' | 'error';

interface SegmentProps {
  label: string;
  value: string;
  tone?: SegmentTone;
}

const TONE_VALUE_CLASS: Record<SegmentTone, string> = {
  default: 'text-ink',
  meta: 'text-meta',
  accent: 'text-accent',
  success: 'text-success',
  warn: 'text-warn',
  error: 'text-error',
};

function Segment({ label, value, tone = 'default' }: SegmentProps) {
  return (
    <div className="flex items-center gap-2 px-4 h-full">
      <span className="font-mono text-[0.65rem] font-medium uppercase tracking-[0.08em] text-meta">
        {label}
      </span>
      <span className={`font-mono text-[0.78rem] tabular tracking-tight ${TONE_VALUE_CLASS[tone]}`}>
        {value}
      </span>
    </div>
  );
}

function formatCount(n: number): string {
  return n.toLocaleString('en-US');
}

function formatTime(date: Date, locale: Locale): string {
  return new Intl.DateTimeFormat(locale, {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).format(date);
}

export function BottomStatusBar({
  locale,
  onOpenDiagnostics,
  onToggleLocale,
}: BottomStatusBarProps) {
  const stream = useEegStore((s) => s.stream);
  const hardwareConfig = useEegStore((s) => s.acquisition.hardwareConfig);
  const diagnosticsCount = useEegStore((s) => s.diagnostics.length);
  const [now, setNow] = useState<Date>(() => new Date());

  useEffect(() => {
    const id = window.setInterval(() => setNow(new Date()), 1000);
    return () => window.clearInterval(id);
  }, []);

  const issuePackets = stream.invalidPacketCount + stream.droppedPacketCount;
  const totalPackets = stream.packetCount + issuePackets;
  const dropRate = totalPackets > 0 ? (issuePackets / totalPackets) * 100 : 0;

  const csvOn = stream.writesRawCsv && stream.outputFileReady && !stream.writeError;
  const csvDisplay = stream.writeError
    ? t(locale, 'statusBar.csvErr')
    : csvOn
      ? t(locale, 'statusBar.csvOn')
      : t(locale, 'statusBar.csvOff');
  const csvTone: SegmentTone = stream.writeError ? 'error' : csvOn ? 'success' : 'meta';

  const pktTone: SegmentTone = stream.isStreaming ? 'default' : 'meta';
  const dropTone: SegmentTone = dropRate > 1 ? 'warn' : stream.isStreaming ? 'default' : 'meta';
  const sampleRateHz = getEffectiveEegHardwareSampleRateHz(hardwareConfig);

  return (
    <footer className="fixed bottom-0 inset-x-0 z-30 bg-card border-t border-hairline">
      <div className="mx-auto flex h-10 max-w-[80rem] items-stretch px-5">
        <div className="flex flex-1 items-stretch divide-x divide-hairline overflow-x-auto">
          <Segment
            label={t(locale, 'statusBar.srLabel')}
            value={`${sampleRateHz} HZ`}
            tone="meta"
          />
          <Segment
            label={t(locale, 'statusBar.pktLabel')}
            value={formatCount(stream.packetCount)}
            tone={pktTone}
          />
          <Segment
            label={t(locale, 'statusBar.dropLabel')}
            value={`${dropRate.toFixed(2)}%`}
            tone={dropTone}
          />
          <Segment
            label={t(locale, 'statusBar.csvLabel')}
            value={csvDisplay}
            tone={csvTone}
          />
          <Segment
            label={t(locale, 'statusBar.timeLabel')}
            value={formatTime(now, locale)}
            tone="meta"
          />
        </div>
        <div className="flex items-center gap-3 pl-4 border-l border-hairline">
          <a
            href="https://github.com/freebci"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 rounded-sm px-2 h-7 font-mono text-[0.7rem] text-accent hover:text-accent/80 hover:bg-surface-2 transition-colors"
          >
            <ExternalLink size={13} strokeWidth={1.5} />
            The FreeBCI Project
          </a>
          <button
            type="button"
            onClick={onOpenDiagnostics}
            className="inline-flex items-center gap-1.5 rounded-sm border border-hairline bg-card px-2.5 h-7 font-mono text-[0.7rem] uppercase tracking-[0.08em] text-meta hover:text-ink hover:border-meta hover:bg-surface-2 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent"
          >
            <ScrollText size={12} strokeWidth={1.5} />
            {t(locale, 'statusRail.logLabel')}
            {diagnosticsCount > 0 && (
              <span className="font-mono tabular text-[0.65rem] text-accent">
                {diagnosticsCount}
              </span>
            )}
          </button>
          <LanguageToggle locale={locale} onToggle={onToggleLocale} />
        </div>
      </div>
    </footer>
  );
}
