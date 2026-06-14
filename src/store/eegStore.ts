import { create } from 'zustand';
import type {
  AcquisitionDeviceSummary,
  AcquisitionState,
  AcquisitionStatus,
  EegTransportMode,
  EegAcquisitionState,
  EegDrawingState,
  NewAcquisitionDiagnosticEntry,
} from '../types/acquisition';
import type {
  EegAlgorithmId,
  EegChannelAnalysisState,
  EegAnalysisPoint,
  EegAnalysisResult,
  EegAnnotationKind,
  EegHeatmapMetric,
  EegSampleBatch,
} from '../types/eeg';
import type { SiteBindingV1 } from '../ai/protocol';
import {
  EEG_ANALYSIS_HISTORY_SECONDS,
  EEG_DEFAULT_ENGAGEMENT_ALERT_THRESHOLD,
  EEG_DEFAULT_ENGAGEMENT_EMA_ALPHA,
  EEG_DEFAULT_FFT_SIZE,
  EEG_DEFAULT_INITIAL_UNRELIABLE_SECONDS,
  EEG_ENGAGEMENT_ALERT_THRESHOLD,
  EEG_ENGAGEMENT_EMA_ALPHA,
  EEG_INITIAL_UNRELIABLE_MAX_SECONDS,
  EEG_INITIAL_UNRELIABLE_MIN_SECONDS,
  EEG_LIVE_WINDOW_MAX_SECONDS,
  EEG_LIVE_WINDOW_MIN_SECONDS,
  EEG_LIVE_WINDOW_SECONDS,
  EEG_SAMPLE_RATE_HZ,
} from '../config/eeg';
import {
  DEFAULT_FILTER_ID,
  getFilterDefaultParams,
  getFilterDefinition,
  type EegFilterId,
} from '../analysis/filterRegistry';
import type { EegSpectrumSnapshot } from '../types/eeg';
import {
  FOCUS_DEFAULT_BASELINE_SECONDS,
  FOCUS_DEFAULT_DECISION_SECONDS,
  FOCUS_DECISION_MIN_SECONDS,
  FOCUS_DECISION_MAX_SECONDS,
} from '../focus/config';
import {
  createInitialFocusCalibrationState,
  advanceFocusCalibration,
  createFocusCalibrationForCurrentStreamTime,
  clampFocusReferenceValue,
  clampFocusBaselineSeconds,
  clampFocusOutputWindowSeconds,
  trimFocusStatePoints,
} from '../focus/focusCalibration';
import {
  EEG_DEFAULT_CHANNEL_COUNT,
  normalizeEegChannelCount,
} from '../transport/eegChannels';
import {
  DEFAULT_EEG_HARDWARE_CONFIG,
  getEffectiveEegHardwareSampleRateHz,
  normalizeEegHardwareConfig,
  type EegHardwareConfig,
} from '../transport/eegHardwareConfig';
import {
  ACTIVE_EEG_TRANSPORT_MODE,
  isImplementedEegTransportMode,
} from '../transport/eegTransport';

interface EegStore extends AcquisitionState {
  setTransportMode: (mode: EegTransportMode) => void;
  setStatus: (status: AcquisitionStatus) => void;
  upsertDevice: (device: AcquisitionDeviceSummary) => void;
  removeDevice: (deviceId: string) => void;
  setConnectedDeviceId: (deviceId: string | null) => void;
  setSupported: (supported: boolean) => void;
  setAvailable: (available: boolean | null) => void;
  setSerialSupported: (supported: boolean) => void;
  setError: (message: string | null) => void;
  addDiagnostic: (entry: NewAcquisitionDiagnosticEntry) => void;
  clearDiagnostics: () => void;
  setStreamOutputFile: (fileName: string | null, isReady: boolean) => void;
  setStreamStarting: (sourceLabel: string, writesRawCsv: boolean) => void;
  setStreamActive: (sourceLabel: string, writesRawCsv: boolean) => void;
  setStreamInactive: () => void;
  setStreamStalled: (isStalled: boolean) => void;
  resetStreamRuntime: () => void;
  setHardwareConfig: (config: Partial<EegHardwareConfig>) => void;
  setChannelCount: (channelCount: number) => void;
  lockHardwareConfig: () => void;
  unlockHardwareConfig: () => void;
  setDrawingEnabled: (key: keyof EegDrawingState, enabled: boolean) => void;
  recordStreamPacket: () => void;
  recordSerialPacketDrop: (packetCount: number, sampleCount: number) => void;
  recordInvalidStreamPacket: () => void;
  recordStreamBatch: (batch: EegSampleBatch) => void;
  recordAnalysisResults: (results: EegAnalysisResult[]) => void;
  recordHeatmapAnalysisResults: (
    binding: Pick<SiteBindingV1, 'siteName' | 'channelName'>,
    results: EegAnalysisResult[],
  ) => void;
  setBrainHeatmapMetric: (metric: EegHeatmapMetric) => void;
  clearBrainHeatmap: () => void;
  setSelectedAlgorithm: (algorithmId: EegAlgorithmId) => void;
  setSelectedFilter: (filterId: EegFilterId, params?: Record<string, number>) => void;
  setFilterParam: (key: string, value: number) => void;
  resetFilterParams: () => void;
  setEngagementEmaAlpha: (alpha: number) => void;
  setInitialUnreliableSeconds: (seconds: number) => void;
  setFocusBaselineSeconds: (seconds: number) => void;
  resetAnalysisTuning: () => void;
  setLiveWindowSeconds: (seconds: number) => void;
  setEngagementAlertThreshold: (threshold: number) => void;
  beginFocusBaseline: () => void;
  setFocusReferenceValue: (value: number) => void;
  setFocusOutputWindowSeconds: (seconds: number) => void;
  addAnnotationLabel: (name: string, kind: EegAnnotationKind) => void;
  removeAnnotationLabel: (labelId: string) => void;
  recordAnnotation: (labelId: string) => void;
  clearAnnotationRecords: () => void;
  captureSpectrumSnapshot: () => void;
  clearSpectrumSnapshot: () => void;
  setStreamWriteError: (message: string | null) => void;
  reset: () => void;
  nextAnnotationLabelId: number;
}

const ANNOTATION_LABEL_COLORS = [
  '#2563eb',
  '#059669',
  '#db2777',
  '#7c3aed',
  '#dc2626',
  '#0891b2',
  '#4f46e5',
] as const;

const initialStreamState = {
  isStarting: false,
  isStreaming: false,
  isStalled: false,
  writesRawCsv: false,
  outputFileName: null,
  outputFileReady: false,
  sourceLabel: null,
  startedAt: null,
  packetCount: 0,
  batchCount: 0,
  sampleCount: 0,
  invalidPacketCount: 0,
  droppedPacketCount: 0,
  droppedSampleCount: 0,
  lastPacketSeq: null,
  lastSampleAt: null,
  writeError: null,
};

const initialDrawingState: EegDrawingState = {
  rawWaveform: false,
  filteredWaveform: false,
  fiveBand: false,
  brainHeatmap: false,
  engagementTrend: false,
  focusState: false,
};

const initialBrainHeatmapState = {
  metric: 'alpha' as EegHeatmapMetric,
  frames: [],
};

const initialAcquisitionState: EegAcquisitionState = {
  channelCount: EEG_DEFAULT_CHANNEL_COUNT,
  hardwareConfig: DEFAULT_EEG_HARDWARE_CONFIG,
  hardwareConfigLocked: false,
};

function createInitialAnalysisState() {
  const ch0State = createEmptyChannelAnalysisState();

  return {
    selectedAlgorithm: 'engagement-index' as const,
    selectedFilterId: DEFAULT_FILTER_ID,
    filterParams: getFilterDefaultParams(DEFAULT_FILTER_ID),
    fftSize: EEG_DEFAULT_FFT_SIZE as number,
    engagementEmaAlpha: EEG_DEFAULT_ENGAGEMENT_EMA_ALPHA,
    initialUnreliableSeconds: EEG_DEFAULT_INITIAL_UNRELIABLE_SECONDS,
    focusBaselineSeconds: FOCUS_DEFAULT_BASELINE_SECONDS,
    focusOutputWindowSeconds: FOCUS_DEFAULT_DECISION_SECONDS,
    liveWindowSeconds: EEG_LIVE_WINDOW_SECONDS,
    engagementAlertThreshold: EEG_DEFAULT_ENGAGEMENT_ALERT_THRESHOLD,
    bandPowers: null,
    engagementIndex: null,
    engagementEma: null as number | null,
    windowSampleCount: 0,
    updatedAt: null,
    spectrum: null as { binHz: number; powers: number[] } | null,
    referenceSpectrum: null as EegSpectrumSnapshot | null,
    channels: {
      ch0: ch0State,
    },
    focusCalibration: createInitialFocusCalibrationState(),
  };
}

const initialAnalysisState = createInitialAnalysisState();

function createEmptyChannelAnalysisState(): EegChannelAnalysisState {
  return {
    bandPowers: null,
    engagementIndex: null,
    engagementEma: null,
    windowSampleCount: 0,
    updatedAt: null,
    spectrum: null,
  };
}

export function smoothEngagementResults(
  results: EegAnalysisResult[],
  previousEma: number | null,
  alpha = EEG_ENGAGEMENT_EMA_ALPHA,
): { results: EegAnalysisResult[]; nextEma: number | null } {
  let nextEma = previousEma;
  const smoothed = results.map((result) => {
    const raw = result.engagementIndex;

    if (raw === null || !Number.isFinite(raw)) {
      return raw === null ? result : { ...result, engagementIndex: null };
    }

    nextEma = nextEma === null ? raw : alpha * raw + (1 - alpha) * nextEma;
    return { ...result, engagementIndex: nextEma };
  });

  return { results: smoothed, nextEma };
}

function trimAnalysisPoints(points: EegAnalysisPoint[]): EegAnalysisPoint[] {
  const latestTimeSeconds = points[points.length - 1]?.timeSeconds;

  if (latestTimeSeconds === undefined) {
    return [];
  }

  const windowStartSeconds = latestTimeSeconds - EEG_ANALYSIS_HISTORY_SECONDS;
  return points.filter((point) => point.timeSeconds >= windowStartSeconds);
}

function trimHeatmapFrames<T extends { timeSeconds: number }>(frames: T[]): T[] {
  const latestTimeSeconds = frames[frames.length - 1]?.timeSeconds;

  if (latestTimeSeconds === undefined) {
    return [];
  }

  const windowStartSeconds = latestTimeSeconds - EEG_LIVE_WINDOW_MAX_SECONDS;
  return frames.filter((frame) => frame.timeSeconds >= windowStartSeconds);
}

function clampLiveWindowSeconds(seconds: number): number {
  if (!Number.isFinite(seconds)) return EEG_LIVE_WINDOW_SECONDS;
  return Math.max(
    EEG_LIVE_WINDOW_MIN_SECONDS,
    Math.min(EEG_LIVE_WINDOW_MAX_SECONDS, Math.round(seconds)),
  );
}

function clampEngagementEmaAlpha(alpha: number): number {
  if (!Number.isFinite(alpha)) return EEG_ENGAGEMENT_EMA_ALPHA;
  return Math.max(0, Math.min(1, alpha));
}

function clampEngagementAlertThreshold(threshold: number): number {
  if (!Number.isFinite(threshold)) return EEG_ENGAGEMENT_ALERT_THRESHOLD;
  return Math.max(0, threshold);
}

function clampInitialUnreliableSeconds(seconds: number): number {
  if (!Number.isFinite(seconds)) return EEG_DEFAULT_INITIAL_UNRELIABLE_SECONDS;
  return Math.max(
    EEG_INITIAL_UNRELIABLE_MIN_SECONDS,
    Math.min(EEG_INITIAL_UNRELIABLE_MAX_SECONDS, Math.round(seconds)),
  );
}

function normalizeChannelName(channelName: string | undefined): string {
  return channelName?.trim() || 'ch0';
}

function getCurrentStreamTimeSeconds(sampleCount: number, sampleRateHz = EEG_SAMPLE_RATE_HZ): number {
  if (!Number.isFinite(sampleCount) || sampleCount <= 0) return 0;
  return (sampleCount - 1) / sampleRateHz;
}

function getCurrentAcquisitionSampleRateHz(state: AcquisitionState): number {
  return getEffectiveEegHardwareSampleRateHz(state.acquisition.hardwareConfig);
}

function getFocusTimingConfig(state: AcquisitionState) {
  return {
    warmupSeconds: state.analysis.initialUnreliableSeconds,
    baselineSeconds: state.analysis.focusBaselineSeconds,
  };
}

function createFocusCalibrationForTiming(
  initialUnreliableSeconds: number,
  focusBaselineSeconds: number,
) {
  return createInitialFocusCalibrationState({
    warmupSeconds: initialUnreliableSeconds,
    baselineSeconds: focusBaselineSeconds,
  });
}

export const useEegStore = create<EegStore>((set) => ({
  transportMode: ACTIVE_EEG_TRANSPORT_MODE,
  status: 'idle',
  isSupported: false,
  isAvailable: null,
  isSerialSupported: false,
  devices: [],
  selectedDeviceId: null,
  connectedDeviceId: null,
  diagnostics: [],
  acquisition: initialAcquisitionState,
  stream: initialStreamState,
  drawing: initialDrawingState,
  analysis: initialAnalysisState,
  brainHeatmap: initialBrainHeatmapState,
  analysisPoints: [],
  focusStatePoints: [],
  annotationLabels: [],
  annotationRecords: [],
  nextAnnotationLabelId: 1,
  errorMessage: null,

  setTransportMode: (transportMode) =>
    set((state) => {
      const nextTransportMode = isImplementedEegTransportMode(transportMode)
        ? transportMode
        : ACTIVE_EEG_TRANSPORT_MODE;

      return {
        transportMode: nextTransportMode,
        status: state.stream.isStreaming || state.stream.isStarting ? state.status : 'idle',
        devices: [],
        selectedDeviceId: null,
        connectedDeviceId: null,
        errorMessage: null,
        stream: {
          ...state.stream,
          sourceLabel: null,
        },
      };
    }),
  setStatus: (status) => set({ status }),
  upsertDevice: (device) =>
    set((state) => ({
      devices: [device],
      selectedDeviceId: device.id,
      connectedDeviceId:
        state.connectedDeviceId === device.id ? state.connectedDeviceId : null,
    })),
  removeDevice: (deviceId) =>
    set((state) => {
      const devices = state.devices.filter((device) => device.id !== deviceId);
      const wasSelected = state.selectedDeviceId === deviceId;
      const nextSelectedDeviceId = wasSelected ? devices[0]?.id ?? null : state.selectedDeviceId;

      return {
        devices,
        selectedDeviceId: nextSelectedDeviceId,
        connectedDeviceId:
          state.connectedDeviceId === deviceId ? null : state.connectedDeviceId,
      };
    }),
  setConnectedDeviceId: (connectedDeviceId) => set({ connectedDeviceId }),
  setSupported: (isSupported) => set({ isSupported }),
  setAvailable: (isAvailable) => set({ isAvailable }),
  setSerialSupported: (isSerialSupported) => set({ isSerialSupported }),
  setError: (errorMessage) => set({ errorMessage }),
  addDiagnostic: (entry) =>
    set((state) => ({
      diagnostics: [
        ...state.diagnostics,
        {
          ...entry,
          id: Date.now() + state.diagnostics.length,
          timestamp: new Date().toISOString(),
        },
      ].slice(-30),
    })),
  clearDiagnostics: () => set({ diagnostics: [] }),
  setStreamOutputFile: (fileName, isReady) =>
    set((state) => ({
      stream: {
        ...state.stream,
        outputFileName: fileName,
        outputFileReady: isReady,
        writeError: null,
      },
    })),
  setStreamStarting: (sourceLabel, writesRawCsv) =>
    set((state) => ({
      stream: {
        ...state.stream,
        isStarting: true,
        isStreaming: false,
        isStalled: false,
        writesRawCsv,
        sourceLabel,
        writeError: null,
      },
    })),
  setStreamActive: (sourceLabel, writesRawCsv) =>
    set((state) => ({
      stream: {
        ...state.stream,
        isStarting: false,
        isStreaming: true,
        isStalled: false,
        writesRawCsv,
        sourceLabel,
        startedAt: new Date().toISOString(),
        writeError: null,
      },
    })),
  setStreamInactive: () =>
    set((state) => ({
      stream: {
        ...state.stream,
        isStarting: false,
        isStreaming: false,
        isStalled: false,
        writesRawCsv: false,
        startedAt: null,
      },
      drawing: initialDrawingState,
      brainHeatmap: {
        ...state.brainHeatmap,
        frames: [],
      },
    })),
  setStreamStalled: (isStalled) =>
    set((state) => ({
      stream: {
        ...state.stream,
        isStalled,
      },
    })),
  resetStreamRuntime: () =>
    set((state) => ({
      stream: {
        ...state.stream,
        isStarting: false,
        isStreaming: false,
        isStalled: false,
        writesRawCsv: false,
        sourceLabel: null,
        startedAt: null,
        packetCount: 0,
        batchCount: 0,
        sampleCount: 0,
        invalidPacketCount: 0,
        droppedPacketCount: 0,
        droppedSampleCount: 0,
        lastPacketSeq: null,
        lastSampleAt: null,
        writeError: null,
      },
      drawing: initialDrawingState,
      analysis: {
        ...state.analysis,
        bandPowers: null,
        engagementIndex: null,
        engagementEma: null,
        windowSampleCount: 0,
        updatedAt: null,
        spectrum: null,
        channels: {
          ch0: createEmptyChannelAnalysisState(),
        },
        focusCalibration: createInitialFocusCalibrationState(getFocusTimingConfig(state)),
      },
      analysisPoints: [],
      focusStatePoints: [],
      brainHeatmap: {
        ...state.brainHeatmap,
        frames: [],
      },
      annotationRecords: [],
    })),
  setHardwareConfig: (config) =>
    set((state) => {
      if (state.acquisition.hardwareConfigLocked) {
        return {};
      }

      const hardwareConfig = normalizeEegHardwareConfig({
        ...state.acquisition.hardwareConfig,
        ...config,
      });

      return {
        acquisition: {
          ...state.acquisition,
          hardwareConfig,
        },
      };
    }),
  setChannelCount: (channelCount) =>
    set((state) => ({
      acquisition: {
        ...state.acquisition,
        channelCount: normalizeEegChannelCount(channelCount),
      },
    })),
  lockHardwareConfig: () =>
    set((state) => ({
      acquisition: {
        ...state.acquisition,
        hardwareConfigLocked: true,
      },
    })),
  unlockHardwareConfig: () =>
    set((state) => ({
      acquisition: {
        ...state.acquisition,
        hardwareConfigLocked: false,
      },
    })),
  setDrawingEnabled: (key, enabled) =>
    set((state) => ({
      drawing: {
        ...state.drawing,
        [key]: enabled,
      },
    })),
  recordStreamPacket: () =>
    set((state) => ({
      stream: {
        ...state.stream,
        packetCount: state.stream.packetCount + 1,
      },
    })),
  recordSerialPacketDrop: (packetCount, sampleCount) =>
    set((state) => ({
      stream: {
        ...state.stream,
        droppedPacketCount: state.stream.droppedPacketCount + Math.max(0, packetCount),
        droppedSampleCount: state.stream.droppedSampleCount + Math.max(0, sampleCount),
      },
    })),
  recordInvalidStreamPacket: () =>
    set((state) => ({
      stream: {
        ...state.stream,
        invalidPacketCount: state.stream.invalidPacketCount + 1,
      },
    })),
  recordStreamBatch: (batch) =>
    set((state) => ({
      stream: {
        ...state.stream,
        batchCount: state.stream.batchCount + 1,
        sampleCount: state.stream.sampleCount + batch.samples.length,
        droppedSampleCount:
          state.stream.droppedSampleCount + Math.max(0, batch.droppedSamples ?? 0),
        lastPacketSeq: batch.packetSeq,
        lastSampleAt: batch.receivedAt,
      },
    })),
  recordAnalysisResults: (results) =>
    set((state) => {
      const latestResult = results[results.length - 1];

      if (!latestResult) {
        return {};
      }

      const nextChannels: Record<string, EegChannelAnalysisState> = {
        ...state.analysis.channels,
      };
      const smoothedResults = results.map((result) => {
        const channelName = normalizeChannelName(result.channelName);
        const previousChannel = nextChannels[channelName] ?? createEmptyChannelAnalysisState();
        const { results: smoothed, nextEma } = smoothEngagementResults(
          [{ ...result, channelName }],
          previousChannel.engagementEma,
          state.analysis.engagementEmaAlpha,
        );
        const smoothedResult = smoothed[0] ?? { ...result, channelName };

        nextChannels[channelName] = {
          bandPowers: result.bandPowers,
          engagementIndex: smoothedResult.engagementIndex,
          engagementEma: nextEma,
          windowSampleCount: result.windowSampleCount,
          updatedAt: result.updatedAt,
          spectrum: result.spectrum,
        };

        return smoothedResult;
      });
      const latestPrimaryResult =
        [...smoothedResults].reverse().find((result) => result.channelName === 'ch0') ??
        smoothedResults[smoothedResults.length - 1] ??
        latestResult;
      const points = smoothedResults.map(({ spectrum: _spectrum, ...point }) => point);
      const nextAnalysisPoints = trimAnalysisPoints([...state.analysisPoints, ...points]);
      const primaryAnalysisPoints = nextAnalysisPoints.filter(
        (point) => point.channelName === 'ch0',
      );
      const {
        focusCalibration: nextFocusCalibration,
        focusStatePoints: nextFocusStatePoints,
      } = advanceFocusCalibration(
        state.analysis.focusCalibration,
        state.analysis.focusOutputWindowSeconds,
        primaryAnalysisPoints,
        state.focusStatePoints,
        getFocusTimingConfig(state),
      );

      return {
        analysis: {
          ...state.analysis,
          bandPowers: latestPrimaryResult.bandPowers,
          engagementIndex: latestPrimaryResult.engagementIndex,
          engagementEma: nextChannels.ch0?.engagementEma ?? state.analysis.engagementEma,
          windowSampleCount: latestPrimaryResult.windowSampleCount,
          fftSize: latestPrimaryResult.fftSize ?? state.analysis.fftSize,
          updatedAt: latestPrimaryResult.updatedAt,
          spectrum: latestPrimaryResult.spectrum,
          channels: nextChannels,
          focusCalibration: nextFocusCalibration,
        },
        analysisPoints: nextAnalysisPoints,
        focusStatePoints: nextFocusStatePoints,
      };
    }),
  recordHeatmapAnalysisResults: (binding, results) =>
    set((state) => {
      if (results.length === 0) {
        return {};
      }

      const siteName = binding.siteName.trim() || 'custom';
      const frames = results.map((result) => ({
        siteName,
        channelName: normalizeChannelName(result.channelName || binding.channelName),
        timeSeconds: result.timeSeconds,
        sampleIndex: result.sampleIndex,
        bandPowers: { ...result.bandPowers },
        engagementIndex:
          result.engagementIndex !== null && Number.isFinite(result.engagementIndex)
            ? result.engagementIndex
            : null,
        updatedAt: result.updatedAt,
      }));

      return {
        brainHeatmap: {
          ...state.brainHeatmap,
          frames: trimHeatmapFrames([...state.brainHeatmap.frames, ...frames]),
        },
      };
    }),
  setBrainHeatmapMetric: (metric) =>
    set((state) => ({
      brainHeatmap: {
        ...state.brainHeatmap,
        metric,
      },
    })),
  clearBrainHeatmap: () =>
    set((state) => ({
      brainHeatmap: {
        ...state.brainHeatmap,
        frames: [],
      },
    })),
  setSelectedAlgorithm: (algorithmId) =>
    set((state) => ({
      analysis: {
        ...state.analysis,
        selectedAlgorithm: algorithmId,
      },
    })),
  setSelectedFilter: (_filterId, params) =>
    set((state) => ({
      analysis: {
        ...state.analysis,
        selectedFilterId: DEFAULT_FILTER_ID,
        filterParams: params ?? getFilterDefaultParams(DEFAULT_FILTER_ID),
      },
    })),
  setFilterParam: (key, value) =>
    set((state) => ({
      analysis: {
        ...state.analysis,
        filterParams: { ...state.analysis.filterParams, [key]: value },
      },
    })),
  resetFilterParams: () =>
    set((state) => ({
      analysis: {
        ...state.analysis,
        selectedFilterId: DEFAULT_FILTER_ID,
        filterParams: getFilterDefaultParams(DEFAULT_FILTER_ID),
      },
    })),
  setEngagementEmaAlpha: (alpha) =>
    set((state) => ({
      analysis: {
        ...state.analysis,
        engagementEmaAlpha: clampEngagementEmaAlpha(alpha),
      },
    })),
  setInitialUnreliableSeconds: (seconds) =>
    set((state) => {
      const initialUnreliableSeconds = clampInitialUnreliableSeconds(seconds);

      return {
        analysis: {
          ...state.analysis,
          initialUnreliableSeconds,
          focusCalibration: createFocusCalibrationForTiming(
            initialUnreliableSeconds,
            state.analysis.focusBaselineSeconds,
          ),
        },
        focusStatePoints: [],
      };
    }),
  setFocusBaselineSeconds: (seconds) =>
    set((state) => {
      const focusBaselineSeconds = clampFocusBaselineSeconds(seconds);

      return {
        analysis: {
          ...state.analysis,
          focusBaselineSeconds,
          focusCalibration: createFocusCalibrationForTiming(
            state.analysis.initialUnreliableSeconds,
            focusBaselineSeconds,
          ),
        },
        focusStatePoints: [],
      };
    }),
  resetAnalysisTuning: () =>
    set((state) => {
      const initialUnreliableSeconds = EEG_DEFAULT_INITIAL_UNRELIABLE_SECONDS;

      return {
        analysis: {
          ...state.analysis,
          engagementEmaAlpha: EEG_DEFAULT_ENGAGEMENT_EMA_ALPHA,
          engagementAlertThreshold: EEG_DEFAULT_ENGAGEMENT_ALERT_THRESHOLD,
          initialUnreliableSeconds,
          focusCalibration: createFocusCalibrationForTiming(
            initialUnreliableSeconds,
            state.analysis.focusBaselineSeconds,
          ),
        },
        focusStatePoints: [],
      };
    }),
  setLiveWindowSeconds: (seconds) =>
    set((state) => ({
      analysis: {
        ...state.analysis,
        liveWindowSeconds: clampLiveWindowSeconds(seconds),
      },
    })),
  setEngagementAlertThreshold: (threshold) =>
    set((state) => ({
      analysis: {
        ...state.analysis,
        engagementAlertThreshold: clampEngagementAlertThreshold(threshold),
      },
    })),
  beginFocusBaseline: () =>
    set((state) => {
      const currentStreamTimeSeconds = getCurrentStreamTimeSeconds(
        state.stream.sampleCount,
        getCurrentAcquisitionSampleRateHz(state),
      );

      return {
        analysis: {
          ...state.analysis,
          focusCalibration: createFocusCalibrationForCurrentStreamTime(
            currentStreamTimeSeconds,
            getFocusTimingConfig(state),
          ),
        },
        focusStatePoints: [],
      };
    }),
  setFocusReferenceValue: (value) =>
    set((state) => ({
      analysis: {
        ...state.analysis,
        focusCalibration: {
          ...state.analysis.focusCalibration,
          referenceValue: clampFocusReferenceValue(value),
        },
      },
    })),
  setFocusOutputWindowSeconds: (seconds) =>
    set((state) => {
      const focusOutputWindowSeconds = clampFocusOutputWindowSeconds(seconds);
      const currentFocusCalibration = state.analysis.focusCalibration;
      const shouldResetDecisionPoints =
        focusOutputWindowSeconds !== state.analysis.focusOutputWindowSeconds &&
        currentFocusCalibration.phase === 'active';

      return {
        analysis: {
          ...state.analysis,
          focusOutputWindowSeconds,
          focusCalibration: shouldResetDecisionPoints
            ? {
                ...currentFocusCalibration,
                lastDecisionWindowEndSeconds: currentFocusCalibration.baselineEndsAtSeconds,
                focusState: null,
                focusValue: null,
              }
            : currentFocusCalibration,
        },
        focusStatePoints: shouldResetDecisionPoints ? [] : state.focusStatePoints,
      };
    }),
  addAnnotationLabel: (name, kind) =>
    set((state) => {
      const trimmedName = name.trim();
      if (trimmedName.length === 0) {
        return {};
      }

      const idNumber = state.nextAnnotationLabelId;
      const color = ANNOTATION_LABEL_COLORS[(idNumber - 1) % ANNOTATION_LABEL_COLORS.length];

      return {
        annotationLabels: [
          ...state.annotationLabels,
          {
            id: `annotation-${idNumber}`,
            name: trimmedName,
            kind,
            color,
          },
        ],
        nextAnnotationLabelId: idNumber + 1,
      };
    }),
  removeAnnotationLabel: (labelId) =>
    set((state) => ({
      annotationLabels: state.annotationLabels.filter((label) => label.id !== labelId),
      annotationRecords: state.annotationRecords.filter((record) => record.labelId !== labelId),
    })),
  recordAnnotation: (labelId) =>
    set((state) => {
      const label = state.annotationLabels.find((item) => item.id === labelId);
      const timeSeconds = getCurrentStreamTimeSeconds(
        state.stream.sampleCount,
        getCurrentAcquisitionSampleRateHz(state),
      );
      const recordedAtMs = Date.now();

      if (!label) {
        return {};
      }

      const currentRecord = state.annotationRecords.find((record) => record.labelId === labelId);
      const otherRecords = state.annotationRecords.filter((record) => record.labelId !== labelId);

      if (label.kind === 'event') {
        return {
          annotationRecords: [
            ...otherRecords,
            {
              labelId,
              kind: 'event',
              timeSeconds,
              recordedAtMs,
            },
          ],
        };
      }

      if (currentRecord?.kind === 'interval' && currentRecord.endTimeSeconds === null) {
        return {
          annotationRecords: [
            ...otherRecords,
            {
              ...currentRecord,
              endTimeSeconds: Math.max(currentRecord.startTimeSeconds, timeSeconds),
              endRecordedAtMs: recordedAtMs,
            },
          ],
        };
      }

      return {
        annotationRecords: [
          ...otherRecords,
          {
            labelId,
            kind: 'interval',
            startTimeSeconds: timeSeconds,
            endTimeSeconds: null,
            startRecordedAtMs: recordedAtMs,
            endRecordedAtMs: null,
          },
        ],
      };
    }),
  clearAnnotationRecords: () => set({ annotationRecords: [] }),
  captureSpectrumSnapshot: () =>
    set((state) => {
      const current = state.analysis.spectrum;
      if (!current) {
        return {};
      }
      const def = getFilterDefinition(state.analysis.selectedFilterId);
      return {
        analysis: {
          ...state.analysis,
          referenceSpectrum: {
            binHz: current.binHz,
            powers: current.powers.slice(),
            capturedAt: Date.now(),
            filterLabel: `${def.id} · fft=${state.analysis.fftSize}`,
            fftSize: state.analysis.fftSize,
          },
        },
      };
    }),
  clearSpectrumSnapshot: () =>
    set((state) => ({
      analysis: {
        ...state.analysis,
        referenceSpectrum: null,
      },
    })),
  setStreamWriteError: (message) =>
    set((state) => ({
      stream: {
        ...state.stream,
        writeError: message,
      },
    })),
  reset: () =>
    set({
      status: 'idle',
      devices: [],
      selectedDeviceId: null,
      connectedDeviceId: null,
      diagnostics: [],
      acquisition: initialAcquisitionState,
      stream: initialStreamState,
      drawing: initialDrawingState,
      analysis: createInitialAnalysisState(),
      brainHeatmap: initialBrainHeatmapState,
      analysisPoints: [],
      focusStatePoints: [],
      annotationLabels: [],
      annotationRecords: [],
      nextAnnotationLabelId: 1,
      errorMessage: null,
    }),
}));
