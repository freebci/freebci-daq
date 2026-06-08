import { EEG_SAMPLE_RATE_HZ } from '../config/eeg';
import type { EegFilter } from './eegFilters';
import { EegFilterChain } from './eegFilters';

export class Biquad implements EegFilter {
  private x1 = 0;
  private x2 = 0;
  private y1 = 0;
  private y2 = 0;

  constructor(
    private readonly b0: number,
    private readonly b1: number,
    private readonly b2: number,
    private readonly a1: number,
    private readonly a2: number,
  ) {}

  reset(): void {
    this.x1 = 0;
    this.x2 = 0;
    this.y1 = 0;
    this.y2 = 0;
  }

  processSample(x: number): number {
    const y =
      this.b0 * x +
      this.b1 * this.x1 +
      this.b2 * this.x2 -
      this.a1 * this.y1 -
      this.a2 * this.y2;
    this.x2 = this.x1;
    this.x1 = x;
    this.y2 = this.y1;
    this.y1 = y;
    return y;
  }
}

export class CascadedScalarFilter implements EegFilter {
  constructor(private readonly stages: EegFilter[]) {}

  reset(): void {
    for (const stage of this.stages) {
      stage.reset();
    }
  }

  processSample(value: number): number {
    let output = value;
    for (const stage of this.stages) {
      output = stage.processSample(output);
    }
    return output;
  }
}

// RBJ Audio EQ Cookbook biquad coefficients, normalized by a0.
export function highPassBiquad(cutoffHz: number, sampleRateHz: number, q: number): Biquad {
  const w0 = (2 * Math.PI * cutoffHz) / sampleRateHz;
  const cosw = Math.cos(w0);
  const sinw = Math.sin(w0);
  const alpha = sinw / (2 * q);
  const a0 = 1 + alpha;
  const b0 = (1 + cosw) / 2 / a0;
  const b1 = -(1 + cosw) / a0;
  const b2 = (1 + cosw) / 2 / a0;
  const a1 = (-2 * cosw) / a0;
  const a2 = (1 - alpha) / a0;
  return new Biquad(b0, b1, b2, a1, a2);
}

export function lowPassBiquad(cutoffHz: number, sampleRateHz: number, q: number): Biquad {
  const w0 = (2 * Math.PI * cutoffHz) / sampleRateHz;
  const cosw = Math.cos(w0);
  const sinw = Math.sin(w0);
  const alpha = sinw / (2 * q);
  const a0 = 1 + alpha;
  const b0 = (1 - cosw) / 2 / a0;
  const b1 = (1 - cosw) / a0;
  const b2 = (1 - cosw) / 2 / a0;
  const a1 = (-2 * cosw) / a0;
  const a2 = (1 - alpha) / a0;
  return new Biquad(b0, b1, b2, a1, a2);
}

export function notchBiquad(centerHz: number, sampleRateHz: number, q: number): Biquad {
  const w0 = (2 * Math.PI * centerHz) / sampleRateHz;
  const cosw = Math.cos(w0);
  const sinw = Math.sin(w0);
  const alpha = sinw / (2 * q);
  const a0 = 1 + alpha;
  const b0 = 1 / a0;
  const b1 = (-2 * cosw) / a0;
  const b2 = 1 / a0;
  const a1 = (-2 * cosw) / a0;
  const a2 = (1 - alpha) / a0;
  return new Biquad(b0, b1, b2, a1, a2);
}

// Q values for the N/2 biquad sections that make an Nth-order Butterworth response.
// Pole angles for a Butterworth prototype: ((2k - 1) / (2N)) * π for k = 1..N/2.
export function butterworthSectionQs(order: number): number[] {
  if (!Number.isInteger(order) || order < 2 || order % 2 !== 0) {
    throw new Error('Butterworth order must be an even integer >= 2.');
  }

  const sections = order / 2;
  const qs: number[] = [];
  for (let sectionIndex = 1; sectionIndex <= sections; sectionIndex += 1) {
    const angle = ((2 * sectionIndex - 1) * Math.PI) / (2 * order);
    qs.push(1 / (2 * Math.cos(angle)));
  }
  return qs;
}

export interface ButterworthBandpassOptions {
  hpCutoffHz: number;
  lpCutoffHz: number;
  sampleRateHz?: number;
  order?: number;
}

// Cascaded Butterworth high-pass + low-pass for the single effective EEG channel.
export function createButterworthBandpassFilter(options: ButterworthBandpassOptions): EegFilter {
  const {
    hpCutoffHz,
    lpCutoffHz,
    sampleRateHz = EEG_SAMPLE_RATE_HZ,
    order = 4,
  } = options;
  const sectionQs = butterworthSectionQs(order);

  const hpStage = new CascadedScalarFilter(
    sectionQs.map((q) => highPassBiquad(hpCutoffHz, sampleRateHz, q)),
  );
  const lpStage = new CascadedScalarFilter(
    sectionQs.map((q) => lowPassBiquad(lpCutoffHz, sampleRateHz, q)),
  );

  return new EegFilterChain([hpStage, lpStage]);
}
