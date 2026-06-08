import { afterEach, describe, expect, it, vi } from 'vitest';
import { createBandFeatureFrame, getBandFeatureQualityFlags } from '../src/ai/bandFeatures';
import { withWriteDeadline } from '../src/ai/conversationRuntime';
import {
  AI_SCHEMA_VERSION,
  validateBandFeatureFrame,
  validateDetailLookupRequest,
} from '../src/ai/protocol';
import { createStoredZip, readStoredZip } from '../src/ai/zipBundle';
import type { EegAnalysisResult } from '../src/types/eeg';

const result: EegAnalysisResult = {
  channelName: 'ch0',
  bandPowers: {
    delta: 1,
    theta: 2,
    alpha: 3,
    beta: 4,
    gamma: 5,
  },
  engagementIndex: null,
  windowSampleCount: 500,
  sampleIndex: 999,
  timeSeconds: 4,
  updatedAt: '2026-05-12T00:00:04.000Z',
  spectrum: { binHz: 1, powers: [] },
};

const binding = {
  schemaVersion: AI_SCHEMA_VERSION,
  conversationId: 'conversation-1',
  bindingId: 'binding-ch0-default',
  channelName: 'ch0',
  siteName: 'Cz',
  placementSystem: '10-20',
  createdAtMs: 1,
} as const;

describe('AI five-band protocol', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('creates strict five-band feature frames with time in the key fields', () => {
    const frame = createBandFeatureFrame(result, {
      conversationId: 'conversation-1',
      binding,
      streamStartedAtMs: 1_000,
      fftSize: 512,
      filterId: 'high-order-iir',
      filterParams: { hpCutoffHz: 0.5, lpCutoffHz: 45 },
      createdAtMs: 10_000,
    });

    expect(frame).toMatchObject({
      conversationId: 'conversation-1',
      bindingId: 'binding-ch0-default',
      channelName: 'ch0',
      siteName: 'Cz',
      windowEndMs: 5_000,
      deltaPower: 1,
      thetaPower: 2,
      alphaPower: 3,
      betaPower: 4,
      gammaPower: 5,
    });
    expect(validateBandFeatureFrame(frame)).toEqual(frame);
  });

  it('rejects extra fields at protocol boundaries', () => {
    const frame = createBandFeatureFrame(result, {
      conversationId: 'conversation-1',
      binding,
      streamStartedAtMs: 1_000,
      fftSize: 512,
      filterId: 'high-order-iir',
      filterParams: { hpCutoffHz: 0.5, lpCutoffHz: 45 },
    });

    expect(() => validateBandFeatureFrame({ ...frame, engagementIndex: 2 })).toThrow(
      /Unrecognized key/,
    );
  });

  it('only allows lookup metrics from the five raw band powers', () => {
    expect(() =>
      validateDetailLookupRequest({
        schemaVersion: AI_SCHEMA_VERSION,
        lookupId: 'lookup-1',
        reasonSummary: 'inspect alpha',
        timeRange: { startMs: 0, endMs: 10_000 },
        bindingId: 'binding-ch0-default',
        metrics: ['alphaPower', 'focusState'],
        granularity: 'frame',
        maxFrames: 10,
      }),
    ).toThrow(/metrics/);
  });

  it('marks filter settings that cut delta or gamma', () => {
    expect(
      getBandFeatureQualityFlags({
        streamTimeSeconds: 10,
        filterParams: { hpCutoffHz: 1, lpCutoffHz: 30 },
      }),
    ).toEqual(['initialUnreliable', 'lowPassCutsGamma', 'highPassCutsDelta']);
  });

  it('round-trips the no-compression .eegai.zip bundle format', () => {
    const zip = createStoredZip([
      { path: 'manifest.json', data: '{"ok":true}' },
      { path: 'bandFeatureFrames.jsonl', data: '{"frame":1}\n' },
    ]);
    const files = readStoredZip(zip.buffer);

    expect(files['manifest.json']).toBe('{"ok":true}');
    expect(files['bandFeatureFrames.jsonl']).toBe('{"frame":1}\n');
  });

  it('releases IndexedDB writes that exceed the 500ms deadline', async () => {
    vi.useFakeTimers();
    const slowWrite = new Promise<void>((resolve) => {
      setTimeout(resolve, 1_000);
    });
    const result = withWriteDeadline(slowWrite, 500);

    await vi.advanceTimersByTimeAsync(500);

    await expect(result).resolves.toMatchObject({
      timedOut: true,
      error: null,
    });
    await vi.advanceTimersByTimeAsync(500);
  });

  it('returns IndexedDB write errors without leaving the deadline pending', async () => {
    const error = new Error('write failed');

    await expect(withWriteDeadline(Promise.reject(error), 500)).resolves.toMatchObject({
      timedOut: false,
      error,
    });
  });
});
