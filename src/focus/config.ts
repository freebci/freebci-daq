/*
 * Focus calibration parameters.
 *
 * These values are tuned for the specific EEG hardware in use.
 * Adjust via the Advanced Tuning panel in the System page,
 * environment variables, or directly in this file.
 * See TUNING.md for guidance.
 */

import { getTuningValue } from '../utils/tuningStorage';

function resolveFocusNumber(
  localStorageKey: string,
  envKey: string,
  fallback: number,
): number {
  const local = getTuningValue(
    localStorageKey as 'focus-baseline' | 'focus-decision' | 'focus-warmup',
  );
  if (local !== null) return local;
  const env = Number(import.meta.env[envKey]);
  if (Number.isFinite(env)) return env;
  return fallback;
}

export const FOCUS_BASELINE_SECONDS = resolveFocusNumber(
  'focus-baseline',
  'VITE_FOCUS_BASELINE',
  15,
);

export const FOCUS_DECISION_SECONDS = resolveFocusNumber(
  'focus-decision',
  'VITE_FOCUS_DECISION',
  15,
);

export const FOCUS_DECISION_MIN_SECONDS = 5;

export const FOCUS_DECISION_MAX_SECONDS = 300;

export const FOCUS_WARMUP_SECONDS = resolveFocusNumber(
  'focus-warmup',
  'VITE_FOCUS_WARMUP',
  30,
);
