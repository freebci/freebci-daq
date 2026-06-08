import type { Locale } from '../i18n';
import { rawWaveformBus } from '../state/rawWaveformBus';
import { WaveformPanel } from './WaveformPanel';

interface RawWaveformPanelProps {
  locale: Locale;
}

export function RawWaveformPanel({ locale }: RawWaveformPanelProps) {
  return (
    <WaveformPanel
      locale={locale}
      bus={rawWaveformBus}
      drawingKey="rawWaveform"
      ariaLabelledBy="raw-waveform-title"
      titleId="raw-waveform-title"
      eyebrowKey="rawWave.eyebrow"
      titleKey="rawWave.title"
      emptyKey="rawWave.empty"
      strokeColor="#0e7490"
      secondaryStrokeColor="#b45309"
      hairlineColor="#d4d4d8"
      metaColor="#525252"
      zeroLineColor="#8a8a8a"
    />
  );
}
