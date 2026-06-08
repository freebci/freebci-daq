import { getTuningValue } from '../utils/tuningStorage';

export const EEG_SAMPLE_RATE_HZ = 250;

export const EEG_LIVE_WINDOW_SECONDS = 300;

export const EEG_LIVE_WINDOW_MIN_SECONDS = 30;

export const EEG_LIVE_WINDOW_MAX_SECONDS = 600;

export const EEG_ANALYSIS_HISTORY_SECONDS = EEG_LIVE_WINDOW_MAX_SECONDS;

export const EEG_ANALYSIS_WINDOW_SECONDS = 2;

export const EEG_ANALYSIS_HOP_SECONDS = 0.5;

function resolveNumber(
  localStorageKey: string,
  envKey: string,
  fallback: number,
): number {
  const local = getTuningValue(
    localStorageKey as 'eeg-ema-alpha' | 'eeg-alert-threshold' | 'eeg-initial-unreliable',
  );
  if (local !== null) return local;
  const env = Number(import.meta.env[envKey]);
  if (Number.isFinite(env)) return env;
  return fallback;
}

export const EEG_ENGAGEMENT_EMA_ALPHA = resolveNumber(
  'eeg-ema-alpha',
  'VITE_EMA_ALPHA',
  0.1,
);

export const EEG_ENGAGEMENT_ALERT_THRESHOLD = resolveNumber(
  'eeg-alert-threshold',
  'VITE_ALERT_THRESHOLD',
  0.3,
);

export const EEG_INITIAL_UNRELIABLE_SECONDS = resolveNumber(
  'eeg-initial-unreliable',
  'VITE_INITIAL_UNRELIABLE',
  30,
);

export const EEG_ANALYSIS_WINDOW_SIZE = EEG_SAMPLE_RATE_HZ * EEG_ANALYSIS_WINDOW_SECONDS;

export const EEG_ANALYSIS_HOP_SIZE = EEG_SAMPLE_RATE_HZ * EEG_ANALYSIS_HOP_SECONDS;

export const EEG_DEFAULT_FFT_SIZE = 512;
