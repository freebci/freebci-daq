import { useEffect, useState, type ChangeEvent, type KeyboardEvent } from 'react';
import {
  EEG_LIVE_WINDOW_MAX_SECONDS,
  EEG_LIVE_WINDOW_MIN_SECONDS,
} from '../config/eeg';
import type { Locale } from '../i18n';
import { t } from '../i18n';
import { useEegStore } from '../store/eegStore';
import { Card, CardBody, CardHeader, Field, NumberInput } from './ui';

interface LiveWindowControlPanelProps {
  locale: Locale;
}

function clampWindowSeconds(seconds: number): number {
  if (!Number.isFinite(seconds)) return 300;
  return Math.max(
    EEG_LIVE_WINDOW_MIN_SECONDS,
    Math.min(EEG_LIVE_WINDOW_MAX_SECONDS, Math.round(seconds)),
  );
}

export function LiveWindowControlPanel({ locale }: LiveWindowControlPanelProps) {
  const liveWindowSeconds = useEegStore((state) => state.analysis.liveWindowSeconds);
  const setLiveWindowSeconds = useEegStore((state) => state.setLiveWindowSeconds);
  const [windowDraft, setWindowDraft] = useState(String(liveWindowSeconds));

  useEffect(() => {
    setWindowDraft(String(liveWindowSeconds));
  }, [liveWindowSeconds]);

  function commitWindowSeconds(raw: string): void {
    const next = clampWindowSeconds(Number(raw));
    setLiveWindowSeconds(next);
    setWindowDraft(String(next));
  }

  function handleWindowSecondsChange(event: ChangeEvent<HTMLInputElement>): void {
    const raw = event.currentTarget.value;
    setWindowDraft(raw);

    const parsed = Number(raw);
    if (
      Number.isFinite(parsed) &&
      parsed >= EEG_LIVE_WINDOW_MIN_SECONDS &&
      parsed <= EEG_LIVE_WINDOW_MAX_SECONDS
    ) {
      setLiveWindowSeconds(Math.round(parsed));
    }
  }

  function handleWindowSecondsKeyDown(event: KeyboardEvent<HTMLInputElement>): void {
    if (event.key !== 'Enter') return;
    commitWindowSeconds(event.currentTarget.value);
    event.currentTarget.blur();
  }

  return (
    <Card ariaLabelledBy="live-window-control-title">
      <CardHeader
        eyebrow={t(locale, 'page.live')}
        title={t(locale, 'chart.windowSecondsLabel')}
        titleId="live-window-control-title"
      />
      <CardBody>
        <Field
          label={t(locale, 'chart.windowSecondsLabel')}
          htmlFor="live-window-seconds"
          hint={t(locale, 'chart.windowSecondsHint')}
        >
          <NumberInput
            id="live-window-seconds"
            min={EEG_LIVE_WINDOW_MIN_SECONDS}
            max={EEG_LIVE_WINDOW_MAX_SECONDS}
            step={1}
            value={windowDraft}
            onChange={handleWindowSecondsChange}
            onBlur={(event) => commitWindowSeconds(event.currentTarget.value)}
            onKeyDown={handleWindowSecondsKeyDown}
          />
        </Field>
      </CardBody>
    </Card>
  );
}
