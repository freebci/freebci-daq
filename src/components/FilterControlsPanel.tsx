import { RotateCcw } from 'lucide-react';
import {
  DEFAULT_FILTER_ID,
  HIGH_ORDER_IIR_DEFAULT_ORDER,
  getFilterDefinition,
  type EegFilterId,
  type FilterParamSchema,
} from '../analysis/filterRegistry';
import { getAutoFftSizeForSampleRate } from '../analysis/fftConfig';
import type { Locale } from '../i18n';
import { t } from '../i18n';
import { useEegStore } from '../store/eegStore';
import { getEffectiveEegHardwareSampleRateHz } from '../transport/eegHardwareConfig';
import { Button, Card, CardBody, CardHeader, Field, NumberInput } from './ui';

interface FilterControlsPanelProps {
  locale: Locale;
}

function paramLabel(schema: FilterParamSchema, locale: Locale): string {
  return locale === 'zh-CN' ? schema.labelZh : schema.labelEn;
}

function filterDescription(id: EegFilterId, locale: Locale): string {
  const def = getFilterDefinition(id);
  return locale === 'zh-CN' ? def.descriptionZh : def.descriptionEn;
}

export function FilterControlsPanel({ locale }: FilterControlsPanelProps) {
  const selectedFilterId = DEFAULT_FILTER_ID;
  const filterParams = useEegStore((s) => s.analysis.filterParams);
  const setFilterParam = useEegStore((s) => s.setFilterParam);
  const resetFilterParams = useEegStore((s) => s.resetFilterParams);
  const sampleRateHz = useEegStore((s) =>
    getEffectiveEegHardwareSampleRateHz(s.acquisition.hardwareConfig),
  );

  const definition = getFilterDefinition(selectedFilterId);
  const autoFftSize = getAutoFftSizeForSampleRate(sampleRateHz);

  return (
    <Card ariaLabelledBy="filter-title">
      <CardHeader
        eyebrow={t(locale, 'filter.eyebrow')}
        title={t(locale, 'filter.title')}
        titleId="filter-title"
      />
      <CardBody className="flex flex-col gap-5">
        <div className="grid gap-3 sm:grid-cols-2">
          <ReadOnlyMetric
            label={t(locale, 'filter.fixedFilterLabel')}
            value={t(locale, 'filter.fixedFilterValue', {
              order: HIGH_ORDER_IIR_DEFAULT_ORDER,
            })}
          />
          <ReadOnlyMetric
            label={t(locale, 'filter.autoFftSizeLabel')}
            value={`${autoFftSize}`}
          />
        </div>

        <p className="m-0 text-[0.8rem] text-meta leading-relaxed">
          {filterDescription(selectedFilterId, locale)}
        </p>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {definition.params.map((schema) => {
            const value = filterParams[schema.key] ?? schema.default;
            const inputId = `filter-param-${schema.key}`;
            return (
              <Field
                key={schema.key}
                label={paramLabel(schema, locale)}
                htmlFor={inputId}
                hint={
                  schema.unit
                    ? `${schema.min}–${schema.max} ${schema.unit}`
                    : `${schema.min}–${schema.max}`
                }
              >
                <NumberInput
                  id={inputId}
                  min={schema.min}
                  max={schema.max}
                  step={schema.step}
                  value={value}
                  onChange={(e) => {
                    const next = Number(e.target.value);
                    if (Number.isFinite(next)) {
                      setFilterParam(schema.key, next);
                    }
                  }}
                />
              </Field>
            );
          })}
        </div>

        <div className="flex flex-wrap items-center gap-2 border-t border-hairline pt-4">
          <Button variant="ghost" onClick={resetFilterParams}>
            <RotateCcw size={14} strokeWidth={1.5} />
            {t(locale, 'filter.resetDefaults')}
          </Button>
          <p className="m-0 text-[0.78rem] text-meta">{t(locale, 'filter.rebuildHint')}</p>
        </div>
      </CardBody>
    </Card>
  );
}

interface ReadOnlyMetricProps {
  label: string;
  value: string;
}

function ReadOnlyMetric({ label, value }: ReadOnlyMetricProps) {
  return (
    <dl className="min-w-0 rounded-sm border border-hairline bg-surface-2 px-3 py-2.5">
      <dt className="font-mono text-[0.62rem] font-medium uppercase tracking-[0.08em] text-meta">
        {label}
      </dt>
      <dd className="m-0 mt-1 font-mono text-[0.9rem] text-ink tabular">
        {value}
      </dd>
    </dl>
  );
}
