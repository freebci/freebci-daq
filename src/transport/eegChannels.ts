export const EEG_MIN_CHANNEL_COUNT = 1;
export const EEG_MAX_CHANNEL_COUNT = 8;
export const EEG_DEFAULT_CHANNEL_COUNT = 2;

export function normalizeEegChannelCount(
  channelCount: number | null | undefined,
): number {
  const numericChannelCount = typeof channelCount === 'number' ? channelCount : NaN;
  if (!Number.isFinite(numericChannelCount)) {
    return EEG_DEFAULT_CHANNEL_COUNT;
  }

  return Math.max(
    EEG_MIN_CHANNEL_COUNT,
    Math.min(EEG_MAX_CHANNEL_COUNT, Math.round(numericChannelCount)),
  );
}

export function getEegChannelNames(channelCount: number): string[] {
  const normalizedChannelCount = normalizeEegChannelCount(channelCount);
  return Array.from({ length: normalizedChannelCount }, (_, index) => `ch${index}`);
}
