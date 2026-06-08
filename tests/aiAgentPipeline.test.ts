import { describe, expect, it } from 'vitest';
import {
  shouldBackcheckUnclearAnswer,
  type AiAnalysisRequestV1,
} from '../src/ai/agentPipeline';
import type { CandidateBandEventV1 } from '../src/ai/bandStats';
import {
  AI_SCHEMA_VERSION,
  type BandMetric,
  type BandMetricSummaryV1,
} from '../src/ai/protocol';

type BackcheckContext = Parameters<typeof shouldBackcheckUnclearAnswer>[1];

function request(userGoal: string): AiAnalysisRequestV1 {
  return {
    schemaVersion: AI_SCHEMA_VERSION,
    requestId: 'request-1',
    conversationId: 'conversation-1',
    userGoal,
    timeRange: { startMs: 0, endMs: 60_000 },
    bindingId: 'binding-ch0-default',
    createdAtMs: 1,
  };
}

function metricSummary(metric: BandMetric, mean: number | null): BandMetricSummaryV1 {
  return {
    metric,
    min: mean,
    max: mean,
    mean,
    median: mean,
    p10: mean,
    p90: mean,
    std: 0,
    slopePerSecond: null,
  };
}

function bandEvent(
  metric: BandMetric,
  direction: CandidateBandEventV1['direction'],
): CandidateBandEventV1 {
  return {
    eventId: `${metric}-${direction}-test`,
    timeRange: { startMs: 30_000, endMs: 32_000 },
    metric,
    direction,
    score: 1,
    summary: `${metric} ${direction}`,
  };
}

function context(input: {
  betaMean: number | null;
  alphaMean: number | null;
  thetaMean: number | null;
  events?: CandidateBandEventV1[];
}): BackcheckContext {
  return {
    schemaVersion: AI_SCHEMA_VERSION,
    requestId: 'request-1',
    timeRange: { startMs: 0, endMs: 60_000 },
    frameCount: 30,
    siteName: 'Cz',
    channelName: 'ch0',
    summary: [
      metricSummary('betaPower', input.betaMean),
      metricSummary('alphaPower', input.alphaMean),
      metricSummary('thetaPower', input.thetaMean),
    ],
    buckets: [],
    candidateEvents: input.events ?? [],
  };
}

describe('AI agent pipeline', () => {
  it('back-checks focus questions when the Beta/(Alpha+Theta) ratio is mixed', () => {
    expect(
      shouldBackcheckUnclearAnswer(
        request('最近 1 分钟我专注么？'),
        context({
          betaMean: 0.25,
          alphaMean: 0.5,
          thetaMean: 0.5,
          events: [bandEvent('alphaPower', 'high')],
        }),
      ),
    ).toBe(true);
  });

  it('does not back-check focus questions when the ratio clearly does not support focus', () => {
    expect(
      shouldBackcheckUnclearAnswer(
        request('最近 1 分钟我专注么？'),
        context({
          betaMean: 0.2,
          alphaMean: 0.8,
          thetaMean: 0.2,
          events: [bandEvent('alphaPower', 'high')],
        }),
      ),
    ).toBe(false);
  });
});
