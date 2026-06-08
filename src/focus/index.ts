export { FocusStatePanel } from './FocusStatePanel';
export type { EegFocusCalibrationPhase, EegFocusCalibrationState, EegFocusStatePoint } from './types';
export {
  createInitialFocusCalibrationState,
  advanceFocusCalibration,
  createFocusCalibrationForCurrentStreamTime,
  clampFocusReferenceValue,
  clampFocusOutputWindowSeconds,
  trimFocusStatePoints,
} from './focusCalibration';
export {
  FOCUS_BASELINE_SECONDS,
  FOCUS_DECISION_SECONDS,
  FOCUS_DECISION_MIN_SECONDS,
  FOCUS_DECISION_MAX_SECONDS,
  FOCUS_WARMUP_SECONDS,
} from './config';
