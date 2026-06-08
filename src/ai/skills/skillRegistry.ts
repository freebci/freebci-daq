import {
  BAND_METRICS,
  AI_SCHEMA_VERSION,
  type BandFeatureFrameV1,
  type BandMetric,
  type DetailLookupRequestV1,
  type DetailLookupResultV1,
  pickBandMetricValues,
  validateDetailLookupRequest,
} from '../protocol';
import {
  bucketBandFrames,
  detectBandAnomalies,
  summarizeBandFrames,
  type BandFeatureBucketV1,
  type CandidateBandEventV1,
} from '../bandStats';

export interface SkillExecutionContext {
  getFrames: (input: {
    startMs: number;
    endMs: number;
    bindingId?: string | null;
  }) => Promise<BandFeatureFrameV1[]>;
}

export interface SkillDefinition<Input, Output> {
  skillId: string;
  version: string;
  description: string;
  execute: (input: Input, context: SkillExecutionContext) => Promise<Output>;
}

export interface SummarizeBandStatsInput {
  frames: BandFeatureFrameV1[];
  metrics: BandMetric[];
}

export interface DetectBandTrendInput {
  frames: BandFeatureFrameV1[];
  metrics: BandMetric[];
}

export interface DetectBandAnomalyInput {
  frames: BandFeatureFrameV1[];
  metrics: BandMetric[];
  maxEvents: number;
}

export interface CompareBandWindowsInput {
  leftFrames: BandFeatureFrameV1[];
  rightFrames: BandFeatureFrameV1[];
  metrics: BandMetric[];
}

export interface RankEvidenceWindowsInput {
  events: CandidateBandEventV1[];
  maxEvents: number;
}

export const summarizeBandStatsSkill: SkillDefinition<
  SummarizeBandStatsInput,
  ReturnType<typeof summarizeBandFrames>
> = {
  skillId: 'summarizeBandStats',
  version: '1.0.0',
  description: 'Summarize five-band EEG power frames with robust statistics.',
  async execute(input) {
    return summarizeBandFrames(input.frames, input.metrics);
  },
};

export const detectBandTrendSkill: SkillDefinition<
  DetectBandTrendInput,
  ReturnType<typeof summarizeBandFrames>
> = {
  skillId: 'detectBandTrend',
  version: '1.0.0',
  description: 'Return per-metric summaries including slope over the selected window.',
  async execute(input) {
    return summarizeBandFrames(input.frames, input.metrics);
  },
};

export const detectBandAnomalySkill: SkillDefinition<
  DetectBandAnomalyInput,
  CandidateBandEventV1[]
> = {
  skillId: 'detectBandAnomaly',
  version: '1.0.0',
  description: 'Rank high and low five-band power excursions.',
  async execute(input) {
    return detectBandAnomalies(input.frames, input.metrics, input.maxEvents);
  },
};

export const compareBandWindowsSkill: SkillDefinition<
  CompareBandWindowsInput,
  Array<{
    metric: BandMetric;
    leftMean: number | null;
    rightMean: number | null;
    delta: number | null;
  }>
> = {
  skillId: 'compareBandWindows',
  version: '1.0.0',
  description: 'Compare mean band power between two windows.',
  async execute(input) {
    const left = summarizeBandFrames(input.leftFrames, input.metrics);
    const right = summarizeBandFrames(input.rightFrames, input.metrics);
    return input.metrics.map((metric) => {
      const leftMean = left.find((item) => item.metric === metric)?.mean ?? null;
      const rightMean = right.find((item) => item.metric === metric)?.mean ?? null;
      return {
        metric,
        leftMean,
        rightMean,
        delta: leftMean === null || rightMean === null ? null : rightMean - leftMean,
      };
    });
  },
};

function aggregateLookupFrames(
  frames: readonly BandFeatureFrameV1[],
  request: DetailLookupRequestV1,
): DetailLookupResultV1['frames'] {
  if (request.granularity === 'frame') {
    return frames.slice(0, request.maxFrames).map((frame) => ({
      windowEndMs: frame.windowEndMs,
      values: pickBandMetricValues(frame, request.metrics),
    }));
  }

  const bucketMs = request.granularity === '1s' ? 1_000 : 5_000;
  const buckets = bucketBandFrames(frames, bucketMs, request.metrics);
  return buckets.slice(0, request.maxFrames).map((bucket) => {
    const values = {} as Record<BandMetric, number>;
    for (const metric of request.metrics) {
      values[metric] = bucket.summary.find((item) => item.metric === metric)?.mean ?? 0;
    }
    return {
      windowEndMs: bucket.bucketEndMs,
      values,
    };
  });
}

export const lookupBandFramesSkill: SkillDefinition<
  DetailLookupRequestV1,
  DetailLookupResultV1
> = {
  skillId: 'lookupBandFrames',
  version: '1.0.0',
  description: 'Look up bounded five-band frame details from IndexedDB.',
  async execute(rawInput, context) {
    const input = validateDetailLookupRequest(rawInput);
    const durationMs = input.timeRange.endMs - input.timeRange.startMs;
    if (durationMs > 60_000) {
      return {
        schemaVersion: AI_SCHEMA_VERSION,
        lookupId: input.lookupId,
        status: 'rejected',
        timeRange: input.timeRange,
        frameCount: 0,
        frames: [],
        summary: [],
        truncation: { truncated: false, reason: null },
        rejectionReason: 'Lookup range exceeds 60 seconds.',
      };
    }

    const frames = await context.getFrames({
      startMs: input.timeRange.startMs,
      endMs: input.timeRange.endMs,
      bindingId: input.bindingId,
    });
    const truncated = frames.length > input.maxFrames && input.granularity === 'frame';
    const slicedFrames = truncated ? frames.slice(0, input.maxFrames) : frames;

    return {
      schemaVersion: AI_SCHEMA_VERSION,
      lookupId: input.lookupId,
      status: 'success',
      timeRange: input.timeRange,
      frameCount: slicedFrames.length,
      frames: aggregateLookupFrames(slicedFrames, input),
      summary: summarizeBandFrames(slicedFrames, input.metrics),
      truncation: {
        truncated,
        reason: truncated ? 'Frame count exceeded maxFrames.' : null,
      },
      rejectionReason: null,
    };
  },
};

export const rankEvidenceWindowsSkill: SkillDefinition<
  RankEvidenceWindowsInput,
  CandidateBandEventV1[]
> = {
  skillId: 'rankEvidenceWindows',
  version: '1.0.0',
  description: 'Rank candidate evidence windows for report citation.',
  async execute(input) {
    return [...input.events].sort((a, b) => b.score - a.score).slice(0, input.maxEvents);
  },
};

export const skillRegistry = {
  summarizeBandStats: summarizeBandStatsSkill,
  detectBandTrend: detectBandTrendSkill,
  detectBandAnomaly: detectBandAnomalySkill,
  compareBandWindows: compareBandWindowsSkill,
  lookupBandFrames: lookupBandFramesSkill,
  rankEvidenceWindows: rankEvidenceWindowsSkill,
} as const;

export type SkillId = keyof typeof skillRegistry;

export const deprecatedSkillIds: string[] = [];

export function assertSkillId(skillId: string): SkillId {
  if (skillId in skillRegistry) {
    return skillId as SkillId;
  }
  throw new Error(`Unknown or deprecated EEG AI skill: ${skillId}`);
}

export function getDefaultBandMetrics(): BandMetric[] {
  return [...BAND_METRICS];
}

export function createSkillCallRecord(input: {
  callId: string;
  skillId: SkillId;
  inputHash: string;
  outputHash: string;
  status: 'success' | 'error';
  startedAtMs: number;
  finishedAtMs: number;
}): Record<string, unknown> {
  return {
    schemaVersion: AI_SCHEMA_VERSION,
    ...input,
  };
}
