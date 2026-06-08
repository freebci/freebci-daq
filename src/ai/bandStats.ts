import {
  BAND_METRICS,
  type BandFeatureFrameV1,
  type BandMetric,
  type BandMetricSummaryV1,
} from './protocol';

export const DEFAULT_CONTEXT_BUCKET_MS = 5_000;

function median(sortedValues: number[]): number | null {
  if (sortedValues.length === 0) return null;
  const middle = Math.floor(sortedValues.length / 2);
  if (sortedValues.length % 2 === 1) return sortedValues[middle];
  return (sortedValues[middle - 1] + sortedValues[middle]) / 2;
}

function percentile(sortedValues: number[], percentileValue: number): number | null {
  if (sortedValues.length === 0) return null;
  const index = Math.min(
    sortedValues.length - 1,
    Math.max(0, Math.floor((sortedValues.length - 1) * percentileValue)),
  );
  return sortedValues[index];
}

function standardDeviation(values: number[], meanValue: number): number {
  if (values.length <= 1) return 0;
  const variance =
    values.reduce((sum, value) => sum + (value - meanValue) ** 2, 0) / values.length;
  return Math.sqrt(variance);
}

function slopePerSecond(frames: readonly BandFeatureFrameV1[], metric: BandMetric): number | null {
  if (frames.length < 2) return null;
  const first = frames[0];
  const last = frames[frames.length - 1];
  const seconds = (last.windowEndMs - first.windowEndMs) / 1000;
  if (seconds <= 0) return null;
  return (last[metric] - first[metric]) / seconds;
}

export function summarizeMetric(
  frames: readonly BandFeatureFrameV1[],
  metric: BandMetric,
): BandMetricSummaryV1 {
  const values = frames
    .map((frame) => frame[metric])
    .filter((value) => Number.isFinite(value))
    .sort((a, b) => a - b);

  if (values.length === 0) {
    return {
      metric,
      min: null,
      max: null,
      mean: null,
      median: null,
      p10: null,
      p90: null,
      std: null,
      slopePerSecond: null,
    };
  }

  const meanValue = values.reduce((sum, value) => sum + value, 0) / values.length;

  return {
    metric,
    min: values[0],
    max: values[values.length - 1],
    mean: meanValue,
    median: median(values),
    p10: percentile(values, 0.1),
    p90: percentile(values, 0.9),
    std: standardDeviation(values, meanValue),
    slopePerSecond: slopePerSecond(frames, metric),
  };
}

export function summarizeBandFrames(
  frames: readonly BandFeatureFrameV1[],
  metrics: readonly BandMetric[] = BAND_METRICS,
): BandMetricSummaryV1[] {
  return metrics.map((metric) => summarizeMetric(frames, metric));
}

export interface BandFeatureBucketV1 {
  bucketStartMs: number;
  bucketEndMs: number;
  frameCount: number;
  summary: BandMetricSummaryV1[];
}

export function bucketBandFrames(
  frames: readonly BandFeatureFrameV1[],
  bucketSizeMs = DEFAULT_CONTEXT_BUCKET_MS,
  metrics: readonly BandMetric[] = BAND_METRICS,
): BandFeatureBucketV1[] {
  if (frames.length === 0) return [];
  const sorted = [...frames].sort((a, b) => a.windowEndMs - b.windowEndMs);
  const buckets = new Map<number, BandFeatureFrameV1[]>();
  const firstStart = Math.floor(sorted[0].windowEndMs / bucketSizeMs) * bucketSizeMs;

  for (const frame of sorted) {
    const bucketStart =
      firstStart + Math.floor((frame.windowEndMs - firstStart) / bucketSizeMs) * bucketSizeMs;
    const bucket = buckets.get(bucketStart) ?? [];
    bucket.push(frame);
    buckets.set(bucketStart, bucket);
  }

  return [...buckets.entries()]
    .sort(([a], [b]) => a - b)
    .map(([bucketStartMs, bucketFrames]) => ({
      bucketStartMs,
      bucketEndMs: bucketStartMs + bucketSizeMs,
      frameCount: bucketFrames.length,
      summary: summarizeBandFrames(bucketFrames, metrics),
    }));
}

export interface CandidateBandEventV1 {
  eventId: string;
  timeRange: {
    startMs: number;
    endMs: number;
  };
  metric: BandMetric;
  direction: 'high' | 'low' | 'trend';
  score: number;
  summary: string;
}

export function detectBandAnomalies(
  frames: readonly BandFeatureFrameV1[],
  metrics: readonly BandMetric[] = BAND_METRICS,
  maxEvents = 5,
): CandidateBandEventV1[] {
  if (frames.length === 0) return [];
  const summaries = summarizeBandFrames(frames, metrics);
  const events: CandidateBandEventV1[] = [];

  for (const summary of summaries) {
    if (
      summary.mean === null ||
      summary.std === null ||
      summary.std === 0 ||
      summary.max === null ||
      summary.min === null
    ) {
      continue;
    }

    const highFrame = [...frames].sort((a, b) => b[summary.metric] - a[summary.metric])[0];
    const lowFrame = [...frames].sort((a, b) => a[summary.metric] - b[summary.metric])[0];
    const highScore = Math.abs((highFrame[summary.metric] - summary.mean) / summary.std);
    const lowScore = Math.abs((lowFrame[summary.metric] - summary.mean) / summary.std);

    events.push({
      eventId: `${summary.metric}-high-${highFrame.windowEndMs}`,
      timeRange: {
        startMs: highFrame.windowStartMs,
        endMs: highFrame.windowEndMs,
      },
      metric: summary.metric,
      direction: 'high',
      score: highScore,
      summary: `${summary.metric} reached a local high.`,
    });

    events.push({
      eventId: `${summary.metric}-low-${lowFrame.windowEndMs}`,
      timeRange: {
        startMs: lowFrame.windowStartMs,
        endMs: lowFrame.windowEndMs,
      },
      metric: summary.metric,
      direction: 'low',
      score: lowScore,
      summary: `${summary.metric} reached a local low.`,
    });
  }

  return events.sort((a, b) => b.score - a.score).slice(0, maxEvents);
}
