import { useCallback, useEffect, useRef } from 'react';
import { EegFrequencyAnalyzer } from '../analysis/eegFrequencyAnalysis';
import { DEFAULT_FILTER_ID, createFilterById } from '../analysis/filterRegistry';
import {
  getAnalysisHopSize,
  getAnalysisWindowSize,
  getAutoFftSizeForWindowSize,
} from '../analysis/fftConfig';
import { LeadOffDetectorBank } from '../analysis/leadOffDetection';
import {
  recordAiBandFeatureResults,
  setAiBandRecordingEnabled,
} from '../ai/conversationRuntime';
import {
  EEG_SERIAL_CONFIG_ACK_TIMEOUT_MS,
  EEG_SERIAL_RESET_ACK_TIMEOUT_MS,
  EEG_SERIAL_STALLED_TIMEOUT_MS,
  EEG_SERIAL_SWITCH_ACK_TIMEOUT_MS,
} from '../config/serial';
import type { Locale, TranslationKey } from '../i18n';
import { t } from '../i18n';
import {
  encodeSerialAcquisitionSwitchCommand,
  type SerialAcquisitionSwitchAck,
  type SerialAcquisitionSwitchAction,
} from '../serial/serialAcquisitionSwitch';
import {
  createSerialConnectionSession,
  createSerialLoopbackEchoError,
  type SerialConnectionSession,
} from '../serial/serialConnectionSession';
import {
  type SerialEegFrame,
  type SerialEegInvalidFrame,
  type SerialEegLoopbackEcho,
  type SerialEegProtocolParser,
} from '../serial/serialEegProtocol';
import {
  encodeSerialHardwareConfigCommand,
  formatSerialHardwareConfigSummary,
} from '../serial/serialHardwareConfig';
import { encodeSerialInitializationResetCommand } from '../serial/serialInitialization';
import {
  addSerialDisconnectListener,
  formatSerialPortId,
  formatSerialPortName,
  isWebSerialSupported,
  openSerialPort,
  requestSerialPort,
  writeSerialBytes,
} from '../serial/webSerialAdapter';
import { filteredWaveformBus } from '../state/filteredWaveformBus';
import { rawWaveformBus } from '../state/rawWaveformBus';
import { useAiStore } from '../store/aiStore';
import { useEegStore } from '../store/eegStore';
import {
  getEegChannelNames,
  normalizeEegChannelCount,
} from '../transport/eegChannels';
import {
  getEffectiveEegHardwareSampleRateHz,
  type EegHardwareConfig,
} from '../transport/eegHardwareConfig';
import type { AcquisitionDeviceSummary, StartEegStreamInput } from '../types/acquisition';
import type { EegSample, EegSampleBatch } from '../types/eeg';
import {
  formatEegSampleBatchCsv,
  formatEegSampleCsvPreamble,
} from '../utils/eegCsv';
import {
  chooseEegOutputFile,
  isOutputFilePickerSupported,
  type EegOutputFileStream,
  type EegOutputFileTarget,
} from '../utils/outputFile';
import { withTimeout } from '../utils/withTimeout';

function toSerialPortSummary(port: SerialPort): AcquisitionDeviceSummary {
  const info = port.getInfo();
  return {
    id: formatSerialPortId(port),
    name: formatSerialPortName(port),
    canForgetAccess: typeof port.forget === 'function',
    transport: 'serial',
    usbVendorId: info.usbVendorId,
    usbProductId: info.usbProductId,
  };
}

function elapsedMs(startTime: number): number {
  return Math.round(performance.now() - startTime);
}

function getErrorDetail(error: unknown): string {
  if (error instanceof DOMException || error instanceof Error) {
    return `${error.name}: ${error.message}`;
  }

  return String(error);
}

const BATCH_PROCESSING_BUDGET_MS = 8;

const MAX_BATCHES_PER_PROCESSING_TASK = 2;

function formatSerialInvalidFrameDetail(frame: SerialEegInvalidFrame): string {
  return Object.entries(frame)
    .map(([key, value]) => `${key}=${String(value)}`)
    .join(', ');
}

function getSampleChannelValue(sample: EegSample, channelName: string): number | null {
  const channelValue = sample.channels?.[channelName];
  if (channelValue !== undefined) {
    return channelValue;
  }

  return channelName === 'ch0' ? sample.eegValue : null;
}

function getCurrentAcquisitionSampleRateHz(): number {
  const store = useEegStore.getState();
  return getEffectiveEegHardwareSampleRateHz(store.acquisition.hardwareConfig);
}

function serialFrameToBatch(frame: SerialEegFrame): EegSampleBatch {
  return {
    source: 'serial',
    packetSeq: frame.seq,
    droppedSamples: frame.droppedSamples,
    receivedAt: frame.receivedAt,
    samples: frame.samples.map((sample, index) => ({
      sampleIndex: index,
      eegValue: sample.ch0 ?? Object.values(sample)[0] ?? 0,
      channels: { ...sample },
      dcValidity: null,
      rldValidity: null,
    })),
  };
}

class SerialSwitchAckError extends Error {
  readonly ack: SerialAcquisitionSwitchAck;

  constructor(ack: SerialAcquisitionSwitchAck) {
    const detail = ack.ok
      ? 'unexpected OK=false state'
      : `code=${ack.errorCode ?? 'UNKNOWN'}, reason=${ack.errorReason ?? 'unknown'}`;
    super(`Serial acquisition switch rejected: seq=${ack.seq}, ${detail}`);
    this.name = 'SerialSwitchAckError';
    this.ack = ack;
  }
}

function createSerialSwitchAckError(ack: SerialAcquisitionSwitchAck): Error {
  return new SerialSwitchAckError(ack);
}

function isSerialConfigRequiredSwitchError(error: unknown): boolean {
  return error instanceof SerialSwitchAckError && error.ack.errorCode === 'CONFIG_REQUIRED';
}

interface PendingSerialSwitchAck {
  action: SerialAcquisitionSwitchAction;
  resolve: () => void;
  reject: (error: Error) => void;
}

export function useAcquisitionActions(locale: Locale) {
  const serialPortRef = useRef<SerialPort | null>(null);
  const serialBaudRateRef = useRef<number | null>(null);
  const serialReaderRef = useRef<ReadableStreamDefaultReader<Uint8Array> | null>(null);
  const serialParserRef = useRef<SerialEegProtocolParser | null>(null);
  const serialDetachRef = useRef<(() => void) | null>(null);
  const serialPendingSwitchAckRef = useRef<PendingSerialSwitchAck | null>(null);
  const serialWaitForResetAckRef =
    useRef<SerialConnectionSession['waitForResetAck'] | null>(null);
  const serialCancelResetAckRef =
    useRef<SerialConnectionSession['cancelResetAck'] | null>(null);
  const serialWaitForConfigAckRef =
    useRef<SerialConnectionSession['waitForConfigAck'] | null>(null);
  const serialCancelConfigAckRef =
    useRef<SerialConnectionSession['cancelConfigAck'] | null>(null);
  const serialWriteQueueRef = useRef<Promise<void>>(Promise.resolve());
  const serialStreamingEnabledRef = useRef(false);
  const serialLastValidFrameAtRef = useRef<number | null>(null);
  const serialStalledTimerRef = useRef<number | null>(null);
  const analysisProcessorsRef = useRef<Map<string, EegFrequencyAnalyzer>>(new Map());
  const leadOffDetectorRef = useRef<LeadOffDetectorBank | null>(null);
  const outputFileTargetRef = useRef<EegOutputFileTarget | null>(null);
  const outputFileRef = useRef<EegOutputFileStream | null>(null);
  const writeQueueRef = useRef<Promise<void>>(Promise.resolve());
  const pendingBatchesRef = useRef<EegSampleBatch[]>([]);
  const batchProcessingTimerRef = useRef<number | null>(null);
  const isBatchProcessingScheduledRef = useRef(false);
  const rawCsvWriteEnabledRef = useRef(false);
  const isStreamStartingRef = useRef(false);
  const streamSessionRef = useRef(0);

  const setStatus = useEegStore((state) => state.setStatus);
  const upsertDevice = useEegStore((state) => state.upsertDevice);
  const removeDevice = useEegStore((state) => state.removeDevice);
  const setConnectedDeviceId = useEegStore((state) => state.setConnectedDeviceId);
  const setSupported = useEegStore((state) => state.setSupported);
  const setAvailable = useEegStore((state) => state.setAvailable);
  const setSerialSupported = useEegStore((state) => state.setSerialSupported);
  const setError = useEegStore((state) => state.setError);
  const addDiagnostic = useEegStore((state) => state.addDiagnostic);
  const clearDiagnostics = useEegStore((state) => state.clearDiagnostics);

  const clearStreamWatchdogs = useCallback((): void => {
    if (serialStalledTimerRef.current !== null) {
      clearInterval(serialStalledTimerRef.current);
      serialStalledTimerRef.current = null;
    }
  }, []);

  const addLocalizedDiagnostic = useCallback(
    (
      status: 'running' | 'success' | 'error' | 'info',
      phaseKey: TranslationKey,
      messageKey: TranslationKey,
      values: Record<string, string | number> = {},
      detail?: string,
      durationMs?: number,
    ): void => {
      addDiagnostic({
        status,
        phase: t(locale, phaseKey),
        message: t(locale, messageKey, values),
        detail,
        durationMs,
      });
    },
    [addDiagnostic, locale],
  );

  const closeOutputFile = useCallback(async (): Promise<void> => {
    const writable = outputFileRef.current;
    outputFileRef.current = null;

    await writeQueueRef.current.catch(() => undefined);

    if (!writable) {
      return;
    }

    try {
      await writable.close();
    } catch (error) {
      useEegStore.getState().setStreamWriteError(getErrorDetail(error));
    } finally {
      const store = useEegStore.getState();
      outputFileTargetRef.current = null;
      store.setStreamOutputFile(store.stream.outputFileName, false);
    }
  }, []);

  const queueFileWrite = useCallback(
    (text: string): void => {
      writeQueueRef.current = writeQueueRef.current
        .then(async () => {
          const writable = outputFileRef.current;

          if (!writable) {
            return;
          }

          await writable.write(text);
        })
        .catch((error) => {
          const detail = getErrorDetail(error);
          const store = useEegStore.getState();
          outputFileRef.current = null;
          outputFileTargetRef.current = null;
          store.setStreamWriteError(detail);
          store.setStreamOutputFile(store.stream.outputFileName, false);
          addDiagnostic({
            status: 'error',
            phase: t(locale, 'diagnostics.phaseDataStream'),
            message: t(locale, 'diagnostics.streamWriteError'),
            detail,
          });
        });
    },
    [addDiagnostic, locale],
  );

  const createAnalysisProcessors = useCallback((channelNames: string[]): void => {
    const store = useEegStore.getState();
    const processors = new Map<string, EegFrequencyAnalyzer>();
    const sampleRateHz = getCurrentAcquisitionSampleRateHz();
    const windowSize = getAnalysisWindowSize(sampleRateHz);
    const hopSize = getAnalysisHopSize(sampleRateHz);
    const fftSize = getAutoFftSizeForWindowSize(windowSize);

    for (const channelName of channelNames) {
      processors.set(
        channelName,
        new EegFrequencyAnalyzer({
          windowSize,
          sampleRateHz,
          hopSize,
          channelName,
          algorithmId: store.analysis.selectedAlgorithm,
          filter: createFilterById(DEFAULT_FILTER_ID, store.analysis.filterParams, sampleRateHz),
          fftSize,
          sampleSelector: (sample) => getSampleChannelValue(sample, channelName),
          onFilteredSample: (value) => filteredWaveformBus.push(value, channelName),
        }),
      );
    }

    analysisProcessorsRef.current = processors;
  }, []);

  const processDecodedBatch = useCallback(
    (batch: EegSampleBatch): void => {
      const store = useEegStore.getState();
      const streamSampleOffset = store.stream.sampleCount;
      const sampleRateHz = getCurrentAcquisitionSampleRateHz();

      if (rawCsvWriteEnabledRef.current) {
        queueFileWrite(
          formatEegSampleBatchCsv(batch, {
            labels: store.annotationLabels,
            records: store.annotationRecords,
            sampleOffset: streamSampleOffset,
            sampleRateHz,
            initialUnreliableSeconds: store.analysis.initialUnreliableSeconds,
            channelNames: getEegChannelNames(store.acquisition.channelCount),
          }),
        );
      }

      for (const sample of batch.samples) {
        const channels = sample.channels ?? { ch0: sample.eegValue };
        for (const [channelName, value] of Object.entries(channels)) {
          const leadOffStatus = leadOffDetectorRef.current?.pushSample(channelName, value) ?? null;
          rawWaveformBus.push(value, channelName, {
            leadOff: leadOffStatus?.leadOff ?? false,
          });
          if (leadOffStatus?.becameLeadOff) {
            rawWaveformBus.markLatestLeadOff(
              leadOffStatus.windowSampleCount,
              channelName,
              true,
            );
          }
        }
      }

      const analysisResults = [...analysisProcessorsRef.current.values()].flatMap((processor) =>
        processor.pushBatch(batch),
      );

      store.recordStreamBatch(batch);

      if (analysisResults.length > 0) {
        const windowSize = getAnalysisWindowSize(sampleRateHz);
        const fftSize = getAutoFftSizeForWindowSize(windowSize);
        store.recordAnalysisResults(analysisResults);
        const aiState = useAiStore.getState();
        const bindingsByChannel = new Map(
          aiState.bindings.map((binding) => [
            binding.channelName.trim().toLowerCase(),
            binding,
          ]),
        );
        for (const result of analysisResults) {
          const binding =
            bindingsByChannel.get(result.channelName.trim().toLowerCase()) ??
            aiState.binding;
          store.recordHeatmapAnalysisResults(binding, [result]);
        }
        recordAiBandFeatureResults(analysisResults, {
          streamStartedAtMs: store.stream.startedAt ? Date.parse(store.stream.startedAt) : null,
          fftSize,
          sampleRateHz,
          filterId: DEFAULT_FILTER_ID,
          filterParams: store.analysis.filterParams,
          initialUnreliableSeconds: store.analysis.initialUnreliableSeconds,
        });
      }
    },
    [queueFileWrite],
  );

  const processBatchQueue = useCallback((): void => {
    batchProcessingTimerRef.current = null;
    isBatchProcessingScheduledRef.current = false;

    const startedAt = performance.now();
    let processedCount = 0;

    while (
      pendingBatchesRef.current.length > 0 &&
      processedCount < MAX_BATCHES_PER_PROCESSING_TASK &&
      performance.now() - startedAt < BATCH_PROCESSING_BUDGET_MS
    ) {
      const batch = pendingBatchesRef.current.shift();

      if (!batch) {
        break;
      }

      processDecodedBatch(batch);
      processedCount += 1;
    }

    if (pendingBatchesRef.current.length > 0) {
      isBatchProcessingScheduledRef.current = true;
      batchProcessingTimerRef.current = window.setTimeout(processBatchQueue, 0);
    }
  }, [processDecodedBatch]);

  const scheduleBatchProcessing = useCallback((): void => {
    if (isBatchProcessingScheduledRef.current) {
      return;
    }

    isBatchProcessingScheduledRef.current = true;
    batchProcessingTimerRef.current = window.setTimeout(processBatchQueue, 0);
  }, [processBatchQueue]);

  const flushPendingBatches = useCallback((): void => {
    if (batchProcessingTimerRef.current !== null) {
      clearTimeout(batchProcessingTimerRef.current);
      batchProcessingTimerRef.current = null;
    }

    isBatchProcessingScheduledRef.current = false;

    const pendingBatches = pendingBatchesRef.current.splice(0);

    for (const batch of pendingBatches) {
      processDecodedBatch(batch);
    }
  }, [processDecodedBatch]);

  const handleDecodedBatch = useCallback(
    (batch: EegSampleBatch): void => {
      pendingBatchesRef.current.push(batch);
      scheduleBatchProcessing();
    },
    [scheduleBatchProcessing],
  );

  const stopStreamInternal = useCallback(async (): Promise<void> => {
    streamSessionRef.current += 1;
    isStreamStartingRef.current = false;
    setAiBandRecordingEnabled(false);
    clearStreamWatchdogs();
    flushPendingBatches();
    for (const processor of analysisProcessorsRef.current.values()) {
      processor.reset();
    }
    analysisProcessorsRef.current = new Map();
    leadOffDetectorRef.current = null;
    serialStreamingEnabledRef.current = false;
    rawCsvWriteEnabledRef.current = false;
    await closeOutputFile();
    useEegStore.getState().setStreamInactive();
  }, [clearStreamWatchdogs, closeOutputFile, flushPendingBatches]);

  const handleSerialInvalidFrame = useCallback(
    (frame: SerialEegInvalidFrame): void => {
      if (!serialStreamingEnabledRef.current) {
        return;
      }

      const store = useEegStore.getState();
      const invalidPacketCount = store.stream.invalidPacketCount + 1;

      store.recordInvalidStreamPacket();

      if (invalidPacketCount > 5) {
        return;
      }

      addDiagnostic({
        status: 'error',
        phase: t(locale, 'diagnostics.phaseDataStream'),
        message: t(locale, 'diagnostics.streamInvalidPacket'),
        detail: formatSerialInvalidFrameDetail(frame),
      });
    },
    [addDiagnostic, locale],
  );

  const handleSerialFrame = useCallback(
    (frame: SerialEegFrame): void => {
      serialLastValidFrameAtRef.current = performance.now();
      const store = useEegStore.getState();

      if (store.stream.isStalled) {
        store.setStreamStalled(false);
        addLocalizedDiagnostic(
          'info',
          'diagnostics.phaseDataStream',
          'diagnostics.serialStreamRecovered',
        );
      }

      if (!serialStreamingEnabledRef.current) {
        return;
      }

      store.recordStreamPacket();
      if (frame.droppedPackets > 0) {
        store.recordSerialPacketDrop(frame.droppedPackets, 0);
        addDiagnostic({
          status: 'info',
          phase: t(locale, 'diagnostics.phaseDataStream'),
          message: t(locale, 'diagnostics.serialPacketGap', {
            count: frame.droppedPackets,
          }),
          detail: `seq=${frame.seq}, droppedSamples=${frame.droppedSamples}`,
        });
      }
      handleDecodedBatch(serialFrameToBatch(frame));
    },
    [addDiagnostic, addLocalizedDiagnostic, handleDecodedBatch, locale],
  );

  const handleSerialSwitchAck = useCallback((ack: SerialAcquisitionSwitchAck): void => {
    const pending = serialPendingSwitchAckRef.current;

    if (!pending) {
      return;
    }

    serialPendingSwitchAckRef.current = null;

    if (!ack.ok) {
      pending.reject(createSerialSwitchAckError(ack));
      return;
    }

    if (pending.action === 'START') {
      serialParserRef.current?.resetDataSequence();
    }

    serialStreamingEnabledRef.current = pending.action === 'START';
    pending.resolve();
  }, []);

  const handleSerialSwitchAckError = useCallback((line: string): void => {
    const pending = serialPendingSwitchAckRef.current;

    if (!pending) {
      return;
    }

    serialPendingSwitchAckRef.current = null;
    pending.reject(new Error(`Invalid serial acquisition switch ACK: ${line}`));
  }, []);

  const detachSerialDisconnectListener = useCallback((): void => {
    if (serialDetachRef.current) {
      serialDetachRef.current();
      serialDetachRef.current = null;
    }
  }, []);

  const handleSerialDisconnected = useCallback(
    (detail?: string): void => {
      const store = useEegStore.getState();
      detachSerialDisconnectListener();
      void stopStreamInternal();
      serialPortRef.current = null;
      serialBaudRateRef.current = null;
      serialReaderRef.current = null;
      serialParserRef.current = null;
      serialCancelResetAckRef.current?.(new Error('Serial connection closed.'));
      serialCancelConfigAckRef.current?.(new Error('Serial connection closed.'));
      serialWaitForResetAckRef.current = null;
      serialCancelResetAckRef.current = null;
      serialWaitForConfigAckRef.current = null;
      serialCancelConfigAckRef.current = null;
      serialStreamingEnabledRef.current = false;
      store.setConnectedDeviceId(null);
      store.unlockHardwareConfig();
      store.setStatus('disconnected');
      store.addDiagnostic({
        status: 'info',
        phase: t(locale, 'diagnostics.phaseDisconnect'),
        message: t(locale, 'diagnostics.serialDisconnected'),
        detail,
      });
    },
    [detachSerialDisconnectListener, locale, stopStreamInternal],
  );

  const startSerialReadLoop = useCallback(
    (port: SerialPort): void => {
      void (async () => {
        while (serialPortRef.current === port && port.readable) {
          const reader = port.readable.getReader();
          serialReaderRef.current = reader;

          try {
            while (true) {
              const { value, done } = await reader.read();

              if (done) {
                break;
              }

              if (value) {
                serialParserRef.current?.pushChunk(value);
              }
            }
          } catch (error) {
            if (serialPortRef.current === port) {
              handleSerialDisconnected(getErrorDetail(error));
            }
            return;
          } finally {
            if (serialReaderRef.current === reader) {
              serialReaderRef.current = null;
              reader.releaseLock();
            }
          }
        }

        if (serialPortRef.current === port) {
          handleSerialDisconnected('Serial readable stream ended.');
        }
      })();
    },
    [handleSerialDisconnected],
  );

  const closeSerialConnection = useCallback(async (): Promise<void> => {
    detachSerialDisconnectListener();
    serialStreamingEnabledRef.current = false;
    serialPendingSwitchAckRef.current?.reject(new Error('Serial connection closed.'));
    serialPendingSwitchAckRef.current = null;
    serialCancelResetAckRef.current?.(new Error('Serial connection closed.'));
    serialCancelConfigAckRef.current?.(new Error('Serial connection closed.'));
    serialWaitForResetAckRef.current = null;
    serialCancelResetAckRef.current = null;
    serialWaitForConfigAckRef.current = null;
    serialCancelConfigAckRef.current = null;
    serialWriteQueueRef.current = Promise.resolve();
    serialParserRef.current?.reset();
    serialParserRef.current = null;

    const port = serialPortRef.current;
    serialPortRef.current = null;
    serialBaudRateRef.current = null;

    const reader = serialReaderRef.current;
    serialReaderRef.current = null;
    if (reader) {
      await reader.cancel().catch(() => undefined);
      try {
        reader.releaseLock();
      } catch {
        // The read loop may have already released it.
      }
    }

    if (port) {
      await port.close().catch(() => undefined);
    }
  }, [detachSerialDisconnectListener]);

  const writeSerialCommandBytes = useCallback(
    async (port: SerialPort, bytes: Uint8Array): Promise<void> => {
      const writeTask = serialWriteQueueRef.current.then(async () => {
        serialParserRef.current?.trackOutboundCommand(bytes);
        await writeSerialBytes(port, bytes);
      });

      serialWriteQueueRef.current = writeTask.catch(() => undefined);
      await writeTask;
    },
    [],
  );

  const sendSerialInitializationResetCommand = useCallback(async (): Promise<void> => {
    const port = serialPortRef.current;
    const waitForResetAck = serialWaitForResetAckRef.current;
    const cancelResetAck = serialCancelResetAckRef.current;

    if (!port || !serialParserRef.current || !waitForResetAck) {
      throw new Error(t(locale, 'error.streamRequiresConnection'));
    }

    const ackPromise = waitForResetAck();

    try {
      await writeSerialCommandBytes(port, encodeSerialInitializationResetCommand());
    } catch (error) {
      void ackPromise.catch(() => undefined);
      cancelResetAck?.(error instanceof Error ? error : new Error(String(error)));
      throw error;
    }

    try {
      await withTimeout(
        ackPromise,
        EEG_SERIAL_RESET_ACK_TIMEOUT_MS,
        t(locale, 'error.serialResetAckTimeout'),
      );
    } catch (error) {
      cancelResetAck?.(error instanceof Error ? error : new Error(String(error)));
      throw error;
    }
  }, [locale, writeSerialCommandBytes]);

  const sendSerialHardwareConfigCommand = useCallback(
    async (config: EegHardwareConfig): Promise<void> => {
      const port = serialPortRef.current;
      const waitForConfigAck = serialWaitForConfigAckRef.current;
      const cancelConfigAck = serialCancelConfigAckRef.current;

      if (!port || !serialParserRef.current || !waitForConfigAck) {
        throw new Error(t(locale, 'error.streamRequiresConnection'));
      }

      const channelCount = normalizeEegChannelCount(
        useEegStore.getState().acquisition.channelCount,
      );
      const ackPromise = waitForConfigAck();

      try {
        await writeSerialCommandBytes(
          port,
          encodeSerialHardwareConfigCommand(config, { channelCount }),
        );
      } catch (error) {
        void ackPromise.catch(() => undefined);
        cancelConfigAck?.(error instanceof Error ? error : new Error(String(error)));
        throw error;
      }

      try {
        await withTimeout(
          ackPromise,
          EEG_SERIAL_CONFIG_ACK_TIMEOUT_MS,
          t(locale, 'error.serialConfigAckTimeout'),
        );
      } catch (error) {
        cancelConfigAck?.(error instanceof Error ? error : new Error(String(error)));
        throw error;
      }
    },
    [locale, writeSerialCommandBytes],
  );

  const handleSerialLoopbackEcho = useCallback(
    (echo: SerialEegLoopbackEcho): void => {
      const error = createSerialLoopbackEchoError(echo);
      const pending = serialPendingSwitchAckRef.current;

      if (pending) {
        serialPendingSwitchAckRef.current = null;
        pending.reject(error);
      }

      const store = useEegStore.getState();
      const phaseKey: TranslationKey =
        store.stream.isStarting || store.stream.isStreaming
          ? 'diagnostics.phaseDataStream'
          : 'diagnostics.phaseSerialConnect';

      setError(error.message);
      addLocalizedDiagnostic(
        'error',
        phaseKey,
        'diagnostics.serialLoopbackEcho',
        {},
        error.message,
      );
      void closeSerialConnection().finally(() => {
        setConnectedDeviceId(null);
        setStatus('error');
      });
    },
    [
      addLocalizedDiagnostic,
      closeSerialConnection,
      setConnectedDeviceId,
      setError,
      setStatus,
    ],
  );

  const sendSerialSwitchCommand = useCallback(
    async (action: SerialAcquisitionSwitchAction): Promise<void> => {
      const port = serialPortRef.current;
      if (!port || !serialParserRef.current) {
        throw new Error(t(locale, 'error.streamRequiresConnection'));
      }

      if (serialPendingSwitchAckRef.current) {
        throw new Error('Serial acquisition switch command is already pending.');
      }

      const pendingAck: PendingSerialSwitchAck = {
        action,
        resolve: () => undefined,
        reject: () => undefined,
      };
      const ackPromise = new Promise<void>((resolve, reject) => {
        pendingAck.resolve = resolve;
        pendingAck.reject = reject;
        serialPendingSwitchAckRef.current = pendingAck;
      });

      try {
        await writeSerialCommandBytes(port, encodeSerialAcquisitionSwitchCommand(action));
        await withTimeout(
          ackPromise,
          EEG_SERIAL_SWITCH_ACK_TIMEOUT_MS,
          t(locale, 'error.serialSwitchAckTimeout'),
        );
      } catch (error) {
        if (serialPendingSwitchAckRef.current === pendingAck) {
          serialPendingSwitchAckRef.current = null;
        }
        throw error;
      }
    },
    [locale, writeSerialCommandBytes],
  );

  const resetCurrentConnection = useCallback(async (): Promise<void> => {
    await stopStreamInternal();
    await closeSerialConnection();
    setConnectedDeviceId(null);
  }, [closeSerialConnection, setConnectedDeviceId, stopStreamInternal]);

  const init = useCallback(async (): Promise<void> => {
    const supported = isWebSerialSupported();
    setSerialSupported(supported);
    setSupported(supported);
    setAvailable(supported);
  }, [setAvailable, setSerialSupported, setSupported]);

  const connectSelectedDevice = useCallback(async (): Promise<void> => {
    const startedAt = performance.now();

    if (!isWebSerialSupported()) {
      const message = t(locale, 'error.unsupportedWebSerial');
      setError(message);
      addLocalizedDiagnostic(
        'error',
        'diagnostics.phaseSerialConnect',
        'diagnostics.serialConnectError',
        {},
        message,
      );
      setStatus('error');
      return;
    }

    if (!useEegStore.getState().acquisition.hardwareConfigLocked) {
      const message = t(locale, 'error.serialConfigRequired');
      setError(message);
      addLocalizedDiagnostic(
        'error',
        'diagnostics.phaseSerialConnect',
        'diagnostics.serialConnectError',
        {},
        message,
      );
      setStatus('error');
      return;
    }

    if (!useAiStore.getState().isSiteBindingLocked) {
      const message = t(locale, 'error.siteBindingRequired');
      setError(message);
      addLocalizedDiagnostic(
        'error',
        'diagnostics.phaseSerialConnect',
        'diagnostics.serialConnectError',
        {},
        message,
      );
      setStatus('error');
      return;
    }

    try {
      clearDiagnostics();
      setError(null);
      await resetCurrentConnection();
      setStatus('requesting-device');
      const baudRate = useEegStore.getState().acquisition.baudRate;
      addLocalizedDiagnostic(
        'running',
        'diagnostics.phaseSerialConnect',
        'diagnostics.serialRequestStart',
        { baudRate },
      );
      const port = await requestSerialPort();
      const summary = toSerialPortSummary(port);
      const hardwareConfig = useEegStore.getState().acquisition.hardwareConfig;
      const channelCount = normalizeEegChannelCount(
        useEegStore.getState().acquisition.channelCount,
      );
      const hardwareConfigSummary = formatSerialHardwareConfigSummary(
        hardwareConfig,
        {
          channelCount: channelCount,
        },
      );
      const session = createSerialConnectionSession({
        gain: hardwareConfig.gain,
        channelCount: channelCount,
        onFrame: handleSerialFrame,
        onInvalidFrame: handleSerialInvalidFrame,
        onSwitchAck: handleSerialSwitchAck,
        onSwitchAckError: handleSerialSwitchAckError,
        onLoopbackEcho: handleSerialLoopbackEcho,
      });

      serialParserRef.current = session.parser;
      serialWaitForResetAckRef.current = session.waitForResetAck;
      serialCancelResetAckRef.current = session.cancelResetAck;
      serialWaitForConfigAckRef.current = session.waitForConfigAck;
      serialCancelConfigAckRef.current = session.cancelConfigAck;

      setStatus('connecting');
      await openSerialPort(port, baudRate);
      serialPortRef.current = port;
      serialBaudRateRef.current = baudRate;
      serialDetachRef.current = addSerialDisconnectListener(port, () =>
        handleSerialDisconnected(),
      );
      startSerialReadLoop(port);
      addLocalizedDiagnostic(
        'running',
        'diagnostics.phaseSerialConnect',
        'diagnostics.serialResetStart',
      );
      await sendSerialInitializationResetCommand();
      useEegStore.getState().setChannelCount(channelCount);
      addLocalizedDiagnostic(
        'success',
        'diagnostics.phaseSerialConnect',
        'diagnostics.serialResetSuccess',
      );
      addLocalizedDiagnostic(
        'running',
        'diagnostics.phaseSerialConnect',
        'diagnostics.serialConfigStart',
        { config: hardwareConfigSummary },
      );
      await sendSerialHardwareConfigCommand(hardwareConfig);

      upsertDevice(summary);
      setConnectedDeviceId(summary.id);
      addLocalizedDiagnostic(
        'success',
        'diagnostics.phaseSerialConnect',
        'diagnostics.serialConfigSuccess',
        { config: hardwareConfigSummary },
      );
      addLocalizedDiagnostic(
        'success',
        'diagnostics.phaseSerialConnect',
        'diagnostics.serialConnectSuccess',
        { deviceName: summary.name ?? t(locale, 'connection.unnamed') },
        summary.id,
        elapsedMs(startedAt),
      );
      setStatus('ready');
    } catch (error) {
      const detail = getErrorDetail(error);
      await closeSerialConnection();
      useEegStore.getState().unlockHardwareConfig();
      setError(detail);
      addLocalizedDiagnostic(
        'error',
        'diagnostics.phaseSerialConnect',
        'diagnostics.serialConnectError',
        {},
        detail,
        elapsedMs(startedAt),
      );
      setStatus('error');
    }
  }, [
    addLocalizedDiagnostic,
    clearDiagnostics,
    closeSerialConnection,
    handleSerialDisconnected,
    handleSerialFrame,
    handleSerialInvalidFrame,
    handleSerialLoopbackEcho,
    handleSerialSwitchAck,
    handleSerialSwitchAckError,
    locale,
    resetCurrentConnection,
    sendSerialHardwareConfigCommand,
    sendSerialInitializationResetCommand,
    setConnectedDeviceId,
    setError,
    setStatus,
    startSerialReadLoop,
    upsertDevice,
  ]);

  const disconnect = useCallback(async (): Promise<void> => {
    await resetCurrentConnection();
    useEegStore.getState().unlockHardwareConfig();
    addLocalizedDiagnostic(
      'info',
      'diagnostics.phaseDisconnect',
      'diagnostics.disconnect',
    );
    setStatus('disconnected');
  }, [addLocalizedDiagnostic, resetCurrentConnection, setStatus]);

  const selectOutputFile = useCallback(async (): Promise<void> => {
    const store = useEegStore.getState();

    if (store.stream.isStarting || store.stream.isStreaming) {
      setError(t(locale, 'error.stopStreamBeforeFileChange'));
      addLocalizedDiagnostic(
        'error',
        'diagnostics.phaseDataStream',
        'diagnostics.streamFileSelectBlocked',
      );
      return;
    }

    if (!isOutputFilePickerSupported()) {
      setError(t(locale, 'error.filePickerUnsupported'));
      addLocalizedDiagnostic(
        'error',
        'diagnostics.phaseDataStream',
        'diagnostics.streamFileUnsupported',
      );
      return;
    }

    try {
      setError(null);
      await closeOutputFile();
      useEegStore.getState().resetStreamRuntime();
      const outputFile = await chooseEegOutputFile();
      outputFileTargetRef.current = outputFile;
      outputFileRef.current = null;
      writeQueueRef.current = Promise.resolve();
      useEegStore.getState().setStreamOutputFile(outputFile.name, true);
      addLocalizedDiagnostic(
        'success',
        'diagnostics.phaseDataStream',
        'diagnostics.streamFileSelected',
        { fileName: outputFile.name },
      );
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') {
        return;
      }

      await closeOutputFile();
      const detail = getErrorDetail(error);
      setError(detail);
      addLocalizedDiagnostic(
        'error',
        'diagnostics.phaseDataStream',
        'diagnostics.streamFileSelectError',
        {},
        detail,
      );
    }
  }, [addLocalizedDiagnostic, closeOutputFile, locale, setError]);

  const startEegStream = useCallback(
    async (input: StartEegStreamInput): Promise<void> => {
      const store = useEegStore.getState();
      const blockStreamStart = (messageKey: TranslationKey): void => {
        const message = t(locale, messageKey);

        setError(message);
        addLocalizedDiagnostic(
          'error',
          'diagnostics.phaseDataStream',
          'diagnostics.streamStartBlocked',
          {},
          message,
        );
      };

      if (store.stream.isStreaming || isStreamStartingRef.current) {
        return;
      }

      const aiState = useAiStore.getState();
      if (!aiState.isSiteBindingLocked) {
        blockStreamStart('error.siteBindingRequired');
        return;
      }

      if (input.writeRawCsv && (!store.stream.outputFileReady || !outputFileTargetRef.current)) {
        blockStreamStart('error.outputFileRequired');
        return;
      }

      const serialParser = serialParserRef.current;
      if (!serialPortRef.current || !serialParser) {
        blockStreamStart('error.streamRequiresConnection');
        return;
      }

      const expectedSerialChannelCount = normalizeEegChannelCount(
        useEegStore.getState().acquisition.channelCount,
      );
      if (serialParser.channelCount !== expectedSerialChannelCount) {
        blockStreamStart('error.serialReconnectRequired');
        return;
      }

      const streamStartedAt = performance.now();
      const baudRate = serialBaudRateRef.current;
      if (baudRate === null) {
        blockStreamStart('error.streamRequiresConnection');
        return;
      }

      try {
        isStreamStartingRef.current = true;
        const streamSessionId = streamSessionRef.current + 1;
        streamSessionRef.current = streamSessionId;
        const channelNames = serialParser.channelNames;
        const hardwareConfig = useEegStore.getState().acquisition.hardwareConfig;
        const sampleRateHz = getCurrentAcquisitionSampleRateHz();
        const serialSourceLabel = `Serial ${baudRate} · ${sampleRateHz}Hz · ${channelNames.length}CH`;
        setError(null);
        useEegStore.getState().setChannelCount(channelNames.length);
        useEegStore.getState().resetStreamRuntime();
        setAiBandRecordingEnabled(input.recordFiveBandFeatures);
        useEegStore.getState().setStreamStarting(serialSourceLabel, input.writeRawCsv);
        rawCsvWriteEnabledRef.current = input.writeRawCsv;
        serialStreamingEnabledRef.current = false;
        serialLastValidFrameAtRef.current = performance.now();
        serialParser.resetStreamState();
        rawWaveformBus.reset();
        filteredWaveformBus.reset();
        leadOffDetectorRef.current = new LeadOffDetectorBank({
          sampleRateHz,
          mode: hardwareConfig.acLeadOffMode,
          channelNames,
        });
        createAnalysisProcessors(channelNames);

        if (input.writeRawCsv && outputFileTargetRef.current) {
          outputFileRef.current = await outputFileTargetRef.current.open();
          writeQueueRef.current = Promise.resolve();
          await outputFileRef.current.write(
            formatEegSampleCsvPreamble(useAiStore.getState().bindings, channelNames),
          );
        }

        if (streamSessionRef.current !== streamSessionId) {
          return;
        }

        await sendSerialSwitchCommand('START');

        if (streamSessionRef.current !== streamSessionId) {
          return;
        }

        useEegStore.getState().setStreamActive(serialSourceLabel, input.writeRawCsv);
        clearStreamWatchdogs();
        serialStalledTimerRef.current = window.setInterval(() => {
          const currentStore = useEegStore.getState();
          const lastValidFrameAt = serialLastValidFrameAtRef.current;

          if (
            streamSessionRef.current !== streamSessionId ||
            !currentStore.stream.isStreaming ||
            lastValidFrameAt === null
          ) {
            return;
          }

          if (performance.now() - lastValidFrameAt > EEG_SERIAL_STALLED_TIMEOUT_MS) {
            if (!currentStore.stream.isStalled) {
              currentStore.setStreamStalled(true);
              addLocalizedDiagnostic(
                'info',
                'diagnostics.phaseDataStream',
                'diagnostics.serialStreamStalled',
              );
            }
          }
        }, 500);
        addLocalizedDiagnostic(
          'success',
          'diagnostics.phaseDataStream',
          'diagnostics.serialStreamStartSuccess',
          { baudRate },
          undefined,
          elapsedMs(streamStartedAt),
        );
      } catch (error) {
        const detail = getErrorDetail(error);
        for (const processor of analysisProcessorsRef.current.values()) {
          processor.reset();
        }
        analysisProcessorsRef.current = new Map();
        leadOffDetectorRef.current = null;
        serialStreamingEnabledRef.current = false;
        if (rawCsvWriteEnabledRef.current) {
          await closeOutputFile();
        }
        rawCsvWriteEnabledRef.current = false;
        setAiBandRecordingEnabled(false);
        useEegStore.getState().setStreamInactive();
        setError(detail);
        addLocalizedDiagnostic(
          'error',
          'diagnostics.phaseDataStream',
          'diagnostics.streamStartError',
          {},
          detail,
          elapsedMs(streamStartedAt),
        );
      } finally {
        isStreamStartingRef.current = false;
      }
    },
    [
      addLocalizedDiagnostic,
      clearStreamWatchdogs,
      closeOutputFile,
      createAnalysisProcessors,
      locale,
      sendSerialSwitchCommand,
      setError,
    ],
  );

  const stopEegStream = useCallback(async (): Promise<void> => {
    const store = useEegStore.getState();

    if (
      serialPortRef.current &&
      serialParserRef.current &&
      (store.stream.isStarting || store.stream.isStreaming)
    ) {
      try {
        await sendSerialSwitchCommand('STOP');
      } catch (error) {
        const detail = getErrorDetail(error);
        if (!isSerialConfigRequiredSwitchError(error)) {
          setError(detail);
          addLocalizedDiagnostic(
            'error',
            'diagnostics.phaseDataStream',
            'diagnostics.streamStartError',
            {},
            detail,
          );
        }
      }
    }

    await stopStreamInternal();
    addLocalizedDiagnostic(
      'info',
      'diagnostics.phaseDataStream',
      'diagnostics.streamStopped',
    );
  }, [addLocalizedDiagnostic, sendSerialSwitchCommand, setError, stopStreamInternal]);

  const forgetSelectedDevice = useCallback(async (): Promise<void> => {
    const { selectedDeviceId } = useEegStore.getState();
    const forgetStartedAt = performance.now();

    if (!selectedDeviceId) {
      setError(t(locale, 'error.noForgetSelected'));
      addLocalizedDiagnostic(
        'error',
        'diagnostics.phaseForgetAccess',
        'diagnostics.forgetError',
        {},
        t(locale, 'error.noForgetSelected'),
      );
      return;
    }

    const port = serialPortRef.current;

    if (!port || typeof port.forget !== 'function') {
      setError(t(locale, 'error.forgetUnsupported'));
      addLocalizedDiagnostic(
        'error',
        'diagnostics.phaseForgetAccess',
        'diagnostics.forgetError',
        {},
        t(locale, 'error.forgetUnsupported'),
      );
      return;
    }

    try {
      setError(null);
      await resetCurrentConnection();
      await port.forget();
      removeDevice(selectedDeviceId);
      addLocalizedDiagnostic(
        'success',
        'diagnostics.phaseForgetAccess',
        'diagnostics.forgetSuccess',
        { deviceName: t(locale, 'system.serialRuntime') },
        undefined,
        elapsedMs(forgetStartedAt),
      );
      setStatus('idle');
    } catch (error) {
      const detail = getErrorDetail(error);
      setError(detail);
      addLocalizedDiagnostic(
        'error',
        'diagnostics.phaseForgetAccess',
        'diagnostics.forgetError',
        {},
        detail,
        elapsedMs(forgetStartedAt),
      );
      setStatus('error');
    }
  }, [
    addLocalizedDiagnostic,
    locale,
    removeDevice,
    resetCurrentConnection,
    setError,
    setStatus,
  ]);

  const filterParams = useEegStore((state) => state.analysis.filterParams);

  useEffect(() => {
    if (analysisProcessorsRef.current.size === 0) {
      return;
    }
    const store = useEegStore.getState();
    const channelNames = [...analysisProcessorsRef.current.keys()];
    const sampleRateHz = getCurrentAcquisitionSampleRateHz();
    const windowSize = getAnalysisWindowSize(sampleRateHz);
    const hopSize = getAnalysisHopSize(sampleRateHz);
    const fftSize = getAutoFftSizeForWindowSize(windowSize);
    filteredWaveformBus.reset();
    const processors = new Map<string, EegFrequencyAnalyzer>();

    for (const channelName of channelNames) {
      processors.set(
        channelName,
        new EegFrequencyAnalyzer({
          windowSize,
          sampleRateHz,
          hopSize,
          channelName,
          algorithmId: store.analysis.selectedAlgorithm,
          filter: createFilterById(DEFAULT_FILTER_ID, filterParams, sampleRateHz),
          fftSize,
          sampleSelector: (sample) => getSampleChannelValue(sample, channelName),
          onFilteredSample: (value) => filteredWaveformBus.push(value, channelName),
        }),
      );
    }

    analysisProcessorsRef.current = processors;
  }, [filterParams]);

  return {
    init,
    connectSelectedDevice,
    disconnect,
    selectOutputFile,
    startEegStream,
    stopEegStream,
    forgetSelectedDevice,
  };
}
