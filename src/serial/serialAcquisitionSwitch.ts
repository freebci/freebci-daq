import { parseSerialDeviceSeq } from './serialProtocolCore';

export type SerialAcquisitionSwitchAction = 'START' | 'STOP';

export interface SerialAcquisitionSwitchAck {
  seq: number;
  ok: boolean;
  errorCode?: string;
  errorReason?: string;
}

const SERIAL_ACQUISITION_SWITCH_COMMAND = 'SW';
const SERIAL_ACQUISITION_SWITCH_ACK = 'SWACK';

const encoder = new TextEncoder();

export function formatSerialAcquisitionSwitchCommand(
  action: SerialAcquisitionSwitchAction,
): string {
  return [
    SERIAL_ACQUISITION_SWITCH_COMMAND,
    action,
  ].join(',') + '\n';
}

export function encodeSerialAcquisitionSwitchCommand(
  action: SerialAcquisitionSwitchAction,
): Uint8Array {
  return encoder.encode(formatSerialAcquisitionSwitchCommand(action));
}

export function parseSerialAcquisitionSwitchAckLine(
  line: string,
): SerialAcquisitionSwitchAck | null {
  const normalizedLine = line.replace(/\r$/, '');
  const parts = normalizedLine.split(',');

  if (parts.length < 3 || parts[0] !== SERIAL_ACQUISITION_SWITCH_ACK) {
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

export function isSerialAcquisitionSwitchAckLine(line: string): boolean {
  return line.replace(/\r$/, '').startsWith(`${SERIAL_ACQUISITION_SWITCH_ACK},`);
}

export function isSerialAcquisitionSwitchAckPrefix(text: string): boolean {
  const normalized = text.replace(/\r$/, '');
  const ackPrefix = `${SERIAL_ACQUISITION_SWITCH_ACK},`;

  if (normalized.length === 0) {
    return false;
  }

  return ackPrefix.startsWith(normalized) || normalized.startsWith(ackPrefix);
}
