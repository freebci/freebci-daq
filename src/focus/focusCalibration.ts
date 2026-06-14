import type { EegAnalysisPoint } from '../types/eeg';
import { EEG_ANALYSIS_HISTORY_SECONDS } from '../config/eeg';
import {
  FOCUS_BASELINE_SECONDS,
  FOCUS_BASELINE_MAX_SECONDS,
  FOCUS_BASELINE_MIN_SECONDS,
  FOCUS_DECISION_SECONDS,
  FOCUS_DECISION_MAX_SECONDS,
  FOCUS_DECISION_MIN_SECONDS,
  FOCUS_WARMUP_SECONDS,
} from './config';
import type {
  EegFocusCalibrationState,
  EegFocusStatePoint,
} from './types';

export interface EegFocusTimingConfig {
  warmupSeconds: number;
  baselineSeconds: number;
}

const DEFAULT_FOCUS_TIMING_CONFIG: EegFocusTimingConfig = {
  warmupSeconds: FOCUS_WARMUP_SECONDS,
  baselineSeconds: FOCUS_BASELINE_SECONDS,
};

function median(values: number[]): number | null {
  if (values.length === 0) return null;

  const sorted = [...values].sort((a, b) => a - b);
  const middleIndex = Math.floor(sorted.length / 2);

  if (sorted.length % 2 !== 0) {
    return sorted[middleIndex];
  }

  return (sorted[middleIndex - 1] + sorted[middleIndex]) / 2;
}

function medianEngagementIndexInWindow(
  points: EegAnalysisPoint[],
  startSeconds: number,
  endSeconds: number,
): number | null {
  const values = points
    .filter((point) => {
      const value = point.engagementIndex;
      return (
        point.timeSeconds >= startSeconds &&
        point.timeSeconds <= endSeconds &&
        value !== null &&
        Number.isFinite(value)
      );
    })
    .map((point) => point.engagementIndex as number);

  return median(values);
}

export function trimFocusStatePoints(points: EegFocusStatePoint[]): EegFocusStatePoint[] {
  const latestTimeSeconds = points[points.length - 1]?.timeSeconds;

  if (latestTimeSeconds === undefined) {
    return [];
  }

  const windowStartSeconds = latestTimeSeconds - EEG_ANALYSIS_HISTORY_SECONDS;
  return points.filter((point) => point.timeSeconds >= windowStartSeconds);
}

export function createInitialFocusCalibrationState(
  timingConfig = DEFAULT_FOCUS_TIMING_CONFIG,
): EegFocusCalibrationState {
  const warmupSeconds = clampFocusWarmupSeconds(timingConfig.warmupSeconds);

  return {
    phase: 'idle',
    warmupEndsAtSeconds: warmupSeconds,
    baselineStartedAtSeconds: null,
    baselineEndsAtSeconds: null,
    baselineValue: null,
    referenceValue: null,
    lastDecisionWindowEndSeconds: null,
    focusState: null,
    focusValue: null,
    updatedAt: null,
  };
}

export function advanceFocusCalibration(
  focusCalibration: EegFocusCalibrationState,
  outputWindowSeconds: number,
  analysisPoints: EegAnalysisPoint[],
  focusStatePoints: EegFocusStatePoint[],
  timingConfig = DEFAULT_FOCUS_TIMING_CONFIG,
): {
  focusCalibration: EegFocusCalibrationState;
  focusStatePoints: EegFocusStatePoint[];
} {
  const latestPoint = analysisPoints[analysisPoints.length - 1];

  if (!latestPoint || focusCalibration.phase === 'idle') {
    return { focusCalibration, focusStatePoints };
  }

  let nextFocusCalibration = focusCalibration;
  let nextFocusStatePoints = focusStatePoints;
  const baselineSeconds = clampFocusBaselineSeconds(timingConfig.baselineSeconds);

  if (
    nextFocusCalibration.phase === 'waiting-warmup' &&
    latestPoint.timeSeconds >= nextFocusCalibration.warmupEndsAtSeconds
  ) {
    nextFocusCalibration = {
      ...nextFocusCalibration,
      phase: 'collecting-baseline',
      baselineStartedAtSeconds: nextFocusCalibration.warmupEndsAtSeconds,
      baselineEndsAtSeconds:
        nextFocusCalibration.warmupEndsAtSeconds + baselineSeconds,
      updatedAt: latestPoint.updatedAt,
    };
  }

  if (nextFocusCalibration.phase === 'collecting-baseline') {
    const baselineStartedAtSeconds = nextFocusCalibration.baselineStartedAtSeconds;
    const baselineEndsAtSeconds = nextFocusCalibration.baselineEndsAtSeconds;

    if (
      baselineStartedAtSeconds !== null &&
      baselineEndsAtSeconds !== null &&
      latestPoint.timeSeconds >= baselineEndsAtSeconds
    ) {
      const baselineValue = medianEngagementIndexInWindow(
        analysisPoints,
        baselineStartedAtSeconds,
        baselineEndsAtSeconds,
      );

      if (baselineValue !== null) {
        nextFocusCalibration = {
          ...nextFocusCalibration,
          phase: 'active',
          baselineValue,
          referenceValue: baselineValue,
          lastDecisionWindowEndSeconds: baselineEndsAtSeconds,
          focusState: null,
          focusValue: null,
          updatedAt: latestPoint.updatedAt,
        };
      } else {
        nextFocusCalibration = {
          ...nextFocusCalibration,
          baselineStartedAtSeconds: latestPoint.timeSeconds,
          baselineEndsAtSeconds: latestPoint.timeSeconds + baselineSeconds,
          updatedAt: latestPoint.updatedAt,
        };
      }
    }
  }

  const referenceValue = nextFocusCalibration.referenceValue;

  if (nextFocusCalibration.phase !== 'active' || referenceValue === null) {
    return { focusCalibration: nextFocusCalibration, focusStatePoints: nextFocusStatePoints };
  }

  let nextWindowEndSeconds =
    (nextFocusCalibration.lastDecisionWindowEndSeconds ??
      nextFocusCalibration.baselineEndsAtSeconds ??
      latestPoint.timeSeconds) + outputWindowSeconds;

  while (latestPoint.timeSeconds >= nextWindowEndSeconds) {
    const windowStartSeconds = nextWindowEndSeconds - outputWindowSeconds;
    const engagementValue = medianEngagementIndexInWindow(
      analysisPoints,
      windowStartSeconds,
      nextWindowEndSeconds,
    );

    if (engagementValue !== null) {
      const state = engagementValue >= referenceValue ? 1 : 0;
      const focusPoint: EegFocusStatePoint = {
        timeSeconds: nextWindowEndSeconds,
        state,
        engagementValue,
        referenceValue,
        windowStartSeconds,
        windowEndSeconds: nextWindowEndSeconds,
        updatedAt: latestPoint.updatedAt,
      };

      nextFocusStatePoints = trimFocusStatePoints([...nextFocusStatePoints, focusPoint]);
      nextFocusCalibration = {
        ...nextFocusCalibration,
        lastDecisionWindowEndSeconds: nextWindowEndSeconds,
        focusState: state,
        focusValue: engagementValue,
        updatedAt: latestPoint.updatedAt,
      };
    } else {
      nextFocusCalibration = {
        ...nextFocusCalibration,
        lastDecisionWindowEndSeconds: nextWindowEndSeconds,
        updatedAt: latestPoint.updatedAt,
      };
    }

    nextWindowEndSeconds += outputWindowSeconds;
  }

  return { focusCalibration: nextFocusCalibration, focusStatePoints: nextFocusStatePoints };
}

export function createFocusCalibrationForCurrentStreamTime(
  currentStreamTimeSeconds: number,
  timingConfig = DEFAULT_FOCUS_TIMING_CONFIG,
): EegFocusCalibrationState {
  const warmupSeconds = clampFocusWarmupSeconds(timingConfig.warmupSeconds);
  const baselineSeconds = clampFocusBaselineSeconds(timingConfig.baselineSeconds);
  const canStartBaseline = currentStreamTimeSeconds >= warmupSeconds;
  const baselineStartedAtSeconds = canStartBaseline ? currentStreamTimeSeconds : null;

  return {
    phase: canStartBaseline ? 'collecting-baseline' : 'waiting-warmup',
    warmupEndsAtSeconds: warmupSeconds,
    baselineStartedAtSeconds,
    baselineEndsAtSeconds:
      baselineStartedAtSeconds === null
        ? null
        : baselineStartedAtSeconds + baselineSeconds,
    baselineValue: null,
    referenceValue: null,
    lastDecisionWindowEndSeconds: null,
    focusState: null,
    focusValue: null,
    updatedAt: null,
  };
}

export function clampFocusReferenceValue(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, value);
}

export function clampFocusOutputWindowSeconds(seconds: number): number {
  if (!Number.isFinite(seconds)) return FOCUS_DECISION_SECONDS;
  return Math.max(
    FOCUS_DECISION_MIN_SECONDS,
    Math.min(FOCUS_DECISION_MAX_SECONDS, Math.round(seconds)),
  );
}

export function clampFocusBaselineSeconds(seconds: number): number {
  if (!Number.isFinite(seconds)) return FOCUS_BASELINE_SECONDS;
  return Math.max(
    FOCUS_BASELINE_MIN_SECONDS,
    Math.min(FOCUS_BASELINE_MAX_SECONDS, Math.round(seconds)),
  );
}

export function clampFocusWarmupSeconds(seconds: number): number {
  if (!Number.isFinite(seconds)) return FOCUS_WARMUP_SECONDS;
  return Math.max(0, Math.round(seconds));
}
