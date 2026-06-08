import { describe, expect, it } from 'vitest';
import { AI_SCHEMA_VERSION, type SiteBindingV1 } from '../src/ai/protocol';
import { EEG_INITIAL_UNRELIABLE_SECONDS, EEG_SAMPLE_RATE_HZ } from '../src/config/eeg';
import type { EegAnnotationLabel, EegAnnotationRecord, EegSampleBatch } from '../src/types/eeg';
import {
  EEG_SAMPLE_CSV_BINDING_HEADER,
  formatEegSampleCsvHeader,
  formatEegSampleCsvPreamble,
  formatEegSampleBatchCsv,
} from '../src/utils/eegCsv';

const makeBatch = (receivedAt: string, sampleCount = 2): EegSampleBatch => ({
  source: 'serial',
  packetSeq: 7,
  droppedSamples: 0,
  receivedAt,
  samples: Array.from({ length: sampleCount }, (_, index) => ({
    sampleIndex: index,
    eegValue: index === 0 ? 1 : 5,
    channels: { ch0: index === 0 ? 1 : 5 },
    dcValidity: null,
    rldValidity: null,
  })),
});

const makeMultiChannelBatch = (receivedAt: string): EegSampleBatch => ({
  source: 'serial',
  packetSeq: 9,
  droppedSamples: 4,
  receivedAt,
  samples: [
    {
      sampleIndex: 0,
      eegValue: 1e-6,
      channels: { ch0: 1e-6, ch1: 2e-6, ch2: 3e-6 },
      dcValidity: null,
      rldValidity: null,
    },
    {
      sampleIndex: 1,
      eegValue: 4e-6,
      channels: { ch0: 4e-6, ch1: 5e-6, ch2: 6e-6 },
      dcValidity: null,
      rldValidity: null,
    },
  ],
});

const makeBinding = (
  channelName: string,
  siteName: string,
  placementSystem = '10-20',
): SiteBindingV1 => ({
  schemaVersion: AI_SCHEMA_VERSION,
  conversationId: 'conversation-test',
  bindingId: `binding-${channelName}`,
  channelName,
  siteName,
  placementSystem,
  createdAtMs: 1,
});

describe('eegCsv', () => {
  it('writes channel-to-site bindings before the sample header', () => {
    expect(EEG_SAMPLE_CSV_BINDING_HEADER).toBe(
      'metadata_type,channel_name,site_name,placement_system,binding_id\n',
    );
    expect(
      formatEegSampleCsvPreamble(
        [
          makeBinding('ch0', 'Cz'),
          makeBinding('ch1', 'F3, left', 'custom "cap"'),
        ],
        ['ch0', 'ch1'],
      ),
    ).toBe(
      [
        'metadata_type,channel_name,site_name,placement_system,binding_id',
        'site_binding,ch0,Cz,10-20,binding-ch0',
        'site_binding,ch1,"F3, left","custom ""cap""",binding-ch1',
        'timestamp_ms,packet_seq,sample_index,ch0,ch1,dropped,annotation_event_labels,annotation_interval_start_labels,annotation_interval_end_labels',
        '',
      ].join('\n'),
    );
  });

  it('uses the sample header only when no bindings are configured', () => {
    expect(formatEegSampleCsvPreamble([], ['ch0', 'ch1'])).toBe(
      'timestamp_ms,packet_seq,sample_index,ch0,ch1,dropped,annotation_event_labels,annotation_interval_start_labels,annotation_interval_end_labels\n',
    );
  });

  it('writes multichannel rows with packet sequence and dropped samples', () => {
    const reliableOffset = EEG_INITIAL_UNRELIABLE_SECONDS * EEG_SAMPLE_RATE_HZ;
    const batch = makeMultiChannelBatch('2026-04-24T08:00:00.123Z');

    expect(formatEegSampleCsvHeader(['ch0', 'ch1', 'ch2'])).toBe(
      'timestamp_ms,packet_seq,sample_index,ch0,ch1,ch2,dropped,annotation_event_labels,annotation_interval_start_labels,annotation_interval_end_labels\n',
    );
    expect(
      formatEegSampleBatchCsv(batch, {
        labels: [],
        records: [],
        sampleOffset: reliableOffset,
        channelNames: ['ch0', 'ch1', 'ch2'],
      }),
    ).toBe(
      [
        `1777017600123,9,${reliableOffset},0.000001,0.000002,0.000003,4,,,`,
        `1777017600123,9,${reliableOffset + 1},0.000004,0.000005,0.000006,0,,,`,
        '',
      ].join('\n'),
    );
  });

  it('writes event labels to every sample row in the matching batch', () => {
    const receivedAt = '2026-04-24T08:00:00.123Z';
    const eventMs = new Date(receivedAt).getTime() - 4;
    const labels: EegAnnotationLabel[] = [
      { id: 'event-1', name: 'Blink', kind: 'event', color: '#2563eb' },
    ];
    const records: EegAnnotationRecord[] = [
      { labelId: 'event-1', kind: 'event', timeSeconds: 0, recordedAtMs: eventMs },
    ];

    expect(
      formatEegSampleBatchCsv(makeBatch(receivedAt), {
        labels,
        records,
        channelNames: ['ch0'],
      }),
    ).toBe(
      [
        '1777017600123,7,0,1,0,Blink,,',
        '1777017600123,7,1,5,0,Blink,,',
        '',
      ].join('\n'),
    );
  });

  it('writes interval start and end labels to their matching batch columns', () => {
    const receivedAt = '2026-04-24T08:00:00.123Z';
    const batchEndMs = new Date(receivedAt).getTime();
    const labels: EegAnnotationLabel[] = [
      { id: 'interval-start', name: 'Task', kind: 'interval', color: '#059669' },
      { id: 'interval-end', name: 'Rest', kind: 'interval', color: '#db2777' },
    ];
    const records: EegAnnotationRecord[] = [
      {
        labelId: 'interval-start',
        kind: 'interval',
        startTimeSeconds: 0,
        endTimeSeconds: null,
        startRecordedAtMs: batchEndMs - 4,
        endRecordedAtMs: null,
      },
      {
        labelId: 'interval-end',
        kind: 'interval',
        startTimeSeconds: 0,
        endTimeSeconds: 1,
        startRecordedAtMs: batchEndMs - 1000,
        endRecordedAtMs: batchEndMs - 4,
      },
    ];

    expect(
      formatEegSampleBatchCsv(makeBatch(receivedAt), {
        labels,
        records,
        channelNames: ['ch0'],
      }),
    ).toBe(
      [
        '1777017600123,7,0,1,0,,Task,Rest',
        '1777017600123,7,1,5,0,,Task,Rest',
        '',
      ].join('\n'),
    );
  });

  it('joins multiple labels and escapes CSV cells', () => {
    const receivedAt = '2026-04-24T08:00:00.123Z';
    const eventMs = new Date(receivedAt).getTime() - 4;
    const labels: EegAnnotationLabel[] = [
      { id: 'event-1', name: 'A,one', kind: 'event', color: '#2563eb' },
      { id: 'event-2', name: 'B "two"', kind: 'event', color: '#059669' },
    ];
    const records: EegAnnotationRecord[] = [
      { labelId: 'event-1', kind: 'event', timeSeconds: 0, recordedAtMs: eventMs },
      { labelId: 'event-2', kind: 'event', timeSeconds: 0, recordedAtMs: eventMs },
    ];

    expect(
      formatEegSampleBatchCsv(makeBatch(receivedAt, 1), {
        labels,
        records,
        channelNames: ['ch0'],
      }),
    ).toBe(['1777017600123,7,0,1,0,"A,one|B ""two""",,', ''].join('\n'));
  });

  it('omits samples before the initial unreliable window when a stream offset is supplied', () => {
    const unreliableSampleCount = EEG_INITIAL_UNRELIABLE_SECONDS * EEG_SAMPLE_RATE_HZ;

    expect(
      formatEegSampleBatchCsv(makeBatch('2026-04-24T08:00:00.123Z'), {
        labels: [],
        records: [],
        sampleOffset: unreliableSampleCount - 1,
        channelNames: ['ch0'],
      }),
    ).toBe([`1777017600123,7,${unreliableSampleCount},5,0,,,`, ''].join('\n'));
  });

  it('writes no rows for batches entirely inside the initial unreliable window', () => {
    const unreliableSampleCount = EEG_INITIAL_UNRELIABLE_SECONDS * EEG_SAMPLE_RATE_HZ;

    expect(
      formatEegSampleBatchCsv(makeBatch('2026-04-24T08:00:00.123Z'), {
        labels: [],
        records: [],
        sampleOffset: unreliableSampleCount - 2,
        channelNames: ['ch0'],
      }),
    ).toBe('');
  });
});
