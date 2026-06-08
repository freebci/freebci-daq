import type { EegAlgorithmId, EegBandPowers } from '../types/eeg';
import { calculateEngagementIndex } from './engagementIndex';

export const EEG_ANALYSIS_ALGORITHMS: readonly EegAlgorithmId[] = ['engagement-index'];

export function calculateAlgorithmScore(
  algorithmId: EegAlgorithmId,
  bandPowers: EegBandPowers,
): number | null {
  switch (algorithmId) {
    case 'engagement-index':
      return calculateEngagementIndex(bandPowers);
    default:
      return null;
  }
}

export { calculateEngagementIndex };
