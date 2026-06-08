import { describe, expect, it } from 'vitest';
import { bucketBandFrames, detectBandAnomalies, summarizeBandFrames } from '../src/ai/bandStats';
import { AI_SCHEMA_VERSION, type BandFeatureFrameV1 } from '../src/ai/protocol';

function frame(windowEndMs: number, alphaPower: number, gammaPower = 1): BandFeatureFrameV1 {
  return {
    schemaVersion: AI_SCHEMA_VERSION,
    conversationId: 'conversation-1',
    bindingId: 'binding-ch0-default',
    channelName: 'ch0',
    siteName: 'Cz',
    placementSystem: '10-20',
    windowStartMs: windowEndMs - 2_000,
    windowEndMs,
    streamTimeSeconds: windowEndMs / 1000,
    sampleIndex: windowEndMs,
    deltaPower: 1,
    thetaPower: 1,
    alphaPower,
    betaPower: 1,
    gammaPower,
    fftSize: 512,
    filterId: 'high-order-iir',
    filterParams: { hpCutoffHz: 0.5, lpCutoffHz: 45 },
    qualityFlags: [],
    createdAtMs: windowEndMs,
  };
}

describe('AI band stats', () => {
  it('summarizes raw band powers without derived EI/focus fields', () => {
    const summary = summarizeBandFrames([frame(1_000, 1), frame(2_000, 3)], [
      'alphaPower',
    ])[0];

    expect(summary).toMatchObject({
      metric: 'alphaPower',
      min: 1,
      max: 3,
      mean: 2,
      median: 2,
    });
    expect(summary.slopePerSecond).toBe(2);
  });

  it('buckets retained frames and detects candidate evidence windows', () => {
    const frames = [
      frame(1_000, 1),
      frame(2_000, 1),
      frame(6_000, 10),
      frame(7_000, 1),
    ];

    expect(bucketBandFrames(frames, 5_000, ['alphaPower'])).toHaveLength(2);
    expect(detectBandAnomalies(frames, ['alphaPower'], 1)[0]).toMatchObject({
      metric: 'alphaPower',
      direction: 'high',
    });
  });
});
