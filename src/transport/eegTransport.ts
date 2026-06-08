import type { AcquisitionDeviceSummary, EegTransportMode } from '../types/acquisition';
import type { EegSampleBatch } from '../types/eeg';
import type { EegHardwareConfig } from './eegHardwareConfig';

export type ImplementedEegTransportMode = 'serial';

export interface EegTransportDescriptor {
  mode: EegTransportMode;
  implemented: boolean;
  visible: boolean;
}

export interface EegTransportRuntime {
  readonly mode: EegTransportMode;
  isSupported(): boolean;
  requestDevice(config: EegTransportConnectInput): Promise<EegTransportSession>;
}

export interface EegTransportConnectInput {
  hardwareConfig: EegHardwareConfig;
  channelCount: number;
  onBatch: (batch: EegSampleBatch) => void;
}

export interface EegTransportSession {
  readonly mode: EegTransportMode;
  readonly device: AcquisitionDeviceSummary;
  readonly channelNames: readonly string[];
  start(): Promise<void>;
  stop(): Promise<void>;
  disconnect(): Promise<void>;
  forgetDevice?(): Promise<void>;
}

export const ACTIVE_EEG_TRANSPORT_MODE: ImplementedEegTransportMode = 'serial';

export const EEG_TRANSPORT_DESCRIPTORS: readonly EegTransportDescriptor[] = [
  { mode: 'serial', implemented: true, visible: false },
  { mode: 'bridge-coc', implemented: false, visible: false },
];

export function isImplementedEegTransportMode(
  mode: EegTransportMode,
): mode is ImplementedEegTransportMode {
  return mode === 'serial';
}
