import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@radix-ui/react-collapsible';
import { useEffect, useState } from 'react';
import { ChevronDown } from 'lucide-react';
import { AiModelSettingsPanel } from './AiAgentPanel';
import type { Locale } from '../i18n';
import { t } from '../i18n';
import { useAiStore } from '../store/aiStore';
import { useEegStore } from '../store/eegStore';
import {
  type TuningKey,
  clearAllTuning,
  getTuningValue,
  writeTuningValues,
} from '../utils/tuningStorage';
import { Button, Card, CardBody, CardHeader, NumberInput } from './ui';

interface SystemPanelProps {
  locale: Locale;
}

interface TuningField {
  key: TuningKey;
  label: string;
  envVar: string;
  defaultVal: number;
  min: number;
  max: number;
  step: number;
}

const TUNING_FIELDS: TuningField[] = [
  {
    key: 'eeg-ema-alpha',
    label: 'EMA Alpha',
    envVar: 'VITE_EMA_ALPHA',
    defaultVal: 0.1,
    min: 0.01,
    max: 1,
    step: 0.01,
  },
  {
    key: 'eeg-alert-threshold',
    label: 'Alert Threshold',
    envVar: 'VITE_ALERT_THRESHOLD',
    defaultVal: 0.3,
    min: 0,
    max: 10,
    step: 0.05,
  },
  {
    key: 'eeg-initial-unreliable',
    label: 'Initial Unreliable (s)',
    envVar: 'VITE_INITIAL_UNRELIABLE',
    defaultVal: 30,
    min: 10,
    max: 120,
    step: 5,
  },
  {
    key: 'focus-baseline',
    label: 'Focus Baseline (s)',
    envVar: 'VITE_FOCUS_BASELINE',
    defaultVal: 15,
    min: 5,
    max: 300,
    step: 5,
  },
  {
    key: 'focus-decision',
    label: 'Focus Decision (s)',
    envVar: 'VITE_FOCUS_DECISION',
    defaultVal: 15,
    min: 5,
    max: 300,
    step: 5,
  },
  {
    key: 'focus-warmup',
    label: 'Focus Warmup (s)',
    envVar: 'VITE_FOCUS_WARMUP',
    defaultVal: 30,
    min: 10,
    max: 120,
    step: 5,
  },
];

function getEffectiveValue(field: TuningField): number {
  return getTuningValue(field.key) ?? field.defaultVal;
}

export function SystemPanel({ locale }: SystemPanelProps) {
  const isSupported = useEegStore((state) => state.isSupported);
  const isSerialSupported = useEegStore((state) => state.isSerialSupported);
  const diagnostics = useEegStore((state) => state.diagnostics);
  const stream = useEegStore((state) => state.stream);
  const analysis = useEegStore((state) => state.analysis);
  const aiState = useAiStore((state) => ({
    conversationId: state.conversationId,
    status: state.status,
    isRecording: state.isRecording,
    isReadOnly: state.isReadOnly,
    frameCount: state.frameCount,
    dataDirectoryLabel: state.dataDirectoryLabel,
    pendingWriteCount: state.pendingWriteCount,
    writeTimeoutCount: state.writeTimeoutCount,
    binding: state.binding,
    modelConfig: {
      ...state.modelConfig,
      apiKey: state.modelConfig.apiKey ? '<redacted>' : '',
    },
  }));
  const protocolDebug = {
    stream: {
      isStreaming: stream.isStreaming,
      writesRawCsv: stream.writesRawCsv,
      sourceLabel: stream.sourceLabel,
      batchCount: stream.batchCount,
      sampleCount: stream.sampleCount,
      invalidPacketCount: stream.invalidPacketCount,
      droppedPacketCount: stream.droppedPacketCount,
      droppedSampleCount: stream.droppedSampleCount,
    },
    analysis: {
      selectedFilterId: analysis.selectedFilterId,
      filterParams: analysis.filterParams,
      fftSize: analysis.fftSize,
      updatedAt: analysis.updatedAt,
      hasSpectrum: analysis.spectrum !== null,
      bandPowers: analysis.bandPowers,
    },
    ai: aiState,
  };

  const [tuningOpen, setTuningOpen] = useState(false);
  const [tuningDrafts, setTuningDrafts] = useState<Partial<Record<TuningKey, string>>>({});

  useEffect(() => {
    const drafts: Partial<Record<TuningKey, string>> = {};
    for (const field of TUNING_FIELDS) {
      drafts[field.key] = String(getEffectiveValue(field));
    }
    setTuningDrafts(drafts);
  }, [tuningOpen]);

  function handleTuningChange(key: TuningKey, raw: string) {
    setTuningDrafts((prev) => ({ ...prev, [key]: raw }));
  }

  function handleApplyTuning() {
    const values: Partial<Record<TuningKey, number>> = {};
    for (const field of TUNING_FIELDS) {
      const raw = tuningDrafts[field.key];
      if (raw !== undefined) {
        const parsed = Number(raw);
        if (Number.isFinite(parsed)) {
          const clamped = Math.max(field.min, Math.min(field.max, parsed));
          values[field.key] = clamped;
        }
      }
    }

    writeTuningValues(values);
    window.location.reload();
  }

  function handleResetTuning() {
    clearAllTuning();
    window.location.reload();
  }

  return (
    <div className="grid gap-4">
      <div className="grid gap-4">
        <Card ariaLabelledBy="system-env-title">
          <CardHeader
            eyebrow={t(locale, 'system.eyebrow')}
            title={t(locale, 'system.environment')}
            titleId="system-env-title"
          />
          <CardBody>
            <dl className="grid gap-4 sm:grid-cols-2">
              <div>
                <dt className="font-mono text-[0.65rem] uppercase tracking-[0.08em] text-meta">
                  {t(locale, 'system.webSerial')}
                </dt>
                <dd className="m-0 pt-1 font-mono text-[0.8rem] text-ink">
                  {isSupported ? t(locale, 'status.supported') : t(locale, 'status.notSupported')}
                </dd>
              </div>
              <div>
                <dt className="font-mono text-[0.65rem] uppercase tracking-[0.08em] text-meta">
                  {t(locale, 'system.serialRuntime')}
                </dt>
                <dd className="m-0 pt-1 font-mono text-[0.8rem] text-ink">
                  {isSerialSupported ? t(locale, 'status.supported') : t(locale, 'status.notSupported')}
                </dd>
              </div>
            </dl>
          </CardBody>
        </Card>
      </div>

      <AiModelSettingsPanel locale={locale} />

      <Card ariaLabelledBy="system-tuning-title">
        <Collapsible open={tuningOpen} onOpenChange={setTuningOpen}>
          <CardHeader
            eyebrow={t(locale, 'system.eyebrow')}
            title={t(locale, 'system.advancedTuning')}
            titleId="system-tuning-title"
            trailing={
              <CollapsibleTrigger asChild>
                <button
                  type="button"
                  className="inline-flex h-7 w-7 items-center justify-center rounded-sm border border-hairline text-meta hover:text-ink hover:bg-surface-2"
                >
                  <ChevronDown
                    size={14}
                    strokeWidth={1.5}
                    className={`transition-transform ${tuningOpen ? 'rotate-180' : ''}`}
                  />
                </button>
              </CollapsibleTrigger>
            }
          />
          <CollapsibleContent>
            <CardBody>
              <p className="m-0 mb-4 text-[0.82rem] text-meta">
                {t(locale, 'system.advancedTuningHint')}
              </p>
              <div className="grid gap-3 sm:grid-cols-2">
                {TUNING_FIELDS.map((field) => (
                  <div key={field.key}>
                    <label className="mb-1 block font-mono text-[0.65rem] uppercase tracking-[0.08em] text-meta">
                      {field.label} ({field.envVar})
                    </label>
                    <NumberInput
                      value={tuningDrafts[field.key] ?? ''}
                      min={field.min}
                      max={field.max}
                      step={field.step}
                      onChange={(e) => handleTuningChange(field.key, e.currentTarget.value)}
                    />
                  </div>
                ))}
              </div>
              <div className="mt-4 flex flex-wrap gap-2">
                <Button size="sm" variant="primary" onClick={handleApplyTuning}>
                  {t(locale, 'system.advancedTuningApply')}
                </Button>
                <Button size="sm" variant="ghost" onClick={handleResetTuning}>
                  Reset to Defaults
                </Button>
              </div>
            </CardBody>
          </CollapsibleContent>
        </Collapsible>
      </Card>

      <div className="grid gap-4 xl:grid-cols-2">
        <Card ariaLabelledBy="system-diagnostics-title">
          <CardHeader
            eyebrow={t(locale, 'system.eyebrow')}
            title={t(locale, 'system.diagnostics')}
            titleId="system-diagnostics-title"
          />
          <CardBody>
            {diagnostics.length === 0 ? (
              <p className="m-0 text-[0.82rem] text-meta">{t(locale, 'system.noDiagnostics')}</p>
            ) : (
              <ol className="m-0 flex max-h-96 flex-col gap-2 overflow-auto pl-4 text-[0.78rem] text-meta">
                {diagnostics.map((entry) => (
                  <li key={entry.id}>
                    <span className="font-medium text-ink">{entry.phase}</span> · {entry.status} ·{' '}
                    {entry.message}
                    {entry.detail && (
                      <pre className="mt-1 overflow-auto rounded-sm border border-hairline bg-paper p-2 text-[0.68rem] text-ink">
                        {entry.detail}
                      </pre>
                    )}
                  </li>
                ))}
              </ol>
            )}
          </CardBody>
        </Card>

        <Card ariaLabelledBy="system-debug-title">
          <CardHeader
            eyebrow={t(locale, 'system.eyebrow')}
            title={t(locale, 'system.protocolDebug')}
            titleId="system-debug-title"
          />
          <CardBody>
            <pre className="max-h-96 overflow-auto rounded-sm border border-hairline bg-paper p-3 text-[0.68rem] leading-relaxed text-ink">
              {JSON.stringify(protocolDebug, null, 2)}
            </pre>
          </CardBody>
        </Card>
      </div>
    </div>
  );
}
