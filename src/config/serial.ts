/**
 * Baud rates exposed by the setup panel.
 *
 * Web Serial does not negotiate this value with the device, so the firmware
 * UART must be configured to the same rate before a connection is opened.
 */
export const EEG_SERIAL_BAUD_RATES = [
  115_200,
  230_400,
  460_800,
  921_600,
] as const;

export type EegSerialBaudRate = (typeof EEG_SERIAL_BAUD_RATES)[number];

export const EEG_SERIAL_DEFAULT_BAUD_RATE: EegSerialBaudRate = 921_600;

/** @deprecated Use EEG_SERIAL_DEFAULT_BAUD_RATE for new code. */
export const EEG_SERIAL_BAUD_RATE = EEG_SERIAL_DEFAULT_BAUD_RATE;

export function isEegSerialBaudRate(value: number): value is EegSerialBaudRate {
  return (EEG_SERIAL_BAUD_RATES as readonly number[]).includes(value);
}

export function normalizeEegSerialBaudRate(
  value: number | null | undefined,
): EegSerialBaudRate {
  return typeof value === 'number' && isEegSerialBaudRate(value)
    ? value
    : EEG_SERIAL_DEFAULT_BAUD_RATE;
}

export const EEG_SERIAL_RESET_ACK_TIMEOUT_MS = 2_000;

export const EEG_SERIAL_CONFIG_ACK_TIMEOUT_MS = 2_000;

export const EEG_SERIAL_SWITCH_ACK_TIMEOUT_MS = 2_000;

export const EEG_SERIAL_STALLED_TIMEOUT_MS = 2_000;
