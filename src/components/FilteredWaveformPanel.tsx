import type { Locale } from '../i18n';
import { filteredWaveformBus } from '../state/filteredWaveformBus';
import { WaveformPanel } from './WaveformPanel';

interface FilteredWaveformPanelProps {
  locale: Locale;
}

export function FilteredWaveformPanel({ locale }: FilteredWaveformPanelProps) {
  return (
    <WaveformPanel
      locale={locale}
      bus={filteredWaveformBus}
      drawingKey="filteredWaveform"
      ariaLabelledBy="filtered-waveform-title"
      titleId="filtered-waveform-title"
      eyebrowKey="filteredWave.eyebrow"
      titleKey="filteredWave.title"
      emptyKey="filteredWave.empty"
      strokeColor="#0e7c66"
      secondaryStrokeColor="#b45309"
      hairlineColor="#e8e6e0"
      metaColor="#6b6b6b"
      zeroLineColor="#a8a8a8"
    />
  );
}
