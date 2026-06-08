import { describe, expect, it } from 'vitest';
import {
  DEFAULT_FILTER_ID,
  EEG_FILTER_IDS,
  EEG_FILTER_REGISTRY,
  HIGH_ORDER_IIR_DEFAULT_ORDER,
  createFilterById,
  getFilterDefaultParams,
  getFilterDefinition,
  type EegFilterId,
} from '../src/analysis/filterRegistry';

const ALL_REGISTERED_IDS: readonly EegFilterId[] = [
  'first-order-iir',
  'high-order-iir',
];

function measureSteadyPeak(
  filter: { reset: () => void; processSample: (v: number) => number },
  freqHz: number,
): number {
  filter.reset();
  const total = 250 * 6;
  const settle = Math.floor(total * 0.6);
  let peak = 0;
  for (let i = 0; i < total; i += 1) {
    const x = Math.sin((2 * Math.PI * freqHz * i) / 250);
    const y = filter.processSample(x);
    if (i >= settle) {
      peak = Math.max(peak, Math.abs(y));
    }
  }
  return peak;
}

describe('EEG_FILTER_REGISTRY', () => {
  it('exposes both IIR and Butterworth filters', () => {
    const ids = EEG_FILTER_REGISTRY.map((entry) => entry.id);
    expect(ids).toEqual(ALL_REGISTERED_IDS);
    expect(EEG_FILTER_IDS).toEqual(ALL_REGISTERED_IDS);
  });

  it('every entry declares hp + lp params with sane defaults', () => {
    for (const entry of EEG_FILTER_REGISTRY) {
      const keys = entry.params.map((p) => p.key);
      expect(keys).toContain('hpCutoffHz');
      expect(keys).toContain('lpCutoffHz');
      for (const param of entry.params) {
        expect(param.default).toBeGreaterThanOrEqual(param.min);
        expect(param.default).toBeLessThanOrEqual(param.max);
      }
    }
  });

  it('localized labels are non-empty in zh and en', () => {
    for (const entry of EEG_FILTER_REGISTRY) {
      expect(entry.labelZh.length).toBeGreaterThan(0);
      expect(entry.labelEn.length).toBeGreaterThan(0);
      expect(entry.descriptionZh.length).toBeGreaterThan(0);
      expect(entry.descriptionEn.length).toBeGreaterThan(0);
    }
  });

  it('uses high-order IIR order 4 as the default filter', () => {
    expect(DEFAULT_FILTER_ID).toBe('high-order-iir');
    expect(getFilterDefaultParams(DEFAULT_FILTER_ID)).toEqual({
      hpCutoffHz: 0.5,
      lpCutoffHz: 45,
    });
    expect(HIGH_ORDER_IIR_DEFAULT_ORDER).toBe(4);
  });
});

describe('getFilterDefinition', () => {
  it('returns the matching entry', () => {
    expect(getFilterDefinition('first-order-iir').id).toBe('first-order-iir');
    expect(getFilterDefinition('high-order-iir').id).toBe('high-order-iir');
  });

  it('throws on unknown id', () => {
    expect(() => getFilterDefinition('does-not-exist' as EegFilterId)).toThrow();
  });
});

describe('getFilterDefaultParams', () => {
  it('returns defaults keyed by schema key', () => {
    for (const id of ALL_REGISTERED_IDS) {
      const defaults = getFilterDefaultParams(id);
      const definition = getFilterDefinition(id);
      for (const param of definition.params) {
        expect(defaults[param.key]).toBe(param.default);
      }
    }
  });
});

describe('createFilterById', () => {
  it('builds runnable filters that process the single EEG channel', () => {
    for (const id of ALL_REGISTERED_IDS) {
      const filter = createFilterById(id, getFilterDefaultParams(id), 250);
      expect(Number.isFinite(filter.processSample(1))).toBe(true);
    }
  });

  it('uses param overrides when provided', () => {
    const filter = createFilterById(
      'first-order-iir',
      { hpCutoffHz: 5, lpCutoffHz: 20 },
      250,
    );
    expect(() => filter.processSample(0.1)).not.toThrow();
  });

  it('reset() does not throw', () => {
    for (const id of ALL_REGISTERED_IDS) {
      const filter = createFilterById(id, getFilterDefaultParams(id), 250);
      filter.processSample(1);
      expect(() => filter.reset()).not.toThrow();
    }
  });

  it('high-order-iir ignores order overrides and stays fixed at order 4', () => {
    const defaultFilter = createFilterById(
      'high-order-iir',
      getFilterDefaultParams('high-order-iir'),
      250,
    );
    const overrideFilter = createFilterById(
      'high-order-iir',
      { ...getFilterDefaultParams('high-order-iir'), order: 16 },
      250,
    );
    for (let i = 0; i < 100; i += 1) {
      const x = Math.sin((2 * Math.PI * 10 * i) / 250);
      expect(defaultFilter.processSample(x)).toBeCloseTo(overrideFilter.processSample(x), 10);
    }
  });

  it('default high-order-iir rejects 50 Hz while preserving 10 Hz', () => {
    const filter50Hz = createFilterById(
      'high-order-iir',
      getFilterDefaultParams('high-order-iir'),
      250,
    );
    const filter10Hz = createFilterById(
      'high-order-iir',
      getFilterDefaultParams('high-order-iir'),
      250,
    );

    expect(measureSteadyPeak(filter50Hz, 50)).toBeLessThan(0.02);
    expect(measureSteadyPeak(filter10Hz, 10)).toBeGreaterThan(0.85);
  });

  it('fixed high-order-iir stays bounded under step + 50 Hz drive', () => {
    const filter = createFilterById(
      'high-order-iir',
      { hpCutoffHz: 1, lpCutoffHz: 30, order: 16 },
      250,
    );
    let maxAbs = 0;
    for (let i = 0; i < 250 * 5; i += 1) {
      const x = (i < 50 ? 1 : 0) + Math.sin((2 * Math.PI * 50 * i) / 250);
      const y = filter.processSample(x);
      expect(Number.isFinite(y)).toBe(true);
      maxAbs = Math.max(maxAbs, Math.abs(y));
    }
    expect(maxAbs).toBeLessThan(20);
  });
});
