function trimTrailingZeros(value: string): string {
  return value.replace(/(\.\d*?[1-9])0+$/, '$1').replace(/\.0+$/, '');
}

export function formatAnalysisMetric(value: number | null): string {
  if (value === null || !Number.isFinite(value)) {
    return '-';
  }

  if (value === 0) {
    return '0';
  }

  if (Math.abs(value) >= 0.01) {
    return trimTrailingZeros(value.toFixed(4));
  }

  return value.toExponential(3);
}

export function formatAnalysisSeconds(seconds: number): string {
  if (seconds < 10) {
    return `${seconds.toFixed(1)}s`;
  }

  if (seconds < 60) {
    return `${seconds.toFixed(0)}s`;
  }

  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = Math.floor(seconds % 60);

  return `${minutes}:${String(remainingSeconds).padStart(2, '0')}`;
}
