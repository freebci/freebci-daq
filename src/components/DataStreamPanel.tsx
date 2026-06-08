import type { FormEvent } from 'react';
import { useEffect, useRef, useState } from 'react';
import { Activity, CircleStop, Database, FileDown, Play } from 'lucide-react';
import type { Locale, TranslationKey } from '../i18n';
import { t } from '../i18n';
import { useAiStore } from '../store/aiStore';
import { useEegStore } from '../store/eegStore';
import type { StartEegStreamInput } from '../types/acquisition';
import {
  Button,
  Card,
  CardBody,
  CardHeader,
  StatusDot,
  ToggleSwitch,
} from './ui';

interface DataStreamPanelProps {
  locale: Locale;
  onSelectOutputFile: () => Promise<void>;
  onStartStream: (input: StartEegStreamInput) => Promise<void>;
  onStopStream: () => void | Promise<void>;
}

function formatDateTime(timestamp: string | null, locale: Locale): string {
  if (!timestamp) return '—';
  return new Intl.DateTimeFormat(locale, {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).format(new Date(timestamp));
}

interface FactProps {
  label: string;
  value: React.ReactNode;
  mono?: boolean;
  align?: 'left' | 'right';
  tone?: 'default' | 'warn' | 'error' | 'success';
}

const FACT_TONE_CLASS = {
  default: 'text-ink',
  warn: 'text-warn',
  error: 'text-error',
  success: 'text-success',
} as const;

function Fact({ label, value, mono = true, align = 'left', tone = 'default' }: FactProps) {
  return (
    <div
      className={`min-w-0 flex flex-col gap-1 rounded-sm border border-hairline bg-paper px-3 py-2.5 ${align === 'right' ? 'text-right' : ''}`}
    >
      <span className="font-mono text-[0.65rem] font-medium uppercase tracking-[0.08em] text-meta">
        {label}
      </span>
      <span
        className={`text-[0.9rem] break-words ${FACT_TONE_CLASS[tone]} ${mono ? 'font-mono tabular' : ''}`}
      >
        {value}
      </span>
    </div>
  );
}

interface StreamBadgeProps {
  icon: React.ReactNode;
  label: string;
  value: React.ReactNode;
}

function StreamBadge({ icon, label, value }: StreamBadgeProps) {
  return (
    <div className="flex min-w-0 items-center gap-2 rounded-sm border border-hairline bg-card px-3 py-2">
      <span className="shrink-0 text-accent">{icon}</span>
      <span className="min-w-0">
        <span className="block font-mono text-[0.62rem] font-medium uppercase tracking-[0.08em] text-meta">
          {label}
        </span>
        <span className="block truncate font-mono text-[0.82rem] text-ink tabular">{value}</span>
      </span>
    </div>
  );
}

export function DataStreamPanel({
  locale,
  onSelectOutputFile,
  onStartStream,
  onStopStream,
}: DataStreamPanelProps) {
  const [writeRawCsv, setWriteRawCsv] = useState(true);
  const [recordFiveBandFeatures, setRecordFiveBandFeatures] = useState(true);
  const isAiRecording = useAiStore((state) => state.isRecording);
  const isAiReadOnly = useAiStore((state) => state.isReadOnly);
  const isSiteBindingLocked = useAiStore((state) => state.isSiteBindingLocked);
  const wasStreamBusyRef = useRef(false);
  const status = useEegStore((state) => state.status);
  const stream = useEegStore((state) => state.stream);
  const isStreamBusy = stream.isStarting || stream.isStreaming;
  const fiveBandRecordingEnabled = !isAiReadOnly && recordFiveBandFeatures;
  const canStart =
    status === 'ready' &&
    !isStreamBusy &&
    isSiteBindingLocked &&
    (!writeRawCsv || stream.outputFileReady);
  const canSelectFile = writeRawCsv && !isStreamBusy;
  let startBlockMessageKey: TranslationKey | null = null;
  if (!isStreamBusy && status !== 'ready') {
    startBlockMessageKey = 'stream.startBlockedNotReady';
  } else if (!isStreamBusy && !isSiteBindingLocked) {
    startBlockMessageKey = 'stream.startBlockedBinding';
  } else if (!isStreamBusy && writeRawCsv && !stream.outputFileReady) {
    startBlockMessageKey = 'stream.startBlockedFile';
  }

  useEffect(() => {
    if (wasStreamBusyRef.current && !isStreamBusy) {
      setWriteRawCsv(false);
      setRecordFiveBandFeatures(false);
    }
    wasStreamBusyRef.current = isStreamBusy;
  }, [isStreamBusy]);

  function handleSubmit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    if (!canStart) return;
    void onStartStream({
      writeRawCsv,
      recordFiveBandFeatures: fiveBandRecordingEnabled,
    });
  }

  const streamStateLabel = stream.isStalled
    ? t(locale, 'stream.stateStalled')
    : stream.isStarting
    ? t(locale, 'stream.stateStarting')
    : stream.isStreaming
      ? t(locale, 'stream.stateStreaming')
      : t(locale, 'stream.stateIdle');
  const streamTone: 'idle' | 'active' | 'success' | 'warn' = stream.isStalled
    ? 'warn'
    : stream.isStreaming
      ? 'success'
      : stream.isStarting
        ? 'active'
        : 'idle';
  const controlsGridClass = 'grid grid-cols-1 gap-4 sm:grid-cols-2';

  return (
    <Card ariaLabelledBy="stream-title">
      <CardHeader
        eyebrow={t(locale, 'stream.eyebrow')}
        title={t(locale, 'stream.title')}
        titleId="stream-title"
        trailing={<StatusDot tone={streamTone} label={streamStateLabel} pulse={streamTone === 'active'} />}
      />
      <CardBody className="flex flex-col gap-6">
        <div className="grid gap-3 rounded-sm border border-hairline bg-surface-2 p-3 md:grid-cols-2">
          <StreamBadge
            icon={<Activity size={15} strokeWidth={1.5} />}
            label={t(locale, 'stream.state')}
            value={streamStateLabel}
          />
          <StreamBadge
            icon={<Database size={15} strokeWidth={1.5} />}
            label={t(locale, 'stream.rawCsvMode')}
            value={
              stream.writesRawCsv || writeRawCsv
                ? t(locale, 'stream.rawCsvEnabled')
                : t(locale, 'stream.rawCsvDisabled')
            }
          />
        </div>

        <form className="flex flex-col gap-5" onSubmit={handleSubmit}>
          <div className={controlsGridClass}>
            <ToggleSwitch
              id="write-raw-csv"
              label={t(locale, 'stream.writeRawCsvLabel')}
              checked={writeRawCsv}
              onCheckedChange={setWriteRawCsv}
              disabled={isStreamBusy}
              className="mb-1"
            />
            <ToggleSwitch
              id="five-band-ai-recording"
              label={t(locale, 'ai.recordingLabel')}
              checked={isStreamBusy ? isAiRecording : fiveBandRecordingEnabled}
              onCheckedChange={setRecordFiveBandFeatures}
              disabled={isStreamBusy || isAiReadOnly}
              className="mb-1"
            />
          </div>

          <div className="flex flex-wrap gap-2 border-t border-hairline pt-4">
            <Button variant="ghost" onClick={() => void onSelectOutputFile()} disabled={!canSelectFile}>
              <FileDown size={14} strokeWidth={1.5} />
              {t(locale, 'stream.selectFile')}
            </Button>
            <Button type="submit" disabled={!canStart}>
              <Play size={14} strokeWidth={1.5} />
              {stream.isStarting ? t(locale, 'stream.starting') : t(locale, 'stream.start')}
            </Button>
            <Button variant="ghost" onClick={() => void onStopStream()} disabled={!isStreamBusy}>
              <CircleStop size={14} strokeWidth={1.5} />
              {t(locale, 'stream.stop')}
            </Button>
          </div>

          {startBlockMessageKey && (
            <p className="m-0 rounded-sm border border-warn/25 bg-warn/[0.04] px-3 py-2 text-[0.8rem] text-warn">
              {t(locale, startBlockMessageKey)}
            </p>
          )}
        </form>

        <p className="m-0 text-[0.8rem] text-meta leading-relaxed">
          {t(locale, 'stream.serialHelp')}
        </p>

        <dl className="grid grid-cols-2 gap-3 border-t border-hairline pt-5 sm:grid-cols-3 lg:grid-cols-4">
          <Fact
            label={t(locale, 'stream.selectFile')}
            value={stream.outputFileName ?? t(locale, 'stream.noFile')}
          />
          <Fact
            label={t(locale, 'stream.fileReady')}
            value={
              stream.outputFileReady
                ? t(locale, 'stream.fileReady')
                : t(locale, 'stream.fileClosed')
            }
            mono={false}
          />
          <Fact
            label={t(locale, 'stream.source')}
            value={stream.sourceLabel ?? '—'}
          />
          <Fact label={t(locale, 'stream.startedAt')} value={formatDateTime(stream.startedAt, locale)} />
          <Fact label={t(locale, 'stream.packets')} value={stream.packetCount} tone={stream.isStreaming ? 'success' : 'default'} />
          <Fact label={t(locale, 'stream.batches')} value={stream.batchCount} />
          <Fact label={t(locale, 'stream.samples')} value={stream.sampleCount} />
          <Fact
            label={t(locale, 'stream.invalidPackets')}
            value={`${stream.invalidPacketCount}/${stream.droppedPacketCount}`}
            tone={stream.invalidPacketCount + stream.droppedPacketCount > 0 ? 'warn' : 'default'}
          />
          <Fact
            label={t(locale, 'stream.lastPacketSeq')}
            value={stream.lastPacketSeq ?? '—'}
          />
        </dl>

        {stream.writeError && (
          <div className="flex flex-col gap-1 rounded-sm border border-error/30 bg-error/[0.03] px-4 py-3">
            <strong className="font-mono text-[0.65rem] font-medium uppercase tracking-[0.08em] text-error">
              {t(locale, 'stream.writeError')}
            </strong>
            <code className="font-mono text-[0.8rem] text-error break-all">{stream.writeError}</code>
          </div>
        )}
      </CardBody>
    </Card>
  );
}
