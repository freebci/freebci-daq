import { z } from 'zod';

export const AI_SCHEMA_VERSION = 'eeg-ai-v1' as const;

export const FIVE_BAND_CATALOG = {
  delta: { minHz: 0.5, maxHz: 4 },
  theta: { minHz: 4, maxHz: 8 },
  alpha: { minHz: 8, maxHz: 13 },
  beta: { minHz: 13, maxHz: 30 },
  gamma: { minHz: 30, maxHz: 45 },
} as const;

export const BAND_METRICS = [
  'deltaPower',
  'thetaPower',
  'alphaPower',
  'betaPower',
  'gammaPower',
] as const;

export type BandMetric = (typeof BAND_METRICS)[number];

export const QUALITY_FLAGS = [
  'initialUnreliable',
  'lowPassCutsGamma',
  'highPassCutsDelta',
] as const;

export type BandFeatureQualityFlag = (typeof QUALITY_FLAGS)[number];

export interface SiteBindingV1 {
  schemaVersion: typeof AI_SCHEMA_VERSION;
  conversationId: string;
  bindingId: string;
  channelName: string;
  siteName: string;
  placementSystem: string;
  createdAtMs: number;
}

export interface BandFeatureFrameV1 {
  schemaVersion: typeof AI_SCHEMA_VERSION;
  conversationId: string;
  bindingId: string;
  channelName: string;
  siteName: string;
  placementSystem: string;
  windowStartMs: number;
  windowEndMs: number;
  streamTimeSeconds: number;
  sampleIndex: number;
  deltaPower: number;
  thetaPower: number;
  alphaPower: number;
  betaPower: number;
  gammaPower: number;
  fftSize: number;
  filterId: string;
  filterParams: Record<string, number>;
  qualityFlags: BandFeatureQualityFlag[];
  createdAtMs: number;
}

export type DetailLookupGranularity = 'frame' | '1s' | '5s';

export interface TimeRangeMsV1 {
  startMs: number;
  endMs: number;
}

export interface DetailLookupRequestV1 {
  schemaVersion: typeof AI_SCHEMA_VERSION;
  lookupId: string;
  reasonSummary: string;
  timeRange: TimeRangeMsV1;
  bindingId: string;
  metrics: BandMetric[];
  granularity: DetailLookupGranularity;
  maxFrames: number;
}

export interface BandMetricSummaryV1 {
  metric: BandMetric;
  min: number | null;
  max: number | null;
  mean: number | null;
  median: number | null;
  p10: number | null;
  p90: number | null;
  std: number | null;
  slopePerSecond: number | null;
}

export interface BandFrameSliceV1 {
  windowEndMs: number;
  values: Partial<Record<BandMetric, number>>;
}

export interface DetailLookupResultV1 {
  schemaVersion: typeof AI_SCHEMA_VERSION;
  lookupId: string;
  status: 'success' | 'rejected';
  timeRange: TimeRangeMsV1;
  frameCount: number;
  frames: BandFrameSliceV1[];
  summary: BandMetricSummaryV1[];
  truncation: {
    truncated: boolean;
    reason: string | null;
  };
  rejectionReason: string | null;
}

export interface TransformTraceV1 {
  schemaVersion: typeof AI_SCHEMA_VERSION;
  stepId: string;
  inputKind: string;
  outputKind: string;
  inputHash: string;
  outputHash: string;
  status: 'success' | 'error';
  errorMessage: string | null;
  createdAtMs: number;
}

export interface AiAnalysisOutputV1 {
  schemaVersion: typeof AI_SCHEMA_VERSION;
  requestId: string;
  machineSummary: {
    primaryState: string;
    confidence: number;
    severity: 'info' | 'notice' | 'warning';
    timeRange: TimeRangeMsV1;
    siteName: string;
    channelName: string;
    keyMetrics: BandMetricSummaryV1[];
    flags: string[];
  };
  humanReport: {
    title: string;
    conclusion: string;
    evidence: string[];
    caveats: string[];
    suggestions: string[];
  };
  findings: Array<{
    findingId: string;
    source: 'contextBucket' | 'detailLookup';
    lookupId: string | null;
    timeRange: TimeRangeMsV1;
    metricIds: BandMetric[];
    evidenceSummary: string;
    severity: 'info' | 'notice' | 'warning';
  }>;
  detailTrace: DetailLookupResultV1[];
  audit: {
    agentsUsed: string[];
    skillsUsed: string[];
    detailLookupCount: number;
    transformTraceCount: number;
    contextPackHash: string;
    providerName: string | null;
    modelId: string | null;
    generationMode: 'ai-sdk-stream' | 'local-fallback';
    schemaVersion: typeof AI_SCHEMA_VERSION;
  };
}

export class AiProtocolError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AiProtocolError';
  }
}

const finiteNumberSchema = z.number().refine(Number.isFinite, {
  message: 'Expected a finite number.',
});

const finiteIntegerSchema = finiteNumberSchema.refine(Number.isInteger, {
  message: 'Expected an integer.',
});

export const BandMetricSchema = z.enum(BAND_METRICS);

export const QualityFlagSchema = z.enum(QUALITY_FLAGS);

export const TimeRangeSchema = z
  .object({
    startMs: finiteIntegerSchema,
    endMs: finiteIntegerSchema,
  })
  .strict()
  .refine((value) => value.startMs <= value.endMs, {
    message: 'startMs must be <= endMs.',
  });

export const SiteBindingSchema = z
  .object({
    schemaVersion: z.literal(AI_SCHEMA_VERSION),
    conversationId: z.string().min(1),
    bindingId: z.string().min(1),
    channelName: z.string().min(1),
    siteName: z.string().min(1),
    placementSystem: z.string().min(1),
    createdAtMs: finiteIntegerSchema,
  })
  .strict();

export const BandFeatureFrameSchema = z
  .object({
    schemaVersion: z.literal(AI_SCHEMA_VERSION),
    conversationId: z.string().min(1),
    bindingId: z.string().min(1),
    channelName: z.string().min(1),
    siteName: z.string().min(1),
    placementSystem: z.string().min(1),
    windowStartMs: finiteIntegerSchema,
    windowEndMs: finiteIntegerSchema,
    streamTimeSeconds: finiteNumberSchema,
    sampleIndex: finiteIntegerSchema,
    deltaPower: finiteNumberSchema,
    thetaPower: finiteNumberSchema,
    alphaPower: finiteNumberSchema,
    betaPower: finiteNumberSchema,
    gammaPower: finiteNumberSchema,
    fftSize: finiteIntegerSchema,
    filterId: z.string().min(1),
    filterParams: z.record(z.string(), finiteNumberSchema),
    qualityFlags: z.array(QualityFlagSchema),
    createdAtMs: finiteIntegerSchema,
  })
  .strict()
  .refine((value) => value.windowStartMs <= value.windowEndMs, {
    message: 'windowStartMs must be <= windowEndMs.',
  });

export const DetailLookupRequestSchema = z
  .object({
    schemaVersion: z.literal(AI_SCHEMA_VERSION),
    lookupId: z.string().min(1),
    reasonSummary: z.string().min(1),
    timeRange: TimeRangeSchema,
    bindingId: z.string().min(1),
    metrics: z.array(BandMetricSchema).min(1),
    granularity: z.enum(['frame', '1s', '5s']),
    maxFrames: finiteIntegerSchema.refine((value) => value >= 1 && value <= 120, {
      message: 'maxFrames must be between 1 and 120.',
    }),
  })
  .strict();

export const BandMetricSummarySchema = z
  .object({
    metric: BandMetricSchema,
    min: finiteNumberSchema.nullable(),
    max: finiteNumberSchema.nullable(),
    mean: finiteNumberSchema.nullable(),
    median: finiteNumberSchema.nullable(),
    p10: finiteNumberSchema.nullable(),
    p90: finiteNumberSchema.nullable(),
    std: finiteNumberSchema.nullable(),
    slopePerSecond: finiteNumberSchema.nullable(),
  })
  .strict();

export const BandFrameSliceSchema = z
  .object({
    windowEndMs: finiteIntegerSchema,
    values: z.partialRecord(BandMetricSchema, finiteNumberSchema),
  })
  .strict();

export const DetailLookupResultSchema = z
  .object({
    schemaVersion: z.literal(AI_SCHEMA_VERSION),
    lookupId: z.string().min(1),
    status: z.enum(['success', 'rejected']),
    timeRange: TimeRangeSchema,
    frameCount: finiteIntegerSchema,
    frames: z.array(BandFrameSliceSchema),
    summary: z.array(BandMetricSummarySchema),
    truncation: z
      .object({
        truncated: z.boolean(),
        reason: z.string().nullable(),
      })
      .strict(),
    rejectionReason: z.string().nullable(),
  })
  .strict();

export const TransformTraceSchema = z
  .object({
    schemaVersion: z.literal(AI_SCHEMA_VERSION),
    stepId: z.string().min(1),
    inputKind: z.string().min(1),
    outputKind: z.string().min(1),
    inputHash: z.string().min(1),
    outputHash: z.string().min(1),
    status: z.enum(['success', 'error']),
    errorMessage: z.string().nullable(),
    createdAtMs: finiteIntegerSchema,
  })
  .strict();

export const AiAnalysisOutputSchema = z
  .object({
    schemaVersion: z.literal(AI_SCHEMA_VERSION),
    requestId: z.string().min(1),
    machineSummary: z
      .object({
        primaryState: z.string(),
        confidence: finiteNumberSchema,
        severity: z.enum(['info', 'notice', 'warning']),
        timeRange: TimeRangeSchema,
        siteName: z.string(),
        channelName: z.string(),
        keyMetrics: z.array(BandMetricSummarySchema),
        flags: z.array(z.string()),
      })
      .strict(),
    humanReport: z
      .object({
        title: z.string(),
        conclusion: z.string(),
        evidence: z.array(z.string()),
        caveats: z.array(z.string()),
        suggestions: z.array(z.string()),
      })
      .strict(),
    findings: z.array(
      z
        .object({
          findingId: z.string().min(1),
          source: z.enum(['contextBucket', 'detailLookup']),
          lookupId: z.string().nullable(),
          timeRange: TimeRangeSchema,
          metricIds: z.array(BandMetricSchema).min(1),
          evidenceSummary: z.string(),
          severity: z.enum(['info', 'notice', 'warning']),
        })
        .strict(),
    ),
    detailTrace: z.array(DetailLookupResultSchema),
    audit: z
      .object({
        agentsUsed: z.array(z.string()),
        skillsUsed: z.array(z.string()),
        detailLookupCount: finiteIntegerSchema,
        transformTraceCount: finiteIntegerSchema,
        contextPackHash: z.string(),
        providerName: z.string().nullable(),
        modelId: z.string().nullable(),
        generationMode: z.enum(['ai-sdk-stream', 'local-fallback']),
        schemaVersion: z.literal(AI_SCHEMA_VERSION),
      })
      .strict(),
  })
  .strict();

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function assertRecord(value: unknown, name: string): Record<string, unknown> {
  if (!isRecord(value)) {
    throw new AiProtocolError(`${name} must be an object.`);
  }
  return value;
}

function assertExactKeys(
  value: Record<string, unknown>,
  keys: readonly string[],
  name: string,
): void {
  const actualKeys = Object.keys(value).sort();
  const expectedKeys = [...keys].sort();
  if (
    actualKeys.length !== expectedKeys.length ||
    actualKeys.some((key, index) => key !== expectedKeys[index])
  ) {
    throw new AiProtocolError(
      `${name} keys must be exactly: ${expectedKeys.join(', ')}.`,
    );
  }
}

function readString(value: Record<string, unknown>, key: string, name: string): string {
  const item = value[key];
  if (typeof item !== 'string' || item.trim().length === 0) {
    throw new AiProtocolError(`${name}.${key} must be a non-empty string.`);
  }
  return item;
}

function readNullableString(
  value: Record<string, unknown>,
  key: string,
  name: string,
): string | null {
  const item = value[key];
  if (item === null) return null;
  if (typeof item !== 'string') {
    throw new AiProtocolError(`${name}.${key} must be a string or null.`);
  }
  return item;
}

function readFiniteNumber(value: Record<string, unknown>, key: string, name: string): number {
  const item = value[key];
  if (typeof item !== 'number' || !Number.isFinite(item)) {
    throw new AiProtocolError(`${name}.${key} must be a finite number.`);
  }
  return item;
}

function readInteger(value: Record<string, unknown>, key: string, name: string): number {
  const item = readFiniteNumber(value, key, name);
  if (!Number.isInteger(item)) {
    throw new AiProtocolError(`${name}.${key} must be an integer.`);
  }
  return item;
}

function readSchemaVersion(value: Record<string, unknown>, name: string): typeof AI_SCHEMA_VERSION {
  const schemaVersion = readString(value, 'schemaVersion', name);
  if (schemaVersion !== AI_SCHEMA_VERSION) {
    throw new AiProtocolError(`${name}.schemaVersion must be ${AI_SCHEMA_VERSION}.`);
  }
  return schemaVersion;
}

function readStringEnum<T extends readonly string[]>(
  value: unknown,
  options: T,
  name: string,
): T[number] {
  if (typeof value !== 'string' || !(options as readonly string[]).includes(value)) {
    throw new AiProtocolError(`${name} must be one of: ${options.join(', ')}.`);
  }
  return value as T[number];
}

export function isBandMetric(value: string): value is BandMetric {
  return (BAND_METRICS as readonly string[]).includes(value);
}

export function validateBandMetric(metric: string): BandMetric {
  return BandMetricSchema.parse(metric);
}

export function validateBandFeatureFrame(input: unknown): BandFeatureFrameV1 {
  return BandFeatureFrameSchema.parse(input) as BandFeatureFrameV1;
}

export function validateSiteBinding(input: unknown): SiteBindingV1 {
  return SiteBindingSchema.parse(input) as SiteBindingV1;
}

export function validateTimeRange(input: unknown, name = 'TimeRangeMsV1'): TimeRangeMsV1 {
  return TimeRangeSchema.parse(input) as TimeRangeMsV1;
}

export function validateDetailLookupRequest(input: unknown): DetailLookupRequestV1 {
  return DetailLookupRequestSchema.parse(input) as DetailLookupRequestV1;
}

export function createTransformTrace(
  input: {
    stepId: string;
    inputKind: string;
    outputKind: string;
    inputHash: string;
    outputHash: string;
    status: 'success' | 'error';
    errorMessage?: string | null;
  },
  createdAtMs = Date.now(),
): TransformTraceV1 {
  return {
    schemaVersion: AI_SCHEMA_VERSION,
    stepId: input.stepId,
    inputKind: input.inputKind,
    outputKind: input.outputKind,
    inputHash: input.inputHash,
    outputHash: input.outputHash,
    status: input.status,
    errorMessage: input.errorMessage ?? null,
    createdAtMs,
  };
}

export function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(',')}]`;
  }
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`)
    .join(',')}}`;
}

export function createProtocolHash(value: unknown): string {
  const text = stableStringify(value);
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return `fnv1a-${(hash >>> 0).toString(16).padStart(8, '0')}`;
}

export function pickBandMetricValues(
  frame: BandFeatureFrameV1,
  metrics: readonly BandMetric[],
): Record<BandMetric, number> {
  const values = {} as Record<BandMetric, number>;
  for (const metric of metrics) {
    values[metric] = frame[metric];
  }
  return values;
}

export function readOptionalNullableString(
  value: Record<string, unknown>,
  key: string,
  name: string,
): string | null {
  return readNullableString(value, key, name);
}
