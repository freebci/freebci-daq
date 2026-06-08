import { describe, expect, it } from 'vitest';
import {
  Biquad,
  CascadedScalarFilter,
  butterworthSectionQs,
  createButterworthBandpassFilter,
  highPassBiquad,
  lowPassBiquad,
  notchBiquad,
} from '../src/analysis/butterworthFilter';

const SAMPLE_RATE_HZ = 250;

function buildHighPassChain(cutoffHz: number, order: number): CascadedScalarFilter {
  const qs = butterworthSectionQs(order);
  return new CascadedScalarFilter(qs.map((q) => highPassBiquad(cutoffHz, SAMPLE_RATE_HZ, q)));
}

function buildLowPassChain(cutoffHz: number, order: number): CascadedScalarFilter {
  const qs = butterworthSectionQs(order);
  return new CascadedScalarFilter(qs.map((q) => lowPassBiquad(cutoffHz, SAMPLE_RATE_HZ, q)));
}

function feedSineSteadyState(
  filter: { reset: () => void; processSample: (v: number) => number },
  freqHz: number,
  durationSeconds: number,
): { peak: number } {
  filter.reset();
  const totalSamples = Math.round(durationSeconds * SAMPLE_RATE_HZ);
  const settleSamples = Math.floor(totalSamples * 0.6);
  let peak = 0;
  for (let i = 0; i < totalSamples; i += 1) {
    const x = Math.sin((2 * Math.PI * freqHz * i) / SAMPLE_RATE_HZ);
    const y = filter.processSample(x);
    if (i >= settleSamples) {
      const abs = Math.abs(y);
      if (abs > peak) peak = abs;
    }
  }
  return { peak };
}

describe('butterworthSectionQs', () => {
  it('returns N/2 Q values for even order', () => {
    expect(butterworthSectionQs(2)).toHaveLength(1);
    expect(butterworthSectionQs(4)).toHaveLength(2);
    expect(butterworthSectionQs(6)).toHaveLength(3);
  });

  it('rejects odd or invalid order', () => {
    expect(() => butterworthSectionQs(3)).toThrow();
    expect(() => butterworthSectionQs(0)).toThrow();
    expect(() => butterworthSectionQs(1.5)).toThrow();
  });

  it('matches known 4th-order Butterworth Q values', () => {
    const [q1, q2] = butterworthSectionQs(4);
    expect(q1).toBeCloseTo(0.541196, 4);
    expect(q2).toBeCloseTo(1.306563, 4);
  });
});

describe('Biquad', () => {
  it('reset() clears state so impulse response is reproducible', () => {
    const biquad = highPassBiquad(5, SAMPLE_RATE_HZ, 0.7071);
    const first: number[] = [];
    biquad.reset();
    first.push(biquad.processSample(1));
    for (let i = 0; i < 20; i += 1) first.push(biquad.processSample(0));

    const second: number[] = [];
    biquad.reset();
    second.push(biquad.processSample(1));
    for (let i = 0; i < 20; i += 1) second.push(biquad.processSample(0));

    expect(second).toEqual(first);
  });

  it('passthrough biquad copies input', () => {
    const passthrough = new Biquad(1, 0, 0, 0, 0);
    expect(passthrough.processSample(0.5)).toBeCloseTo(0.5);
    expect(passthrough.processSample(-1)).toBeCloseTo(-1);
  });
});

describe('Butterworth high-pass', () => {
  it('rejects DC-band 0.1 Hz strongly', () => {
    const hp = buildHighPassChain(1, 4);
    const { peak } = feedSineSteadyState(hp, 0.1, 6);
    expect(peak).toBeLessThan(0.01); // > 40 dB attenuation
  });

  it('passes signals well above cutoff with near-unity gain', () => {
    const hp = buildHighPassChain(1, 4);
    const { peak } = feedSineSteadyState(hp, 10, 4);
    expect(peak).toBeGreaterThan(0.95);
    expect(peak).toBeLessThan(1.05);
  });
});

describe('Butterworth low-pass', () => {
  it('passes 10 Hz with near-unity gain', () => {
    const lp = buildLowPassChain(30, 4);
    const { peak } = feedSineSteadyState(lp, 10, 4);
    expect(peak).toBeGreaterThan(0.95);
    expect(peak).toBeLessThan(1.05);
  });

  it('attenuates 60 Hz substantially more than a first-order LP at 30 Hz', () => {
    const lp4 = buildLowPassChain(30, 4);
    const lp1Like = buildLowPassChain(30, 2);
    const { peak: peak4 } = feedSineSteadyState(lp4, 60, 4);
    const { peak: peak2 } = feedSineSteadyState(lp1Like, 60, 4);
    // Higher order = lower passing amplitude at 2× cutoff.
    expect(peak4).toBeLessThan(peak2);
    expect(peak4).toBeLessThan(0.1);
  });
});

describe('notchBiquad', () => {
  it('strongly attenuates a steady 50 Hz sine', () => {
    const notch = notchBiquad(50, SAMPLE_RATE_HZ, 30);
    const { peak } = feedSineSteadyState(notch, 50, 8);
    expect(peak).toBeLessThan(0.02);
  });

  it('preserves a 10 Hz sine with near-unity gain', () => {
    const notch = notchBiquad(50, SAMPLE_RATE_HZ, 30);
    const { peak } = feedSineSteadyState(notch, 10, 4);
    expect(peak).toBeGreaterThan(0.95);
    expect(peak).toBeLessThan(1.05);
  });

  it('reset() clears state so impulse response is reproducible', () => {
    const notch = notchBiquad(50, SAMPLE_RATE_HZ, 30);
    const collect = (): number[] => {
      const output: number[] = [];
      for (let i = 0; i < 30; i += 1) {
        output.push(notch.processSample(i === 0 ? 1 : 0));
      }
      return output;
    };

    const first = collect();
    notch.reset();
    const second = collect();
    expect(second).toEqual(first);
  });
});

describe('createButterworthBandpassFilter', () => {
  it('processes the single EEG channel', () => {
    const filter = createButterworthBandpassFilter({
      hpCutoffHz: 1,
      lpCutoffHz: 30,
      sampleRateHz: SAMPLE_RATE_HZ,
      order: 4,
    });
    expect(Number.isFinite(filter.processSample(1))).toBe(true);
  });

  it('reset() restores filter state', () => {
    const filter = createButterworthBandpassFilter({
      hpCutoffHz: 1,
      lpCutoffHz: 30,
      sampleRateHz: SAMPLE_RATE_HZ,
      order: 4,
    });

    const collect = (): number[] => {
      const out: number[] = [];
      for (let i = 0; i < 30; i += 1) {
        out.push(filter.processSample(i === 0 ? 1 : 0));
      }
      return out;
    };

    const first = collect();
    filter.reset();
    const second = collect();
    expect(second).toEqual(first);
  });

  it('passes a 10 Hz sine through the band with substantial amplitude retained', () => {
    const filter = createButterworthBandpassFilter({
      hpCutoffHz: 1,
      lpCutoffHz: 30,
      sampleRateHz: SAMPLE_RATE_HZ,
      order: 4,
    });
    const totalSamples = SAMPLE_RATE_HZ * 4;
    let peak = 0;
    for (let i = 0; i < totalSamples; i += 1) {
      const x = Math.sin((2 * Math.PI * 10 * i) / SAMPLE_RATE_HZ);
      const y = filter.processSample(x);
      if (i > totalSamples * 0.6) peak = Math.max(peak, Math.abs(y));
    }
    expect(peak).toBeGreaterThan(0.9);
  });
});
