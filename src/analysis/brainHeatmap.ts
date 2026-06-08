import type {
  EegHeatmapFrame,
  EegHeatmapMetric,
  EegHeatmapSiteValue,
} from '../types/eeg';

export interface EegSiteCoordinate {
  siteName: string;
  x: number;
  y: number;
}

export const EEG_SITE_COORDINATES: Record<string, EegSiteCoordinate> = {
  Fp1: { siteName: 'Fp1', x: 0.38, y: 0.1 },
  Fp2: { siteName: 'Fp2', x: 0.62, y: 0.1 },
  AF3: { siteName: 'AF3', x: 0.34, y: 0.18 },
  AF4: { siteName: 'AF4', x: 0.66, y: 0.18 },
  F7: { siteName: 'F7', x: 0.18, y: 0.28 },
  F3: { siteName: 'F3', x: 0.36, y: 0.3 },
  Fz: { siteName: 'Fz', x: 0.5, y: 0.28 },
  F4: { siteName: 'F4', x: 0.64, y: 0.3 },
  F8: { siteName: 'F8', x: 0.82, y: 0.28 },
  FC5: { siteName: 'FC5', x: 0.25, y: 0.42 },
  FC1: { siteName: 'FC1', x: 0.42, y: 0.4 },
  FC2: { siteName: 'FC2', x: 0.58, y: 0.4 },
  FC6: { siteName: 'FC6', x: 0.75, y: 0.42 },
  T3: { siteName: 'T3', x: 0.12, y: 0.52 },
  C3: { siteName: 'C3', x: 0.33, y: 0.52 },
  Cz: { siteName: 'Cz', x: 0.5, y: 0.52 },
  C4: { siteName: 'C4', x: 0.67, y: 0.52 },
  T4: { siteName: 'T4', x: 0.88, y: 0.52 },
  CP5: { siteName: 'CP5', x: 0.25, y: 0.64 },
  CP1: { siteName: 'CP1', x: 0.42, y: 0.64 },
  CP2: { siteName: 'CP2', x: 0.58, y: 0.64 },
  CP6: { siteName: 'CP6', x: 0.75, y: 0.64 },
  T5: { siteName: 'T5', x: 0.2, y: 0.76 },
  P3: { siteName: 'P3', x: 0.37, y: 0.76 },
  Pz: { siteName: 'Pz', x: 0.5, y: 0.78 },
  P4: { siteName: 'P4', x: 0.63, y: 0.76 },
  T6: { siteName: 'T6', x: 0.8, y: 0.76 },
  PO3: { siteName: 'PO3', x: 0.38, y: 0.86 },
  PO4: { siteName: 'PO4', x: 0.62, y: 0.86 },
  O1: { siteName: 'O1', x: 0.4, y: 0.93 },
  O2: { siteName: 'O2', x: 0.6, y: 0.93 },
};

function normalizeSiteName(siteName: string): string {
  return siteName.trim();
}

function getMetricValue(frame: EegHeatmapFrame, metric: EegHeatmapMetric): number | null {
  if (metric === 'engagementIndex') {
    return frame.engagementIndex;
  }

  return frame.bandPowers[metric];
}

export function getEegSiteCoordinate(siteName: string): EegSiteCoordinate | null {
  const normalizedSiteName = normalizeSiteName(siteName);
  return EEG_SITE_COORDINATES[normalizedSiteName] ?? null;
}

export function aggregateHeatmapSiteValues(input: {
  frames: readonly EegHeatmapFrame[];
  metric: EegHeatmapMetric;
  latestTimeSeconds: number;
  windowSeconds: number;
}): EegHeatmapSiteValue[] {
  const startSeconds = input.latestTimeSeconds - input.windowSeconds;
  const buckets = new Map<
    string,
    {
      siteName: string;
      channelName: string;
      sum: number;
      count: number;
    }
  >();

  for (const frame of input.frames) {
    if (frame.timeSeconds < startSeconds || frame.timeSeconds > input.latestTimeSeconds) {
      continue;
    }

    const value = getMetricValue(frame, input.metric);
    if (value === null || !Number.isFinite(value)) {
      continue;
    }

    const siteName = normalizeSiteName(frame.siteName);
    const channelName = frame.channelName.trim();
    if (!siteName || !channelName) {
      continue;
    }

    const key = `${siteName}::${channelName}`;
    const bucket = buckets.get(key) ?? {
      siteName,
      channelName,
      sum: 0,
      count: 0,
    };
    bucket.sum += value;
    bucket.count += 1;
    buckets.set(key, bucket);
  }

  return [...buckets.values()]
    .map((bucket) => {
      const coordinate = getEegSiteCoordinate(bucket.siteName);
      return {
        siteName: bucket.siteName,
        channelName: bucket.channelName,
        value: bucket.sum / bucket.count,
        sampleCount: bucket.count,
        x: coordinate?.x ?? null,
        y: coordinate?.y ?? null,
      };
    })
    .sort((a, b) => a.siteName.localeCompare(b.siteName) || a.channelName.localeCompare(b.channelName));
}

export function getCoordinateSiteValues(
  siteValues: readonly EegHeatmapSiteValue[],
): EegHeatmapSiteValue[] {
  return siteValues.filter(
    (value) => value.x !== null && value.y !== null && Number.isFinite(value.value),
  );
}
