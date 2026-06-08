import { describe, expect, it } from 'vitest';
import { aggregateHeatmapSiteValues, getCoordinateSiteValues } from '../src/analysis/brainHeatmap';
import { useEegStore } from '../src/store/eegStore';
import type { EegAnalysisResult, EegHeatmapFrame } from '../src/types/eeg';

function frame(
  siteName: string,
  timeSeconds: number,
  alpha: number,
  beta = 0,
): EegHeatmapFrame {
  return {
    siteName,
    channelName: 'ch0',
    timeSeconds,
    sampleIndex: Math.round(timeSeconds * 250),
    bandPowers: {
      delta: 0,
      theta: 0,
      alpha,
      beta,
      gamma: 0,
    },
    engagementIndex: beta,
    updatedAt: new Date(timeSeconds * 1000).toISOString(),
  };
}

function result(timeSeconds: number, alpha: number): EegAnalysisResult {
  return {
    channelName: 'ch0',
    bandPowers: {
      delta: 1,
      theta: 2,
      alpha,
      beta: 4,
      gamma: 5,
    },
    engagementIndex: 0.5,
    windowSampleCount: 500,
    sampleIndex: Math.round(timeSeconds * 250),
    timeSeconds,
    updatedAt: new Date(timeSeconds * 1000).toISOString(),
    spectrum: { binHz: 1, powers: [] },
  };
}

describe('brain heatmap aggregation', () => {
  it('averages frames by site and channel inside the selected window', () => {
    const values = aggregateHeatmapSiteValues({
      frames: [frame('Cz', 1, 1), frame('Cz', 2, 3), frame('Pz', 2, 5)],
      metric: 'alpha',
      latestTimeSeconds: 2,
      windowSeconds: 5,
    });

    expect(values).toEqual([
      expect.objectContaining({ siteName: 'Cz', channelName: 'ch0', value: 2, sampleCount: 2 }),
      expect.objectContaining({ siteName: 'Pz', channelName: 'ch0', value: 5, sampleCount: 1 }),
    ]);
  });

  it('excludes frames outside the current live window', () => {
    const values = aggregateHeatmapSiteValues({
      frames: [frame('Cz', 1, 1), frame('Cz', 10, 9)],
      metric: 'alpha',
      latestTimeSeconds: 10,
      windowSeconds: 3,
    });

    expect(values).toHaveLength(1);
    expect(values[0]).toMatchObject({ siteName: 'Cz', value: 9, sampleCount: 1 });
  });

  it('keeps unknown sites out of coordinate interpolation', () => {
    const values = aggregateHeatmapSiteValues({
      frames: [frame('custom', 1, 1), frame('Cz', 1, 2)],
      metric: 'alpha',
      latestTimeSeconds: 1,
      windowSeconds: 5,
    });

    expect(values.find((value) => value.siteName === 'custom')).toMatchObject({
      x: null,
      y: null,
    });
    expect(getCoordinateSiteValues(values).map((value) => value.siteName)).toEqual(['Cz']);
  });
});

describe('brain heatmap store', () => {
  it('records frames using the supplied acquisition binding', () => {
    useEegStore.getState().reset();

    useEegStore.getState().recordHeatmapAnalysisResults(
      { siteName: 'Pz', channelName: 'ch0' },
      [result(1, 7)],
    );

    expect(useEegStore.getState().brainHeatmap.frames[0]).toMatchObject({
      siteName: 'Pz',
      channelName: 'ch0',
      timeSeconds: 1,
      bandPowers: expect.objectContaining({ alpha: 7 }),
    });
  });

  it('updates metric and clears current heatmap frames', () => {
    useEegStore.getState().reset();
    useEegStore.getState().recordHeatmapAnalysisResults(
      { siteName: 'Cz', channelName: 'ch0' },
      [result(1, 1)],
    );

    useEegStore.getState().setBrainHeatmapMetric('beta');
    useEegStore.getState().clearBrainHeatmap();

    expect(useEegStore.getState().brainHeatmap.metric).toBe('beta');
    expect(useEegStore.getState().brainHeatmap.frames).toHaveLength(0);
  });

  it('clears heatmap frames when stream runtime stops or resets', () => {
    useEegStore.getState().reset();
    useEegStore.getState().recordHeatmapAnalysisResults(
      { siteName: 'Cz', channelName: 'ch0' },
      [result(1, 1)],
    );

    useEegStore.getState().setStreamInactive();
    expect(useEegStore.getState().brainHeatmap.frames).toHaveLength(0);

    useEegStore.getState().recordHeatmapAnalysisResults(
      { siteName: 'Cz', channelName: 'ch0' },
      [result(1, 1)],
    );
    useEegStore.getState().resetStreamRuntime();
    expect(useEegStore.getState().brainHeatmap.frames).toHaveLength(0);
  });
});
