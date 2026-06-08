import { describe, expect, it } from 'vitest';
import { formatSerialEegProtocolLabel } from '../src/serial/serialEegProtocol';
import { formatSerialInitializationResetCommand } from '../src/serial/serialInitialization';
import {
  concatBytes,
  createSerialParserProbe,
  rawCodeToVolts,
  serialDataFrameBytes,
  serialTextBytes,
} from './serialProtocolTestUtils';

describe('serial EEG initialization', () => {
  it('formats the frontend reset command sent immediately after opening serial', () => {
    expect(formatSerialInitializationResetCommand()).toBe('EEGRST,1\n');
    expect(formatSerialEegProtocolLabel(3)).toBe('EEGRST/ACK + EEGCFG/ACK · 3CH · I24LE');
  });

  it('detects looped-back reset commands without swallowing following ACKs', () => {
    const probe = createSerialParserProbe();
    const resetLine = 'EEGRST,1';

    probe.parser.trackOutboundCommand(`${resetLine}\n`);
    probe.parser.pushChunk(serialTextBytes(`${resetLine}\nEEGCFGACK,0,OK\n`));

    expect(probe.loopbackEchoes).toEqual([
      { line: resetLine, command: 'EEGRST', exactMatch: true },
    ]);
    expect(probe.configAcks).toEqual([{ seq: 0, ok: true }]);
    expect(probe.invalidFrames).toEqual([]);
  });
});

describe('serial EEG text acknowledgements', () => {
  it('emits reset, config, and switch ACKs before binary EEG frames', () => {
    const probe = createSerialParserProbe();

    probe.parser.pushChunk(
      concatBytes(
        serialTextBytes('EEGRSTACK,0,OK\nEEGCFGACK,1,OK\nSWACK,2,OK\n'),
        serialDataFrameBytes(3, [[1, 2]]),
      ),
    );

    expect(probe.resetAcks).toEqual([{ seq: 0, ok: true }]);
    expect(probe.configAcks).toEqual([{ seq: 1, ok: true }]);
    expect(probe.switchAcks).toEqual([{ seq: 2, ok: true }]);
    expect(probe.resetAckErrors).toEqual([]);
    expect(probe.configAckErrors).toEqual([]);
    expect(probe.switchAckErrors).toEqual([]);
    expect(probe.frames).toHaveLength(1);
    expect(probe.frames[0]).toMatchObject({
      seq: 3,
      droppedPackets: 0,
      droppedSamples: 0,
    });
    expect(probe.invalidFrames).toEqual([]);
  });

  it('waits for fragmented ACK lines until their newline arrives', () => {
    const probe = createSerialParserProbe();

    probe.parser.pushChunk(serialTextBytes('EEGRST'));
    probe.parser.pushChunk(serialTextBytes('ACK,0,OK\nEEGCFG'));
    probe.parser.pushChunk(serialTextBytes('ACK,1,OK\nSW'));
    probe.parser.pushChunk(serialTextBytes('ACK,2,OK\n'));

    expect(probe.resetAcks).toEqual([{ seq: 0, ok: true }]);
    expect(probe.configAcks).toEqual([{ seq: 1, ok: true }]);
    expect(probe.switchAcks).toEqual([{ seq: 2, ok: true }]);
    expect(probe.invalidFrames).toEqual([]);
  });

  it('reports malformed config and switch ACK lines', () => {
    const probe = createSerialParserProbe();

    probe.parser.pushChunk(serialTextBytes('EEGRSTACK,0,ERR\nEEGCFGACK,1,ERR\nSWACK,2,ERR\n'));

    expect(probe.resetAcks).toEqual([]);
    expect(probe.configAcks).toEqual([]);
    expect(probe.switchAcks).toEqual([]);
    expect(probe.resetAckErrors).toEqual(['EEGRSTACK,0,ERR']);
    expect(probe.configAckErrors).toEqual(['EEGCFGACK,1,ERR']);
    expect(probe.switchAckErrors).toEqual(['SWACK,2,ERR']);
  });

  it('detects looped-back config commands without swallowing following ACKs', () => {
    const probe = createSerialParserProbe();
    const configLine = 'EEGCFG,1,SR=250,CH=2,GAIN=24,RLD=ON,AC=FDR4';

    probe.parser.trackOutboundCommand(`${configLine}\n`);
    probe.parser.pushChunk(serialTextBytes(`${configLine}\nEEGCFGACK,0,OK\n`));

    expect(probe.loopbackEchoes).toEqual([
      { line: configLine, command: 'EEGCFG', exactMatch: true },
    ]);
    expect(probe.configAcks).toEqual([{ seq: 0, ok: true }]);
    expect(probe.invalidFrames).toEqual([]);
  });

  it('treats any upstream SW command as loopback or firmware echo', () => {
    const probe = createSerialParserProbe();

    probe.parser.pushChunk(serialTextBytes('SW,START\nSWACK,1,OK\n'));

    expect(probe.loopbackEchoes).toEqual([
      { line: 'SW,START', command: 'SW', exactMatch: false },
    ]);
    expect(probe.switchAcks).toEqual([{ seq: 1, ok: true }]);
  });
});

describe('serial EEG binary frames', () => {
  it('parses fragmented int24 frames and converts raw codes to volts', () => {
    const probe = createSerialParserProbe(24);
    const frame = serialDataFrameBytes(0, [
      [24, -48],
      [72, 96],
    ]);

    probe.parser.pushChunk(frame.slice(0, 5));
    probe.parser.pushChunk(frame.slice(5));

    expect(probe.frames).toHaveLength(1);
    expect(probe.frames[0]).toMatchObject({
      seq: 0,
      count: 2,
      droppedPackets: 0,
      droppedSamples: 0,
    });
    expect(probe.frames[0].samples[0].ch0).toBeCloseTo(rawCodeToVolts(24), 18);
    expect(probe.frames[0].samples[0].ch1).toBeCloseTo(rawCodeToVolts(-48), 18);
    expect(probe.frames[0].samples[1].ch0).toBeCloseTo(rawCodeToVolts(72), 18);
    expect(probe.frames[0].samples[1].ch1).toBeCloseTo(rawCodeToVolts(96), 18);
  });

  it('uses the configured channel count for payload unpacking', () => {
    const probe = createSerialParserProbe(12, 3);
    const frame = serialDataFrameBytes(0, [[10, 20, 30]], { channelCount: 3 });

    probe.parser.pushChunk(frame);

    expect(probe.frames).toHaveLength(1);
    expect(probe.frames[0]).toMatchObject({
      seq: 0,
      channelCount: 3,
      channelNames: ['ch0', 'ch1', 'ch2'],
    });
    expect(probe.frames[0].samples[0].ch0).toBeCloseTo(rawCodeToVolts(10, 12), 18);
    expect(probe.frames[0].samples[0].ch1).toBeCloseTo(rawCodeToVolts(20, 12), 18);
    expect(probe.frames[0].samples[0].ch2).toBeCloseTo(rawCodeToVolts(30, 12), 18);
  });

  it('can reconfigure channels before subsequent frames', () => {
    const probe = createSerialParserProbe(24, 2);

    probe.parser.configureChannels(4);
    probe.parser.pushChunk(
      serialDataFrameBytes(0, [[1, 2, 3, 4]], { channelCount: 4 }),
    );

    expect(probe.parser.channelCount).toBe(4);
    expect(probe.parser.channelNames).toEqual(['ch0', 'ch1', 'ch2', 'ch3']);
    expect(probe.frames[0]).toMatchObject({
      channelCount: 4,
      channelNames: ['ch0', 'ch1', 'ch2', 'ch3'],
    });
  });

  it('reports device sequence gaps', () => {
    const probe = createSerialParserProbe();

    probe.parser.pushChunk(
      concatBytes(
        serialDataFrameBytes(10, [
          [1, 2],
          [3, 4],
        ]),
        serialDataFrameBytes(12, [
          [5, 6],
          [7, 8],
        ]),
      ),
    );

    expect(probe.frames.map((frame) => frame.seq)).toEqual([10, 12]);
    expect(probe.frames[1]).toMatchObject({
      droppedPackets: 1,
      droppedSamples: 2,
    });
  });

  it('resets the data sequence baseline for a new stream session', () => {
    const probe = createSerialParserProbe();

    probe.parser.pushChunk(
      concatBytes(
        serialDataFrameBytes(10, [[1, 2]]),
        serialDataFrameBytes(12, [[3, 4]]),
      ),
    );
    probe.parser.resetDataSequence();
    probe.parser.pushChunk(serialDataFrameBytes(99, [[5, 6]]));

    expect(probe.frames.map((frame) => frame.seq)).toEqual([10, 12, 99]);
    expect(probe.frames[1]).toMatchObject({ droppedPackets: 1, droppedSamples: 1 });
    expect(probe.frames[2]).toMatchObject({ droppedPackets: 0, droppedSamples: 0 });
  });
});

describe('serial EEG parser recovery', () => {
  it('discards garbage before magic and resynchronizes', () => {
    const probe = createSerialParserProbe();

    probe.parser.pushChunk(
      concatBytes(
        new Uint8Array([1, 2, 3]),
        serialDataFrameBytes(0, [[1, 2]]),
      ),
    );

    expect(probe.frames).toHaveLength(1);
    expect(probe.invalidFrames[0]).toMatchObject({
      reason: 'discarded-bytes',
      discardedBytes: 3,
    });
  });

  it('rejects invalid packet type and invalid count', () => {
    const probe = createSerialParserProbe();

    probe.parser.pushChunk(serialDataFrameBytes(0, [[1, 2]], { packetType: 2 }));
    probe.parser.pushChunk(serialDataFrameBytes(1, [[1, 2]], { count: 0 }));

    expect(probe.frames).toHaveLength(0);
    expect(probe.invalidFrames).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ reason: 'invalid-packet-type', actualPacketType: 2 }),
        expect.objectContaining({ reason: 'invalid-count', count: 0 }),
      ]),
    );
  });

  it('discards only an unknown text line before an ACK', () => {
    const probe = createSerialParserProbe();

    probe.parser.pushChunk(serialTextBytes('UNKNOWN\nEEGCFGACK,0,OK\n'));

    expect(probe.configAcks).toEqual([{ seq: 0, ok: true }]);
    expect(probe.invalidFrames).toEqual([
      { reason: 'discarded-bytes', discardedBytes: 'UNKNOWN\n'.length },
    ]);
  });
});
