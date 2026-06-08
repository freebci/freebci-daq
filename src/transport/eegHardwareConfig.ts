export const EEG_HARDWARE_SAMPLE_RATES_HZ = [
  125,
  250,
  500,
  1_000,
  2_000,
  4_000,
  8_000,
] as const;

export const EEG_HARDWARE_GAINS = [1, 2, 3, 4, 6, 8, 12, 24, 48] as const;

export const EEG_HARDWARE_AC_LEAD_OFF_MODES = [
  'FDR4',
  '7_8HZ',
  '31_2HZ',
  'OFF',
] as const;

export const EEG_HARDWARE_DEFAULT_SAMPLE_RATE_HZ = 250;

export type EegHardwareSampleRateHz = (typeof EEG_HARDWARE_SAMPLE_RATES_HZ)[number];
export type EegHardwareGain = (typeof EEG_HARDWARE_GAINS)[number];
export type EegHardwareAcLeadOffMode =
  (typeof EEG_HARDWARE_AC_LEAD_OFF_MODES)[number];

export interface EegHardwareConfig {
  sampleRateHz: EegHardwareSampleRateHz;
  gain: EegHardwareGain;
  rldEnabled: boolean;
  acLeadOffMode: EegHardwareAcLeadOffMode;
}

export const DEFAULT_EEG_HARDWARE_CONFIG: EegHardwareConfig = {
  sampleRateHz: EEG_HARDWARE_DEFAULT_SAMPLE_RATE_HZ,
  gain: 24,
  rldEnabled: true,
  acLeadOffMode: 'FDR4',
};

export function isEegHardwareSampleRateHz(
  value: number,
): value is EegHardwareSampleRateHz {
  return (EEG_HARDWARE_SAMPLE_RATES_HZ as readonly number[]).includes(value);
}

export function isEegHardwareGain(value: number): value is EegHardwareGain {
  return (EEG_HARDWARE_GAINS as readonly number[]).includes(value);
}

export function isEegHardwareAcLeadOffMode(
  value: string,
): value is EegHardwareAcLeadOffMode {
  return (EEG_HARDWARE_AC_LEAD_OFF_MODES as readonly string[]).includes(value);
}

export function normalizeEegHardwareConfig(
  config: Partial<EegHardwareConfig> | null | undefined,
): EegHardwareConfig {
  const sampleRateHz =
    typeof config?.sampleRateHz === 'number' &&
    isEegHardwareSampleRateHz(config.sampleRateHz)
      ? config.sampleRateHz
      : DEFAULT_EEG_HARDWARE_CONFIG.sampleRateHz;
  const gain =
    typeof config?.gain === 'number' && isEegHardwareGain(config.gain)
      ? config.gain
      : DEFAULT_EEG_HARDWARE_CONFIG.gain;
  const acLeadOffMode =
    typeof config?.acLeadOffMode === 'string' &&
    isEegHardwareAcLeadOffMode(config.acLeadOffMode)
      ? config.acLeadOffMode
      : DEFAULT_EEG_HARDWARE_CONFIG.acLeadOffMode;

  return {
    sampleRateHz,
    gain,
    rldEnabled:
      typeof config?.rldEnabled === 'boolean'
        ? config.rldEnabled
        : DEFAULT_EEG_HARDWARE_CONFIG.rldEnabled,
    acLeadOffMode,
  };
}

export function getEffectiveEegHardwareSampleRateHz(
  config: Pick<EegHardwareConfig, 'sampleRateHz'>,
): EegHardwareSampleRateHz {
  return config.sampleRateHz;
}
