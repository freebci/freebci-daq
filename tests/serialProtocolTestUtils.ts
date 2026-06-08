import type { SerialAcquisitionSwitchAck } from '../src/serial/serialAcquisitionSwitch';
import {
  SERIAL_EEG_CONVERTER_REFERENCE_VOLTS,
  SERIAL_EEG_INT24_FULL_SCALE_CODE,
  SERIAL_EEG_MAGIC_0,
  SERIAL_EEG_MAGIC_1,
  SERIAL_EEG_PACKET_TYPE_DATA,
  SerialEegProtocolParser,
  type SerialEegFrame,
  type SerialEegInvalidFrame,
  type SerialEegLoopbackEcho,
} from '../src/serial/serialEegProtocol';
import type { SerialHardwareConfigAck } from '../src/serial/serialHardwareConfig';
import type { SerialInitializationResetAck } from '../src/serial/serialInitialization';

interface SerialDataFrameOptions {
  packetType?: number;
  count?: number;
  channelCount?: number;
}

export interface SerialParserProbe {
  parser: SerialEegProtocolParser;
  frames: SerialEegFrame[];
  invalidFrames: SerialEegInvalidFrame[];
  resetAcks: SerialInitializationResetAck[];
  resetAckErrors: string[];
  configAcks: SerialHardwareConfigAck[];
  configAckErrors: string[];
  switchAcks: SerialAcquisitionSwitchAck[];
  switchAckErrors: string[];
  loopbackEchoes: SerialEegLoopbackEcho[];
}

const encoder = new TextEncoder();

export function serialTextBytes(text: string): Uint8Array {
  return encoder.encode(text);
}

export function concatBytes(...chunks: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(chunks.reduce((sum, chunk) => sum + chunk.byteLength, 0));
  let offset = 0;

  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.byteLength;
  }

  return out;
}

export function serialDataFrameBytes(
  seq: number,
  samples: number[][],
  options: SerialDataFrameOptions = {},
): Uint8Array {
  const count = options.count ?? samples.length;
  const channelCount = options.channelCount ?? samples[0]?.length ?? 2;
  const bytes = new Uint8Array(8 + samples.length * channelCount * 3);
  const view = new DataView(bytes.buffer);

  bytes[0] = SERIAL_EEG_MAGIC_0;
  bytes[1] = SERIAL_EEG_MAGIC_1;
  bytes[2] = options.packetType ?? SERIAL_EEG_PACKET_TYPE_DATA;
  view.setUint32(3, seq, true);
  bytes[7] = count;

  samples.forEach((channels, sampleIndex) => {
    const sampleOffset = 8 + sampleIndex * channelCount * 3;
    channels.forEach((value, channelIndex) => {
      writeInt24Le(bytes, sampleOffset + channelIndex * 3, value);
    });
  });

  return bytes;
}

export function rawCodeToVolts(rawCode: number, gain = 24): number {
  return (
    (rawCode * SERIAL_EEG_CONVERTER_REFERENCE_VOLTS) /
    gain /
    SERIAL_EEG_INT24_FULL_SCALE_CODE
  );
}

export function createSerialParserProbe(gain = 24, channelCount = 2): SerialParserProbe {
  const frames: SerialEegFrame[] = [];
  const invalidFrames: SerialEegInvalidFrame[] = [];
  const resetAcks: SerialInitializationResetAck[] = [];
  const resetAckErrors: string[] = [];
  const configAcks: SerialHardwareConfigAck[] = [];
  const configAckErrors: string[] = [];
  const switchAcks: SerialAcquisitionSwitchAck[] = [];
  const switchAckErrors: string[] = [];
  const loopbackEchoes: SerialEegLoopbackEcho[] = [];

  const parser = new SerialEegProtocolParser(
    {
      onResetAck: (ack) => resetAcks.push(ack),
      onResetAckError: (line) => resetAckErrors.push(line),
      onConfigAck: (ack) => configAcks.push(ack),
      onConfigAckError: (line) => configAckErrors.push(line),
      onSwitchAck: (ack) => switchAcks.push(ack),
      onSwitchAckError: (line) => switchAckErrors.push(line),
      onLoopbackEcho: (echo) => loopbackEchoes.push(echo),
      onFrame: (frame) => frames.push(frame),
      onInvalidFrame: (frame) => invalidFrames.push(frame),
    },
    { gain, channelCount },
  );

  return {
    parser,
    frames,
    invalidFrames,
    resetAcks,
    resetAckErrors,
    configAcks,
    configAckErrors,
    switchAcks,
    switchAckErrors,
    loopbackEchoes,
  };
}

function writeInt24Le(bytes: Uint8Array, offset: number, value: number): void {
  const raw = value < 0 ? value + 0x1000000 : value;
  bytes[offset] = raw & 0xff;
  bytes[offset + 1] = (raw >> 8) & 0xff;
  bytes[offset + 2] = (raw >> 16) & 0xff;
}
