import { describe, expect, it } from 'vitest';
import {
  getAnalysisHopSize,
  getAnalysisWindowSize,
  getAutoFftSizeForSampleRate,
} from '../src/analysis/fftConfig';

describe('FFT analysis sizing', () => {
  it('uses a 2-second window and 0.5-second hop for each sample rate', () => {
    expect(getAnalysisWindowSize(250)).toBe(500);
    expect(getAnalysisHopSize(250)).toBe(125);
    expect(getAnalysisWindowSize(8_000)).toBe(16_000);
    expect(getAnalysisHopSize(8_000)).toBe(4_000);
  });

  it('derives the FFT size automatically from the active sample rate', () => {
    expect(getAutoFftSizeForSampleRate(125)).toBe(512);
    expect(getAutoFftSizeForSampleRate(250)).toBe(512);
    expect(getAutoFftSizeForSampleRate(500)).toBe(1_024);
    expect(getAutoFftSizeForSampleRate(1_000)).toBe(2_048);
    expect(getAutoFftSizeForSampleRate(2_000)).toBe(4_096);
    expect(getAutoFftSizeForSampleRate(4_000)).toBe(8_192);
    expect(getAutoFftSizeForSampleRate(8_000)).toBe(16_384);
  });
});
