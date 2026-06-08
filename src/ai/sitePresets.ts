import { CUSTOM_PRESET_VALUE, type LocalizedOption } from './modelPresets';

export const PLACEMENT_SYSTEM_OPTIONS = [
  { value: '10-20', labelZh: '国际 10-20 系统', labelEn: 'International 10-20 system' },
  { value: '10-10', labelZh: '国际 10-10 系统', labelEn: 'International 10-10 system' },
  { value: CUSTOM_PRESET_VALUE, labelZh: '未指定/自定义', labelEn: 'Unspecified/custom' },
] as const satisfies readonly LocalizedOption[];

const TEN_TWENTY_SITES: readonly LocalizedOption[] = [
  'Fp1',
  'Fp2',
  'F7',
  'F3',
  'Fz',
  'F4',
  'F8',
  'T3',
  'C3',
  'Cz',
  'C4',
  'T4',
  'T5',
  'P3',
  'Pz',
  'P4',
  'T6',
  'O1',
  'O2',
].map((site) => ({ value: site, labelZh: site, labelEn: site }));

const TEN_TEN_EXTRA_SITES: readonly LocalizedOption[] = [
  'AF3',
  'AF4',
  'FC5',
  'FC1',
  'FC2',
  'FC6',
  'CP5',
  'CP1',
  'CP2',
  'CP6',
  'PO3',
  'PO4',
].map((site) => ({ value: site, labelZh: site, labelEn: site }));

export function getSiteOptions(placementSystem: string): readonly LocalizedOption[] {
  const base = [
    { value: CUSTOM_PRESET_VALUE, labelZh: '未指定/自定义点位', labelEn: 'Unspecified/custom site' },
    ...TEN_TWENTY_SITES,
  ];
  if (placementSystem === '10-10') {
    return [...base, ...TEN_TEN_EXTRA_SITES].sort((a, b) => a.value.localeCompare(b.value));
  }
  return base;
}
