import {
  isSerialAcquisitionSwitchAckLine,
  isSerialAcquisitionSwitchAckPrefix,
  parseSerialAcquisitionSwitchAckLine,
  type SerialAcquisitionSwitchAck,
} from './serialAcquisitionSwitch';
import {
  isSerialHardwareConfigAckLine,
  isSerialHardwareConfigAckPrefix,
  parseSerialHardwareConfigAckLine,
  type SerialHardwareConfigAck,
  type SerialHardwareGain,
} from './serialHardwareConfig';
import {
  isSerialInitializationResetAckLine,
  isSerialInitializationResetAckPrefix,
  isSerialInitializationResetCommandLine,
  isSerialInitializationResetCommandPrefix,
  parseSerialInitializationResetAckLine,
  type SerialInitializationResetAck,
} from './serialInitialization';
import {
  EEG_FRAME_BYTES_PER_INT24,
  EEG_FRAME_CONVERTER_REFERENCE_VOLTS,
  EEG_FRAME_DEFAULT_SAMPLE_COUNT,
  EEG_FRAME_HEADER_BYTES,
  EEG_FRAME_INT24_FULL_SCALE_CODE,
  EEG_FRAME_MAGIC_0,
  EEG_FRAME_MAGIC_1,
  EEG_FRAME_MAX_SAMPLE_COUNT,
  EEG_FRAME_MIN_SAMPLE_COUNT,
  EEG_FRAME_PACKET_TYPE_DATA,
  countForwardEegFrameSeqGap,
  eegRawCodeToVolts,
  findEegFrameMagic,
  getEegDataFrameByteLength,
  getNextEegFrameSeq,
  readEegInt24Le,
  type EegDataFrame,
  type EegFrameSample,
  type EegInvalidDataFrame,
} from '../transport/eegFrameProtocol';
import {
  getEegChannelNames,
  normalizeEegChannelCount,
} from '../transport/eegChannels';

export {
  SERIAL_EEG_CHANNEL_COUNT,
  SERIAL_EEG_MAX_CHANNEL_COUNT,
  SERIAL_EEG_MIN_CHANNEL_COUNT,
  getSerialEegChannelNames,
  normalizeSerialEegChannelCount,
} from './serialChannels';

export const SERIAL_EEG_MAGIC_0 = EEG_FRAME_MAGIC_0;
export const SERIAL_EEG_MAGIC_1 = EEG_FRAME_MAGIC_1;
export const SERIAL_EEG_PACKET_TYPE_DATA = EEG_FRAME_PACKET_TYPE_DATA;
export const SERIAL_EEG_BYTES_PER_INT24 = EEG_FRAME_BYTES_PER_INT24;
export const SERIAL_EEG_HEADER_BYTES = EEG_FRAME_HEADER_BYTES;
export const SERIAL_EEG_MIN_SAMPLE_COUNT = EEG_FRAME_MIN_SAMPLE_COUNT;
export const SERIAL_EEG_MAX_SAMPLE_COUNT = EEG_FRAME_MAX_SAMPLE_COUNT;
export const SERIAL_EEG_DEFAULT_SAMPLE_COUNT = EEG_FRAME_DEFAULT_SAMPLE_COUNT;
export const SERIAL_EEG_CONVERTER_REFERENCE_VOLTS = EEG_FRAME_CONVERTER_REFERENCE_VOLTS;
export const SERIAL_EEG_INT24_FULL_SCALE_CODE = EEG_FRAME_INT24_FULL_SCALE_CODE;

export type SerialEegSample = EegFrameSample;
export type SerialEegFrame = EegDataFrame;
export type SerialEegInvalidFrame = EegInvalidDataFrame;

export interface SerialEegLoopbackEcho {
  line: string;
  command: 'EEGCFG' | 'SW' | 'EEGRST';
  exactMatch: boolean;
}

export interface SerialEegProtocolParserCallbacks {
  onResetAck?: (ack: SerialInitializationResetAck) => void;
  onResetAckError?: (line: string) => void;
  onConfigAck?: (ack: SerialHardwareConfigAck) => void;
  onConfigAckError?: (line: string) => void;
  onSwitchAck?: (ack: SerialAcquisitionSwitchAck) => void;
  onSwitchAckError?: (line: string) => void;
  onLoopbackEcho?: (echo: SerialEegLoopbackEcho) => void;
  onFrame: (frame: SerialEegFrame) => void;
  onInvalidFrame?: (frame: SerialEegInvalidFrame) => void;
}

export interface SerialEegProtocolParserOptions {
  gain?: SerialHardwareGain;
  channelCount?: number;
}

export function formatSerialEegProtocolLabel(channelCount: number): string {
  return `EEGRST/ACK + EEGCFG/ACK · ${normalizeEegChannelCount(channelCount)}CH · I24LE`;
}

export class SerialEegProtocolParser {
  private readonly callbacks: SerialEegProtocolParserCallbacks;

  private readonly gain: SerialHardwareGain;

  private readonly decoder = new TextDecoder();

  private buffer: Uint8Array<ArrayBufferLike> = new Uint8Array(0);

  private configuredChannelCount: number;

  private configuredChannelNames: string[];

  private expectedDataSeq: number | null = null;

  private readonly outboundCommandLines: string[] = [];

  constructor(
    callbacks: SerialEegProtocolParserCallbacks,
    options: SerialEegProtocolParserOptions = {},
  ) {
    this.callbacks = callbacks;
    this.gain = options.gain ?? 24;
    this.configuredChannelCount = normalizeEegChannelCount(options.channelCount);
    this.configuredChannelNames = getEegChannelNames(this.configuredChannelCount);
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

  trackOutboundCommand(command: Uint8Array | string): void {
    const text = typeof command === 'string' ? command : this.decoder.decode(command);

    for (const line of text.split('\n')) {
      const normalizedLine = line.replace(/\r$/, '');
      if (normalizedLine.length === 0) {
        continue;
      }

      this.outboundCommandLines.push(normalizedLine);
    }

    while (this.outboundCommandLines.length > 8) {
      this.outboundCommandLines.shift();
    }
  }

  pushChunk(chunk: Uint8Array): void {
    if (chunk.byteLength === 0) {
      return;
    }

    this.buffer = appendBytes(this.buffer, chunk);
    this.consumeFramesAndTextAcks();
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

  private consumeFramesAndTextAcks(): void {
    while (true) {
      const magicIndex = findEegFrameMagic(this.buffer);

      if (this.consumeTextLineBeforeMagic(magicIndex)) {
        continue;
      }

      if (magicIndex === -1) {
        if (this.shouldWaitForTextAckLine()) {
          return;
        }

        const keepTail = this.buffer[this.buffer.byteLength - 1] === EEG_FRAME_MAGIC_0;
        const discardedBytes = keepTail
          ? this.buffer.byteLength - 1
          : this.buffer.byteLength;

        if (discardedBytes > 0) {
          this.callbacks.onInvalidFrame?.({
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
        this.callbacks.onInvalidFrame?.({
          reason: 'discarded-bytes',
          discardedBytes: magicIndex,
        });
        this.buffer = this.buffer.slice(magicIndex);
      }

      if (this.buffer.byteLength < EEG_FRAME_HEADER_BYTES) {
        return;
      }

      const packetType = this.buffer[2];
      if (packetType !== EEG_FRAME_PACKET_TYPE_DATA) {
        this.callbacks.onInvalidFrame?.({
          reason: 'invalid-packet-type',
          actualPacketType: packetType,
        });
        this.buffer = this.buffer.slice(1);
        continue;
      }

      const count = this.buffer[7];
      if (count < EEG_FRAME_MIN_SAMPLE_COUNT || count > EEG_FRAME_MAX_SAMPLE_COUNT) {
        this.callbacks.onInvalidFrame?.({
          reason: 'invalid-count',
          count,
        });
        this.buffer = this.buffer.slice(1);
        continue;
      }

      const frameBytes = getEegDataFrameByteLength(count, this.configuredChannelCount);
      if (this.buffer.byteLength < frameBytes) {
        return;
      }

      const frameBytesView = this.buffer.slice(0, frameBytes);
      const parsed = this.parseFrame(frameBytesView, count);

      if (parsed) {
        this.buffer = this.buffer.slice(frameBytes);
        this.callbacks.onFrame(parsed);
      } else {
        this.buffer = this.buffer.slice(1);
      }
    }
  }

  private consumeTextLineBeforeMagic(magicIndex: number): boolean {
    const newlineIndex = this.buffer.indexOf(0x0a);

    if (newlineIndex === -1 || (magicIndex !== -1 && newlineIndex > magicIndex)) {
      return false;
    }

    const lineBytes = this.buffer.slice(0, newlineIndex);
    const line = this.decoder.decode(lineBytes).replace(/\r$/, '');
    const frontendCommand = getFrontendCommandKind(line);

    this.buffer = this.buffer.slice(newlineIndex + 1);

    if (frontendCommand) {
      this.callbacks.onLoopbackEcho?.({
        line,
        command: frontendCommand,
        exactMatch: this.outboundCommandLines.includes(line),
      });
      return true;
    }

    if (isSerialInitializationResetAckLine(line)) {
      const ack = parseSerialInitializationResetAckLine(line);
      if (!ack) {
        this.callbacks.onResetAckError?.(line);
        return true;
      }
      this.callbacks.onResetAck?.(ack);
      return true;
    }

    if (isSerialHardwareConfigAckLine(line)) {
      const ack = parseSerialHardwareConfigAckLine(line);
      if (!ack) {
        this.callbacks.onConfigAckError?.(line);
        return true;
      }
      this.callbacks.onConfigAck?.(ack);
      return true;
    }

    if (isSerialAcquisitionSwitchAckLine(line)) {
      const ack = parseSerialAcquisitionSwitchAckLine(line);
      if (!ack) {
        this.callbacks.onSwitchAckError?.(line);
        return true;
      }
      this.callbacks.onSwitchAck?.(ack);
      return true;
    }

    this.callbacks.onInvalidFrame?.({
      reason: 'discarded-bytes',
      discardedBytes: newlineIndex + 1,
    });
    return true;
  }

  private shouldWaitForTextAckLine(): boolean {
    if (this.buffer.byteLength === 0) {
      return false;
    }

    const text = this.decoder.decode(this.buffer);
    return (
      isSerialInitializationResetAckPrefix(text) ||
      isSerialHardwareConfigAckPrefix(text) ||
      isSerialAcquisitionSwitchAckPrefix(text) ||
      isFrontendCommandPrefix(text)
    );
  }

  private parseFrame(bytes: Uint8Array, count: number): SerialEegFrame | null {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const seq = view.getUint32(3, true);
    const samples: SerialEegSample[] = [];

    for (let sampleIndex = 0; sampleIndex < count; sampleIndex += 1) {
      const sampleOffset =
        SERIAL_EEG_HEADER_BYTES +
        sampleIndex * this.configuredChannelCount * SERIAL_EEG_BYTES_PER_INT24;
      const sample: SerialEegSample = {};

      for (let channelIndex = 0; channelIndex < this.configuredChannelCount; channelIndex += 1) {
        const channelName = this.configuredChannelNames[channelIndex];
        const channelOffset = sampleOffset + channelIndex * SERIAL_EEG_BYTES_PER_INT24;
        const rawCode = readEegInt24Le(bytes, channelOffset);

        if (!Number.isSafeInteger(rawCode)) {
          this.callbacks.onInvalidFrame?.({
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

function appendBytes(left: Uint8Array, right: Uint8Array): Uint8Array {
  const out = new Uint8Array(left.byteLength + right.byteLength);
  out.set(left, 0);
  out.set(right, left.byteLength);
  return out;
}

function getFrontendCommandKind(line: string): SerialEegLoopbackEcho['command'] | null {
  if (isSerialInitializationResetCommandLine(line)) {
    return 'EEGRST';
  }

  if (line.startsWith('EEGCFG,')) {
    return 'EEGCFG';
  }

  if (line.startsWith('SW,')) {
    return 'SW';
  }

  return null;
}

function isFrontendCommandPrefix(text: string): boolean {
  const normalized = text.replace(/\r$/, '');
  if (normalized.length === 0) {
    return false;
  }

  return (
    isSerialInitializationResetCommandPrefix(normalized) ||
    'EEGCFG,'.startsWith(normalized) ||
    normalized.startsWith('EEGCFG,') ||
    'SW,'.startsWith(normalized) ||
    normalized.startsWith('SW,')
  );
}
