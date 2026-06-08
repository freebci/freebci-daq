/*
 * Focus calibration parameters.
 *
 * These values are tuned for the specific EEG hardware in use.
 * Adjust based on your device's signal characteristics and noise floor.
 */

export const FOCUS_BASELINE_SECONDS = 30;

export const FOCUS_DECISION_SECONDS = 30;

export const FOCUS_DECISION_MIN_SECONDS = 5;

export const FOCUS_DECISION_MAX_SECONDS = 300;

export const FOCUS_WARMUP_SECONDS = 40;

export const FOCUS_EMA_ALPHA = 0.25;

export const FOCUS_ALERT_THRESHOLD = 0.5;
