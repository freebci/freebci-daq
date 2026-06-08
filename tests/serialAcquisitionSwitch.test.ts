import { describe, expect, it } from 'vitest';
import {
  formatSerialAcquisitionSwitchCommand,
  parseSerialAcquisitionSwitchAckLine,
} from '../src/serial/serialAcquisitionSwitch';

describe('serial acquisition switch protocol', () => {
  it('formats START and STOP commands without a version field', () => {
    expect(formatSerialAcquisitionSwitchCommand('START')).toBe('SW,START\n');
    expect(formatSerialAcquisitionSwitchCommand('STOP')).toBe('SW,STOP\n');
  });

  it('parses OK and ERR acknowledgements', () => {
    expect(parseSerialAcquisitionSwitchAckLine('SWACK,2,OK')).toEqual({ seq: 2, ok: true });
    expect(
      parseSerialAcquisitionSwitchAckLine('SWACK,2,ERR,CONFIG_REQUIRED,no_config\r'),
    ).toEqual({
      seq: 2,
      ok: false,
      errorCode: 'CONFIG_REQUIRED',
      errorReason: 'no_config',
    });
  });

  it.each([
    'SWACK,not-a-seq,OK',
    'SWACK,4294967296,OK',
    'SWACK,2,ERR',
  ])('rejects malformed ACK line %s', (line) => {
    expect(parseSerialAcquisitionSwitchAckLine(line)).toBeNull();
  });
});
