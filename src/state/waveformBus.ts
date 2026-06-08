import { EEG_SAMPLE_RATE_HZ } from '../config/eeg';

const CAPACITY_SECONDS = 600;
const CAPACITY = EEG_SAMPLE_RATE_HZ * CAPACITY_SECONDS;

export interface WaveformSampleQuality {
  leadOff?: boolean;
}

export interface WaveformBus {
  push: (value: number, channelName?: string, quality?: WaveformSampleQuality) => void;
  reset: () => void;
  getWriteIndex: (channelName?: string) => number;
  getCapacity: () => number;
  copyLatest: (out: Float32Array, requestedCount: number, channelName?: string) => number;
  copyLatestLeadOff: (out: Uint8Array, requestedCount: number, channelName?: string) => number;
  markLatestLeadOff: (requestedCount: number, channelName?: string, leadOff?: boolean) => void;
  getChannelNames: () => string[];
}

export function createWaveformBus(): WaveformBus {
  const buffers = new Map<string, Float32Array>();
  const leadOffBuffers = new Map<string, Uint8Array>();
  const writeIndexes = new Map<string, number>();

  function normalizeChannelName(channelName = 'ch0'): string {
    return channelName.trim() || 'ch0';
  }

  function getBuffer(channelName = 'ch0'): Float32Array {
    const normalized = normalizeChannelName(channelName);
    let buffer = buffers.get(normalized);

    if (!buffer) {
      buffer = new Float32Array(CAPACITY);
      buffers.set(normalized, buffer);
      writeIndexes.set(normalized, 0);
    }

    return buffer;
  }

  function getLeadOffBuffer(channelName = 'ch0'): Uint8Array {
    const normalized = normalizeChannelName(channelName);
    let buffer = leadOffBuffers.get(normalized);

    if (!buffer) {
      buffer = new Uint8Array(CAPACITY);
      leadOffBuffers.set(normalized, buffer);
      getBuffer(normalized);
    }

    return buffer;
  }

  function getChannelWriteIndex(channelName = 'ch0'): number {
    return writeIndexes.get(normalizeChannelName(channelName)) ?? 0;
  }

  return {
    push(value, channelName = 'ch0', quality) {
      const normalized = normalizeChannelName(channelName);
      const buffer = getBuffer(normalized);
      const leadOffBuffer = getLeadOffBuffer(normalized);
      const writeIndex = getChannelWriteIndex(normalized);
      buffer[writeIndex % CAPACITY] = value;
      leadOffBuffer[writeIndex % CAPACITY] = quality?.leadOff ? 1 : 0;
      writeIndexes.set(normalized, writeIndex + 1);
    },
    reset() {
      for (const buffer of buffers.values()) {
        buffer.fill(0);
      }
      for (const buffer of leadOffBuffers.values()) {
        buffer.fill(0);
      }
      for (const channelName of buffers.keys()) {
        writeIndexes.set(channelName, 0);
      }
    },
    getWriteIndex(channelName = 'ch0') {
      return getChannelWriteIndex(channelName);
    },
    getCapacity() {
      return CAPACITY;
    },
    copyLatest(out, requestedCount, channelName = 'ch0') {
      const buffer = getBuffer(channelName);
      const writeIndex = getChannelWriteIndex(channelName);
      const available = Math.min(writeIndex, CAPACITY);
      const count = Math.min(out.length, requestedCount, available);
      if (count === 0) return 0;

      const startWriteIndex = writeIndex - count;
      for (let i = 0; i < count; i += 1) {
        out[i] = buffer[(startWriteIndex + i) % CAPACITY];
      }
      return count;
    },
    copyLatestLeadOff(out, requestedCount, channelName = 'ch0') {
      const buffer = getLeadOffBuffer(channelName);
      const writeIndex = getChannelWriteIndex(channelName);
      const available = Math.min(writeIndex, CAPACITY);
      const count = Math.min(out.length, requestedCount, available);
      if (count === 0) return 0;

      const startWriteIndex = writeIndex - count;
      for (let i = 0; i < count; i += 1) {
        out[i] = buffer[(startWriteIndex + i) % CAPACITY];
      }
      return count;
    },
    markLatestLeadOff(requestedCount, channelName = 'ch0', leadOff = true) {
      const buffer = getLeadOffBuffer(channelName);
      const writeIndex = getChannelWriteIndex(channelName);
      const count = Math.min(Math.max(0, requestedCount), writeIndex, CAPACITY);

      for (let i = 0; i < count; i += 1) {
        buffer[(writeIndex - 1 - i + CAPACITY) % CAPACITY] = leadOff ? 1 : 0;
      }
    },
    getChannelNames() {
      return [...buffers.keys()].sort();
    },
  };
}
