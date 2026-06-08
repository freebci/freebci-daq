import {
  SERIAL_PROTOCOL_VERSION,
  parseSerialDeviceSeq,
} from './serialProtocolCore';

export const SERIAL_INITIALIZATION_RESET_COMMAND = 'EEGRST';
const SERIAL_INITIALIZATION_RESET_ACK = 'EEGRSTACK';

export interface SerialInitializationResetAck {
  seq: number;
  ok: boolean;
  errorCode?: string;
  errorReason?: string;
}

const encoder = new TextEncoder();

export function formatSerialInitializationResetCommand(): string {
  return `${SERIAL_INITIALIZATION_RESET_COMMAND},${SERIAL_PROTOCOL_VERSION}\n`;
}

export function encodeSerialInitializationResetCommand(): Uint8Array {
  return encoder.encode(formatSerialInitializationResetCommand());
}

export function isSerialInitializationResetCommandLine(line: string): boolean {
  return line.replace(/\r$/, '').startsWith(`${SERIAL_INITIALIZATION_RESET_COMMAND},`);
}

export function isSerialInitializationResetCommandPrefix(text: string): boolean {
  const normalized = text.replace(/\r$/, '');
  const commandPrefix = `${SERIAL_INITIALIZATION_RESET_COMMAND},`;

  if (normalized.length === 0) {
    return false;
  }

  return commandPrefix.startsWith(normalized) || normalized.startsWith(commandPrefix);
}

export function parseSerialInitializationResetAckLine(
  line: string,
): SerialInitializationResetAck | null {
  const normalizedLine = line.replace(/\r$/, '');
  const parts = normalizedLine.split(',');

  if (parts.length < 3 || parts[0] !== SERIAL_INITIALIZATION_RESET_ACK) {
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

export function isSerialInitializationResetAckLine(line: string): boolean {
  return line.replace(/\r$/, '').startsWith(`${SERIAL_INITIALIZATION_RESET_ACK},`);
}

export function isSerialInitializationResetAckPrefix(text: string): boolean {
  const normalized = text.replace(/\r$/, '');
  const ackPrefix = `${SERIAL_INITIALIZATION_RESET_ACK},`;

  if (normalized.length === 0) {
    return false;
  }

  return ackPrefix.startsWith(normalized) || normalized.startsWith(ackPrefix);
}
