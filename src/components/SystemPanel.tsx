import { AiModelSettingsPanel } from './AiAgentPanel';
import type { Locale } from '../i18n';
import { t } from '../i18n';
import { useAiStore } from '../store/aiStore';
import { useEegStore } from '../store/eegStore';
import { Card, CardBody, CardHeader } from './ui';

interface SystemPanelProps {
  locale: Locale;
}

export function SystemPanel({ locale }: SystemPanelProps) {
  const isSupported = useEegStore((state) => state.isSupported);
  const isSerialSupported = useEegStore((state) => state.isSerialSupported);
  const diagnostics = useEegStore((state) => state.diagnostics);
  const stream = useEegStore((state) => state.stream);
  const acquisition = useEegStore((state) => state.acquisition);
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
    acquisition: {
      baudRate: acquisition.baudRate,
      hardwareConfig: acquisition.hardwareConfig,
      channelCount: acquisition.channelCount,
      hardwareConfigLocked: acquisition.hardwareConfigLocked,
    },
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
