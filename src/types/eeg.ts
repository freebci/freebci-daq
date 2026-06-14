import type { EegTransportMode } from './acquisition';
import type { EegFilterId } from '../analysis/filterRegistry';
import type { EegFocusCalibrationState } from '../focus/types';

export type EegAlgorithmId = 'engagement-index';

export type { EegFilterId };

export type EegAnnotationKind = 'interval' | 'event';

export interface EegAnnotationLabel {
  id: string;
  name: string;
  kind: EegAnnotationKind;
  color: string;
}

export interface EegEventAnnotationRecord {
  labelId: string;
  kind: 'event';
  timeSeconds: number;
  recordedAtMs: number;
}

export interface EegIntervalAnnotationRecord {
  labelId: string;
  kind: 'interval';
  startTimeSeconds: number;
  endTimeSeconds: number | null;
  startRecordedAtMs: number;
  endRecordedAtMs: number | null;
}

export type EegAnnotationRecord = EegEventAnnotationRecord | EegIntervalAnnotationRecord;

export interface EegBandPowers {
  delta: number;
  theta: number;
  alpha: number;
  beta: number;
  gamma: number;
}

export type EegHeatmapMetric =
  | 'delta'
  | 'theta'
  | 'alpha'
  | 'beta'
  | 'gamma'
  | 'engagementIndex';

export interface EegHeatmapFrame {
  siteName: string;
  channelName: string;
  timeSeconds: number;
  sampleIndex: number;
  bandPowers: EegBandPowers;
  engagementIndex: number | null;
  updatedAt: string;
}

export interface EegHeatmapSiteValue {
  siteName: string;
  channelName: string;
  value: number;
  sampleCount: number;
  x: number | null;
  y: number | null;
}

export interface EegBrainHeatmapState {
  metric: EegHeatmapMetric;
  frames: EegHeatmapFrame[];
}

export interface EegSpectrumSnapshot {
  binHz: number;
  powers: number[];
  capturedAt: number;
  filterLabel: string;
  fftSize: number;
  channelName?: string;
}

export interface EegChannelAnalysisState {
  bandPowers: EegBandPowers | null;
  engagementIndex: number | null;
  engagementEma: number | null;
  windowSampleCount: number;
  updatedAt: string | null;
  spectrum: { binHz: number; powers: number[] } | null;
}

export interface EegAnalysisState {
  selectedAlgorithm: EegAlgorithmId;
  selectedFilterId: EegFilterId;
  filterParams: Record<string, number>;
  fftSize: number;
  engagementEmaAlpha: number;
  initialUnreliableSeconds: number;
  focusBaselineSeconds: number;
  focusOutputWindowSeconds: number;
  liveWindowSeconds: number;
  engagementAlertThreshold: number;
  bandPowers: EegBandPowers | null;
  engagementIndex: number | null;
  engagementEma: number | null;
  windowSampleCount: number;
  updatedAt: string | null;
  spectrum: { binHz: number; powers: number[] } | null;
  referenceSpectrum: EegSpectrumSnapshot | null;
  channels: Record<string, EegChannelAnalysisState>;
  focusCalibration: EegFocusCalibrationState;
}

export interface EegAnalysisResult {
  channelName: string;
  bandPowers: EegBandPowers;
  engagementIndex: number | null;
  windowSampleCount: number;
  sampleIndex: number;
  timeSeconds: number;
  updatedAt: string;
  fftSize?: number;
  spectrum: { binHz: number; powers: number[] };
}

export type EegAnalysisPoint = Omit<EegAnalysisResult, 'spectrum'>;

export interface EegSample {
  sampleIndex: number;
  eegValue: number;
  channels?: Record<string, number>;
  dcValidity: number | null;
  rldValidity: number | null;
}

export interface EegSampleBatch {
  packetSeq: number;
  receivedAt: string;
  source?: EegTransportMode;
  droppedSamples?: number;
  samples: EegSample[];
}
