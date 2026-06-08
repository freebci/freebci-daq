export const SERIAL_PROTOCOL_VERSION = 1;
export const SERIAL_DEVICE_SEQ_MAX = 0xffff_ffff;

export function parseSerialDeviceSeq(raw: string): number | null {
  if (!/^\d+$/.test(raw)) {
    return null;
  }

  const seq = Number(raw);
  if (!Number.isSafeInteger(seq) || seq < 0 || seq > SERIAL_DEVICE_SEQ_MAX) {
    return null;
  }

  return seq >>> 0;
}

export function getNextSerialDeviceSeq(seq: number): number {
  return (seq + 1) >>> 0;
}

export function countForwardSerialDeviceSeqGap(
  expectedSeq: number,
  actualSeq: number,
): number {
  const gap = (actualSeq - expectedSeq) >>> 0;
  if (gap === 0 || gap > 0x7fff_ffff) {
    return 0;
  }

  return gap;
}
