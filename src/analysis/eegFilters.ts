export interface EegFilter {
  reset: () => void;
  processSample: (value: number) => number;
}

export class IdentityEegFilter implements EegFilter {
  reset(): void {
    return undefined;
  }

  processSample(value: number): number {
    return value;
  }
}

export class FirstOrderHighPassFilter implements EegFilter {
  private readonly coefficient: number;

  private previousInput = 0;

  private previousOutput = 0;

  private hasPreviousInput = false;

  constructor(cutoffHz: number, sampleRateHz: number) {
    const dt = 1 / sampleRateHz;
    const rc = 1 / (2 * Math.PI * cutoffHz);
    this.coefficient = rc / (rc + dt);
  }

  reset(): void {
    this.previousInput = 0;
    this.previousOutput = 0;
    this.hasPreviousInput = false;
  }

  processSample(value: number): number {
    if (!this.hasPreviousInput) {
      this.previousInput = value;
      this.previousOutput = 0;
      this.hasPreviousInput = true;
      return 0;
    }

    const output = this.coefficient * (this.previousOutput + value - this.previousInput);
    this.previousInput = value;
    this.previousOutput = output;
    return output;
  }
}

export class FirstOrderLowPassFilter implements EegFilter {
  private readonly coefficient: number;

  private previousOutput = 0;

  private hasPreviousOutput = false;

  constructor(cutoffHz: number, sampleRateHz: number) {
    const dt = 1 / sampleRateHz;
    const rc = 1 / (2 * Math.PI * cutoffHz);
    this.coefficient = dt / (rc + dt);
  }

  reset(): void {
    this.previousOutput = 0;
    this.hasPreviousOutput = false;
  }

  processSample(value: number): number {
    if (!this.hasPreviousOutput) {
      this.previousOutput = value;
      this.hasPreviousOutput = true;
      return value;
    }

    this.previousOutput += this.coefficient * (value - this.previousOutput);
    return this.previousOutput;
  }
}

export class EegFilterChain implements EegFilter {
  constructor(private readonly filters: EegFilter[]) {}

  reset(): void {
    for (const filter of this.filters) {
      filter.reset();
    }
  }

  processSample(value: number): number {
    return this.filters.reduce(
      (filteredValue, filter) => filter.processSample(filteredValue),
      value,
    );
  }
}
