import { describe, expect, it } from 'vitest';
import {
  EEG_FRAME_HEADER_BYTES,
  EEG_FRAME_MAGIC_0,
  EEG_FRAME_MAGIC_1,
  EEG_FRAME_PACKET_TYPE_DATA,
  EegFrameParser,
  eegRawCodeToVolts,
} from '../src/transport/eegFrameProtocol';

function int24Bytes(value: number): [number, number, number] {
  const unsigned = value < 0 ? value + 0x100_0000 : value;
  return [
    unsigned & 0xff,
    (unsigned >> 8) & 0xff,
    (unsigned >> 16) & 0xff,
  ];
}

function dataFrameBytes(seq: number, samples: number[][], channelCount = samples[0]?.length ?? 1): Uint8Array {
  const bytes = new Uint8Array(EEG_FRAME_HEADER_BYTES + samples.length * channelCount * 3);
  bytes[0] = EEG_FRAME_MAGIC_0;
  bytes[1] = EEG_FRAME_MAGIC_1;
  bytes[2] = EEG_FRAME_PACKET_TYPE_DATA;
  new DataView(bytes.buffer).setUint32(3, seq >>> 0, true);
  bytes[7] = samples.length;

  for (let sampleIndex = 0; sampleIndex < samples.length; sampleIndex += 1) {
    const sample = samples[sampleIndex];
    const sampleOffset = EEG_FRAME_HEADER_BYTES + sampleIndex * channelCount * 3;
    for (let channelIndex = 0; channelIndex < channelCount; channelIndex += 1) {
      bytes.set(int24Bytes(sample[channelIndex] ?? 0), sampleOffset + channelIndex * 3);
    }
  }

  return bytes;
}

describe('transport-neutral EEG frame parser', () => {
  it('parses one channel int24 samples into volts', () => {
    const frames: unknown[] = [];
    const parser = new EegFrameParser({
      gain: 24,
      channelCount: 1,
      onFrame: (frame) => frames.push(frame),
    });

    parser.pushChunk(dataFrameBytes(7, [[0x7f_ffff], [-0x80_0000]], 1));

    expect(frames).toHaveLength(1);
    expect(frames[0]).toMatchObject({
      seq: 7,
      count: 2,
      channelCount: 1,
      channelNames: ['ch0'],
      droppedPackets: 0,
      droppedSamples: 0,
    });
    expect((frames[0] as { samples: Record<string, number>[] }).samples[0].ch0).toBeCloseTo(
      eegRawCodeToVolts(0x7f_ffff, 24),
    );
    expect((frames[0] as { samples: Record<string, number>[] }).samples[1].ch0).toBeCloseTo(
      eegRawCodeToVolts(-0x80_0000, 24),
    );
  });

  it('parses eight-channel frames for the 250 Hz bridge-coc target shape', () => {
    const frames: unknown[] = [];
    const parser = new EegFrameParser({
      gain: 24,
      channelCount: 8,
      onFrame: (frame) => frames.push(frame),
    });

    parser.pushChunk(dataFrameBytes(1, Array.from({ length: 20 }, () => [1, 2, 3, 4, 5, 6, 7, 8]), 8));

    expect(frames).toHaveLength(1);
    expect(frames[0]).toMatchObject({
      seq: 1,
      count: 20,
      channelCount: 8,
      channelNames: ['ch0', 'ch1', 'ch2', 'ch3', 'ch4', 'ch5', 'ch6', 'ch7'],
    });
  });

  it('tracks packet gaps and uint32 sequence wrap', () => {
    const frames: Array<{ droppedPackets: number; droppedSamples: number }> = [];
    const parser = new EegFrameParser({
      channelCount: 2,
      onFrame: (frame) => frames.push(frame),
    });

    parser.pushChunk(dataFrameBytes(0xffff_fffe, [[1, 2]], 2));
    parser.pushChunk(dataFrameBytes(1, [[3, 4]], 2));
    parser.pushChunk(dataFrameBytes(3, [[5, 6], [7, 8]], 2));

    expect(frames.map((frame) => frame.droppedPackets)).toEqual([0, 2, 1]);
    expect(frames.map((frame) => frame.droppedSamples)).toEqual([0, 2, 2]);
  });

  it('reports invalid frame types and sample counts', () => {
    const invalid: unknown[] = [];
    const parser = new EegFrameParser({
      channelCount: 1,
      onFrame: () => undefined,
      onInvalidFrame: (frame) => invalid.push(frame),
    });
    const badType = dataFrameBytes(1, [[1]], 1);
    badType[2] = 0x09;
    const badCount = dataFrameBytes(2, [[1]], 1);
    badCount[7] = 0;

    parser.pushChunk(badType);
    parser.pushChunk(badCount);

    expect(invalid).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ reason: 'invalid-packet-type', actualPacketType: 0x09 }),
        expect.objectContaining({ reason: 'invalid-count', count: 0 }),
      ]),
    );
  });
});
