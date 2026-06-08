import { describe, expect, it } from 'vitest';
import {
  LeadOffDetectorBank,
  getAcLeadOffFrequencyHz,
} from '../src/analysis/leadOffDetection';

const SAMPLE_RATE_HZ = 250;

function sine(freqHz: number, sampleIndex: number, amplitudeVolts: number): number {
  return amplitudeVolts * Math.sin((2 * Math.PI * freqHz * sampleIndex) / SAMPLE_RATE_HZ);
}

describe('lead-off detection', () => {
  it('maps AC lead-off modes to the configured feature frequency', () => {
    expect(getAcLeadOffFrequencyHz('FDR4', 250)).toBe(62.5);
    expect(getAcLeadOffFrequencyHz('7_8HZ', 250)).toBe(7.8);
    expect(getAcLeadOffFrequencyHz('31_2HZ', 250)).toBe(31.2);
    expect(getAcLeadOffFrequencyHz('OFF', 250)).toBeNull();
  });

  it('detects a strong injected AC feature tone and releases after it clears', () => {
    const bank = new LeadOffDetectorBank({
      sampleRateHz: SAMPLE_RATE_HZ,
      mode: '31_2HZ',
      channelNames: ['ch0'],
    });
    let latest = {
      leadOff: false,
      becameLeadOff: false,
      amplitudeVolts: 0,
      powerRatio: 0,
      windowSampleCount: SAMPLE_RATE_HZ,
    };

    for (let index = 0; index < SAMPLE_RATE_HZ * 2; index += 1) {
      latest = bank.pushSample('ch0', sine(10, index, 20e-6));
    }

    expect(latest.leadOff).toBe(false);

    let sawTransition = false;
    for (let index = 0; index < SAMPLE_RATE_HZ * 2; index += 1) {
      latest = bank.pushSample(
        'ch0',
        sine(10, index, 10e-6) + sine(31.2, index, 100e-6),
      );
      sawTransition = sawTransition || latest.becameLeadOff;
    }

    expect(latest.leadOff).toBe(true);
    expect(sawTransition).toBe(true);
    expect(latest.amplitudeVolts).toBeGreaterThan(60e-6);
    expect(latest.powerRatio).toBeGreaterThan(0.08);

    for (let index = 0; index < SAMPLE_RATE_HZ * 2; index += 1) {
      latest = bank.pushSample('ch0', sine(10, index, 10e-6));
    }

    expect(latest.leadOff).toBe(false);
  });

  it('keeps lead-off detection disabled for OFF mode', () => {
    const bank = new LeadOffDetectorBank({
      sampleRateHz: SAMPLE_RATE_HZ,
      mode: 'OFF',
      channelNames: ['ch0'],
    });
    let latest = {
      leadOff: false,
      becameLeadOff: false,
      amplitudeVolts: 0,
      powerRatio: 0,
      windowSampleCount: SAMPLE_RATE_HZ,
    };

    for (let index = 0; index < SAMPLE_RATE_HZ * 2; index += 1) {
      latest = bank.pushSample(
        'ch0',
        30e-3 + sine(31.2, index, 100e-6),
      );
    }

    expect(latest.leadOff).toBe(false);
    expect(latest.becameLeadOff).toBe(false);
  });
});
