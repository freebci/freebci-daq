import { describe, expect, it } from 'vitest';
import {
  EegBandPowerAnalyzer,
  EegFrequencyAnalyzer,
  NumberRingBuffer,
} from '../src/analysis/eegFrequencyAnalysis';
import { IdentityEegFilter } from '../src/analysis/eegFilters';
import {
  EEG_ANALYSIS_HOP_SIZE,
  EEG_ANALYSIS_WINDOW_SIZE,
  EEG_SAMPLE_RATE_HZ,
} from '../src/config/eeg';
import type { EegSampleBatch, EegSample } from '../src/types/eeg';

const TEST_SIGNAL_AMPLITUDE_VOLTS = 20e-6;

interface CreateBatchOptions {
  sampleCount?: number;
  getValue?: (value: number, sampleIndex: number) => number;
  getDcValidity?: (sampleIndex: number) => number;
  getRldValidity?: (sampleIndex: number) => number;
}

function sineAt(frequencyHz: number, sampleIndex: number): number {
  return Math.sin((2 * Math.PI * frequencyHz * sampleIndex) / EEG_SAMPLE_RATE_HZ);
}

function createBatch(frequencyHz: number, options: CreateBatchOptions = {}): EegSampleBatch {
  const {
    sampleCount = EEG_ANALYSIS_WINDOW_SIZE,
    getValue = (value) => value,
    getDcValidity = () => 0,
    getRldValidity = () => 0,
  } = options;
  const samples: EegSample[] = Array.from({ length: sampleCount }, (_, sampleIndex) => {
    const value = TEST_SIGNAL_AMPLITUDE_VOLTS * sineAt(frequencyHz, sampleIndex);

    return {
      sampleIndex: sampleIndex,
      eegValue: getValue(value, sampleIndex),
      dcValidity: getDcValidity(sampleIndex),
      rldValidity: getRldValidity(sampleIndex),
    };
  });

  return {
    packetSeq: 1,
    receivedAt: '2026-04-25T08:00:00.000Z',
    samples,
  };
}

describe('eegFrequencyAnalysis', () => {
  it('keeps the latest values in insertion order with a ring buffer', () => {
    const buffer = new NumberRingBuffer(3);

    buffer.push(1);
    buffer.push(2);

    const firstTwo = [0, 0];
    expect(buffer.copyLatestInto(firstTwo)).toBe(2);
    expect(firstTwo).toEqual([1, 2]);

    buffer.push(3);
    buffer.push(4);
    buffer.push(5);
    expect(buffer.length).toBe(3);

    const latestTwo = [0, 0];
    expect(buffer.copyLatestInto(latestTwo)).toBe(2);
    expect(latestTwo).toEqual([4, 5]);

    const latestThree = [0, 0, 0];
    expect(buffer.copyLatestInto(latestThree)).toBe(3);
    expect(latestThree).toEqual([3, 4, 5]);
  });

  it('separates delta, theta, alpha, beta, and gamma band power with fft.js', () => {
    const analyzer = new EegBandPowerAnalyzer();

    const delta = analyzer.calculateBandPowers(
      createBatch(2).samples.map((sample) => sample.eegValue),
    );
    const theta = analyzer.calculateBandPowers(
      createBatch(6).samples.map((sample) => sample.eegValue),
    );
    const alpha = analyzer.calculateBandPowers(
      createBatch(10).samples.map((sample) => sample.eegValue),
    );
    const beta = analyzer.calculateBandPowers(
      createBatch(20).samples.map((sample) => sample.eegValue),
    );
    const gamma = analyzer.calculateBandPowers(
      createBatch(40).samples.map((sample) => sample.eegValue),
    );

    expect(delta.delta).toBeGreaterThan(delta.theta);
    expect(delta.delta).toBeGreaterThan(delta.alpha);
    expect(theta.theta).toBeGreaterThan(theta.alpha);
    expect(theta.theta).toBeGreaterThan(theta.beta);
    expect(alpha.alpha).toBeGreaterThan(alpha.theta);
    expect(alpha.alpha).toBeGreaterThan(alpha.beta);
    expect(beta.beta).toBeGreaterThan(beta.theta);
    expect(beta.beta).toBeGreaterThan(beta.alpha);
    expect(gamma.gamma).toBeGreaterThan(gamma.beta);
    expect(gamma.gamma).toBeGreaterThan(gamma.alpha);
  });

  it('calculates engagement index from rolling beta, alpha, and theta power', () => {
    const analyzer = new EegFrequencyAnalyzer({
      windowSize: EEG_ANALYSIS_WINDOW_SIZE,
      sampleRateHz: EEG_SAMPLE_RATE_HZ,
      filter: new IdentityEegFilter(),
    });
    const [result] = analyzer.pushBatch(createBatch(20));

    expect(result).toBeDefined();
    expect(result?.bandPowers?.beta).toBeGreaterThan(result?.bandPowers?.alpha ?? 0);
    expect(result?.bandPowers?.beta).toBeGreaterThan(result?.bandPowers?.theta ?? 0);
    expect(result?.engagementIndex).toBeGreaterThan(1);
    expect(result?.windowSampleCount).toBe(EEG_SAMPLE_RATE_HZ * 2);
  });

  it('does not exclude fixed raw DC offsets or create FFT power from them', () => {
    const analyzer = new EegFrequencyAnalyzer({
      windowSize: EEG_ANALYSIS_WINDOW_SIZE,
      sampleRateHz: EEG_SAMPLE_RATE_HZ,
      filter: new IdentityEegFilter(),
    });
    const [result] = analyzer.pushBatch(
      createBatch(20, {
        getValue: () => 0.125,
      }),
    );

    expect(result?.engagementIndex).toBeNull();
    expect(result?.bandPowers?.beta ?? 0).toBe(0);
    expect(result?.bandPowers?.alpha ?? 0).toBe(0);
    expect(result?.bandPowers?.theta ?? 0).toBe(0);
    expect(result?.bandPowers?.delta ?? 0).toBe(0);
    expect(result?.bandPowers?.gamma ?? 0).toBe(0);
  });

  it('uses the default registered filter with 50 Hz notch when no filter is supplied', () => {
    const filteredSamples: number[] = [];
    const analyzer = new EegFrequencyAnalyzer({
      sampleRateHz: EEG_SAMPLE_RATE_HZ,
      hopSize: EEG_ANALYSIS_WINDOW_SIZE,
      onFilteredSample: (value) => filteredSamples.push(value),
    });

    analyzer.pushBatch(createBatch(50, { sampleCount: EEG_SAMPLE_RATE_HZ * 6 }));
    const steadySamples = filteredSamples.slice(Math.floor(filteredSamples.length * 0.6));
    const peak = Math.max(...steadySamples.map((value) => Math.abs(value)));

    expect(peak).toBeLessThan(TEST_SIGNAL_AMPLITUDE_VOLTS * 0.02);
  });

  it('emits one FFT result per 0.5 second hop after the 2 second window fills', () => {
    const analyzer = new EegFrequencyAnalyzer({
      windowSize: EEG_ANALYSIS_WINDOW_SIZE,
      sampleRateHz: EEG_SAMPLE_RATE_HZ,
      filter: new IdentityEegFilter(),
    });
    const results = [
      analyzer.pushBatch(createBatch(20, { sampleCount: EEG_ANALYSIS_HOP_SIZE })),
      analyzer.pushBatch(createBatch(20, { sampleCount: EEG_ANALYSIS_HOP_SIZE })),
      analyzer.pushBatch(createBatch(20, { sampleCount: EEG_ANALYSIS_HOP_SIZE })),
      analyzer.pushBatch(createBatch(20, { sampleCount: EEG_ANALYSIS_HOP_SIZE })),
      analyzer.pushBatch(createBatch(20, { sampleCount: EEG_ANALYSIS_HOP_SIZE })),
    ];

    expect(results.slice(0, 3)).toEqual([[], [], []]);
    expect(results[3][0]?.sampleIndex).toBe(EEG_ANALYSIS_WINDOW_SIZE - 1);
    expect(results[4][0]?.sampleIndex).toBe(EEG_ANALYSIS_WINDOW_SIZE + EEG_ANALYSIS_HOP_SIZE - 1);
  });

  it('emits every due hop when a large batch contains multiple analysis points', () => {
    const analyzer = new EegFrequencyAnalyzer({
      windowSize: EEG_ANALYSIS_WINDOW_SIZE,
      sampleRateHz: EEG_SAMPLE_RATE_HZ,
      filter: new IdentityEegFilter(),
    });

    const results = analyzer.pushBatch(
      createBatch(20, { sampleCount: EEG_ANALYSIS_WINDOW_SIZE + EEG_ANALYSIS_HOP_SIZE * 2 }),
    );

    expect(results).toHaveLength(3);
    expect(results.map((result) => result.sampleIndex)).toEqual([
      EEG_ANALYSIS_WINDOW_SIZE - 1,
      EEG_ANALYSIS_WINDOW_SIZE + EEG_ANALYSIS_HOP_SIZE - 1,
      EEG_ANALYSIS_WINDOW_SIZE + EEG_ANALYSIS_HOP_SIZE * 2 - 1,
    ]);
  });

  it('honours fftSize option and rejects sizes smaller than the window', () => {
    for (const fftSize of [512, 1024, 2048]) {
      const analyzer = new EegFrequencyAnalyzer({
        windowSize: EEG_ANALYSIS_WINDOW_SIZE,
        sampleRateHz: EEG_SAMPLE_RATE_HZ,
        filter: new IdentityEegFilter(),
        hopSize: EEG_ANALYSIS_WINDOW_SIZE,
        fftSize,
      });
      const [result] = analyzer.pushBatch(createBatch(10));
      expect(result).toBeDefined();
      expect(result.bandPowers.alpha).toBeGreaterThan(result.bandPowers.theta);
      expect(result.bandPowers.alpha).toBeGreaterThan(result.bandPowers.beta);
    }
    expect(
      () =>
        new EegFrequencyAnalyzer({
          windowSize: EEG_ANALYSIS_WINDOW_SIZE,
          sampleRateHz: EEG_SAMPLE_RATE_HZ,
          filter: new IdentityEegFilter(),
          fftSize: 256,
        }),
    ).toThrow();
  });

  it('invokes onFilteredSample exactly once per input sample', () => {
    const seen: number[] = [];
    const analyzer = new EegFrequencyAnalyzer({
      windowSize: EEG_ANALYSIS_WINDOW_SIZE,
      sampleRateHz: EEG_SAMPLE_RATE_HZ,
      filter: new IdentityEegFilter(),
      hopSize: EEG_ANALYSIS_WINDOW_SIZE,
      onFilteredSample: (v) => seen.push(v),
    });
    analyzer.pushBatch(createBatch(10, { sampleCount: 125 }));
    expect(seen).toHaveLength(125);
  });

});
