import type { EegBandPowers } from '../types/eeg';

export function calculateEngagementIndex(bandPowers: EegBandPowers): number | null {
  const denominator = bandPowers.alpha + bandPowers.theta;

  if (denominator <= 0) {
    return null;
  }

  return bandPowers.beta / denominator;
}
