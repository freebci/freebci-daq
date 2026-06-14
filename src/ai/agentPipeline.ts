import { z } from 'zod';
import {
  AI_SCHEMA_VERSION,
  BAND_METRICS,
  AiAnalysisOutputSchema,
  BandFeatureFrameSchema,
  BandMetricSummarySchema,
  BandMetricSchema,
  DetailLookupRequestSchema,
  TimeRangeSchema,
  type AiAnalysisOutputV1,
  type BandFeatureFrameV1,
  type BandMetric,
  type DetailLookupRequestV1,
  createProtocolHash,
} from './protocol';
import {
  DEFAULT_CONTEXT_BUCKET_MS,
  bucketBandFrames,
  detectBandAnomalies,
  summarizeBandFrames,
} from './bandStats';
import { getActiveAiFrames } from './conversationRuntime';
import {
  lookupBandFramesSkill,
  rankEvidenceWindowsSkill,
  skillRegistry,
  type SkillId,
} from './skills/skillRegistry';
import { useAiStore } from '../store/aiStore';
import { useEegStore } from '../store/eegStore';
import type { Locale } from '../i18n';
import { parseAiQuestionIntent } from './questionIntent';
import {
  createNaturalHumanReport as createReadableHumanReport,
} from './naturalReport';
import {
  createLanguageModel,
  hasUsableModelConfig,
  type AiModelConfig,
} from './modelProvider';
import {
  createBandEventMap,
  createBandMeanMap,
  getFocusInference,
  shouldBackcheckMentalStateEvents,
} from './fiveBandInference';

type AiToolFactory = typeof import('ai')['tool'];

export interface AiAnalysisRequestV1 {
  schemaVersion: typeof AI_SCHEMA_VERSION;
  requestId: string;
  conversationId: string;
  userGoal: string;
  timeRange: {
    startMs: number;
    endMs: number;
  };
  bindingId: string;
  createdAtMs: number;
}

interface IntentPlanV1 {
  schemaVersion: typeof AI_SCHEMA_VERSION;
  requestId: string;
  normalizedGoal: string;
  targetMetrics: BandMetric[];
  requiredSkills: SkillId[];
  lookupPolicy: {
    maxRounds: number;
    maxLookupSeconds: number;
    maxFrames: number;
  };
}

interface ContextPackV1 {
  schemaVersion: typeof AI_SCHEMA_VERSION;
  requestId: string;
  timeRange: {
    startMs: number;
    endMs: number;
  };
  frameCount: number;
  siteName: string;
  channelName: string;
  summary: ReturnType<typeof summarizeBandFrames>;
  buckets: ReturnType<typeof bucketBandFrames>;
  candidateEvents: ReturnType<typeof detectBandAnomalies>;
}

export type AiPipelineStreamEvent =
  | { type: 'start'; message: string }
  | { type: 'text-delta'; message: string }
  | { type: 'tool-call'; message: string }
  | { type: 'tool-result'; message: string }
  | { type: 'partial-output'; message: string }
  | { type: 'finish'; message: string }
  | { type: 'fallback'; message: string };

const AiAnalysisRequestSchema = z
  .object({
    schemaVersion: z.literal(AI_SCHEMA_VERSION),
    requestId: z.string().min(1),
    conversationId: z.string().min(1),
    userGoal: z.string(),
    timeRange: z
      .object({
        startMs: z.number().int(),
        endMs: z.number().int(),
      })
      .strict()
      .refine((value) => value.startMs <= value.endMs),
    bindingId: z.string().min(1),
    createdAtMs: z.number().int(),
  })
  .strict();

const IntentPlanSchema = z
  .object({
    schemaVersion: z.literal(AI_SCHEMA_VERSION),
    requestId: z.string().min(1),
    normalizedGoal: z.string(),
    targetMetrics: z.array(BandMetricSchema).min(1),
    requiredSkills: z.array(z.string()).min(1),
    lookupPolicy: z
      .object({
        maxRounds: z.number().int().min(1).max(3),
        maxLookupSeconds: z.number().int().min(1).max(60),
        maxFrames: z.number().int().min(1).max(120),
      })
      .strict(),
  })
  .strict();

const ContextPackSchema = z
  .object({
    schemaVersion: z.literal(AI_SCHEMA_VERSION),
    requestId: z.string().min(1),
    timeRange: TimeRangeSchema,
    frameCount: z.number().int(),
    siteName: z.string(),
    channelName: z.string(),
    summary: z.array(BandMetricSummarySchema),
    buckets: z.array(z.unknown()),
    candidateEvents: z.array(z.unknown()),
  })
  .strict();

function createRequestId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `request-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

function selectMetrics(): BandMetric[] {
  return [...BAND_METRICS];
}

function intentAgent(request: AiAnalysisRequestV1): IntentPlanV1 {
  return IntentPlanSchema.parse({
    schemaVersion: AI_SCHEMA_VERSION,
    requestId: request.requestId,
    normalizedGoal: request.userGoal.trim(),
    targetMetrics: selectMetrics(),
    requiredSkills: [
      'summarizeBandStats',
      'detectBandTrend',
      'detectBandAnomaly',
      'rankEvidenceWindows',
      'lookupBandFrames',
    ],
    lookupPolicy: {
      maxRounds: 3,
      maxLookupSeconds: 60,
      maxFrames: 120,
    },
  }) as IntentPlanV1;
}

function contextBuilder(
  request: AiAnalysisRequestV1,
  frames: readonly BandFeatureFrameV1[],
  targetMetrics: readonly BandMetric[],
): ContextPackV1 {
  const firstFrame = frames[0];
  return ContextPackSchema.parse({
    schemaVersion: AI_SCHEMA_VERSION,
    requestId: request.requestId,
    timeRange: request.timeRange,
    frameCount: frames.length,
    siteName: firstFrame?.siteName ?? 'unknown',
    channelName: firstFrame?.channelName ?? 'ch0',
    summary: summarizeBandFrames(frames, targetMetrics),
    buckets: bucketBandFrames(frames, DEFAULT_CONTEXT_BUCKET_MS, targetMetrics),
    candidateEvents: detectBandAnomalies(frames, targetMetrics, 6),
  }) as ContextPackV1;
}

function isFocusInferenceUnclear(context: ContextPackV1): boolean {
  const inference = getFocusInference(createBandMeanMap(context.summary), {
    supportRatioThreshold: useEegStore.getState().analysis.engagementAlertThreshold,
  });
  return inference.status === 'insufficient' || inference.status === 'mixed';
}

export function shouldBackcheckUnclearAnswer(
  request: AiAnalysisRequestV1,
  context: ContextPackV1,
): boolean {
  const intent = parseAiQuestionIntent(request.userGoal);
  if (!intent.isEegRelated || context.frameCount === 0) return false;
  if (context.frameCount < 20) return true;
  if (context.candidateEvents.length === 0) {
    return (
      intent.mentalStateTargets.length > 0 ||
      intent.asksAbnormality ||
      intent.asksSignalQuality
    );
  }

  const target = intent.primaryMentalStateTarget;
  if (!target) return false;
  if (target === 'focus') return isFocusInferenceUnclear(context);
  return shouldBackcheckMentalStateEvents(target, context.candidateEvents);
}

function createLookupRequests(
  request: AiAnalysisRequestV1,
  context: ContextPackV1,
  plan: IntentPlanV1,
): DetailLookupRequestV1[] {
  const requests: DetailLookupRequestV1[] = context.candidateEvents
    .slice(0, 3)
    .map((event, index) => {
      const center = Math.round((event.timeRange.startMs + event.timeRange.endMs) / 2);
      const halfWindowMs = 15_000;
      return {
        schemaVersion: AI_SCHEMA_VERSION,
        lookupId: `lookup-${index + 1}-${event.metric}-${center}`,
        reasonSummary: event.summary,
        timeRange: {
          startMs: Math.max(context.timeRange.startMs, center - halfWindowMs),
          endMs: Math.min(context.timeRange.endMs, center + halfWindowMs),
        },
        bindingId: useAiStore.getState().binding.bindingId,
        metrics: [
          event.metric,
          ...plan.targetMetrics.filter((metric) => metric !== event.metric),
        ],
        granularity: 'frame',
        maxFrames: plan.lookupPolicy.maxFrames,
      };
    });

  if (shouldBackcheckUnclearAnswer(request, context)) {
    const maxLookupMs = plan.lookupPolicy.maxLookupSeconds * 1000;
    requests.push({
      schemaVersion: AI_SCHEMA_VERSION,
      lookupId: `lookup-unclear-window-${context.timeRange.endMs}`,
      reasonSummary:
        'The preliminary EEG inference is unclear, weak, or lacks a focal event; back-check the selected window before answering.',
      timeRange: {
        startMs: Math.max(context.timeRange.startMs, context.timeRange.endMs - maxLookupMs),
        endMs: context.timeRange.endMs,
      },
      bindingId: useAiStore.getState().binding.bindingId,
      metrics: plan.targetMetrics,
      granularity: '1s',
      maxFrames: plan.lookupPolicy.maxFrames,
    });
  }

  return requests;
}

function formatMetricName(metric: BandMetric): string {
  return metric.replace('Power', '');
}

function formatFiveBandPrimaryState(context: ContextPackV1): string {
  if (context.frameCount === 0) return 'insufficient-data';
  const eventsByMetric = createBandEventMap(context.candidateEvents);
  const parts = BAND_METRICS.map((metric) => {
    const event = eventsByMetric.get(metric);
    return `${formatMetricName(metric)}:${event?.direction ?? 'stable'}`;
  });
  return `five-band profile ${parts.join(',')}`;
}

function reportAgent(input: {
  request: AiAnalysisRequestV1;
  plan: IntentPlanV1;
  context: ContextPackV1;
  detailTrace: AiAnalysisOutputV1['detailTrace'];
  contextPackHash: string;
  modelConfig?: AiModelConfig | null;
  generationMode: AiAnalysisOutputV1['audit']['generationMode'];
  outputLocale: Locale;
}): AiAnalysisOutputV1 {
  const findings = input.context.candidateEvents.slice(0, 3).map((event, index) => ({
    findingId: `finding-${index + 1}`,
    source:
      input.detailTrace[index]?.status === 'success'
        ? ('detailLookup' as const)
        : ('contextBucket' as const),
    lookupId:
      input.detailTrace[index]?.status === 'success'
        ? input.detailTrace[index].lookupId
        : null,
    timeRange: event.timeRange,
    metricIds: [event.metric],
    evidenceSummary: `${formatMetricName(event.metric)} ${event.direction} score ${event.score.toFixed(2)}`,
    severity: event.score >= 3 ? ('warning' as const) : ('notice' as const),
  }));

  return AiAnalysisOutputSchema.parse({
    schemaVersion: AI_SCHEMA_VERSION,
    requestId: input.request.requestId,
    machineSummary: {
      primaryState: formatFiveBandPrimaryState(input.context),
      confidence: input.context.frameCount >= 20 ? 0.72 : 0.35,
      severity: findings.some((finding) => finding.severity === 'warning') ? 'warning' : 'notice',
      timeRange: input.request.timeRange,
      siteName: input.context.siteName,
      channelName: input.context.channelName,
      keyMetrics: input.context.summary,
      flags: input.context.frameCount === 0 ? ['no-frames'] : [],
    },
    humanReport: createReadableHumanReport({
      locale: input.outputLocale,
      request: input.request,
      context: { ...input.context, detailTrace: input.detailTrace },
      focusSupportRatioThreshold: useEegStore.getState().analysis.engagementAlertThreshold,
    }),
    findings,
    detailTrace: input.detailTrace,
    audit: {
      agentsUsed: ['IntentAgent', 'ContextBuilder', 'InvestigationAgent', 'ReportAgent'],
      skillsUsed: input.plan.requiredSkills,
      detailLookupCount: input.detailTrace.length,
      transformTraceCount: 4,
      contextPackHash: input.contextPackHash,
      providerName: input.modelConfig?.providerName ?? null,
      modelId: input.modelConfig?.modelId ?? null,
      generationMode: input.generationMode,
      schemaVersion: AI_SCHEMA_VERSION,
    },
  }) as AiAnalysisOutputV1;
}

const ToolLookupInputSchema = DetailLookupRequestSchema;

const ToolWindowInputSchema = z
  .object({
    timeRange: TimeRangeSchema,
    bindingId: z.string().min(1),
    metrics: z.array(BandMetricSchema).min(1),
  })
  .strict();

function createAiSdkTools(toolFactory: AiToolFactory) {
  return {
    summarizeBandStats: toolFactory({
      description:
        'Compute exact five-band summary statistics from IndexedDB for a bounded time window.',
      inputSchema: ToolWindowInputSchema,
      execute: async (input) => {
        const frames = await getActiveAiFrames({
          startMs: input.timeRange.startMs,
          endMs: input.timeRange.endMs,
          bindingId: input.bindingId,
        });
        return summarizeBandFrames(frames, input.metrics);
      },
    }),
    detectBandAnomaly: toolFactory({
      description:
        'Find candidate high/low excursions in Delta, Theta, Alpha, Beta, or Gamma powers.',
      inputSchema: ToolWindowInputSchema.extend({
        maxEvents: z.number().int().min(1).max(10),
      }).strict(),
      execute: async (input) => {
        const frames = await getActiveAiFrames({
          startMs: input.timeRange.startMs,
          endMs: input.timeRange.endMs,
          bindingId: input.bindingId,
        });
        return detectBandAnomalies(frames, input.metrics, input.maxEvents);
      },
    }),
    lookupBandFrames: toolFactory({
      description:
        'Look up high-granularity five-band frames for a suspected abnormal or unclear segment. You must use this before finalizing a mixed, weak, or unclear EEG inference.',
      inputSchema: ToolLookupInputSchema,
      execute: async (input) => {
        return lookupBandFramesSkill.execute(input, {
          getFrames: getActiveAiFrames,
        });
      },
    }),
  };
}

const AI_SDK_SYSTEM_PROMPT =
  'You are an EEG five-band analysis agent with an open user-facing chat surface. Internally, use only deltaPower, thetaPower, alphaPower, betaPower, and gammaPower plus the provided tools. Every EEG judgment must integrate the full Delta, Theta, Alpha, Beta, and Gamma pattern. A single band excursion may be evidence, but it is never sufficient by itself for the conclusion. First decide whether request.userGoal is about EEG signals, EEG recording, the experiment scene, signal quality, or an EEG-related mental-state inference. If it asks for a mental-state inference, identify the requested target first, such as anxiety, depression/low mood, tension/stress, relaxation, fatigue, drowsiness, alertness, arousal, or focus, then reason toward that target from the five-band evidence. Use clinical-note-like rigor without pretending to be a clinician: state limitations first, separate evidence that supports, weakly supports, conflicts, or remains uncertain, and recommend concrete checks such as raw waveform, artifacts, contact quality, task context, and subjective report. If it is outside EEG scope, say that you can only infer from the EEG context and do not answer unrelated content. Do not invent stored EI values, calibrated Focus labels, baselines, raw waveform details, or medical diagnoses. For in-scope questions, answer directly as a cautious inference from the available evidence, not as certainty. For focus/attention questions, infer from the five-band pattern, especially Beta relative to Alpha+Theta while checking Delta, Gamma, and low-frequency/artifact clues, and state that it is not the calibrated Focus page result. For anxiety, depression, tension, relaxation, fatigue, drowsiness, alertness, arousal, or other mental-state questions, state that this is not a diagnosis or direct readout; then infer whether the observed five-band pattern supports, weakly supports, is mixed for, or does not support the requested state. Do not force general EEG questions into anxiety or focus. If a segment looks abnormal and needs detail, call lookupBandFrames. Return a strict object matching AiAnalysisOutputV1. The structured object is internal; humanReport must be natural language for end users and must not mention schema keys, lookup IDs, source labels, audit fields, or JSON.';

const AI_SDK_OUTPUT_RULES = [
  'Answer request.userGoal directly as an EEG-context inference before giving any generic summary.',
  'If request.userGoal is not about EEG, EEG acquisition, signal quality, experiment events, or EEG-related state inference, politely keep the answer inside the EEG analyzer scope.',
  'Every conclusion must explicitly be based on the combined Delta/Theta/Alpha/Beta/Gamma profile. Never make a mental-state or signal-quality judgment from one frequency band alone.',
  'For general EEG scene questions, explain what the five-band pattern suggests; do not turn every question into anxiety or focus.',
  'If the user asks about focus, attention, concentration, engagement, distraction, or whether they were focused, state that this is not a calibrated Focus classification; then make the strongest cautious inference supported by Beta relative to Alpha+Theta together with Delta, Gamma, and the observed band abnormalities.',
  'If the user asks about anxiety, depression/low mood, tension/stress, relaxation, fatigue, drowsiness, alertness, arousal, emotion, or another mental state, first name the inferred target, then state that this is not a diagnosis or direct readout; then make the strongest cautious inference the combined five-band data supports, such as supports, weakly supports, mixed, or does not support that target. Do not stop at "cannot determine".',
  'For mental-state answers, write the humanReport like a strict preliminary clinical-style note: conclusion strength first, evidence for and against, uncertainty, and the next checks. Never diagnose, name a disorder as confirmed, or imply medical care decisions.',
  'If your preliminary answer would be unclear, mixed, weakly supported, or based on no strong local event, you must call lookupBandFrames before finalizing and use the returned detailTrace to give a steadier, more detailed answer.',
  'If the user asks about signal quality, discuss possible artifact or contact-quality clues only from the five-band pattern and recommend checking the raw waveform.',
  'Every finding must cite source=contextBucket or source=detailLookup.',
  'Use detailTrace for all lookupBandFrames results.',
  'audit.generationMode must be ai-sdk-stream.',
  'audit.providerName and audit.modelId must match the provided model configuration.',
  'humanReport.title, conclusion, evidence, caveats, and suggestions must be readable natural language for the end user.',
  'Do not expose lookupId, detailLookup, contextBucket, schema names, audit fields, JSON, or raw score jargon in humanReport.',
] as const;

async function runAiSdkStructuredAnalysis(input: {
  request: AiAnalysisRequestV1;
  plan: IntentPlanV1;
  context: ContextPackV1;
  contextPackHash: string;
  modelConfig: AiModelConfig;
  outputLocale: Locale;
  onStreamEvent?: (event: AiPipelineStreamEvent) => void;
}): Promise<AiAnalysisOutputV1> {
  input.onStreamEvent?.({ type: 'start', message: 'Starting AI SDK structured stream.' });
  const [{ Output, stepCountIs, streamText, tool }, model] = await Promise.all([
    import('ai'),
    createLanguageModel(input.modelConfig),
  ]);
  const tools = createAiSdkTools(tool);
  const questionIntent = parseAiQuestionIntent(input.request.userGoal);
  const result = streamText({
    model,
    temperature: input.modelConfig.temperature,
    stopWhen: stepCountIs(input.plan.lookupPolicy.maxRounds + 1),
    tools,
    output: Output.object({
      schema: AiAnalysisOutputSchema,
      name: 'AiAnalysisOutputV1',
      description:
        'Strict EEG five-band analysis output. Cite context buckets or detail lookup evidence for every finding.',
    }),
    system: AI_SDK_SYSTEM_PROMPT,
    prompt: JSON.stringify({
      request: input.request,
      intentPlan: input.plan,
      questionIntent,
      contextPack: input.context,
      outputLanguage: input.outputLocale === 'zh-CN' ? 'Simplified Chinese' : 'English',
      outputRules: AI_SDK_OUTPUT_RULES,
      modelAudit: {
        providerName: input.modelConfig.providerName,
        modelId: input.modelConfig.modelId,
      },
    }),
    experimental_onToolCallStart: (event) => {
      input.onStreamEvent?.({
        type: 'tool-call',
        message: `Calling ${String(event.toolCall.toolName)}`,
      });
    },
    experimental_onToolCallFinish: (event) => {
      input.onStreamEvent?.({
        type: 'tool-result',
        message: `Finished ${String(event.toolCall.toolName)} (${event.success ? 'ok' : 'error'})`,
      });
    },
  });

  for await (const part of result.fullStream) {
    if (part.type === 'text-delta') {
      input.onStreamEvent?.({ type: 'text-delta', message: part.text });
    }
  }

  const generated = (await result.output) as AiAnalysisOutputV1;
  const parsed = AiAnalysisOutputSchema.parse({
    ...generated,
    audit: {
      ...generated.audit,
      providerName: input.modelConfig.providerName,
      modelId: input.modelConfig.modelId,
      generationMode: 'ai-sdk-stream',
    },
  }) as AiAnalysisOutputV1;
  input.onStreamEvent?.({ type: 'finish', message: 'AI SDK structured output complete.' });
  return parsed;
}

export async function runStructuredAiAnalysis(input: {
  userGoal: string;
  startMs: number;
  endMs: number;
  modelConfig?: AiModelConfig | null;
  outputLocale?: Locale;
  onStreamEvent?: (event: AiPipelineStreamEvent) => void;
}): Promise<AiAnalysisOutputV1> {
  const aiState = useAiStore.getState();
  const request = AiAnalysisRequestSchema.parse({
    schemaVersion: AI_SCHEMA_VERSION,
    requestId: createRequestId(),
    conversationId: aiState.conversationId,
    userGoal: input.userGoal,
    timeRange: {
      startMs: input.startMs,
      endMs: input.endMs,
    },
    bindingId: aiState.binding.bindingId,
    createdAtMs: Date.now(),
  }) as AiAnalysisRequestV1;
  const plan = intentAgent(request);
  const frames = await getActiveAiFrames({
    startMs: input.startMs,
    endMs: input.endMs,
    bindingId: aiState.binding.bindingId,
  });
  const context = contextBuilder(request, frames, plan.targetMetrics);
  const contextPackHash = createProtocolHash(context);

  if (hasUsableModelConfig(input.modelConfig)) {
    try {
      const sdkOutput = await runAiSdkStructuredAnalysis({
        request,
        plan,
        context,
        contextPackHash,
        modelConfig: input.modelConfig,
        outputLocale: input.outputLocale ?? 'en-US',
        onStreamEvent: input.onStreamEvent,
      });
      return sdkOutput;
    } catch (error) {
      input.onStreamEvent?.({
        type: 'fallback',
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }

  const rankedEvents = await rankEvidenceWindowsSkill.execute(
    { events: context.candidateEvents, maxEvents: 3 },
    { getFrames: getActiveAiFrames },
  );

  const detailTrace: AiAnalysisOutputV1['detailTrace'] = [];
  for (const lookupRequest of createLookupRequests(
    request,
    { ...context, candidateEvents: rankedEvents },
    plan,
  )) {
    const result = await lookupBandFramesSkill.execute(lookupRequest, {
      getFrames: getActiveAiFrames,
    });
    detailTrace.push(result);
  }

  const output = reportAgent({
    request,
    plan,
    context: { ...context, candidateEvents: rankedEvents },
    detailTrace,
    contextPackHash,
    modelConfig: input.modelConfig,
    generationMode: 'local-fallback',
    outputLocale: input.outputLocale ?? 'en-US',
  });

  return output;
}
