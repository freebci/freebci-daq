export type EegFocusCalibrationPhase =
  | 'idle'
  | 'waiting-warmup'
  | 'collecting-baseline'
  | 'active';

export type EegFocusStateValue = 0 | 1;

export interface EegFocusCalibrationState {
  phase: EegFocusCalibrationPhase;
  warmupEndsAtSeconds: number;
  baselineStartedAtSeconds: number | null;
  baselineEndsAtSeconds: number | null;
  baselineValue: number | null;
  referenceValue: number | null;
  lastDecisionWindowEndSeconds: number | null;
  focusState: EegFocusStateValue | null;
  focusValue: number | null;
  updatedAt: string | null;
}

export interface EegFocusStatePoint {
  timeSeconds: number;
  state: EegFocusStateValue;
  engagementValue: number;
  referenceValue: number;
  windowStartSeconds: number;
  windowEndSeconds: number;
  updatedAt: string;
}
