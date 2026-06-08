import { describe, expect, it } from 'vitest';
import {
  DEFAULT_SERIAL_HARDWARE_CONFIG,
  SERIAL_HARDWARE_AC_LEAD_OFF_MODES,
  SERIAL_HARDWARE_SAMPLE_RATES_HZ,
  formatSerialHardwareConfigCommand,
  getEffectiveSerialHardwareSampleRateHz,
  normalizeSerialHardwareConfig,
  parseSerialHardwareConfigAckLine,
} from '../src/serial/serialHardwareConfig';

describe('serial hardware config protocol', () => {
  it('formats an initialization command with protocol version 1', () => {
    expect(
      formatSerialHardwareConfigCommand(
        {
          sampleRateHz: 500,
          gain: 12,
          rldEnabled: false,
          acLeadOffMode: '31_2HZ',
        },
        { channelCount: 8 },
      ),
    ).toBe('EEGCFG,1,SR=500,CH=8,GAIN=12,RLD=OFF,AC=31_2HZ\n');
  });

  it('uses 250 Hz as the default sample rate', () => {
    expect(formatSerialHardwareConfigCommand(DEFAULT_SERIAL_HARDWARE_CONFIG)).toBe(
      'EEGCFG,1,SR=250,CH=2,GAIN=24,RLD=ON,AC=FDR4\n',
    );
    expect(getEffectiveSerialHardwareSampleRateHz(DEFAULT_SERIAL_HARDWARE_CONFIG)).toBe(250);
  });

  it('supports three AC lead-off modes and off', () => {
    expect(SERIAL_HARDWARE_AC_LEAD_OFF_MODES).toEqual([
      'FDR4',
      '7_8HZ',
      '31_2HZ',
      'OFF',
    ]);
    expect(
      formatSerialHardwareConfigCommand({
        sampleRateHz: 250,
        gain: 24,
        rldEnabled: true,
        acLeadOffMode: 'OFF',
      }),
    ).toBe('EEGCFG,1,SR=250,CH=2,GAIN=24,RLD=ON,AC=OFF\n');
    expect(normalizeSerialHardwareConfig({ acLeadOffMode: 'DC' as never }).acLeadOffMode).toBe(
      'FDR4',
    );
  });

  it('parses OK and ERR acknowledgements', () => {
    expect(parseSerialHardwareConfigAckLine('EEGCFGACK,7,OK')).toEqual({ seq: 7, ok: true });
    expect(
      parseSerialHardwareConfigAckLine('EEGCFGACK,7,ERR,UNSUPPORTED_SR,bad_sr\r'),
    ).toEqual({
      seq: 7,
      ok: false,
      errorCode: 'UNSUPPORTED_SR',
      errorReason: 'bad_sr',
    });
  });

  it.each([
    'EEGCFGACK,not-a-seq,OK',
    'EEGCFGACK,4294967296,OK',
    'EEGCFGACK,1,ERR',
  ])('rejects malformed ACK line %s', (line) => {
    expect(parseSerialHardwareConfigAckLine(line)).toBeNull();
  });

  it('normalizes supported and unsupported sample rates', () => {
    expect(SERIAL_HARDWARE_SAMPLE_RATES_HZ).toEqual([
      125,
      250,
      500,
      1_000,
      2_000,
      4_000,
      8_000,
    ]);
    expect(normalizeSerialHardwareConfig({ sampleRateHz: 8_000 }).sampleRateHz).toBe(8_000);
    expect(normalizeSerialHardwareConfig({ sampleRateHz: 16_000 as never }).sampleRateHz).toBe(
      250,
    );
  });

  it('normalizes invalid config input', () => {
    expect(
      normalizeSerialHardwareConfig({
        sampleRateHz: 333 as never,
        gain: 99 as never,
        rldEnabled: false,
        acLeadOffMode: 'BAD' as never,
      }),
    ).toEqual({
      sampleRateHz: 250,
      gain: 24,
      rldEnabled: false,
      acLeadOffMode: 'FDR4',
    });
  });
});
