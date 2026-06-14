import {
  EEG_INITIAL_UNRELIABLE_SECONDS,
  EEG_SAMPLE_RATE_HZ,
} from '../config/eeg';
import type { EegAnalysisResult } from '../types/eeg';
import {
  AI_SCHEMA_VERSION,
  FIVE_BAND_CATALOG,
  type BandFeatureFrameV1,
  type BandFeatureQualityFlag,
  type SiteBindingV1,
  validateBandFeatureFrame,
} from './protocol';

export interface BandFeatureFrameOptions {
  conversationId: string;
  binding: SiteBindingV1;
  streamStartedAtMs: number | null;
  fftSize: number;
  sampleRateHz?: number;
  initialUnreliableSeconds?: number;
  filterId: string;
  filterParams: Record<string, number>;
  createdAtMs?: number;
}

export function createDefaultSiteBinding(
  conversationId: string,
  siteName = 'custom',
  placementSystem = 'custom',
  createdAtMs = Date.now(),
): SiteBindingV1 {
  return {
    schemaVersion: AI_SCHEMA_VERSION,
    conversationId,
    bindingId: 'binding-ch0-default',
    channelName: 'ch0',
    siteName: siteName.trim() || 'custom',
    placementSystem: placementSystem.trim() || 'custom',
    createdAtMs,
  };
}

export function getBandFeatureQualityFlags(
  input: {
    streamTimeSeconds: number;
    filterParams: Record<string, number>;
    initialUnreliableSeconds?: number;
  },
): BandFeatureQualityFlag[] {
  const flags: BandFeatureQualityFlag[] = [];
  const hpCutoffHz = input.filterParams.hpCutoffHz;
  const lpCutoffHz = input.filterParams.lpCutoffHz;
  const initialUnreliableSeconds =
    input.initialUnreliableSeconds ?? EEG_INITIAL_UNRELIABLE_SECONDS;

  if (input.streamTimeSeconds < Math.max(0, initialUnreliableSeconds)) {
    flags.push('initialUnreliable');
  }
  if (typeof lpCutoffHz === 'number' && lpCutoffHz < FIVE_BAND_CATALOG.gamma.maxHz) {
    flags.push('lowPassCutsGamma');
  }
  if (typeof hpCutoffHz === 'number' && hpCutoffHz > FIVE_BAND_CATALOG.delta.minHz) {
    flags.push('highPassCutsDelta');
  }

  return flags;
}

export function createBandFeatureFrame(
  result: EegAnalysisResult,
  options: BandFeatureFrameOptions,
): BandFeatureFrameV1 {
  const createdAtMs = options.createdAtMs ?? Date.now();
  const fallbackEndMs = Number.isFinite(Date.parse(result.updatedAt))
    ? Date.parse(result.updatedAt)
    : createdAtMs;
  const windowEndMs =
    options.streamStartedAtMs === null
      ? fallbackEndMs
      : Math.round(options.streamStartedAtMs + result.timeSeconds * 1000);
  const sampleRateHz = options.sampleRateHz ?? EEG_SAMPLE_RATE_HZ;
  const windowDurationMs = Math.round((result.windowSampleCount / sampleRateHz) * 1000);
  const windowStartMs = Math.max(0, windowEndMs - windowDurationMs);
  const qualityFlags = getBandFeatureQualityFlags({
    streamTimeSeconds: result.timeSeconds,
    filterParams: options.filterParams,
    initialUnreliableSeconds: options.initialUnreliableSeconds,
  });

  return validateBandFeatureFrame({
    schemaVersion: AI_SCHEMA_VERSION,
    conversationId: options.conversationId,
    bindingId: options.binding.bindingId,
    channelName: options.binding.channelName,
    siteName: options.binding.siteName,
    placementSystem: options.binding.placementSystem,
    windowStartMs,
    windowEndMs,
    streamTimeSeconds: result.timeSeconds,
    sampleIndex: result.sampleIndex,
    deltaPower: result.bandPowers.delta,
    thetaPower: result.bandPowers.theta,
    alphaPower: result.bandPowers.alpha,
    betaPower: result.bandPowers.beta,
    gammaPower: result.bandPowers.gamma,
    fftSize: options.fftSize,
    filterId: options.filterId,
    filterParams: { ...options.filterParams },
    qualityFlags,
    createdAtMs,
  });
}

export function createBandFeatureFrames(
  results: readonly EegAnalysisResult[],
  options: BandFeatureFrameOptions,
): BandFeatureFrameV1[] {
  return results.map((result) => createBandFeatureFrame(result, options));
}
