import { useEffect, useState, type ChangeEvent, type KeyboardEvent } from 'react';
import { RotateCcw } from 'lucide-react';
import {
  EEG_INITIAL_UNRELIABLE_MAX_SECONDS,
  EEG_INITIAL_UNRELIABLE_MIN_SECONDS,
} from '../config/eeg';
import type { Locale } from '../i18n';
import { t } from '../i18n';
import { useEegStore } from '../store/eegStore';
import { Button, Card, CardBody, CardHeader, Field, NumberInput } from './ui';

interface AnalysisTuningPanelProps {
  locale: Locale;
}

interface NumberSettingFieldProps {
  id: string;
  label: string;
  hint: string;
  value: number;
  min?: number;
  max?: number;
  step: number;
  onCommit: (value: number) => void;
}

function parseDraftNumber(raw: string): number | null {
  if (raw.trim().length === 0) return null;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : null;
}

function normalizeDraftNumber(raw: string, min?: number, max?: number): number | null {
  const parsed = parseDraftNumber(raw);
  if (parsed === null) return null;
  return Math.max(min ?? -Infinity, Math.min(max ?? Infinity, parsed));
}

function NumberSettingField({
  id,
  label,
  hint,
  value,
  min,
  max,
  step,
  onCommit,
}: NumberSettingFieldProps) {
  const [draft, setDraft] = useState(String(value));

  useEffect(() => {
    setDraft(String(value));
  }, [value]);

  function commit(raw: string): void {
    const next = normalizeDraftNumber(raw, min, max);
    if (next === null) {
      setDraft(String(value));
      return;
    }
    setDraft(String(next));
    onCommit(next);
  }

  function handleChange(event: ChangeEvent<HTMLInputElement>): void {
    setDraft(event.currentTarget.value);
  }

  function handleKeyDown(event: KeyboardEvent<HTMLInputElement>): void {
    if (event.key !== 'Enter') return;
    commit(event.currentTarget.value);
    event.currentTarget.blur();
  }

  return (
    <Field label={label} htmlFor={id} hint={hint}>
      <NumberInput
        id={id}
        min={min}
        max={max}
        step={step}
        value={draft}
        onChange={handleChange}
        onBlur={(event) => commit(event.currentTarget.value)}
        onKeyDown={handleKeyDown}
      />
    </Field>
  );
}

export function AnalysisTuningPanel({ locale }: AnalysisTuningPanelProps) {
  const engagementEmaAlpha = useEegStore((state) => state.analysis.engagementEmaAlpha);
  const engagementAlertThreshold = useEegStore(
    (state) => state.analysis.engagementAlertThreshold,
  );
  const initialUnreliableSeconds = useEegStore(
    (state) => state.analysis.initialUnreliableSeconds,
  );
  const setEngagementEmaAlpha = useEegStore((state) => state.setEngagementEmaAlpha);
  const setEngagementAlertThreshold = useEegStore(
    (state) => state.setEngagementAlertThreshold,
  );
  const setInitialUnreliableSeconds = useEegStore(
    (state) => state.setInitialUnreliableSeconds,
  );
  const resetAnalysisTuning = useEegStore((state) => state.resetAnalysisTuning);

  return (
    <Card ariaLabelledBy="analysis-tuning-title">
      <CardHeader
        eyebrow={t(locale, 'analysisTuning.eyebrow')}
        title={t(locale, 'analysisTuning.title')}
        titleId="analysis-tuning-title"
        trailing={
          <Button size="sm" variant="ghost" onClick={resetAnalysisTuning}>
            <RotateCcw size={14} strokeWidth={1.5} />
            {t(locale, 'analysisTuning.resetDefaults')}
          </Button>
        }
      />
      <CardBody className="space-y-3">
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          <NumberSettingField
            id="analysis-tuning-ema-alpha"
            label={t(locale, 'analysisTuning.emaAlphaLabel')}
            hint={t(locale, 'analysisTuning.emaAlphaHint')}
            value={engagementEmaAlpha}
            min={0}
            max={1}
            step={0.01}
            onCommit={setEngagementEmaAlpha}
          />
          <NumberSettingField
            id="analysis-tuning-alert-threshold"
            label={t(locale, 'trend.alertThresholdLabel')}
            hint={t(locale, 'analysisTuning.alertThresholdHint')}
            value={engagementAlertThreshold}
            min={0}
            step={0.05}
            onCommit={setEngagementAlertThreshold}
          />
          <NumberSettingField
            id="analysis-tuning-initial-unreliable"
            label={t(locale, 'analysisTuning.initialUnreliableLabel')}
            hint={t(locale, 'analysisTuning.initialUnreliableHint')}
            value={initialUnreliableSeconds}
            min={EEG_INITIAL_UNRELIABLE_MIN_SECONDS}
            max={EEG_INITIAL_UNRELIABLE_MAX_SECONDS}
            step={5}
            onCommit={setInitialUnreliableSeconds}
          />
        </div>
        <p className="m-0 text-[0.82rem] leading-snug text-meta">
          {t(locale, 'analysisTuning.runtimeNote')}
        </p>
      </CardBody>
    </Card>
  );
}
