import { EEG_SAMPLE_RATE_HZ } from '../config/eeg';
import { createButterworthBandpassFilter, notchBiquad } from './butterworthFilter';
import {
  EegFilterChain,
  FirstOrderHighPassFilter,
  FirstOrderLowPassFilter,
  type EegFilter,
} from './eegFilters';

export type EegFilterId = 'first-order-iir' | 'high-order-iir';

export const HIGH_ORDER_IIR_DEFAULT_ORDER = 4;
const MAINS_NOTCH_FREQUENCY_HZ = 50;
const MAINS_NOTCH_Q = 30;

export interface NumberParamSchema {
  kind: 'number';
  key: string;
  labelZh: string;
  labelEn: string;
  min: number;
  max: number;
  step: number;
  default: number;
  unit?: string;
}

export type FilterParamSchema = NumberParamSchema;

export interface EegFilterDefinition {
  id: EegFilterId;
  labelZh: string;
  labelEn: string;
  descriptionZh: string;
  descriptionEn: string;
  params: FilterParamSchema[];
  create: (params: Record<string, number>, sampleRateHz: number) => EegFilter;
}

const SHARED_BANDPASS_PARAMS: readonly NumberParamSchema[] = [
  {
    kind: 'number',
    key: 'hpCutoffHz',
    labelZh: '高通截止',
    labelEn: 'High-pass cutoff',
    min: 0.1,
    max: 10,
    step: 0.1,
    default: 0.5,
    unit: 'Hz',
  },
  {
    kind: 'number',
    key: 'lpCutoffHz',
    labelZh: '低通截止',
    labelEn: 'Low-pass cutoff',
    min: 10,
    max: 100,
    step: 1,
    default: 45,
    unit: 'Hz',
  },
];

function readCutoffs(params: Record<string, number>): { hp: number; lp: number } {
  const hp = params.hpCutoffHz ?? 0.5;
  const lp = params.lpCutoffHz ?? 45;
  return { hp, lp };
}

function createFirstOrderIir(
  params: Record<string, number>,
  sampleRateHz: number,
): EegFilter {
  const { hp, lp } = readCutoffs(params);
  return new EegFilterChain([
    notchBiquad(MAINS_NOTCH_FREQUENCY_HZ, sampleRateHz, MAINS_NOTCH_Q),
    new FirstOrderHighPassFilter(hp, sampleRateHz),
    new FirstOrderLowPassFilter(lp, sampleRateHz),
  ]);
}

function createHighOrderIir(
  params: Record<string, number>,
  sampleRateHz: number,
): EegFilter {
  const { hp, lp } = readCutoffs(params);
  return new EegFilterChain([
    notchBiquad(MAINS_NOTCH_FREQUENCY_HZ, sampleRateHz, MAINS_NOTCH_Q),
    createButterworthBandpassFilter({
      hpCutoffHz: hp,
      lpCutoffHz: lp,
      sampleRateHz,
      order: HIGH_ORDER_IIR_DEFAULT_ORDER,
    }),
  ]);
}

export const EEG_FILTER_REGISTRY: readonly EegFilterDefinition[] = [
  {
    id: 'first-order-iir',
    labelZh: '1阶 IIR',
    labelEn: '1st-order IIR',
    descriptionZh: '50Hz 陷波 + 一阶 RC 高通/低通,滚降 6 dB/oct。作为轻量基线实现。',
    descriptionEn:
      '50Hz notch + first-order RC HP/LP, 6 dB/oct roll-off. Serves as the lightweight comparison baseline.',
    params: [...SHARED_BANDPASS_PARAMS],
    create: createFirstOrderIir,
  },
  {
    id: 'high-order-iir',
    labelZh: '高阶 IIR(默认)',
    labelEn: 'High-order IIR (default)',
    descriptionZh:
      '50Hz 陷波 + 4 阶 Butterworth 级联高通/低通。只开放截止频率,阶数固定以减少误操作。',
    descriptionEn:
      '50Hz notch + fixed 4th-order cascaded Butterworth HP/LP. Only cutoff frequencies are adjustable.',
    params: [...SHARED_BANDPASS_PARAMS],
    create: createHighOrderIir,
  },
];

export const EEG_FILTER_IDS: readonly EegFilterId[] = EEG_FILTER_REGISTRY.map(
  (definition) => definition.id,
);

export const DEFAULT_FILTER_ID: EegFilterId = 'high-order-iir';

export function getFilterDefinition(id: EegFilterId): EegFilterDefinition {
  const definition = EEG_FILTER_REGISTRY.find((entry) => entry.id === id);

  if (!definition) {
    throw new Error(`Unknown EEG filter id: ${id}`);
  }

  return definition;
}

export function getFilterDefaultParams(id: EegFilterId): Record<string, number> {
  return Object.fromEntries(
    getFilterDefinition(id).params.map((schema) => [schema.key, schema.default]),
  );
}

export function createFilterById(
  id: EegFilterId,
  params: Record<string, number>,
  sampleRateHz: number = EEG_SAMPLE_RATE_HZ,
): EegFilter {
  return getFilterDefinition(id).create(params, sampleRateHz);
}
