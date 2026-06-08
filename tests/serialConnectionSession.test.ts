import { describe, expect, it, vi } from 'vitest';
import { createSerialConnectionSession } from '../src/serial/serialConnectionSession';
import { serialTextBytes } from './serialProtocolTestUtils';

describe('createSerialConnectionSession', () => {
  it('resolves reset and config ACK promises during serial startup', async () => {
    const session = createSession(4);
    const resetAckPromise = session.waitForResetAck();
    const configAckPromise = session.waitForConfigAck();

    session.parser.pushChunk(serialTextBytes('EEGRSTACK,6,OK\nEEGCFGACK,7,OK\n'));

    expect(session.parser.channelCount).toBe(4);
    expect(session.parser.channelNames).toEqual(['ch0', 'ch1', 'ch2', 'ch3']);
    await expect(resetAckPromise).resolves.toBeUndefined();
    await expect(configAckPromise).resolves.toBeUndefined();
  });

  it('rejects reset ERR acknowledgements', async () => {
    const session = createSession();
    const ackExpectation = expect(session.waitForResetAck()).rejects.toThrow(
      'Serial initialization reset rejected',
    );

    session.parser.pushChunk(
      serialTextBytes('EEGRSTACK,1,ERR,BUSY,reset_not_available\n'),
    );

    await ackExpectation;
  });

  it('rejects hardware config ERR acknowledgements', async () => {
    const session = createSession();
    const ackExpectation = expect(session.waitForConfigAck()).rejects.toThrow(
      'Serial hardware config rejected',
    );

    session.parser.pushChunk(
      serialTextBytes('EEGCFGACK,3,ERR,UNSUPPORTED_SR,sample_rate_not_supported\n'),
    );

    await ackExpectation;
  });

  it('rejects config flow when a frontend command is echoed upstream', async () => {
    const session = createSession();
    const command = 'EEGCFG,1,SR=250,CH=2,GAIN=24,RLD=ON,AC=FDR4';
    const ackExpectation = expect(session.waitForConfigAck()).rejects.toThrow(
      'Serial loopback/echo detected',
    );

    session.parser.trackOutboundCommand(`${command}\n`);
    session.parser.pushChunk(serialTextBytes(`${command}\nEEGCFGACK,1,OK\n`));

    await ackExpectation;
  });

  it('rejects reset flow when the reset command is echoed upstream', async () => {
    const session = createSession();
    const command = 'EEGRST,1';
    const ackExpectation = expect(session.waitForResetAck()).rejects.toThrow(
      'Serial loopback/echo detected',
    );

    session.parser.trackOutboundCommand(`${command}\n`);
    session.parser.pushChunk(serialTextBytes(`${command}\nEEGRSTACK,1,OK\n`));

    await ackExpectation;
  });

  it('can wait for a fresh config ACK after a previous config ACK resolved', async () => {
    const session = createSession();
    const firstAck = session.waitForConfigAck();

    session.parser.pushChunk(serialTextBytes('EEGCFGACK,1,OK\n'));

    await expect(firstAck).resolves.toBeUndefined();

    const secondAck = session.waitForConfigAck();
    session.parser.pushChunk(serialTextBytes('EEGCFGACK,2,OK\n'));

    await expect(secondAck).resolves.toBeUndefined();
  });
});

function createSession(channelCount = 2) {
  return createSerialConnectionSession({
    gain: 24,
    channelCount,
    onFrame: vi.fn(),
    onInvalidFrame: vi.fn(),
  });
}
