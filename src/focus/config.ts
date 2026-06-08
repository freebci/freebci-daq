/*
 * Focus calibration parameters.
 *
 * These values are tuned for the specific EEG hardware in use.
 * Adjust via environment variables or directly in this file.
 * See TUNING.md for guidance.
 */

export const FOCUS_BASELINE_SECONDS =
  Number(import.meta.env.VITE_FOCUS_BASELINE) || 15;

export const FOCUS_DECISION_SECONDS =
  Number(import.meta.env.VITE_FOCUS_DECISION) || 15;

export const FOCUS_DECISION_MIN_SECONDS = 5;

export const FOCUS_DECISION_MAX_SECONDS = 300;

export const FOCUS_WARMUP_SECONDS =
  Number(import.meta.env.VITE_FOCUS_WARMUP) || 30;
