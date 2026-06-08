import { describe, expect, it } from 'vitest';
import {
  formatSerialInitializationResetCommand,
  parseSerialInitializationResetAckLine,
} from '../src/serial/serialInitialization';

describe('serial initialization reset protocol', () => {
  it('formats the reset command and parses OK/ERR acknowledgements', () => {
    expect(formatSerialInitializationResetCommand()).toBe('EEGRST,1\n');
    expect(parseSerialInitializationResetAckLine('EEGRSTACK,7,OK')).toEqual({
      seq: 7,
      ok: true,
    });
    expect(parseSerialInitializationResetAckLine('EEGRSTACK,8,ERR,BUSY,reset_busy\r')).toEqual({
      seq: 8,
      ok: false,
      errorCode: 'BUSY',
      errorReason: 'reset_busy',
    });
  });

  it.each([
    'EEGRSTACK,not-a-seq,OK',
    'EEGRSTACK,4294967296,OK',
    'EEGRSTACK,1,ERR',
  ])('rejects malformed reset ACK line %s', (line) => {
    expect(parseSerialInitializationResetAckLine(line)).toBeNull();
  });
});
