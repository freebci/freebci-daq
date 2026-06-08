import { useEffect, useMemo, useRef, useState, type ChangeEvent } from 'react';
import { AlertTriangle, Bot, CheckCircle2, Download, FileUp, Plus, PlugZap, RefreshCcw, X } from 'lucide-react';
import {
  deleteStoredAiConversation,
  downloadAiBundle,
  exportActiveAiConversation,
  initializeAiConversation,
  restoreAiConversationFromBundle,
  switchAiConversation,
  updateAiSiteBindings,
} from '../ai/conversationRuntime';
import { runStructuredAiAnalysis } from '../ai/agentPipeline';
import { createRequestModelConfig } from '../ai/modelConfig';
import {
  testLanguageModelConnection,
  type AiModelConnectionTestResult,
} from '../ai/modelProvider';
import { resolveAiQuestionTimeRange } from '../ai/questionIntent';
import {
  AI_PROVIDER_PRESETS,
  CUSTOM_PRESET_VALUE,
  TEMPERATURE_PRESETS,
  getProviderPreset,
  type AiProviderPresetId,
  type LocalizedOption,
  type TemperaturePresetId,
} from '../ai/modelPresets';
import { PLACEMENT_SYSTEM_OPTIONS, getSiteOptions } from '../ai/sitePresets';
import type { AiAnalysisOutputV1, SiteBindingV1 } from '../ai/protocol';
import type { Locale } from '../i18n';
import { t } from '../i18n';
import {
  createBindingForConversation,
  useAiStore,
} from '../store/aiStore';
import { useEegStore } from '../store/eegStore';
import { Button, Card, CardBody, CardHeader, Checkbox, Field, TextInput } from './ui';

interface LocaleProps {
  locale: Locale;
}

interface AiSiteBindingPanelProps extends LocaleProps {
  onBeginBindingEdit?: () => Promise<void> | void;
}

interface ClassNameProps {
  className?: string;
}

const SELECT_CLASS =
  'w-full rounded-sm border border-hairline bg-surface-2 px-3 py-2 font-mono text-[0.88rem] text-ink focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent focus-visible:border-accent disabled:bg-paper disabled:text-meta';

function optionLabel(locale: Locale, option: LocalizedOption): string {
  return locale === 'zh-CN' ? option.labelZh : option.labelEn;
}

function withCurrentOption(
  options: readonly LocalizedOption[],
  currentValue: string,
  labelPrefix: string,
): readonly LocalizedOption[] {
  if (!currentValue || options.some((option) => option.value === currentValue)) return options;
  return [
    {
      value: currentValue,
      labelZh: `${labelPrefix}: ${currentValue}`,
      labelEn: `${labelPrefix}: ${currentValue}`,
    },
    ...options,
  ];
}

function getFirstConcreteOptionValue(options: readonly LocalizedOption[]): string {
  return options.find((option) => option.value !== CUSTOM_PRESET_VALUE)?.value ?? '';
}

function getConcreteOptions(options: readonly LocalizedOption[]): readonly LocalizedOption[] {
  return options.filter((option) => option.value !== CUSTOM_PRESET_VALUE);
}

function normalizeBindingDrafts(
  bindings: readonly SiteBindingV1[],
  conversationId: string,
  placementSystem: string,
): SiteBindingV1[] {
  const fallbackBindings =
    bindings.length > 0
      ? bindings
      : [createBindingForConversation(conversationId, CUSTOM_PRESET_VALUE, placementSystem)];

  return fallbackBindings.map((binding, index) => {
    const channelName = `ch${index}`;
    return {
      ...binding,
      conversationId,
      bindingId: `binding-${channelName}`,
      channelName,
      placementSystem,
      siteName: binding.siteName.trim() || CUSTOM_PRESET_VALUE,
    };
  });
}

function parseAnalysisOutput(json: string | null): AiAnalysisOutputV1 | null {
  if (!json) return null;
  try {
    return JSON.parse(json) as AiAnalysisOutputV1;
  } catch {
    return null;
  }
}

type ModelTestStatus = 'idle' | 'testing' | 'success' | 'error';

function AiModelSettingsFields({ locale }: LocaleProps) {
  const config = useAiStore((state) => state.modelConfig);
  const setModelConfig = useAiStore((state) => state.setModelConfig);
  const [testStatus, setTestStatus] = useState<ModelTestStatus>('idle');
  const [testResult, setTestResult] = useState<AiModelConnectionTestResult | null>(null);
  const providerPreset = getProviderPreset(config.providerPresetId);
  const concreteBaseUrlOptions = getConcreteOptions(providerPreset.baseUrls);
  const concreteModelOptions = getConcreteOptions(providerPreset.models);

  useEffect(() => {
    setTestStatus('idle');
    setTestResult(null);
  }, [
    config.apiKey,
    config.baseURL,
    config.enableStreaming,
    config.modelId,
    config.providerPresetId,
    config.temperaturePresetId,
  ]);

  function handleProviderPresetChange(value: string): void {
    const nextPreset = getProviderPreset(value);
    setModelConfig({
      providerPresetId: nextPreset.id as AiProviderPresetId,
      baseURL: getFirstConcreteOptionValue(nextPreset.baseUrls),
      customBaseURL: '',
      modelId: getFirstConcreteOptionValue(nextPreset.models),
      customModelId: '',
    });
  }

  async function handleTestModel(): Promise<void> {
    const requestConfig = createRequestModelConfig(config);
    if (!requestConfig) {
      setTestStatus('error');
      setTestResult({
        status: 'error',
        latencyMs: 0,
        providerName: providerPreset.providerName,
        modelId: config.modelId.trim(),
        sampleText: null,
        errorMessage: t(locale, 'ai.testMissingConfig'),
      });
      return;
    }

    setTestStatus('testing');
    setTestResult(null);
    const result = await testLanguageModelConnection(requestConfig);
    setTestResult(result);
    setTestStatus(result.status);
  }

  const testMessage =
    testResult?.status === 'success'
      ? t(locale, 'ai.testSuccess', {
          latencyMs: testResult.latencyMs,
          sampleText: testResult.sampleText ?? 'OK',
        })
      : testResult?.status === 'error'
        ? testResult.latencyMs > 0
          ? t(locale, 'ai.testFailed', {
              latencyMs: testResult.latencyMs,
              message: testResult.errorMessage ?? '',
            })
          : testResult.errorMessage
        : null;

  return (
    <div className="flex flex-col gap-4">
      <div className="grid gap-4 lg:grid-cols-2">
        <Field label={t(locale, 'ai.providerLabel')} htmlFor="ai-provider-preset">
          <select
            id="ai-provider-preset"
            value={config.providerPresetId}
            onChange={(event) => handleProviderPresetChange(event.currentTarget.value)}
            className={SELECT_CLASS}
          >
            {AI_PROVIDER_PRESETS.map((preset) => (
              <option key={preset.id} value={preset.id}>
                {locale === 'zh-CN' ? preset.labelZh : preset.labelEn}
              </option>
            ))}
          </select>
        </Field>
        <Field label={t(locale, 'ai.temperatureLabel')} htmlFor="ai-temperature">
          <select
            id="ai-temperature"
            value={config.temperaturePresetId}
            onChange={(event) =>
              setModelConfig({
                temperaturePresetId: event.currentTarget.value as TemperaturePresetId,
              })
            }
            className={SELECT_CLASS}
          >
            {TEMPERATURE_PRESETS.map((option) => (
              <option key={option.id} value={option.id}>
                {locale === 'zh-CN' ? option.labelZh : option.labelEn}
              </option>
            ))}
          </select>
        </Field>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Field label={t(locale, 'ai.baseUrlLabel')} htmlFor="ai-base-url">
          <TextInput
            id="ai-base-url"
            list="ai-base-url-options"
            value={config.baseURL}
            onChange={(event) => setModelConfig({ baseURL: event.currentTarget.value })}
            placeholder={t(locale, 'ai.baseUrlCustomPlaceholder')}
          />
          {concreteBaseUrlOptions.length > 0 && (
            <datalist id="ai-base-url-options">
              {concreteBaseUrlOptions.map((option) => (
                <option key={option.value} value={option.value} label={optionLabel(locale, option)} />
              ))}
            </datalist>
          )}
        </Field>
        <Field label={t(locale, 'ai.modelLabel')} htmlFor="ai-model-id">
          <TextInput
            id="ai-model-id"
            list="ai-model-options"
            value={config.modelId}
            onChange={(event) => setModelConfig({ modelId: event.currentTarget.value })}
            placeholder={t(locale, 'ai.modelCustomPlaceholder')}
          />
          {concreteModelOptions.length > 0 && (
            <datalist id="ai-model-options">
              {concreteModelOptions.map((option) => (
                <option key={option.value} value={option.value} label={optionLabel(locale, option)} />
              ))}
            </datalist>
          )}
        </Field>
      </div>

      <div className="grid gap-4 lg:grid-cols-[1fr_auto] lg:items-end">
        <Field label={t(locale, 'ai.apiKeyLabel')} htmlFor="ai-api-key">
          <TextInput
            id="ai-api-key"
            type="password"
            value={config.apiKey}
            onChange={(event) => setModelConfig({ apiKey: event.currentTarget.value })}
            placeholder={
              providerPreset.requiresApiKey
                ? t(locale, 'ai.apiKeyPlaceholder')
                : t(locale, 'ai.apiKeyOptionalPlaceholder')
            }
          />
        </Field>
        <Checkbox
          id="ai-enable-streaming"
          label={t(locale, 'ai.streamingLabel')}
          checked={config.enableStreaming}
          onChange={(event) => setModelConfig({ enableStreaming: event.currentTarget.checked })}
          className="pb-2"
        />
      </div>

      <div className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => void handleTestModel()}
            disabled={testStatus === 'testing'}
          >
            <PlugZap size={14} strokeWidth={1.5} />
            {testStatus === 'testing' ? t(locale, 'ai.testingModel') : t(locale, 'ai.testModel')}
          </Button>
          {testMessage && (
            <span
              className={`inline-flex min-w-0 items-center gap-1.5 text-[0.76rem] ${
                testStatus === 'success' ? 'text-success' : 'text-error'
              }`}
            >
              {testStatus === 'success' ? (
                <CheckCircle2 className="shrink-0" size={14} strokeWidth={1.5} />
              ) : (
                <AlertTriangle className="shrink-0" size={14} strokeWidth={1.5} />
              )}
              <span className="min-w-0 break-words">{testMessage}</span>
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

export function AiModelSettingsPanel({ locale }: LocaleProps) {
  return (
    <Card ariaLabelledBy="ai-model-settings-title">
      <CardHeader
        eyebrow={t(locale, 'ai.eyebrow')}
        title={t(locale, 'ai.modelSettingsTitle')}
        titleId="ai-model-settings-title"
      />
      <CardBody>
        <AiModelSettingsFields locale={locale} />
      </CardBody>
    </Card>
  );
}

export function AiSiteBindingPanel({ locale, onBeginBindingEdit }: AiSiteBindingPanelProps) {
  const isReadOnly = useAiStore((state) => state.isReadOnly);
  const isSiteBindingLocked = useAiStore((state) => state.isSiteBindingLocked);
  const frameCount = useAiStore((state) => state.frameCount);
  const setSiteBindingLocked = useAiStore((state) => state.setSiteBindingLocked);
  const setLastAnalysisResult = useAiStore((state) => state.setLastAnalysisResult);
  const conversationId = useAiStore((state) => state.conversationId);
  const bindings = useAiStore((state) => state.bindings);
  const setChannelCount = useEegStore((state) => state.setChannelCount);
  const [bindingDrafts, setBindingDrafts] = useState<SiteBindingV1[]>(bindings);
  const [isBindingBusy, setIsBindingBusy] = useState(false);
  const fallbackPlacementSystem = PLACEMENT_SYSTEM_OPTIONS[0]?.value ?? CUSTOM_PRESET_VALUE;
  const placementSystemDraft = bindingDrafts[0]?.placementSystem || fallbackPlacementSystem;
  const placementOptions = withCurrentOption(
    PLACEMENT_SYSTEM_OPTIONS,
    placementSystemDraft,
    locale === 'zh-CN' ? '当前系统' : 'Current system',
  );

  useEffect(() => {
    void initializeAiConversation();
  }, []);

  useEffect(() => {
    setBindingDrafts(
      normalizeBindingDrafts(
        bindings,
        conversationId,
        bindings[0]?.placementSystem || fallbackPlacementSystem,
      ),
    );
  }, [bindings, conversationId, fallbackPlacementSystem]);

  function replaceDrafts(nextBindings: SiteBindingV1[], placementSystem = placementSystemDraft): void {
    setBindingDrafts(normalizeBindingDrafts(nextBindings, conversationId, placementSystem));
  }

  function siteBelongsToPlacement(siteName: string, placementSystem: string): boolean {
    return getSiteOptions(placementSystem).some((option) => option.value === siteName);
  }

  function createDraftBinding(channelName: string, siteName = CUSTOM_PRESET_VALUE): SiteBindingV1 {
    return createBindingForConversation(conversationId, siteName, placementSystemDraft, channelName);
  }

  function nextChannelName(): string {
    return `ch${bindingDrafts.length}`;
  }

  function updateBinding(index: number, patch: Partial<SiteBindingV1>): void {
    const nextBindings = bindingDrafts.map((binding, bindingIndex) => {
      if (bindingIndex !== index) return binding;
      return {
        ...binding,
        ...patch,
        conversationId,
        placementSystem: placementSystemDraft,
      };
    });
    replaceDrafts(nextBindings);
  }

  function updatePlacementSystem(placementSystem: string): void {
    replaceDrafts(
      bindingDrafts.map((binding) => ({
        ...binding,
        conversationId,
        placementSystem,
        siteName: siteBelongsToPlacement(binding.siteName, placementSystem)
          ? binding.siteName
          : CUSTOM_PRESET_VALUE,
      })),
      placementSystem,
    );
  }

  function addBinding(): void {
    replaceDrafts([...bindingDrafts, createDraftBinding(nextChannelName())]);
  }

  function removeBinding(index: number): void {
    if (bindingDrafts.length <= 1) return;
    replaceDrafts(bindingDrafts.filter((_, bindingIndex) => bindingIndex !== index));
  }

  async function confirmBindings(): Promise<void> {
    if (isReadOnly || isSiteBindingLocked) return;
    const normalizedBindings = normalizeBindingDrafts(
      bindingDrafts,
      conversationId,
      placementSystemDraft,
    );
    setIsBindingBusy(true);
    try {
      setBindingDrafts(normalizedBindings);
      await updateAiSiteBindings(normalizedBindings);
      setChannelCount(normalizedBindings.length);
      setSiteBindingLocked(true);
    } finally {
      setIsBindingBusy(false);
    }
  }

  async function beginBindingEdit(): Promise<void> {
    if (isReadOnly || !isSiteBindingLocked) return;
    setIsBindingBusy(true);
    try {
      await onBeginBindingEdit?.();
      useEegStore.getState().resetStreamRuntime();
      if (frameCount > 0) {
        const bundle = await switchAiConversation();
        downloadAiBundle(bundle.bytes, bundle.fileName);
        await deleteStoredAiConversation(bundle.previousConversationId);
        setLastAnalysisResult(null);
      }
      setSiteBindingLocked(false);
      const currentBindings = useAiStore.getState().bindings;
      setBindingDrafts(
        normalizeBindingDrafts(
          currentBindings,
          useAiStore.getState().conversationId,
          currentBindings[0]?.placementSystem || fallbackPlacementSystem,
        ),
      );
    } finally {
      setIsBindingBusy(false);
    }
  }

  return (
    <Card ariaLabelledBy="ai-site-binding-title">
      <CardHeader
        eyebrow={t(locale, 'ai.eyebrow')}
        title={t(locale, 'ai.siteBindingTitle')}
        titleId="ai-site-binding-title"
      />
      <CardBody className="flex flex-col gap-3">
        <Field label={t(locale, 'ai.placementLabel')} htmlFor="ai-placement-system">
          <select
            id="ai-placement-system"
            value={placementSystemDraft}
            onChange={(event) => updatePlacementSystem(event.currentTarget.value)}
            disabled={isReadOnly || isSiteBindingLocked || isBindingBusy}
            className={SELECT_CLASS}
          >
            {placementOptions.map((option) => (
              <option key={option.value} value={option.value}>
                {optionLabel(locale, option)}
              </option>
            ))}
          </select>
        </Field>
        {bindingDrafts.map((binding, index) => {
          const siteOptions = withCurrentOption(
            getSiteOptions(placementSystemDraft),
            binding.siteName,
            locale === 'zh-CN' ? '当前点位' : 'Current site',
          );
          return (
            <div
              key={`${binding.bindingId}-${index}`}
              className="grid gap-3 rounded-sm border border-hairline bg-paper p-3 lg:grid-cols-[8rem_minmax(10rem,1fr)_auto] lg:items-end"
            >
              <Field label={t(locale, 'ai.channelName')} htmlFor={`ai-channel-name-${index}`}>
                <TextInput
                  id={`ai-channel-name-${index}`}
                  value={binding.channelName}
                  readOnly
                  disabled
                  placeholder="ch0"
                />
              </Field>
              <Field label={t(locale, 'ai.siteNameLabel')} htmlFor={`ai-site-name-${index}`}>
                <select
                  id={`ai-site-name-${index}`}
                  value={binding.siteName}
                  onChange={(event) => updateBinding(index, { siteName: event.currentTarget.value })}
                  disabled={isReadOnly || isSiteBindingLocked || isBindingBusy}
                  className={SELECT_CLASS}
                >
                  {siteOptions.map((option) => (
                    <option key={option.value} value={option.value}>
                      {optionLabel(locale, option)}
                    </option>
                  ))}
                </select>
              </Field>
              <Button
                variant="quiet"
                size="sm"
                onClick={() => removeBinding(index)}
                disabled={isReadOnly || isSiteBindingLocked || isBindingBusy || bindingDrafts.length <= 1}
                aria-label={t(locale, 'ai.removeBinding')}
              >
                <X size={14} strokeWidth={1.5} />
              </Button>
            </div>
          );
        })}
        <Button
          variant="ghost"
          size="sm"
          onClick={addBinding}
          disabled={isReadOnly || isSiteBindingLocked || isBindingBusy}
          className="self-start"
        >
          <Plus size={14} strokeWidth={1.5} />
          {t(locale, 'ai.addBinding')}
        </Button>
        <div className="flex flex-wrap items-center gap-2 border-t border-hairline pt-3">
          <Button
            size="sm"
            onClick={() => void confirmBindings()}
            disabled={isReadOnly || isSiteBindingLocked || isBindingBusy}
          >
            <CheckCircle2 size={14} strokeWidth={1.5} />
            {t(locale, 'ai.confirmBinding')}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => void beginBindingEdit()}
            disabled={isReadOnly || !isSiteBindingLocked || isBindingBusy}
          >
            <RefreshCcw size={14} strokeWidth={1.5} />
            {t(locale, 'ai.changeBinding')}
          </Button>
          <span className="text-[0.78rem] text-meta">
            {isSiteBindingLocked
              ? t(locale, 'ai.bindingLockedHint')
              : t(locale, 'ai.bindingDraftHint')}
          </span>
        </div>
      </CardBody>
    </Card>
  );
}

export function AiAnalysisSidebar({ locale, className = '' }: LocaleProps & ClassNameProps) {
  const status = useAiStore((state) => state.status);
  const frameCount = useAiStore((state) => state.frameCount);
  const isRecording = useAiStore((state) => state.isRecording);
  const modelConfig = useAiStore((state) => state.modelConfig);
  const errorMessage = useAiStore((state) => state.errorMessage);
  const lastAnalysisResult = useAiStore((state) => state.lastAnalysisResult);
  const setLastAnalysisResult = useAiStore((state) => state.setLastAnalysisResult);
  const isStreamBusy = useEegStore(
    (state) => state.stream.isStarting || state.stream.isStreaming,
  );
  const [goalDraft, setGoalDraft] = useState('');
  const [analysisError, setAnalysisError] = useState<string | null>(null);
  const [isBusy, setIsBusy] = useState(false);
  const parsedResult = useMemo(
    () => parseAnalysisOutput(lastAnalysisResult?.json ?? null),
    [lastAnalysisResult?.json],
  );

  useEffect(() => {
    void initializeAiConversation();
  }, []);

  async function handleRunAnalysis(): Promise<void> {
    setAnalysisError(null);
    if ((isStreamBusy && !isRecording) || (!isRecording && frameCount === 0)) {
      setAnalysisError(t(locale, 'ai.recordingRequired'));
      return;
    }
    if (frameCount === 0) {
      setAnalysisError(t(locale, 'ai.noFramesHint'));
      return;
    }

    const userGoal = goalDraft.trim() || t(locale, 'ai.defaultGoal');
    const { startMs, endMs } = resolveAiQuestionTimeRange(userGoal);

    setIsBusy(true);
    setLastAnalysisResult(null);
    try {
      const output = await runStructuredAiAnalysis({
        userGoal,
        startMs,
        endMs,
        modelConfig: createRequestModelConfig(modelConfig),
        outputLocale: locale,
      });
      setLastAnalysisResult({
        requestId: output.requestId,
        createdAtMs: Date.now(),
        json: JSON.stringify(output, null, 2),
      });
    } catch (error) {
      setAnalysisError(
        t(locale, 'ai.analysisFailed', {
          message: error instanceof Error ? error.message : String(error),
        }),
      );
    } finally {
      setIsBusy(false);
    }
  }

  return (
    <Card ariaLabelledBy="ai-sidebar-title" className={className}>
      <CardHeader
        eyebrow={t(locale, 'ai.eyebrow')}
        title={t(locale, 'ai.sidebarTitle')}
        titleId="ai-sidebar-title"
        trailing={
          <span className="font-mono text-[0.68rem] uppercase tracking-[0.08em] text-meta">
            {status}
          </span>
        }
      />
      <CardBody className="flex flex-col gap-4">
        <div className="rounded-sm border border-hairline bg-paper px-3 py-2">
          <span className="font-mono text-[0.7rem] uppercase tracking-[0.08em] text-meta">
            {t(locale, 'ai.frameCount')} {frameCount} ·{' '}
            {isRecording ? t(locale, 'ai.recordingOn') : t(locale, 'ai.recordingOff')}
          </span>
        </div>

        <Field label={t(locale, 'ai.goalLabel')} htmlFor="ai-goal">
          <textarea
            id="ai-goal"
            value={goalDraft}
            onChange={(event) => setGoalDraft(event.currentTarget.value)}
            className="min-h-24 w-full rounded-sm border border-hairline bg-surface-2 px-3 py-2 text-[0.88rem] text-ink placeholder:text-hint focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent"
            placeholder={t(locale, 'ai.goalPlaceholder')}
          />
        </Field>

        <Button
          onClick={() => void handleRunAnalysis()}
          disabled={isBusy || status !== 'ready'}
        >
          <Bot size={14} strokeWidth={1.5} />
          {t(locale, 'ai.runAnalysis')}
        </Button>

        {analysisError && <p className="m-0 text-[0.82rem] text-error">{analysisError}</p>}
        {errorMessage && <p className="m-0 text-[0.82rem] text-error">{errorMessage}</p>}

        {isBusy && (
          <div className="rounded-sm border border-hairline bg-paper p-3">
            <p className="m-0 font-mono text-[0.68rem] uppercase tracking-[0.08em] text-meta">
              {t(locale, 'ai.reasoning')}
            </p>
          </div>
        )}

        {parsedResult && (
          <div className="flex flex-col gap-3 rounded-sm border border-hairline bg-paper p-3">
            <p className="m-0 font-mono text-[0.65rem] uppercase tracking-[0.08em] text-meta">
              {t(locale, 'ai.resultTitle')}
            </p>
            <div>
              <p className="m-0 text-[0.88rem] font-medium text-ink">
                {parsedResult.humanReport.title}
              </p>
              <p className="m-0 pt-1 text-[0.8rem] leading-relaxed text-meta">
                {parsedResult.humanReport.conclusion}
              </p>
            </div>
            {parsedResult.humanReport.evidence.length > 0 && (
              <section className="flex flex-col gap-2">
                <p className="m-0 font-mono text-[0.65rem] uppercase tracking-[0.08em] text-meta">
                  {t(locale, 'ai.reportEvidenceTitle')}
                </p>
                {parsedResult.humanReport.evidence.map((item) => (
                  <p key={item} className="m-0 rounded-sm border border-hairline bg-card p-2 text-[0.78rem] leading-relaxed text-ink">
                    {item}
                  </p>
                ))}
              </section>
            )}
            {parsedResult.humanReport.suggestions.length > 0 && (
              <section className="flex flex-col gap-2">
                <p className="m-0 font-mono text-[0.65rem] uppercase tracking-[0.08em] text-meta">
                  {t(locale, 'ai.reportSuggestionsTitle')}
                </p>
                {parsedResult.humanReport.suggestions.map((item) => (
                  <p key={item} className="m-0 rounded-sm border border-hairline bg-card p-2 text-[0.78rem] leading-relaxed text-ink">
                    {item}
                  </p>
                ))}
              </section>
            )}
            {parsedResult.humanReport.caveats.length > 0 && (
              <section className="flex flex-col gap-2">
                <p className="m-0 font-mono text-[0.65rem] uppercase tracking-[0.08em] text-meta">
                  {t(locale, 'ai.reportCaveatsTitle')}
                </p>
                {parsedResult.humanReport.caveats.map((item) => (
                  <p key={item} className="m-0 rounded-sm border border-hairline bg-card p-2 text-[0.78rem] leading-relaxed text-meta">
                    {item}
                  </p>
                ))}
              </section>
            )}
          </div>
        )}
      </CardBody>
    </Card>
  );
}

export function AiSessionPanel({ locale }: LocaleProps) {
  const status = useAiStore((state) => state.status);
  const conversationId = useAiStore((state) => state.conversationId);
  const frameCount = useAiStore((state) => state.frameCount);
  const dataDirectoryLabel = useAiStore((state) => state.dataDirectoryLabel);
  const pendingWriteCount = useAiStore((state) => state.pendingWriteCount);
  const lastWriteDurationMs = useAiStore((state) => state.lastWriteDurationMs);
  const writeTimeoutCount = useAiStore((state) => state.writeTimeoutCount);
  const binding = useAiStore((state) => state.binding);
  const errorMessage = useAiStore((state) => state.errorMessage);
  const lastExportFileName = useAiStore((state) => state.lastExportFileName);
  const setLastAnalysisResult = useAiStore((state) => state.setLastAnalysisResult);
  const stream = useEegStore((state) => state.stream);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [isBusy, setIsBusy] = useState(false);

  useEffect(() => {
    void initializeAiConversation();
  }, []);

  async function handleExport(): Promise<void> {
    setIsBusy(true);
    try {
      const bundle = await exportActiveAiConversation();
      downloadAiBundle(bundle.bytes, bundle.fileName);
    } finally {
      setIsBusy(false);
    }
  }

  async function handleSwitchConversation(): Promise<void> {
    setIsBusy(true);
    try {
      const bundle = await switchAiConversation();
      downloadAiBundle(bundle.bytes, bundle.fileName);
      await deleteStoredAiConversation(bundle.previousConversationId);
      setLastAnalysisResult(null);
    } finally {
      setIsBusy(false);
    }
  }

  async function handleImportFile(event: ChangeEvent<HTMLInputElement>): Promise<void> {
    const file = event.currentTarget.files?.[0];
    event.currentTarget.value = '';
    if (!file) return;
    setIsBusy(true);
    try {
      const result = await restoreAiConversationFromBundle(file);
      if (result.exportedPrevious) {
        downloadAiBundle(result.exportedPrevious.bytes, result.exportedPrevious.fileName);
      }
      await deleteStoredAiConversation(result.previousConversationId);
      setLastAnalysisResult(null);
    } finally {
      setIsBusy(false);
    }
  }

  return (
    <Card ariaLabelledBy="ai-session-title">
      <CardHeader
        eyebrow={t(locale, 'sessions.eyebrow')}
        title={t(locale, 'sessions.title')}
        titleId="ai-session-title"
        trailing={
          <span className="font-mono text-[0.68rem] uppercase tracking-[0.08em] text-meta">
            {status}
          </span>
        }
      />
      <CardBody className="flex flex-col gap-5">
        <dl className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
          <div>
            <dt className="font-mono text-[0.65rem] uppercase tracking-[0.08em] text-meta">
              {t(locale, 'ai.conversationId')}
            </dt>
            <dd className="m-0 break-all font-mono text-[0.78rem] text-ink">{conversationId}</dd>
          </div>
          <div>
            <dt className="font-mono text-[0.65rem] uppercase tracking-[0.08em] text-meta">
              {t(locale, 'ai.channelName')}
            </dt>
            <dd className="m-0 font-mono text-[0.78rem] text-ink">{binding.channelName}</dd>
          </div>
          <div>
            <dt className="font-mono text-[0.65rem] uppercase tracking-[0.08em] text-meta">
              {t(locale, 'ai.frameCount')}
            </dt>
            <dd className="m-0 font-mono text-[0.78rem] text-ink">{frameCount}</dd>
          </div>
          <div>
            <dt className="font-mono text-[0.65rem] uppercase tracking-[0.08em] text-meta">
              {t(locale, 'ai.writeState')}
            </dt>
            <dd className="m-0 font-mono text-[0.78rem] text-ink">
              {pendingWriteCount} / {lastWriteDurationMs ?? '-'}ms / {writeTimeoutCount}
            </dd>
          </div>
          <div>
            <dt className="font-mono text-[0.65rem] uppercase tracking-[0.08em] text-meta">
              {t(locale, 'sessions.csvState')}
            </dt>
            <dd className="m-0 font-mono text-[0.78rem] text-ink">
              {stream.writesRawCsv ? t(locale, 'sessions.csvOn') : t(locale, 'sessions.csvOff')}
            </dd>
          </div>
        </dl>

        <div className="grid gap-4 lg:grid-cols-2">
          <div className="rounded-sm border border-hairline bg-paper p-3">
            <p className="m-0 pb-1 font-mono text-[0.65rem] uppercase tracking-[0.08em] text-meta">
              {t(locale, 'ai.dataDirectory')}
            </p>
            <p className="m-0 break-all font-mono text-[0.76rem] text-ink">
              {dataDirectoryLabel || `IndexedDB/eeg-ai-conversation-${conversationId}/bandFeatureFrames`}
            </p>
          </div>
          <div className="rounded-sm border border-hairline bg-paper p-3">
            <p className="m-0 pb-1 font-mono text-[0.65rem] uppercase tracking-[0.08em] text-meta">
              {t(locale, 'ai.lastExport')}
            </p>
            <p className="m-0 break-all font-mono text-[0.76rem] text-ink">
              {lastExportFileName ?? '-'}
            </p>
          </div>
        </div>

        <div className="rounded-sm border border-hairline bg-paper p-3">
          <p className="m-0 pb-1 font-mono text-[0.65rem] uppercase tracking-[0.08em] text-meta">
            {t(locale, 'sessions.csvOutput')}
          </p>
          <p className="m-0 break-all font-mono text-[0.76rem] text-ink">
            {stream.outputFileName ?? '-'} ·{' '}
            {stream.outputFileReady ? t(locale, 'sessions.csvReady') : t(locale, 'sessions.csvNotReady')}
          </p>
          {stream.writeError && <p className="m-0 pt-2 text-[0.78rem] text-error">{stream.writeError}</p>}
        </div>

        <div className="flex flex-wrap gap-2 border-t border-hairline pt-4">
          <Button variant="ghost" onClick={() => void handleExport()} disabled={isBusy || status !== 'ready'}>
            <Download size={14} strokeWidth={1.5} />
            {t(locale, 'ai.exportBundle')}
          </Button>
          <Button
            variant="ghost"
            onClick={() => void handleSwitchConversation()}
            disabled={isBusy || status !== 'ready'}
          >
            <RefreshCcw size={14} strokeWidth={1.5} />
            {t(locale, 'ai.switchConversation')}
          </Button>
          <Button variant="quiet" onClick={() => fileInputRef.current?.click()} disabled={isBusy}>
            <FileUp size={14} strokeWidth={1.5} />
            {t(locale, 'ai.importBundle')}
          </Button>
          <input
            ref={fileInputRef}
            type="file"
            className="hidden"
            accept=".eegai.zip,application/zip"
            onChange={(event) => void handleImportFile(event)}
          />
        </div>

        {errorMessage && <p className="m-0 text-[0.82rem] text-error">{errorMessage}</p>}
      </CardBody>
    </Card>
  );
}
