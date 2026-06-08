import FFT from 'fft.js';
import {
  EEG_ANALYSIS_HOP_SIZE,
  EEG_ANALYSIS_WINDOW_SIZE,
  EEG_DEFAULT_FFT_SIZE,
  EEG_SAMPLE_RATE_HZ,
} from '../config/eeg';
import { nextPowerOfTwo } from './fftConfig';
import type {
  EegAlgorithmId,
  EegAnalysisResult,
  EegBandPowers,
  EegSampleBatch,
  EegSample,
} from '../types/eeg';
import { calculateAlgorithmScore } from '../algorithms';
import {
  DEFAULT_FILTER_ID,
  createFilterById,
  getFilterDefaultParams,
} from './filterRegistry';
import type { EegFilter } from './eegFilters';

export interface EegSpectrum {
  binHz: number;
  powers: number[];
}

export const EEG_FREQUENCY_BANDS = {
  delta: { minHz: 0.5, maxHz: 4 },
  theta: { minHz: 4, maxHz: 8 },
  alpha: { minHz: 8, maxHz: 13 },
  beta: { minHz: 13, maxHz: 30 },
  gamma: { minHz: 30, maxHz: 45 },
} as const;

type BandName = keyof EegBandPowers;

export class NumberRingBuffer {
  private readonly values: number[];

  private writeIndex = 0;

  private itemCount = 0;

  constructor(private readonly capacity: number) {
    if (!Number.isInteger(capacity) || capacity <= 0) {
      throw new Error('Ring buffer capacity must be a positive integer.');
    }

    this.values = new Array(capacity).fill(0);
  }

  get length(): number {
    return this.itemCount;
  }

  clear(): void {
    this.writeIndex = 0;
    this.itemCount = 0;
  }

  push(value: number): void {
    this.values[this.writeIndex] = value;
    this.writeIndex = (this.writeIndex + 1) % this.capacity;
    this.itemCount = Math.min(this.itemCount + 1, this.capacity);
  }

  copyLatestInto(target: number[]): number {
    const count = Math.min(this.itemCount, target.length);
    const startIndex = (this.writeIndex - count + this.capacity) % this.capacity;

    for (let index = 0; index < count; index += 1) {
      target[index] = this.values[(startIndex + index) % this.capacity];
    }

    return count;
  }
}

function createHammingWindow(size: number): number[] {
  if (size <= 1) {
    return new Array(size).fill(1);
  }

  return Array.from({ length: size }, (_, index) => {
    return 0.54 - 0.46 * Math.cos((2 * Math.PI * index) / (size - 1));
  });
}

function mean(values: ArrayLike<number>, startIndex: number, count: number): number {
  let sum = 0;

  for (let index = 0; index < count; index += 1) {
    sum += values[startIndex + index] ?? 0;
  }

  return sum / count;
}

export interface EegBandPowerAnalysisResult {
  bandPowers: EegBandPowers;
  spectrum: EegSpectrum;
}

export class EegBandPowerAnalyzer {
  private readonly fft: FFT;

  private readonly hammingWindow: number[];

  private readonly fftInput: number[];

  private readonly spectrum: number[];

  constructor(
    private readonly windowSize = EEG_ANALYSIS_WINDOW_SIZE,
    private readonly sampleRateHz = EEG_SAMPLE_RATE_HZ,
    fftSize: number = nextPowerOfTwo(windowSize),
  ) {
    if (fftSize < windowSize) {
      throw new Error(
        `FFT size (${fftSize}) must be >= window size (${windowSize}); shrinking the window distorts comparisons.`,
      );
    }
    if ((fftSize & (fftSize - 1)) !== 0) {
      throw new Error(`FFT size must be a power of 2, got ${fftSize}.`);
    }
    this.fft = new FFT(fftSize);
    this.hammingWindow = createHammingWindow(windowSize);
    this.fftInput = new Array(fftSize).fill(0);
    this.spectrum = this.fft.createComplexArray();
  }

  calculateBandPowers(samples: ArrayLike<number>, sampleCount = samples.length): EegBandPowers {
    return this.analyze(samples, sampleCount).bandPowers;
  }

  analyze(samples: ArrayLike<number>, sampleCount = samples.length): EegBandPowerAnalysisResult {
    const availableSampleCount = Math.min(samples.length, sampleCount);
    const windowSampleCount = Math.min(availableSampleCount, this.windowSize);
    const binWidthHz = this.sampleRateHz / this.fft.size;
    const binCount = this.fft.size / 2 + 1;

    if (windowSampleCount === 0) {
      return {
        bandPowers: { delta: 0, theta: 0, alpha: 0, beta: 0, gamma: 0 },
        spectrum: { binHz: binWidthHz, powers: new Array(binCount).fill(0) },
      };
    }

    const startIndex = availableSampleCount - windowSampleCount;
    const sampleMean = mean(samples, startIndex, windowSampleCount);

    for (let index = 0; index < this.fft.size; index += 1) {
      if (index >= windowSampleCount) {
        this.fftInput[index] = 0;
        continue;
      }

      this.fftInput[index] =
        ((samples[startIndex + index] ?? 0) - sampleMean) * this.hammingWindow[index];
    }

    this.fft.realTransform(this.spectrum, this.fftInput);

    return this.collectSpectrum(binWidthHz, binCount);
  }

  private collectSpectrum(binWidthHz: number, binCount: number): EegBandPowerAnalysisResult {
    const bandPowers: EegBandPowers = {
      delta: 0,
      theta: 0,
      alpha: 0,
      beta: 0,
      gamma: 0,
    };
    const powers: number[] = new Array(binCount).fill(0);
    const sizeSquared = this.fft.size * this.fft.size;

    for (let binIndex = 0; binIndex < binCount; binIndex += 1) {
      const real = this.spectrum[binIndex * 2] ?? 0;
      const imaginary = this.spectrum[binIndex * 2 + 1] ?? 0;
      const power = (real * real + imaginary * imaginary) / sizeSquared;
      powers[binIndex] = power;

      if (binIndex === 0) {
        continue;
      }

      const bandName = getBandName(binIndex * binWidthHz);

      if (bandName) {
        bandPowers[bandName] += power;
      }
    }

    return {
      bandPowers,
      spectrum: { binHz: binWidthHz, powers },
    };
  }
}

export interface EegFrequencyAnalyzerOptions {
  windowSize?: number;
  sampleRateHz?: number;
  filter?: EegFilter;
  hopSize?: number;
  algorithmId?: EegAlgorithmId;
  fftSize?: number;
  channelName?: string;
  sampleSelector?: (sample: EegSample) => number | null;
  onFilteredSample?: (filteredValue: number) => void;
}

export class EegFrequencyAnalyzer {
  private readonly filter: EegFilter;

  private readonly bandPowerAnalyzer: EegBandPowerAnalyzer;

  private readonly filteredSamples: NumberRingBuffer;

  private readonly filteredWindow: number[];

  private readonly windowSize: number;

  private readonly sampleRateHz: number;

  private readonly hopSize: number;

  private readonly algorithmId: EegAlgorithmId;

  private readonly channelName: string;

  private readonly sampleSelector: (sample: EegSample) => number | null;

  private readonly onFilteredSample?: (filteredValue: number) => void;

  private processedSampleCount = 0;

  private nextAnalysisSampleCount: number;

  constructor(options: EegFrequencyAnalyzerOptions = {}) {
    const {
      windowSize = EEG_ANALYSIS_WINDOW_SIZE,
      sampleRateHz = EEG_SAMPLE_RATE_HZ,
      filter = createFilterById(
        DEFAULT_FILTER_ID,
        getFilterDefaultParams(DEFAULT_FILTER_ID),
        sampleRateHz,
      ),
      hopSize = EEG_ANALYSIS_HOP_SIZE,
      algorithmId = 'engagement-index',
      fftSize = EEG_DEFAULT_FFT_SIZE,
      channelName = 'ch0',
      sampleSelector = (sample) => sample.eegValue,
      onFilteredSample,
    } = options;

    this.windowSize = windowSize;
    this.sampleRateHz = sampleRateHz;
    this.hopSize = hopSize;
    this.algorithmId = algorithmId;
    this.channelName = channelName;
    this.sampleSelector = sampleSelector;
    this.filter = filter;
    this.onFilteredSample = onFilteredSample;
    this.bandPowerAnalyzer = new EegBandPowerAnalyzer(windowSize, sampleRateHz, fftSize);
    this.filteredSamples = new NumberRingBuffer(windowSize);
    this.filteredWindow = new Array(windowSize).fill(0);
    this.nextAnalysisSampleCount = windowSize;
  }

  reset(): void {
    this.filter.reset();

    this.filteredSamples.clear();
    this.processedSampleCount = 0;
    this.nextAnalysisSampleCount = this.windowSize;
  }

  pushBatch(batch: EegSampleBatch): EegAnalysisResult[] {
    const results: EegAnalysisResult[] = [];

    for (const sample of batch.samples) {
      this.pushSample(sample);

      if (this.shouldAnalyze()) {
        results.push(this.createAnalysisResult(batch.receivedAt));
        this.nextAnalysisSampleCount += this.hopSize;
      }
    }

    return results;
  }

  private shouldAnalyze(): boolean {
    return (
      this.filteredSamples.length >= this.windowSize &&
      this.processedSampleCount >= this.nextAnalysisSampleCount
    );
  }

  private createAnalysisResult(updatedAt: string): EegAnalysisResult {
    const sampleCount = this.copyLatestFilteredWindows();
    const sampleIndex = this.processedSampleCount - 1;
    const { bandPowers, spectrum } = this.bandPowerAnalyzer.analyze(
      this.filteredWindow,
      sampleCount,
    );
    const engagementIndex = calculateAlgorithmScore(this.algorithmId, bandPowers);

    return {
      channelName: this.channelName,
      bandPowers,
      engagementIndex,
      windowSampleCount: this.windowSize,
      sampleIndex,
      timeSeconds: sampleIndex / this.sampleRateHz,
      updatedAt,
      fftSize: spectrum.powers.length > 1 ? (spectrum.powers.length - 1) * 2 : 0,
      spectrum: { binHz: spectrum.binHz, powers: spectrum.powers.slice() },
    };
  }

  private pushSample(sample: EegSample): void {
    const rawValue = this.sampleSelector(sample);

    if (rawValue === null || !Number.isFinite(rawValue)) {
      return;
    }

    const filteredValue = this.filter.processSample(rawValue);
    this.filteredSamples.push(filteredValue);
    this.onFilteredSample?.(filteredValue);
    this.processedSampleCount += 1;
  }

  private copyLatestFilteredWindows(): number {
    return this.filteredSamples.copyLatestInto(this.filteredWindow);
  }
}

function getBandName(frequencyHz: number): BandName | null {
  for (const [bandName, range] of Object.entries(EEG_FREQUENCY_BANDS) as Array<
    [BandName, (typeof EEG_FREQUENCY_BANDS)[BandName]]
  >) {
    if (frequencyHz >= range.minHz && frequencyHz < range.maxHz) {
      return bandName;
    }
  }

  return null;
}
