import {
  EEG_ANALYSIS_HOP_SECONDS,
  EEG_ANALYSIS_WINDOW_SECONDS,
  EEG_DEFAULT_FFT_SIZE,
} from '../config/eeg';

export function nextPowerOfTwo(value: number): number {
  let power = 1;

  while (power < value) {
    power *= 2;
  }

  return power;
}

export function getAnalysisWindowSize(sampleRateHz: number): number {
  return Math.max(1, Math.round(sampleRateHz * EEG_ANALYSIS_WINDOW_SECONDS));
}

export function getAnalysisHopSize(sampleRateHz: number): number {
  return Math.max(1, Math.round(sampleRateHz * EEG_ANALYSIS_HOP_SECONDS));
}

export function getAutoFftSizeForWindowSize(
  windowSize: number,
  minimumFftSize = EEG_DEFAULT_FFT_SIZE,
): number {
  return nextPowerOfTwo(Math.max(windowSize, minimumFftSize));
}

export function getAutoFftSizeForSampleRate(sampleRateHz: number): number {
  return getAutoFftSizeForWindowSize(getAnalysisWindowSize(sampleRateHz));
}
