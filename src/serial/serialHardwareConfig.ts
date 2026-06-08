import {
  SERIAL_PROTOCOL_VERSION,
  parseSerialDeviceSeq,
} from './serialProtocolCore';
import { normalizeEegChannelCount } from '../transport/eegChannels';
import {
  DEFAULT_EEG_HARDWARE_CONFIG,
  EEG_HARDWARE_AC_LEAD_OFF_MODES,
  EEG_HARDWARE_DEFAULT_SAMPLE_RATE_HZ,
  EEG_HARDWARE_GAINS,
  EEG_HARDWARE_SAMPLE_RATES_HZ,
  getEffectiveEegHardwareSampleRateHz,
  isEegHardwareAcLeadOffMode,
  isEegHardwareGain,
  isEegHardwareSampleRateHz,
  normalizeEegHardwareConfig,
  type EegHardwareAcLeadOffMode,
  type EegHardwareConfig,
  type EegHardwareGain,
  type EegHardwareSampleRateHz,
} from '../transport/eegHardwareConfig';

export const SERIAL_HARDWARE_SAMPLE_RATES_HZ = EEG_HARDWARE_SAMPLE_RATES_HZ;
export const SERIAL_HARDWARE_GAINS = EEG_HARDWARE_GAINS;
export const SERIAL_HARDWARE_AC_LEAD_OFF_MODES = EEG_HARDWARE_AC_LEAD_OFF_MODES;
export const SERIAL_HARDWARE_DEFAULT_SAMPLE_RATE_HZ = EEG_HARDWARE_DEFAULT_SAMPLE_RATE_HZ;

export type SerialHardwareSampleRateHz = EegHardwareSampleRateHz;
export type SerialHardwareGain = EegHardwareGain;
export type SerialHardwareAcLeadOffMode = EegHardwareAcLeadOffMode;
export type SerialHardwareConfig = EegHardwareConfig;

export interface SerialHardwareConfigCommandOptions {
  channelCount?: number;
}

export interface SerialHardwareConfigAck {
  seq: number;
  ok: boolean;
  errorCode?: string;
  errorReason?: string;
}

export const DEFAULT_SERIAL_HARDWARE_CONFIG: SerialHardwareConfig = DEFAULT_EEG_HARDWARE_CONFIG;

const SERIAL_HARDWARE_CONFIG_COMMAND = 'EEGCFG';
const SERIAL_HARDWARE_CONFIG_ACK = 'EEGCFGACK';

const encoder = new TextEncoder();

export function isSerialHardwareSampleRateHz(
  value: number,
): value is SerialHardwareSampleRateHz {
  return isEegHardwareSampleRateHz(value);
}

export function isSerialHardwareGain(value: number): value is SerialHardwareGain {
  return isEegHardwareGain(value);
}

export function isSerialHardwareAcLeadOffMode(
  value: string,
): value is SerialHardwareAcLeadOffMode {
  return isEegHardwareAcLeadOffMode(value);
}

export function normalizeSerialHardwareConfig(
  config: Partial<SerialHardwareConfig> | null | undefined,
): SerialHardwareConfig {
  return normalizeEegHardwareConfig(config);
}

export function formatSerialHardwareConfigCommand(
  config: SerialHardwareConfig,
  options: SerialHardwareConfigCommandOptions = {},
): string {
  const normalized = normalizeSerialHardwareConfig(config);
  const channelCount = normalizeEegChannelCount(options.channelCount);
  const fields = [
    SERIAL_HARDWARE_CONFIG_COMMAND,
    String(SERIAL_PROTOCOL_VERSION),
  ];

  return [
    ...fields,
    `SR=${normalized.sampleRateHz}`,
    `CH=${channelCount}`,
    `GAIN=${normalized.gain}`,
    `RLD=${normalized.rldEnabled ? 'ON' : 'OFF'}`,
    `AC=${normalized.acLeadOffMode}`,
  ].join(',') + '\n';
}

export function encodeSerialHardwareConfigCommand(
  config: SerialHardwareConfig,
  options: SerialHardwareConfigCommandOptions = {},
): Uint8Array {
  return encoder.encode(formatSerialHardwareConfigCommand(config, options));
}

export function parseSerialHardwareConfigAckLine(
  line: string,
): SerialHardwareConfigAck | null {
  const normalizedLine = line.replace(/\r$/, '');
  const parts = normalizedLine.split(',');

  if (parts.length < 3 || parts[0] !== SERIAL_HARDWARE_CONFIG_ACK) {
    return null;
  }

  const seq = parseSerialDeviceSeq(parts[1]);
  if (seq === null) {
    return null;
  }

  if (parts[2] === 'OK' && parts.length === 3) {
    return { seq, ok: true };
  }

  if (
    parts[2] === 'ERR' &&
    parts.length === 5 &&
    parts[3].trim().length > 0 &&
    parts[4].trim().length > 0
  ) {
    return {
      seq,
      ok: false,
      errorCode: parts[3].trim(),
      errorReason: parts[4].trim(),
    };
  }

  return null;
}

export function isSerialHardwareConfigAckLine(line: string): boolean {
  return line.replace(/\r$/, '').startsWith(`${SERIAL_HARDWARE_CONFIG_ACK},`);
}

export function isSerialHardwareConfigAckPrefix(text: string): boolean {
  const normalized = text.replace(/\r$/, '');
  const ackPrefix = `${SERIAL_HARDWARE_CONFIG_ACK},`;

  if (normalized.length === 0) {
    return false;
  }

  return ackPrefix.startsWith(normalized) || normalized.startsWith(ackPrefix);
}

export function formatSerialHardwareConfigSummary(
  config: SerialHardwareConfig,
  options: SerialHardwareConfigCommandOptions = {},
): string {
  const normalized = normalizeSerialHardwareConfig(config);
  const channelCount = normalizeEegChannelCount(options.channelCount);

  return `SR=${normalized.sampleRateHz}, CH=${channelCount}, GAIN=${normalized.gain}, RLD=${
    normalized.rldEnabled ? 'ON' : 'OFF'
  }, AC=${normalized.acLeadOffMode}`;
}

export function getEffectiveSerialHardwareSampleRateHz(
  config: Pick<SerialHardwareConfig, 'sampleRateHz'>,
): SerialHardwareSampleRateHz {
  return getEffectiveEegHardwareSampleRateHz(config);
}
