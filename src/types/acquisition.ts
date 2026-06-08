import type {
  EegAnalysisPoint,
  EegAnalysisState,
  EegAnnotationLabel,
  EegAnnotationRecord,
  EegBrainHeatmapState,
  EegFocusStatePoint,
} from './eeg';
import type { EegHardwareConfig } from '../transport/eegHardwareConfig';

export type AcquisitionStatus =
  | 'idle'
  | 'requesting-device'
  | 'device-selected'
  | 'connecting'
  | 'ready'
  | 'disconnected'
  | 'error';

export type EegTransportMode = 'serial' | 'bridge-coc';

export interface AcquisitionDeviceSummary {
  id: string;
  name: string | null;
  canForgetAccess: boolean;
  transport: EegTransportMode;
  usbVendorId?: number;
  usbProductId?: number;
}

export type AcquisitionDiagnosticStatus = 'running' | 'success' | 'error' | 'info';

export interface AcquisitionDiagnosticEntry {
  id: number;
  timestamp: string;
  phase: string;
  status: AcquisitionDiagnosticStatus;
  message: string;
  detail?: string;
  durationMs?: number;
}

export interface NewAcquisitionDiagnosticEntry {
  phase: string;
  status: AcquisitionDiagnosticStatus;
  message: string;
  detail?: string;
  durationMs?: number;
}

export interface EegStreamState {
  isStarting: boolean;
  isStreaming: boolean;
  isStalled: boolean;
  writesRawCsv: boolean;
  outputFileName: string | null;
  outputFileReady: boolean;
  sourceLabel: string | null;
  startedAt: string | null;
  packetCount: number;
  batchCount: number;
  sampleCount: number;
  invalidPacketCount: number;
  droppedPacketCount: number;
  droppedSampleCount: number;
  lastPacketSeq: number | null;
  lastSampleAt: string | null;
  writeError: string | null;
}

export interface EegDrawingState {
  rawWaveform: boolean;
  filteredWaveform: boolean;
  fiveBand: boolean;
  brainHeatmap: boolean;
  engagementTrend: boolean;
  focusState: boolean;
}

export interface EegAcquisitionState {
  channelCount: number;
  hardwareConfig: EegHardwareConfig;
  hardwareConfigLocked: boolean;
}

export interface AcquisitionState {
  transportMode: EegTransportMode;
  status: AcquisitionStatus;
  isSupported: boolean;
  isAvailable: boolean | null;
  isSerialSupported: boolean;
  devices: AcquisitionDeviceSummary[];
  selectedDeviceId: string | null;
  connectedDeviceId: string | null;
  diagnostics: AcquisitionDiagnosticEntry[];
  acquisition: EegAcquisitionState;
  stream: EegStreamState;
  drawing: EegDrawingState;
  analysis: EegAnalysisState;
  brainHeatmap: EegBrainHeatmapState;
  analysisPoints: EegAnalysisPoint[];
  focusStatePoints: EegFocusStatePoint[];
  annotationLabels: EegAnnotationLabel[];
  annotationRecords: EegAnnotationRecord[];
  errorMessage: string | null;
}

export interface StartEegStreamInput {
  writeRawCsv: boolean;
  recordFiveBandFeatures: boolean;
}
