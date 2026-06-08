/*
 * Engagement Index (EI) = β / (α + θ)
 *
 * Reference:
 *   Pope, A. T., Bogart, E. H., & Bartolome, D. S. (1995).
 *   Biocybernetic system evaluates indices of operator engagement in
 *   automated task. Biological Psychology, 40(1–2), 187–195.
 */
import type { EegBandPowers } from '../types/eeg';

export function calculateEngagementIndex(bandPowers: EegBandPowers): number | null {
  const denominator = bandPowers.alpha + bandPowers.theta;

  if (denominator <= 0) {
    return null;
  }

  return bandPowers.beta / denominator;
}
