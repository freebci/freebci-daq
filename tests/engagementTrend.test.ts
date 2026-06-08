import { afterEach, describe, expect, it, vi } from 'vitest';
import { smoothEngagementResults, useEegStore } from '../src/store/eegStore';
import {
  EEG_ENGAGEMENT_ALERT_THRESHOLD,
  EEG_ENGAGEMENT_EMA_ALPHA,
  EEG_INITIAL_UNRELIABLE_SECONDS,
  EEG_LIVE_WINDOW_MAX_SECONDS,
  EEG_LIVE_WINDOW_MIN_SECONDS,
  EEG_LIVE_WINDOW_SECONDS,
  EEG_SAMPLE_RATE_HZ,
} from '../src/config/eeg';
import {
  FOCUS_BASELINE_SECONDS,
  FOCUS_DECISION_SECONDS,
} from '../src/focus/config';
import type { EegAnalysisResult, EegSampleBatch } from '../src/types/eeg';

const baseResult = (
  timeSeconds: number,
  ei: number | null,
  channelName = 'ch0',
): EegAnalysisResult => ({
  channelName,
  bandPowers: { delta: 0, theta: 0, alpha: 0, beta: 0, gamma: 0 },
  engagementIndex: ei,
  windowSampleCount: 500,
  sampleIndex: 0,
  timeSeconds,
  updatedAt: new Date(0).toISOString(),
  spectrum: { binHz: 1, powers: [] },
});

const batchWithSampleCount = (sampleCount: number): EegSampleBatch => ({
  packetSeq: 0,
  receivedAt: new Date(0).toISOString(),
  samples: Array.from({ length: sampleCount }, (_, index) => ({
    sampleIndex: index,
    eegValue: 0,
    dcValidity: 0,
    rldValidity: 0,
  })),
});

function advanceStreamSamples(sampleCount: number): void {
  useEegStore.getState().recordStreamBatch(batchWithSampleCount(sampleCount));
}

afterEach(() => {
  vi.useRealTimers();
});

describe('smoothEngagementResults', () => {
  it('seeds EMA from the first valid EI and smooths following values', () => {
    const { results, nextEma } = smoothEngagementResults(
      [baseResult(0.5, 1), baseResult(1.0, 3)],
      null,
      0.5,
    );

    expect(results.map((r) => r.engagementIndex)).toEqual([1, 2]);
    expect(nextEma).toBe(2);
  });

  it('skips null EI without moving the EMA state', () => {
    const { results, nextEma } = smoothEngagementResults(
      [baseResult(0.5, null), baseResult(1.0, 3)],
      1,
      0.5,
    );

    expect(results.map((r) => r.engagementIndex)).toEqual([null, 2]);
    expect(nextEma).toBe(2);
  });
});

describe('eegStore page annotations', () => {
  it('overwrites an event label when it is marked again', () => {
    const store = useEegStore;
    store.getState().reset();
    store.getState().addAnnotationLabel('Stimulus', 'event');
    const label = store.getState().annotationLabels[0];

    vi.useFakeTimers();
    advanceStreamSamples(EEG_SAMPLE_RATE_HZ + 1);
    vi.setSystemTime(new Date('2026-05-08T00:00:01.000Z'));
    store.getState().recordAnnotation(label.id);
    advanceStreamSamples(EEG_SAMPLE_RATE_HZ);
    vi.setSystemTime(new Date('2026-05-08T00:00:02.000Z'));
    store.getState().recordAnnotation(label.id);

    const records = store.getState().annotationRecords;
    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({
      labelId: label.id,
      kind: 'event',
      timeSeconds: 2,
      recordedAtMs: new Date('2026-05-08T00:00:02.000Z').getTime(),
    });
  });

  it('records an event timestamp before the first decoded batch is counted', () => {
    const store = useEegStore;
    store.getState().reset();
    store.getState().setStreamActive('characteristic-uuid', true);
    store.getState().addAnnotationLabel('Stimulus', 'event');
    const label = store.getState().annotationLabels[0];
    const markedAt = new Date('2026-05-08T00:00:00.250Z');

    vi.useFakeTimers();
    vi.setSystemTime(markedAt);
    store.getState().recordAnnotation(label.id);

    expect(store.getState().annotationRecords[0]).toMatchObject({
      labelId: label.id,
      kind: 'event',
      timeSeconds: 0,
      recordedAtMs: markedAt.getTime(),
    });
  });

  it('starts, ends, then overwrites an interval label on the next click', () => {
    const store = useEegStore;
    store.getState().reset();
    store.getState().addAnnotationLabel('Task', 'interval');
    const label = store.getState().annotationLabels[0];

    vi.useFakeTimers();
    advanceStreamSamples(EEG_SAMPLE_RATE_HZ + 1);
    vi.setSystemTime(new Date('2026-05-08T00:00:01.000Z'));
    store.getState().recordAnnotation(label.id);
    expect(store.getState().annotationRecords[0]).toMatchObject({
      labelId: label.id,
      kind: 'interval',
      startTimeSeconds: 1,
      endTimeSeconds: null,
      startRecordedAtMs: new Date('2026-05-08T00:00:01.000Z').getTime(),
      endRecordedAtMs: null,
    });

    advanceStreamSamples(EEG_SAMPLE_RATE_HZ);
    vi.setSystemTime(new Date('2026-05-08T00:00:02.000Z'));
    store.getState().recordAnnotation(label.id);
    expect(store.getState().annotationRecords[0]).toMatchObject({
      labelId: label.id,
      kind: 'interval',
      startTimeSeconds: 1,
      endTimeSeconds: 2,
      endRecordedAtMs: new Date('2026-05-08T00:00:02.000Z').getTime(),
    });

    advanceStreamSamples(EEG_SAMPLE_RATE_HZ);
    vi.setSystemTime(new Date('2026-05-08T00:00:03.000Z'));
    store.getState().recordAnnotation(label.id);
    expect(store.getState().annotationRecords).toHaveLength(1);
    expect(store.getState().annotationRecords[0]).toMatchObject({
      labelId: label.id,
      kind: 'interval',
      startTimeSeconds: 3,
      endTimeSeconds: null,
      startRecordedAtMs: new Date('2026-05-08T00:00:03.000Z').getTime(),
      endRecordedAtMs: null,
    });
  });

  it('allows multiple interval labels to stay active at the same time', () => {
    const store = useEegStore;
    store.getState().reset();
    store.getState().addAnnotationLabel('Task', 'interval');
    store.getState().addAnnotationLabel('Stimulus', 'interval');
    const [taskLabel, stimulusLabel] = store.getState().annotationLabels;

    advanceStreamSamples(EEG_SAMPLE_RATE_HZ + 1);
    store.getState().recordAnnotation(taskLabel.id);
    advanceStreamSamples(EEG_SAMPLE_RATE_HZ);
    store.getState().recordAnnotation(stimulusLabel.id);

    expect(store.getState().annotationRecords).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          labelId: taskLabel.id,
          kind: 'interval',
          startTimeSeconds: 1,
          endTimeSeconds: null,
        }),
        expect.objectContaining({
          labelId: stimulusLabel.id,
          kind: 'interval',
          startTimeSeconds: 2,
          endTimeSeconds: null,
        }),
      ]),
    );
  });

  it('resetStreamRuntime clears annotation records but keeps configured labels', () => {
    const store = useEegStore;
    store.getState().reset();
    store.getState().addAnnotationLabel('Stimulus', 'event');
    const label = store.getState().annotationLabels[0];

    advanceStreamSamples(EEG_SAMPLE_RATE_HZ + 1);
    store.getState().recordAnnotation(label.id);
    expect(store.getState().annotationRecords).toHaveLength(1);

    store.getState().resetStreamRuntime();

    expect(store.getState().annotationLabels).toHaveLength(1);
    expect(store.getState().annotationRecords).toHaveLength(0);
  });

  it('reset clears configured labels and annotation records', () => {
    const store = useEegStore;
    store.getState().reset();
    store.getState().addAnnotationLabel('Stimulus', 'event');
    const label = store.getState().annotationLabels[0];

    advanceStreamSamples(EEG_SAMPLE_RATE_HZ + 1);
    store.getState().recordAnnotation(label.id);

    store.getState().reset();

    expect(store.getState().annotationLabels).toHaveLength(0);
    expect(store.getState().annotationRecords).toHaveLength(0);
    store.getState().addAnnotationLabel('Next', 'event');
    expect(store.getState().annotationLabels[0]?.id).toBe('annotation-1');
  });
});

describe('eegStore engagement trend settings', () => {
  it('stores EMA-smoothed realtime EI points', () => {
    const store = useEegStore;
    store.getState().reset();

    store.getState().recordAnalysisResults([
      baseResult(0.5, 0),
      baseResult(10.5, 10),
    ]);

    const expectedEma = EEG_ENGAGEMENT_EMA_ALPHA * 10;
    const s = store.getState();
    expect(s.analysis.engagementIndex).toBeCloseTo(expectedEma, 6);
    expect(s.analysis.engagementEma).toBeCloseTo(expectedEma, 6);
    expect(s.analysisPoints.map((p) => p.engagementIndex)).toEqual([0, expectedEma]);
  });

  it('keeps channel EMA state independent and keeps primary EI on ch0', () => {
    const store = useEegStore;
    store.getState().reset();

    store.getState().recordAnalysisResults([
      baseResult(0.5, 1, 'ch0'),
      baseResult(0.5, 10, 'ch1'),
      baseResult(1.0, 3, 'ch0'),
      baseResult(1.0, 20, 'ch1'),
    ]);

    const state = store.getState();
    const expectedCh0 = EEG_ENGAGEMENT_EMA_ALPHA * 3 + (1 - EEG_ENGAGEMENT_EMA_ALPHA) * 1;
    const expectedCh1 = EEG_ENGAGEMENT_EMA_ALPHA * 20 + (1 - EEG_ENGAGEMENT_EMA_ALPHA) * 10;

    expect(state.analysis.engagementIndex).toBeCloseTo(expectedCh0, 6);
    expect(state.analysis.channels.ch0.engagementIndex).toBeCloseTo(expectedCh0, 6);
    expect(state.analysis.channels.ch1.engagementIndex).toBeCloseTo(expectedCh1, 6);
    expect(state.analysisPoints.map((point) => point.channelName)).toEqual([
      'ch0',
      'ch1',
      'ch0',
      'ch1',
    ]);
  });

  it('resetStreamRuntime clears realtime EI state', () => {
    const store = useEegStore;
    store.getState().reset();
    store.getState().recordAnalysisResults([
      baseResult(0.5, 0.5),
      baseResult(10.5, 0.5),
    ]);
    expect(store.getState().analysisPoints).toHaveLength(2);

    store.getState().resetStreamRuntime();
    expect(store.getState().analysisPoints).toHaveLength(0);
    expect(store.getState().analysis.engagementEma).toBeNull();
  });

  it('stores chart display settings with bounded live window and non-negative EI threshold', () => {
    const store = useEegStore;
    store.getState().reset();

    expect(store.getState().analysis.liveWindowSeconds).toBe(EEG_LIVE_WINDOW_SECONDS);
    expect(store.getState().analysis.engagementAlertThreshold).toBe(
      EEG_ENGAGEMENT_ALERT_THRESHOLD,
    );

    store.getState().setLiveWindowSeconds(120.4);
    expect(store.getState().analysis.liveWindowSeconds).toBe(120);

    store.getState().setLiveWindowSeconds(1);
    expect(store.getState().analysis.liveWindowSeconds).toBe(EEG_LIVE_WINDOW_MIN_SECONDS);

    store.getState().setLiveWindowSeconds(999);
    expect(store.getState().analysis.liveWindowSeconds).toBe(EEG_LIVE_WINDOW_MAX_SECONDS);

    store.getState().setEngagementAlertThreshold(0.75);
    expect(store.getState().analysis.engagementAlertThreshold).toBe(0.75);

    store.getState().setEngagementAlertThreshold(-1);
    expect(store.getState().analysis.engagementAlertThreshold).toBe(0);
  });

  it('collects focus baseline after the warmup and emits binary states', () => {
    const store = useEegStore;
    store.getState().reset();
    store.getState().setStreamActive('characteristic-uuid', false);

    advanceStreamSamples(EEG_SAMPLE_RATE_HZ * EEG_INITIAL_UNRELIABLE_SECONDS + 1);
    store.getState().beginFocusBaseline();

    const warmupSec = EEG_INITIAL_UNRELIABLE_SECONDS;
    const baselineEnd = warmupSec + FOCUS_BASELINE_SECONDS;

    expect(store.getState().analysis.focusCalibration).toMatchObject({
      phase: 'collecting-baseline',
      baselineStartedAtSeconds: warmupSec,
      baselineEndsAtSeconds: baselineEnd,
      baselineValue: null,
    });

    store.getState().recordAnalysisResults([
      baseResult(warmupSec, 0.8),
      baseResult(warmupSec + 15, 0.8),
      baseResult(baselineEnd, 0.8),
    ]);

    expect(store.getState().analysis.focusCalibration).toMatchObject({
      phase: 'active',
      baselineValue: 0.8,
      referenceValue: 0.8,
      lastDecisionWindowEndSeconds: baselineEnd,
    });
    expect(store.getState().focusStatePoints).toHaveLength(0);

    const decisionEnd = baselineEnd + FOCUS_DECISION_SECONDS;
    store.getState().recordAnalysisResults([baseResult(decisionEnd, 1.2)]);

    const [focusPoint] = store.getState().focusStatePoints;
    expect(focusPoint).toMatchObject({
      timeSeconds: decisionEnd,
      state: 1,
      referenceValue: 0.8,
      windowStartSeconds: baselineEnd,
      windowEndSeconds: decisionEnd,
    });
  });

  it('lets the edited focus reference drive later binary states', () => {
    const store = useEegStore;
    store.getState().reset();
    store.getState().setStreamActive('characteristic-uuid', false);

    const warmupSec = EEG_INITIAL_UNRELIABLE_SECONDS;
    const baselineEnd = warmupSec + FOCUS_BASELINE_SECONDS;

    advanceStreamSamples(EEG_SAMPLE_RATE_HZ * warmupSec + 1);
    store.getState().beginFocusBaseline();
    store.getState().recordAnalysisResults([
      baseResult(warmupSec, 0.8),
      baseResult(warmupSec + 15, 0.8),
      baseResult(baselineEnd, 0.8),
    ]);
    store.getState().setFocusReferenceValue(1);
    store.getState().recordAnalysisResults([
      baseResult(baselineEnd + FOCUS_DECISION_SECONDS, 0.2),
    ]);

    expect(store.getState().analysis.focusCalibration.referenceValue).toBe(1);
    expect(store.getState().focusStatePoints[0]).toMatchObject({
      state: 0,
      referenceValue: 1,
    });
  });

  it('uses the configured focus output window for binary state points', () => {
    const store = useEegStore;
    store.getState().reset();
    store.getState().setStreamActive('characteristic-uuid', false);

    const warmupSec = EEG_INITIAL_UNRELIABLE_SECONDS;
    const baselineEnd = warmupSec + FOCUS_BASELINE_SECONDS;

    advanceStreamSamples(EEG_SAMPLE_RATE_HZ * warmupSec + 1);
    store.getState().beginFocusBaseline();
    store.getState().recordAnalysisResults([
      baseResult(warmupSec, 0.8),
      baseResult(warmupSec + 15, 0.8),
      baseResult(baselineEnd, 0.8),
    ]);
    store.getState().setFocusOutputWindowSeconds(10);
    store.getState().recordAnalysisResults([baseResult(baselineEnd + 10, 1.2)]);

    expect(store.getState().analysis.focusOutputWindowSeconds).toBe(10);
    expect(store.getState().focusStatePoints[0]).toMatchObject({
      timeSeconds: baselineEnd + 10,
      state: 1,
      windowStartSeconds: baselineEnd,
      windowEndSeconds: baselineEnd + 10,
    });
  });

  it('restarts focus baseline collection and clears binary focus points on each click', () => {
    const store = useEegStore;
    store.getState().reset();
    store.getState().setStreamActive('characteristic-uuid', false);

    advanceStreamSamples(EEG_SAMPLE_RATE_HZ * EEG_INITIAL_UNRELIABLE_SECONDS + 1);
    store.getState().beginFocusBaseline();
    store.getState().recordAnalysisResults([
      baseResult(40, 0.8),
      baseResult(70, 0.8),
      baseResult(100, 1.2),
    ]);
    expect(store.getState().focusStatePoints).toHaveLength(1);

    store.getState().beginFocusBaseline();

    expect(store.getState().focusStatePoints).toHaveLength(0);
    expect(store.getState().analysis.focusCalibration).toMatchObject({
      phase: 'collecting-baseline',
      baselineValue: null,
      referenceValue: null,
      focusState: null,
    });
  });
});
