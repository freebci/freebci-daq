import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  EEG_SERIAL_BAUD_RATE,
  EEG_SERIAL_CONFIG_ACK_TIMEOUT_MS,
  EEG_SERIAL_RESET_ACK_TIMEOUT_MS,
  EEG_SERIAL_SWITCH_ACK_TIMEOUT_MS,
} from '../src/config/serial';
import { formatSerialAcquisitionSwitchCommand } from '../src/serial/serialAcquisitionSwitch';
import { formatSerialInitializationResetCommand } from '../src/serial/serialInitialization';
import {
  SERIAL_EEG_MAX_CHANNEL_COUNT,
  SERIAL_EEG_MIN_CHANNEL_COUNT,
} from '../src/serial/serialChannels';
import {
  SERIAL_HARDWARE_SAMPLE_RATES_HZ,
  formatSerialHardwareConfigCommand,
} from '../src/serial/serialHardwareConfig';

const protocolDoc = readFileSync('docs/serial-protocol.md', 'utf8');

describe('serial protocol document consistency', () => {
  it('matches the frontend baud rate and supported sample rates', () => {
    expect(protocolDoc).toContain(`Web Serial baudRate: ${EEG_SERIAL_BAUD_RATE}`);
    expect(protocolDoc).toContain(`baudRate = ${EEG_SERIAL_BAUD_RATE}`);
    expect(protocolDoc).toContain('UART 8N1, no parity, no flow control');
    expect(protocolDoc).toContain(`SR:   ${SERIAL_HARDWARE_SAMPLE_RATES_HZ.join(', ')}`);
    expect(protocolDoc).toContain(
      `CH:   ${Array.from(
        { length: SERIAL_EEG_MAX_CHANNEL_COUNT - SERIAL_EEG_MIN_CHANNEL_COUNT + 1 },
        (_, index) => SERIAL_EEG_MIN_CHANNEL_COUNT + index,
      ).join(', ')}`,
    );
    expect(protocolDoc).not.toContain('16000');
  });

  it('matches frontend command wire formats', () => {
    expect(protocolDoc).toContain('EEGRST,<version:uint8>');
    expect(protocolDoc).toContain(asDocumentLine(formatSerialInitializationResetCommand()));
    expect(protocolDoc).toContain('EEGCFG,<version:uint8>');
    expect(protocolDoc).toContain(
      asDocumentLine(
        formatSerialHardwareConfigCommand(
          {
            sampleRateHz: 250,
            gain: 24,
            rldEnabled: true,
            acLeadOffMode: 'FDR4',
          },
          { channelCount: 2 },
        ),
      ),
    );
    expect(protocolDoc).toContain('SW,<START|STOP>');
    expect(protocolDoc).toContain(asDocumentLine(formatSerialAcquisitionSwitchCommand('START')));
    expect(protocolDoc).toContain(asDocumentLine(formatSerialAcquisitionSwitchCommand('STOP')));
    expect(protocolDoc).not.toContain('SW,<version');
    expect(protocolDoc).not.toContain('SW,1,START');
  });

  it('documents ACK grammar, timeouts, and expected sequencing', () => {
    expect(protocolDoc).toContain('EEGRSTACK,<seq>,OK');
    expect(protocolDoc).toContain('OK  ACK: exactly 3 comma-separated fields');
    expect(protocolDoc).toContain('ERR ACK: exactly 5 comma-separated fields');
    expect(protocolDoc).toContain('seq: decimal uint32, 0..4294967295');
    expect(protocolDoc).toContain(`EEGRSTACK timeout: ${EEG_SERIAL_RESET_ACK_TIMEOUT_MS} ms`);
    expect(protocolDoc).toContain(`EEGCFGACK timeout: ${EEG_SERIAL_CONFIG_ACK_TIMEOUT_MS} ms`);
    expect(protocolDoc).toContain(`SWACK timeout:     ${EEG_SERIAL_SWITCH_ACK_TIMEOUT_MS} ms`);
    expect(protocolDoc).toContain('SWACK,<seq>,ERR,CONFIG_REQUIRED,<reason>');
    expect(protocolDoc).toContain('Every new frontend serial connection sends `EEGRST`');
    expect(protocolDoc).toContain('The frontend does not send `EEGCFG` again on `SW,START`');
    expect(protocolDoc).toContain('only opens serial after hardware parameters and site/channel bindings are confirmed');
    expect(protocolDoc).toContain('Firmware should not start streaming after `EEGCFG`');
    expect(protocolDoc).toContain('binary data frames only after it has sent `SWACK,<seq>,OK\\n`');
  });

  it('documents lead-off detection modes as hardware detection behavior', () => {
    expect(protocolDoc).toContain('FDR4:   使用 fDR/4 作为交流脱落检测频率');
    expect(protocolDoc).toContain('7_8HZ:  使用 7.8 Hz 作为交流脱落检测频率');
    expect(protocolDoc).toContain('31_2HZ: 使用 31.2 Hz 作为交流脱落检测频率');
    expect(protocolDoc).toContain('OFF:    关闭脱落检测');
    expect(protocolDoc).not.toContain('AC:   FDR4, DC');
    expect(protocolDoc).not.toContain('DC:     使用直流脱落检测');
    expect(protocolDoc).toContain('does not consume a separate lead-off/status packet');
    expect(protocolDoc).toContain('runs software detection directly on the streamed EEG samples');
    expect(protocolDoc).toContain("channel's waveform segment is rendered yellow");
  });

  it('documents binary data frame layout and data-only drop accounting', () => {
    expect(protocolDoc).toContain('byte0      magic0 = 0xA5');
    expect(protocolDoc).toContain('byte3..6   seq:uint32 little-endian, data-frame sequence');
    expect(protocolDoc).toContain('byte7      count:uint8, samples per packet, valid range 1..64');
    expect(protocolDoc).toContain('count * CH * int24 little-endian samples');
    expect(protocolDoc).toContain('8 + count * CH * 3 bytes');
    expect(protocolDoc).toContain('signed int24 two\'s-complement little-endian ADC code');
    expect(protocolDoc).toContain('volts = rawCode * 2.5 / GAIN / 0x7fffff');
    expect(protocolDoc).toContain('data seq baseline when `SWACK,<seq>,OK` for START is received');
    expect(protocolDoc).toContain('The first data frame after START establishes the baseline');
    expect(protocolDoc).toContain('droppedSamples = droppedPackets * currentFrame.count');
    expect(protocolDoc).toContain('Recommended default: `count = 20`');
    expect(protocolDoc).toContain('This is below the current `921600` baud setting.');
  });

  it('documents sequential writes and loopback detection', () => {
    expect(protocolDoc).toContain('frontend -> EEGRST,1\\n');
    expect(protocolDoc).toContain('firmware -> EEGRSTACK,<seq>,OK\\n');
    expect(protocolDoc).toContain('frontend -> EEGCFG,1,SR=...,CH=...,GAIN=...,RLD=...,AC=...\\n');
    expect(protocolDoc).toContain('frontend -> SW,START\\n');
    expect(protocolDoc).toContain('frontend -> SW,STOP\\n');
    expect(protocolDoc).toContain('Firmware must not echo frontend commands upstream.');
    expect(protocolDoc).toContain('`EEGRST,`, `EEGCFG,`, or `SW,`');
    expect(protocolDoc).toContain('Serial loopback/echo detected');
    expect(protocolDoc).toContain('immediately closes the current serial connection');
    expect(protocolDoc).toContain('Do not emit debug logs on the same port');
  });
});

function asDocumentLine(command: string): string {
  return command.replace(/\n$/, '\\n');
}
