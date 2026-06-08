import { useEffect, useState } from 'react';
import { AlgorithmTrendPanel } from './components/AlgorithmTrendPanel';
import { AiAnalysisSidebar, AiSessionPanel, AiSiteBindingPanel } from './components/AiAgentPanel';
import { BottomStatusBar } from './components/BottomStatusBar';
import { BrainHeatmapPanel } from './components/BrainHeatmapPanel';
import { ConnectionPanel } from './components/ConnectionPanel';
import { DataStreamPanel } from './components/DataStreamPanel';
import { DiagnosticsPanel } from './components/DiagnosticsPanel';
import { ErrorBanner } from './components/ErrorBanner';
import { FilteredWaveformPanel } from './components/FilteredWaveformPanel';
import { FiveBandFeaturePanel } from './components/FiveBandFeaturePanel';
import { FilterControlsPanel } from './components/FilterControlsPanel';
import { FocusStatePanel } from './components/FocusStatePanel';
import { HardwareConfigPanel } from './components/HardwareConfigPanel';
import { LiveWindowControlPanel } from './components/LiveWindowControlPanel';
import { RawWaveformPanel } from './components/RawWaveformPanel';
import { SpectrumComparePanel } from './components/SpectrumComparePanel';
import { SystemPanel } from './components/SystemPanel';
import { StatusDot } from './components/ui';
import { WorkspaceShell } from './components/WorkspaceShell';
import { useAcquisitionActions } from './hooks/useAcquisitionActions';
import { DEFAULT_LOCALE, type Locale, t } from './i18n';
import { useEegStore } from './store/eegStore';
import type { AcquisitionStatus } from './types/acquisition';
import { formatModeBadge } from './utils/acquisitionUi';

type StatusTone = 'idle' | 'active' | 'success' | 'warn' | 'error';

function acquisitionStatusTone(status: AcquisitionStatus, isStreaming: boolean): StatusTone {
  if (isStreaming) return 'active';
  switch (status) {
    case 'ready':
      return 'success';
    case 'requesting-device':
    case 'connecting':
      return 'active';
    case 'error':
      return 'error';
    case 'disconnected':
      return 'warn';
    default:
      return 'idle';
  }
}

function App() {
  const [locale, setLocale] = useState<Locale>(DEFAULT_LOCALE);
  const [diagnosticsOpen, setDiagnosticsOpen] = useState(false);
  const status = useEegStore((state) => state.status);
  const isStreaming = useEegStore((state) => state.stream.isStreaming || state.stream.isStarting);
  const {
    init,
    connectSelectedDevice,
    disconnect,
    selectOutputFile,
    startEegStream,
    stopEegStream,
    forgetSelectedDevice,
  } = useAcquisitionActions(locale);

  useEffect(() => {
    void init();
  }, [init]);

  useEffect(() => {
    document.documentElement.lang = locale;
    document.title = t(locale, 'app.title');
  }, [locale]);

  function toggleLocale(): void {
    setLocale((currentLocale) => (currentLocale === 'zh-CN' ? 'en-US' : 'zh-CN'));
  }

  async function handleBeginBindingEdit(): Promise<void> {
    if (!['idle', 'disconnected', 'error'].includes(status)) {
      await disconnect();
    }
    useEegStore.getState().resetStreamRuntime();
  }

  const tone = acquisitionStatusTone(status, isStreaming);
  const modeBadge = formatModeBadge(status, isStreaming, locale);
  const stateLabel = t(locale, 'statusRail.stateLabel');

  return (
    <div className="min-h-screen bg-paper text-ink">
      <header className="sticky top-0 z-30 border-b border-hairline bg-card">
        <div className="mx-auto flex h-10 max-w-[80rem] items-stretch px-5">
          <div className="flex items-center gap-3 pr-5 border-r border-hairline">
            <span className="text-[0.85rem] font-medium tracking-tight text-ink">
              {t(locale, 'masthead.brand')}
            </span>
            <span className="font-mono text-[0.65rem] uppercase tracking-[0.08em] text-meta">
              {t(locale, 'masthead.edition')}
            </span>
          </div>

          <div
            className="flex items-center gap-2.5 px-5"
            aria-label={t(locale, 'app.statusAria')}
          >
            <span className="font-mono text-[0.65rem] uppercase tracking-[0.08em] text-meta">
              {stateLabel}
            </span>
            <StatusDot tone={tone} pulse={tone === 'active'} />
            <span className="font-mono text-[0.78rem] tabular tracking-tight text-ink">
              {modeBadge}
            </span>
          </div>
        </div>
      </header>

      <WorkspaceShell locale={locale} statusTone={tone} modeBadge={modeBadge}>
        {(activePage) => (
          <>
            {activePage === 'setup' && (
              <>
                {!isStreaming && <HardwareConfigPanel locale={locale} />}

                {!isStreaming && (
                  <section>
                    <ConnectionPanel
                      locale={locale}
                      onConnectDevice={connectSelectedDevice}
                      onDisconnect={disconnect}
                      onForgetDevice={forgetSelectedDevice}
                    />
                  </section>
                )}

                <AiSiteBindingPanel
                  locale={locale}
                  onBeginBindingEdit={handleBeginBindingEdit}
                />
                <FilterControlsPanel locale={locale} />
                <DataStreamPanel
                  locale={locale}
                  onSelectOutputFile={selectOutputFile}
                  onStartStream={startEegStream}
                  onStopStream={stopEegStream}
                />
              </>
            )}

            {activePage === 'live' && (
              <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_22rem]">
                <div className="flex min-w-0 flex-col gap-4">
                  <LiveWindowControlPanel locale={locale} />
                  <BrainHeatmapPanel locale={locale} />
                  <FiveBandFeaturePanel locale={locale} />
                  <div className="grid gap-4">
                    <RawWaveformPanel locale={locale} />
                    <FilteredWaveformPanel locale={locale} />
                  </div>
                  <SpectrumComparePanel locale={locale} />
                </div>
                <AiAnalysisSidebar
                  locale={locale}
                  className="xl:sticky xl:top-14 xl:max-h-[calc(100vh-4.5rem)] xl:overflow-y-auto xl:self-start"
                />
              </div>
            )}

            {activePage === 'analysis' && (
              <>
                <AlgorithmTrendPanel locale={locale} />
                <FocusStatePanel locale={locale} />
              </>
            )}

            {activePage === 'sessions' && <AiSessionPanel locale={locale} />}

            {activePage === 'system' && <SystemPanel locale={locale} />}
          </>
        )}
      </WorkspaceShell>

      <ErrorBanner locale={locale} />

      <DiagnosticsPanel
        locale={locale}
        isOpen={diagnosticsOpen}
        onClose={() => setDiagnosticsOpen(false)}
      />

      <BottomStatusBar
        locale={locale}
        onOpenDiagnostics={() => setDiagnosticsOpen(true)}
        onToggleLocale={toggleLocale}
      />
    </div>
  );
}

export default App;
