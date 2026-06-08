const TUNING_KEYS = [
  'eeg-ema-alpha',
  'eeg-alert-threshold',
  'eeg-initial-unreliable',
  'focus-baseline',
  'focus-decision',
  'focus-warmup',
] as const;

export type TuningKey = (typeof TUNING_KEYS)[number];

export interface TuningValues {
  'eeg-ema-alpha': number | null;
  'eeg-alert-threshold': number | null;
  'eeg-initial-unreliable': number | null;
  'focus-baseline': number | null;
  'focus-decision': number | null;
  'focus-warmup': number | null;
}

function readStorage(): Partial<TuningValues> {
  const result: Partial<TuningValues> = {};

  for (const key of TUNING_KEYS) {
    const raw = window.localStorage.getItem(key);
    if (raw !== null) {
      const parsed = Number(raw);
      if (Number.isFinite(parsed)) {
        (result as Record<string, number>)[key] = parsed;
      }
    }
  }

  return result;
}

export function getTuningValue(key: TuningKey): number | null {
  if (typeof window === 'undefined') return null;

  const raw = window.localStorage.getItem(key);
  if (raw === null) return null;

  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : null;
}

export function writeTuningValues(values: Partial<Record<TuningKey, number>>): void {
  for (const [key, value] of Object.entries(values)) {
    if (value !== undefined && value !== null) {
      window.localStorage.setItem(key, String(value));
    } else {
      window.localStorage.removeItem(key);
    }
  }
}

export function clearAllTuning(): void {
  for (const key of TUNING_KEYS) {
    window.localStorage.removeItem(key);
  }
}

export function getTuningValues(): Partial<TuningValues> {
  return readStorage();
}

export { TUNING_KEYS };
