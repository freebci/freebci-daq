import { beforeEach, describe, expect, it } from 'vitest';
import {
  EEG_SERIAL_BAUD_RATES,
  EEG_SERIAL_DEFAULT_BAUD_RATE,
  isEegSerialBaudRate,
  normalizeEegSerialBaudRate,
} from '../src/config/serial';
import { useEegStore } from '../src/store/eegStore';

describe('serial baud-rate configuration', () => {
  beforeEach(() => {
    useEegStore.getState().reset();
  });

  it('offers common rates and defaults to 921600', () => {
    expect(EEG_SERIAL_BAUD_RATES).toEqual([115_200, 230_400, 460_800, 921_600]);
    expect(EEG_SERIAL_DEFAULT_BAUD_RATE).toBe(921_600);
    expect(useEegStore.getState().acquisition.baudRate).toBe(921_600);
  });

  it('normalizes unsupported values to the default', () => {
    expect(isEegSerialBaudRate(230_400)).toBe(true);
    expect(isEegSerialBaudRate(123_456)).toBe(false);
    expect(normalizeEegSerialBaudRate(123_456)).toBe(921_600);
  });

  it('allows changes before confirmation and ignores them while locked', () => {
    const store = useEegStore.getState();
    store.setBaudRate(230_400);
    expect(useEegStore.getState().acquisition.baudRate).toBe(230_400);

    store.lockHardwareConfig();
    useEegStore.getState().setBaudRate(460_800);
    expect(useEegStore.getState().acquisition.baudRate).toBe(230_400);

    useEegStore.getState().unlockHardwareConfig();
    useEegStore.getState().setBaudRate(460_800);
    expect(useEegStore.getState().acquisition.baudRate).toBe(460_800);
  });
});
