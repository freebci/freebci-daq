import { EEG_SERIAL_DEFAULT_BAUD_RATE } from '../config/serial';

export function isWebSerialSupported(): boolean {
  return typeof navigator !== 'undefined' && 'serial' in navigator;
}

export async function requestSerialPort(): Promise<SerialPort> {
  if (!isWebSerialSupported()) {
    throw new Error('Web Serial is not supported by this browser.');
  }

  return navigator.serial.requestPort();
}

export async function openSerialPort(
  port: SerialPort,
  baudRate = EEG_SERIAL_DEFAULT_BAUD_RATE,
): Promise<void> {
  await port.open({ baudRate });
}

export async function writeSerialBytes(port: SerialPort, bytes: Uint8Array): Promise<void> {
  const writer = port.writable?.getWriter();

  if (!writer) {
    throw new Error('Serial writable stream is not available.');
  }

  try {
    await writer.write(bytes);
  } finally {
    writer.releaseLock();
  }
}

export function addSerialDisconnectListener(
  port: SerialPort,
  onDisconnect: () => void,
): () => void {
  const handleDisconnect = (event: Event): void => {
    if (event.target === port) {
      onDisconnect();
    }
  };

  navigator.serial.addEventListener('disconnect', handleDisconnect);

  return () => navigator.serial.removeEventListener('disconnect', handleDisconnect);
}

export function formatSerialPortId(port: SerialPort): string {
  const info = port.getInfo();
  const vendorId = info.usbVendorId?.toString(16).padStart(4, '0') ?? 'unknown';
  const productId = info.usbProductId?.toString(16).padStart(4, '0') ?? 'unknown';
  return `serial-${vendorId}-${productId}`;
}

export function formatSerialPortName(port: SerialPort): string {
  const info = port.getInfo();
  if (info.usbVendorId === undefined && info.usbProductId === undefined) {
    return 'Serial EEG Port';
  }

  const vendorId = info.usbVendorId?.toString(16).padStart(4, '0') ?? '????';
  const productId = info.usbProductId?.toString(16).padStart(4, '0') ?? '????';
  return `Serial EEG ${vendorId}:${productId}`;
}
