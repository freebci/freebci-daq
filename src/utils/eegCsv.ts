import { EEG_INITIAL_UNRELIABLE_SECONDS, EEG_SAMPLE_RATE_HZ } from '../config/eeg';
import type { SiteBindingV1 } from '../ai/protocol';
import type { EegAnnotationLabel, EegAnnotationRecord, EegSampleBatch } from '../types/eeg';
import {
  EEG_DEFAULT_CHANNEL_COUNT,
  getEegChannelNames,
} from '../transport/eegChannels';

export const EEG_SAMPLE_CSV_BINDING_HEADER =
  'metadata_type,channel_name,site_name,placement_system,binding_id\n';

export interface EegCsvAnnotations {
  labels: EegAnnotationLabel[];
  records: EegAnnotationRecord[];
}

export interface EegCsvFormatOptions extends EegCsvAnnotations {
  sampleOffset?: number;
  sampleRateHz?: number;
  initialUnreliableSeconds?: number;
  channelNames?: readonly string[];
}

interface BatchAnnotationLabels {
  event: string;
  intervalStart: string;
  intervalEnd: string;
}

function formatCsvCell(value: number | string | null): string {
  if (value === null) return '';
  if (typeof value === 'number') return String(value);
  if (!/[",\n\r]/.test(value)) return value;
  return `"${value.replace(/"/g, '""')}"`;
}

function normalizeEegCsvChannelNames(channelNames?: readonly string[]): string[] {
  const normalized = (channelNames ?? getEegChannelNames(EEG_DEFAULT_CHANNEL_COUNT))
    .map((channelName) => channelName.trim())
    .filter((channelName) => channelName.length > 0);
  return normalized.length > 0 ? [...new Set(normalized)] : getEegChannelNames(EEG_DEFAULT_CHANNEL_COUNT);
}

export function formatEegSampleCsvHeader(channelNames?: readonly string[]): string {
  return [
    'timestamp_ms',
    'packet_seq',
    'sample_index',
    ...normalizeEegCsvChannelNames(channelNames),
    'dropped',
    'annotation_event_labels',
    'annotation_interval_start_labels',
    'annotation_interval_end_labels',
  ].join(',') + '\n';
}

export function formatEegSampleCsvPreamble(
  bindings: readonly SiteBindingV1[],
  channelNames?: readonly string[],
): string {
  const header = formatEegSampleCsvHeader(channelNames);
  if (bindings.length === 0) return header;
  const bindingLines = bindings.map((binding) =>
    [
      'site_binding',
      binding.channelName,
      binding.siteName,
      binding.placementSystem,
      binding.bindingId,
    ].map(formatCsvCell).join(','),
  );
  return `${EEG_SAMPLE_CSV_BINDING_HEADER}${bindingLines.join('\n')}\n${header}`;
}

function isWithinBatch(timeMs: number | null, startMs: number, endMs: number): boolean {
  if (timeMs === null || !Number.isFinite(timeMs)) return false;
  return timeMs >= startMs && timeMs <= endMs;
}

function collectBatchAnnotationLabels(
  batch: EegSampleBatch,
  options?: EegCsvAnnotations,
  sampleRateHz = EEG_SAMPLE_RATE_HZ,
): BatchAnnotationLabels {
  if (!options || options.labels.length === 0 || options.records.length === 0) {
    return { event: '', intervalStart: '', intervalEnd: '' };
  }

  const batchEndMs = new Date(batch.receivedAt).getTime();
  const batchDurationMs = (batch.samples.length / sampleRateHz) * 1000;
  const batchStartMs = batchEndMs - batchDurationMs;
  const recordsByLabelId = new Map(options.records.map((record) => [record.labelId, record]));
  const eventLabels: string[] = [];
  const intervalStartLabels: string[] = [];
  const intervalEndLabels: string[] = [];

  for (const label of options.labels) {
    const record = recordsByLabelId.get(label.id);
    if (!record) continue;

    if (record.kind === 'event') {
      if (isWithinBatch(record.recordedAtMs, batchStartMs, batchEndMs)) {
        eventLabels.push(label.name);
      }
      continue;
    }

    if (isWithinBatch(record.startRecordedAtMs, batchStartMs, batchEndMs)) {
      intervalStartLabels.push(label.name);
    }
    if (isWithinBatch(record.endRecordedAtMs, batchStartMs, batchEndMs)) {
      intervalEndLabels.push(label.name);
    }
  }

  return {
    event: eventLabels.join('|'),
    intervalStart: intervalStartLabels.join('|'),
    intervalEnd: intervalEndLabels.join('|'),
  };
}

function getReliableBatch(
  batch: EegSampleBatch,
  sampleOffset?: number,
  sampleRateHz = EEG_SAMPLE_RATE_HZ,
  initialUnreliableSeconds = EEG_INITIAL_UNRELIABLE_SECONDS,
): EegSampleBatch {
  if (sampleOffset === undefined) {
    return batch;
  }

  const firstReliableSampleIndex = Math.max(0, initialUnreliableSeconds) * sampleRateHz;
  const samples = batch.samples.filter((_, index) => {
    return sampleOffset + index >= firstReliableSampleIndex;
  });

  return samples.length === batch.samples.length ? batch : { ...batch, samples };
}

export function formatEegSampleBatchCsv(
  batch: EegSampleBatch,
  options?: EegCsvFormatOptions,
): string {
  const sampleRateHz = options?.sampleRateHz ?? EEG_SAMPLE_RATE_HZ;
  const reliableBatch = getReliableBatch(
    batch,
    options?.sampleOffset,
    sampleRateHz,
    options?.initialUnreliableSeconds,
  );

  if (reliableBatch.samples.length === 0) {
    return '';
  }

  const timestampMs = new Date(batch.receivedAt).getTime();
  const annotationLabels = collectBatchAnnotationLabels(reliableBatch, options, sampleRateHz);
  const sampleOffset = options?.sampleOffset ?? 0;
  const droppedSamples = Math.max(0, batch.droppedSamples ?? 0);
  const channelNames = normalizeEegCsvChannelNames(options?.channelNames);
  const lines = reliableBatch.samples.map((sample, index) => {
    return [
      timestampMs,
      batch.packetSeq,
      sampleOffset + sample.sampleIndex,
      ...channelNames.map((channelName) =>
        sample.channels?.[channelName] ?? (channelName === 'ch0' ? sample.eegValue : ''),
      ),
      index === 0 ? droppedSamples : 0,
      annotationLabels.event,
      annotationLabels.intervalStart,
      annotationLabels.intervalEnd,
    ].map(formatCsvCell).join(',');
  });

  return `${lines.join('\n')}\n`;
}
