import {
  getEegChannelNames,
  normalizeEegChannelCount,
} from './eegChannels';
import type { EegHardwareGain } from './eegHardwareConfig';

export const EEG_FRAME_MAGIC_0 = 0xa5;
export const EEG_FRAME_MAGIC_1 = 0x5a;
export const EEG_FRAME_PACKET_TYPE_DATA = 0x01;
export const EEG_FRAME_BYTES_PER_INT24 = 3;
export const EEG_FRAME_HEADER_BYTES = 8;
export const EEG_FRAME_MIN_SAMPLE_COUNT = 1;
export const EEG_FRAME_MAX_SAMPLE_COUNT = 64;
export const EEG_FRAME_DEFAULT_SAMPLE_COUNT = 20;
export const EEG_FRAME_CONVERTER_REFERENCE_VOLTS = 2.5;
export const EEG_FRAME_INT24_FULL_SCALE_CODE = 0x7f_ffff;
export const EEG_FRAME_SEQ_MAX = 0xffff_ffff;

export type EegFrameSample = Record<string, number>;

export interface EegDataFrame {
  seq: number;
  count: number;
  channelCount: number;
  channelNames: string[];
  droppedPackets: number;
  droppedSamples: number;
  receivedAt: string;
  samples: EegFrameSample[];
}

export interface EegInvalidDataFrame {
  reason:
    | 'discarded-bytes'
    | 'invalid-packet-type'
    | 'invalid-count'
    | 'invalid-int24';
  actualPacketType?: number;
  count?: number;
  discardedBytes?: number;
  seq?: number;
  sampleIndex?: number;
  channelName?: string;
  value?: number;
}

export interface EegFrameParserOptions {
  gain?: EegHardwareGain;
  channelCount?: number;
  onFrame: (frame: EegDataFrame) => void;
  onInvalidFrame?: (frame: EegInvalidDataFrame) => void;
}

export function formatEegFrameProtocolLabel(channelCount: number): string {
  return `${normalizeEegChannelCount(channelCount)}CH · I24LE`;
}

export function getNextEegFrameSeq(seq: number): number {
  return (seq + 1) >>> 0;
}

export function countForwardEegFrameSeqGap(
  expectedSeq: number,
  actualSeq: number,
): number {
  const gap = (actualSeq - expectedSeq) >>> 0;
  if (gap === 0 || gap > 0x7fff_ffff) {
    return 0;
  }

  return gap;
}

export class EegFrameParser {
  private readonly onFrame: (frame: EegDataFrame) => void;

  private readonly onInvalidFrame?: (frame: EegInvalidDataFrame) => void;

  private readonly gain: EegHardwareGain;

  private buffer: Uint8Array<ArrayBufferLike> = new Uint8Array(0);

  private configuredChannelCount: number;

  private configuredChannelNames: string[];

  private expectedDataSeq: number | null = null;

  constructor({
    gain = 24,
    channelCount,
    onFrame,
    onInvalidFrame,
  }: EegFrameParserOptions) {
    this.gain = gain;
    this.configuredChannelCount = normalizeEegChannelCount(channelCount);
    this.configuredChannelNames = getEegChannelNames(this.configuredChannelCount);
    this.onFrame = onFrame;
    this.onInvalidFrame = onInvalidFrame;
  }

  get channelCount(): number {
    return this.configuredChannelCount;
  }

  get channelNames(): string[] {
    return [...this.configuredChannelNames];
  }

  configureChannels(channelCount: number): void {
    this.configuredChannelCount = normalizeEegChannelCount(channelCount);
    this.configuredChannelNames = getEegChannelNames(this.configuredChannelCount);
  }

  pushChunk(chunk: Uint8Array): void {
    if (chunk.byteLength === 0) {
      return;
    }

    this.buffer = appendBytes(this.buffer, chunk);
    this.consumeFrames();
  }

  resetStreamState(): void {
    this.buffer = new Uint8Array(0);
    this.resetDataSequence();
  }

  resetDataSequence(): void {
    this.expectedDataSeq = null;
  }

  reset(): void {
    this.resetStreamState();
  }

  private consumeFrames(): void {
    while (true) {
      const magicIndex = findEegFrameMagic(this.buffer);

      if (magicIndex === -1) {
        const keepTail = this.buffer[this.buffer.byteLength - 1] === EEG_FRAME_MAGIC_0;
        const discardedBytes = keepTail
          ? this.buffer.byteLength - 1
          : this.buffer.byteLength;

        if (discardedBytes > 0) {
          this.onInvalidFrame?.({
            reason: 'discarded-bytes',
            discardedBytes,
          });
        }

        this.buffer = keepTail
          ? this.buffer.slice(this.buffer.byteLength - 1)
          : new Uint8Array(0);
        return;
      }

      if (magicIndex > 0) {
        this.onInvalidFrame?.({
          reason: 'discarded-bytes',
          discardedBytes: magicIndex,
        });
        this.buffer = this.buffer.slice(magicIndex);
      }

      const parseResult = this.parseBufferedFrame();
      if (parseResult === 'need-more-data') {
        return;
      }

      if (parseResult === 'parsed') {
        continue;
      }

      this.buffer = this.buffer.slice(1);
    }
  }

  private parseBufferedFrame(): 'parsed' | 'invalid' | 'need-more-data' {
    if (this.buffer.byteLength < EEG_FRAME_HEADER_BYTES) {
      return 'need-more-data';
    }

    const packetType = this.buffer[2];
    if (packetType !== EEG_FRAME_PACKET_TYPE_DATA) {
      this.onInvalidFrame?.({
        reason: 'invalid-packet-type',
        actualPacketType: packetType,
      });
      return 'invalid';
    }

    const count = this.buffer[7];
    if (count < EEG_FRAME_MIN_SAMPLE_COUNT || count > EEG_FRAME_MAX_SAMPLE_COUNT) {
      this.onInvalidFrame?.({
        reason: 'invalid-count',
        count,
      });
      return 'invalid';
    }

    const frameBytes = getEegDataFrameByteLength(count, this.configuredChannelCount);
    if (this.buffer.byteLength < frameBytes) {
      return 'need-more-data';
    }

    const frameBytesView = this.buffer.slice(0, frameBytes);
    const parsed = this.parseFrame(frameBytesView, count);

    if (!parsed) {
      return 'invalid';
    }

    this.buffer = this.buffer.slice(frameBytes);
    this.onFrame(parsed);
    return 'parsed';
  }

  private parseFrame(bytes: Uint8Array, count: number): EegDataFrame | null {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const seq = view.getUint32(3, true);
    const samples: EegFrameSample[] = [];

    for (let sampleIndex = 0; sampleIndex < count; sampleIndex += 1) {
      const sampleOffset =
        EEG_FRAME_HEADER_BYTES +
        sampleIndex * this.configuredChannelCount * EEG_FRAME_BYTES_PER_INT24;
      const sample: EegFrameSample = {};

      for (let channelIndex = 0; channelIndex < this.configuredChannelCount; channelIndex += 1) {
        const channelName = this.configuredChannelNames[channelIndex];
        const channelOffset = sampleOffset + channelIndex * EEG_FRAME_BYTES_PER_INT24;
        const rawCode = readEegInt24Le(bytes, channelOffset);

        if (!Number.isSafeInteger(rawCode)) {
          this.onInvalidFrame?.({
            reason: 'invalid-int24',
            seq,
            sampleIndex,
            channelName,
            value: rawCode,
          });
          return null;
        }

        sample[channelName] = eegRawCodeToVolts(rawCode, this.gain);
      }

      samples.push(sample);
    }

    const droppedPackets = this.observeDataFrameSeq(seq);

    return {
      seq,
      count,
      channelCount: this.configuredChannelCount,
      channelNames: [...this.configuredChannelNames],
      droppedPackets,
      droppedSamples: droppedPackets * count,
      receivedAt: new Date().toISOString(),
      samples,
    };
  }

  private observeDataFrameSeq(seq: number): number {
    if (this.expectedDataSeq === null) {
      this.expectedDataSeq = getNextEegFrameSeq(seq);
      return 0;
    }

    const droppedPackets = countForwardEegFrameSeqGap(this.expectedDataSeq, seq);
    this.expectedDataSeq = getNextEegFrameSeq(seq);
    return droppedPackets;
  }
}

export function getEegDataFrameByteLength(count: number, channelCount: number): number {
  return (
    EEG_FRAME_HEADER_BYTES +
    count * normalizeEegChannelCount(channelCount) * EEG_FRAME_BYTES_PER_INT24
  );
}

export function findEegFrameMagic(bytes: Uint8Array): number {
  for (let index = 0; index < bytes.byteLength - 1; index += 1) {
    if (
      bytes[index] === EEG_FRAME_MAGIC_0 &&
      bytes[index + 1] === EEG_FRAME_MAGIC_1
    ) {
      return index;
    }
  }

  return -1;
}

export function readEegInt24Le(bytes: Uint8Array, offset: number): number {
  const raw =
    bytes[offset] |
    (bytes[offset + 1] << 8) |
    (bytes[offset + 2] << 16);
  return raw & 0x80_0000 ? raw - 0x100_0000 : raw;
}

export function eegRawCodeToVolts(rawCode: number, gain: EegHardwareGain): number {
  return (
    (rawCode * EEG_FRAME_CONVERTER_REFERENCE_VOLTS) /
    gain /
    EEG_FRAME_INT24_FULL_SCALE_CODE
  );
}

function appendBytes(left: Uint8Array, right: Uint8Array): Uint8Array {
  const out = new Uint8Array(left.byteLength + right.byteLength);
  out.set(left, 0);
  out.set(right, left.byteLength);
  return out;
}
