import { EEG_ENGAGEMENT_ALERT_THRESHOLD } from '../config/eeg';
import type { CandidateBandEventV1 } from './bandStats';
import { BAND_METRICS, type BandMetric, type BandMetricSummaryV1 } from './protocol';
import type { EegMentalStateTarget } from './questionIntent';

export const FIVE_BAND_METRICS: readonly BandMetric[] = BAND_METRICS;
export const FOCUS_SUPPORT_RATIO_THRESHOLD = EEG_ENGAGEMENT_ALERT_THRESHOLD;
export const FOCUS_MIXED_RATIO_THRESHOLD = EEG_ENGAGEMENT_ALERT_THRESHOLD * 0.7;

export type MentalStateSupport =
  | 'supports'
  | 'weakly-supports'
  | 'mixed'
  | 'does-not-support';

export type FocusInference =
  | { status: 'supports' | 'mixed' | 'does-not-support'; ratio: number }
  | { status: 'insufficient'; ratio: null };

export function createBandMeanMap(
  summary: readonly BandMetricSummaryV1[],
): ReadonlyMap<BandMetric, number | null> {
  return new Map(summary.map((item) => [item.metric, item.mean]));
}

export function createBandEventMap(
  events: readonly CandidateBandEventV1[],
): ReadonlyMap<BandMetric, CandidateBandEventV1> {
  const map = new Map<BandMetric, CandidateBandEventV1>();
  for (const event of events) {
    if (!map.has(event.metric)) {
      map.set(event.metric, event);
    }
  }
  return map;
}

export function getBandMean(
  means: ReadonlyMap<BandMetric, number | null>,
  metric: BandMetric,
): number | null {
  return means.get(metric) ?? null;
}

export function getFocusInference(
  means: ReadonlyMap<BandMetric, number | null>,
  options: { supportRatioThreshold?: number } = {},
): FocusInference {
  const betaMean = getBandMean(means, 'betaPower');
  const alphaMean = getBandMean(means, 'alphaPower');
  const thetaMean = getBandMean(means, 'thetaPower');
  const supportRatioThreshold =
    options.supportRatioThreshold ?? FOCUS_SUPPORT_RATIO_THRESHOLD;
  const mixedRatioThreshold = supportRatioThreshold * 0.7;
  const denominator =
    alphaMean !== null && thetaMean !== null ? alphaMean + thetaMean : null;
  if (betaMean === null || denominator === null || denominator <= 0) {
    return { status: 'insufficient', ratio: null };
  }

  const ratio = betaMean / denominator;
  if (ratio >= supportRatioThreshold) return { status: 'supports', ratio };
  if (ratio >= mixedRatioThreshold) return { status: 'mixed', ratio };
  return { status: 'does-not-support', ratio };
}

export function getSingleBandMentalStateSupport(
  target: EegMentalStateTarget,
  event: CandidateBandEventV1 | null,
): MentalStateSupport {
  if (!event) return 'mixed';
  const { metric, direction } = event;
  const high = direction === 'high';
  const low = direction === 'low';

  if (target === 'anxiety' || target === 'tension') {
    if ((metric === 'betaPower' || metric === 'gammaPower') && high) return 'supports';
    if (metric === 'alphaPower' && low) return 'weakly-supports';
    if ((metric === 'betaPower' || metric === 'gammaPower') && low) return 'does-not-support';
    if (metric === 'alphaPower' && high) return 'does-not-support';
    return 'mixed';
  }

  if (target === 'relaxation') {
    if (metric === 'alphaPower' && high) return 'supports';
    if ((metric === 'betaPower' || metric === 'gammaPower') && low) return 'weakly-supports';
    if ((metric === 'betaPower' || metric === 'gammaPower') && high) return 'does-not-support';
    if (metric === 'alphaPower' && low) return 'does-not-support';
    return 'mixed';
  }

  if (target === 'fatigue' || target === 'drowsiness') {
    if ((metric === 'thetaPower' || metric === 'deltaPower') && high) return 'supports';
    if (metric === 'betaPower' && low) return 'weakly-supports';
    if (metric === 'alphaPower' && high) return 'weakly-supports';
    if ((metric === 'betaPower' || metric === 'gammaPower') && high) return 'does-not-support';
    return 'mixed';
  }

  if (target === 'alertness' || target === 'arousal') {
    if ((metric === 'betaPower' || metric === 'gammaPower') && high) return 'supports';
    if (metric === 'alphaPower' && low) return 'weakly-supports';
    if ((metric === 'thetaPower' || metric === 'deltaPower') && high) return 'does-not-support';
    if ((metric === 'betaPower' || metric === 'gammaPower') && low) return 'does-not-support';
    return 'mixed';
  }

  if (target === 'depression') {
    if ((metric === 'thetaPower' || metric === 'alphaPower') && high) return 'weakly-supports';
    if (metric === 'betaPower' && low) return 'weakly-supports';
    if ((metric === 'betaPower' || metric === 'gammaPower') && high) return 'does-not-support';
    return 'mixed';
  }

  return 'mixed';
}

export function getMentalStateSupport(
  target: EegMentalStateTarget,
  events: readonly CandidateBandEventV1[],
): MentalStateSupport {
  if (events.length === 0) return 'mixed';

  const supports = events
    .slice(0, FIVE_BAND_METRICS.length)
    .map((event) => getSingleBandMentalStateSupport(target, event));
  const strongCount = supports.filter((support) => support === 'supports').length;
  const weakCount = supports.filter((support) => support === 'weakly-supports').length;
  const conflictCount = supports.filter((support) => support === 'does-not-support').length;
  const usefulSupportCount = strongCount + weakCount;

  if (usefulSupportCount === 0 && conflictCount > 0) return 'does-not-support';
  if (usefulSupportCount > 0 && conflictCount > 0) return 'mixed';
  if (strongCount >= 2 || (strongCount >= 1 && weakCount >= 1)) return 'supports';
  if (usefulSupportCount > 0) return 'weakly-supports';
  return 'mixed';
}

export function shouldBackcheckMentalStateEvents(
  target: EegMentalStateTarget,
  events: readonly CandidateBandEventV1[],
): boolean {
  const supports = events
    .slice(0, FIVE_BAND_METRICS.length)
    .map((event) => getSingleBandMentalStateSupport(target, event));
  const hasSupport = supports.includes('supports');
  const hasWeakSupport = supports.includes('weakly-supports');
  const hasConflict = supports.includes('does-not-support');
  const hasMixed = supports.includes('mixed');
  return hasMixed || hasWeakSupport || (hasSupport && hasConflict) || !hasSupport;
}
