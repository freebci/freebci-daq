import type { EegHardwareAcLeadOffMode } from '../transport/eegHardwareConfig';

export interface LeadOffSampleStatus {
  leadOff: boolean;
  becameLeadOff: boolean;
  amplitudeVolts: number;
  powerRatio: number;
  windowSampleCount: number;
}

export interface LeadOffDetectorBankOptions {
  sampleRateHz: number;
  mode: EegHardwareAcLeadOffMode;
  channelNames: readonly string[];
}

const AC_WINDOW_SECONDS = 1;
const AC_HOP_SECONDS = 0.25;
const AC_RATIO_ON = 0.08;
const AC_RATIO_OFF = 0.04;
const AC_AMPLITUDE_ON_VOLTS = 25e-6;
const AC_AMPLITUDE_OFF_VOLTS = 12e-6;
const HIT_COUNT_TO_LATCH = 2;
const CLEAR_COUNT_TO_RELEASE = 4;

export function getAcLeadOffFrequencyHz(
  mode: EegHardwareAcLeadOffMode,
  sampleRateHz: number,
): number | null {
  switch (mode) {
    case 'FDR4':
      return sampleRateHz / 4;
    case '7_8HZ':
      return 7.8;
    case '31_2HZ':
      return 31.2;
    case 'OFF':
      return null;
  }
}

export class LeadOffDetectorBank {
  private readonly detectors = new Map<string, LeadOffDetector>();

  constructor(options: LeadOffDetectorBankOptions) {
    for (const channelName of options.channelNames) {
      this.detectors.set(
        normalizeChannelName(channelName),
        new LeadOffDetector(options.sampleRateHz, options.mode),
      );
    }
  }

  pushSample(channelName: string, value: number): LeadOffSampleStatus {
    const normalized = normalizeChannelName(channelName);
    let detector = this.detectors.get(normalized);

    if (!detector) {
      const fallback = [...this.detectors.values()][0];
      detector = fallback?.clone() ?? new LeadOffDetector(250, 'FDR4');
      this.detectors.set(normalized, detector);
    }

    return detector.push(value);
  }

  reset(): void {
    for (const detector of this.detectors.values()) {
      detector.reset();
    }
  }
}

class LeadOffDetector {
  private readonly windowSize: number;

  private readonly hopSize: number;

  private readonly frequencyHz: number | null;

  private readonly values: Float64Array;

  private readonly window: Float64Array;

  private readonly cosTable: Float64Array;

  private readonly sinTable: Float64Array;

  private readonly windowSum: number;

  private writeIndex = 0;

  private count = 0;

  private samplesSinceAnalysis = 0;

  private hitCount = 0;

  private clearCount = 0;

  private current: LeadOffSampleStatus = {
    leadOff: false,
    becameLeadOff: false,
    amplitudeVolts: 0,
    powerRatio: 0,
    windowSampleCount: 0,
  };

  constructor(
    private readonly sampleRateHz: number,
    private readonly mode: EegHardwareAcLeadOffMode,
  ) {
    this.windowSize = Math.max(32, Math.round(sampleRateHz * AC_WINDOW_SECONDS));
    this.hopSize = Math.max(8, Math.round(sampleRateHz * AC_HOP_SECONDS));
    this.frequencyHz = getAcLeadOffFrequencyHz(mode, sampleRateHz);
    this.values = new Float64Array(this.windowSize);
    this.window = createHannWindow(this.windowSize);
    this.cosTable = new Float64Array(this.windowSize);
    this.sinTable = new Float64Array(this.windowSize);
    this.windowSum = sum(this.window);

    if (this.frequencyHz !== null) {
      const omega = (2 * Math.PI * this.frequencyHz) / sampleRateHz;
      for (let index = 0; index < this.windowSize; index += 1) {
        this.cosTable[index] = Math.cos(omega * index);
        this.sinTable[index] = Math.sin(omega * index);
      }
    }

    this.current = {
      leadOff: false,
      becameLeadOff: false,
      amplitudeVolts: 0,
      powerRatio: 0,
      windowSampleCount: this.windowSize,
    };
  }

  clone(): LeadOffDetector {
    return new LeadOffDetector(this.sampleRateHz, this.mode);
  }

  reset(): void {
    this.values.fill(0);
    this.writeIndex = 0;
    this.count = 0;
    this.samplesSinceAnalysis = 0;
    this.hitCount = 0;
    this.clearCount = 0;
    this.current = {
      leadOff: false,
      becameLeadOff: false,
      amplitudeVolts: 0,
      powerRatio: 0,
      windowSampleCount: this.windowSize,
    };
  }

  push(value: number): LeadOffSampleStatus {
    if (!Number.isFinite(value)) {
      return this.current;
    }

    this.values[this.writeIndex] = value;
    this.writeIndex = (this.writeIndex + 1) % this.windowSize;
    this.count = Math.min(this.count + 1, this.windowSize);
    this.samplesSinceAnalysis += 1;

    if (this.count >= this.windowSize && this.samplesSinceAnalysis >= this.hopSize) {
      this.samplesSinceAnalysis = 0;
      if (this.frequencyHz !== null) {
        this.current = this.analyzeAcWindow();
      }
    }

    return this.current;
  }

  private analyzeAcWindow(): LeadOffSampleStatus {
    const mean = this.calculateMean();
    let real = 0;
    let imaginary = 0;
    let weightedEnergy = 0;

    for (let index = 0; index < this.windowSize; index += 1) {
      const sample = this.getChronologicalValue(index) - mean;
      const weighted = sample * this.window[index];
      real += weighted * this.cosTable[index];
      imaginary -= weighted * this.sinTable[index];
      weightedEnergy += weighted * weighted;
    }

    const power = real * real + imaginary * imaginary;
    const amplitudeVolts =
      this.windowSum > 0 ? (2 * Math.sqrt(power)) / this.windowSum : 0;
    const powerRatio =
      weightedEnergy > 0 ? power / (this.windowSize * weightedEnergy) : 0;
    const hit = powerRatio >= AC_RATIO_ON && amplitudeVolts >= AC_AMPLITUDE_ON_VOLTS;
    const clear =
      powerRatio <= AC_RATIO_OFF || amplitudeVolts <= AC_AMPLITUDE_OFF_VOLTS;

    return this.updateLatchedState(hit, clear, amplitudeVolts, powerRatio);
  }

  private updateLatchedState(
    hit: boolean,
    clear: boolean,
    amplitudeVolts: number,
    powerRatio: number,
  ): LeadOffSampleStatus {
    if (hit) {
      this.hitCount += 1;
      this.clearCount = 0;
    } else if (clear) {
      this.clearCount += 1;
      this.hitCount = 0;
    } else {
      this.hitCount = 0;
      this.clearCount = 0;
    }

    let leadOff = this.current.leadOff;
    const previousLeadOff = leadOff;
    if (!leadOff && this.hitCount >= HIT_COUNT_TO_LATCH) {
      leadOff = true;
    } else if (leadOff && this.clearCount >= CLEAR_COUNT_TO_RELEASE) {
      leadOff = false;
    }

    this.current = {
      leadOff,
      becameLeadOff: !previousLeadOff && leadOff,
      amplitudeVolts,
      powerRatio,
      windowSampleCount: this.windowSize,
    };

    return this.current;
  }

  private calculateMean(): number {
    let total = 0;

    for (let index = 0; index < this.windowSize; index += 1) {
      total += this.getChronologicalValue(index);
    }

    return total / this.windowSize;
  }

  private getChronologicalValue(index: number): number {
    return this.values[(this.writeIndex + index) % this.windowSize];
  }
}

function createHannWindow(size: number): Float64Array {
  if (size <= 1) {
    return new Float64Array([1]);
  }

  return Float64Array.from({ length: size }, (_, index) => {
    return 0.5 - 0.5 * Math.cos((2 * Math.PI * index) / (size - 1));
  });
}

function sum(values: Float64Array): number {
  let total = 0;

  for (const value of values) {
    total += value;
  }

  return total;
}

function normalizeChannelName(channelName = 'ch0'): string {
  return channelName.trim() || 'ch0';
}
