import { Camera, X } from 'lucide-react';
import { useEffect, useRef } from 'react';
import type { Locale } from '../i18n';
import { t } from '../i18n';
import { useEegStore } from '../store/eegStore';
import { Button, Card, CardBody, CardHeader } from './ui';

interface SpectrumComparePanelProps {
  locale: Locale;
}

const CANVAS_WIDTH = 900;
const CANVAS_HEIGHT = 280;
const PLOT_LEFT = 56;
const PLOT_RIGHT = 16;
const PLOT_TOP = 16;
const PLOT_BOTTOM = 240;
const PLOT_WIDTH = CANVAS_WIDTH - PLOT_LEFT - PLOT_RIGHT;
const PLOT_HEIGHT = PLOT_BOTTOM - PLOT_TOP;
const FREQ_AXIS_Y = PLOT_BOTTOM + 14;
const MAX_HZ = 30;
const FREQ_TICKS = [0, 5, 10, 15, 20, 25, 30];

const HAIRLINE = '#e8e6e0';
const META = '#6b6b6b';
const CURRENT_FILL = '#3730a3';
const REFERENCE_STROKE = '#b04a3a';

function formatPower(value: number): string {
  if (value === 0) return '0';
  const abs = Math.abs(value);
  if (abs >= 1) return value.toFixed(2);
  if (abs >= 1e-3) return `${(value * 1e3).toFixed(2)}m`;
  if (abs >= 1e-6) return `${(value * 1e6).toFixed(2)}µ`;
  return value.toExponential(1);
}

export function SpectrumComparePanel({ locale }: SpectrumComparePanelProps) {
  const spectrum = useEegStore((s) => s.analysis.spectrum);
  const reference = useEegStore((s) => s.analysis.referenceSpectrum);
  const captureSnapshot = useEegStore((s) => s.captureSpectrumSnapshot);
  const clearSnapshot = useEegStore((s) => s.clearSpectrumSnapshot);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = CANVAS_WIDTH * dpr;
    canvas.height = CANVAS_HEIGHT * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    ctx.clearRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);

    ctx.strokeStyle = HAIRLINE;
    ctx.lineWidth = 1;
    ctx.strokeRect(PLOT_LEFT + 0.5, PLOT_TOP + 0.5, PLOT_WIDTH - 1, PLOT_HEIGHT - 1);

    ctx.strokeStyle = HAIRLINE;
    ctx.beginPath();
    ctx.moveTo(PLOT_LEFT, FREQ_AXIS_Y);
    ctx.lineTo(PLOT_LEFT + PLOT_WIDTH, FREQ_AXIS_Y);
    ctx.stroke();
    ctx.fillStyle = META;
    ctx.font = '11px ui-monospace, "JetBrains Mono", monospace';
    ctx.textBaseline = 'top';
    for (const hz of FREQ_TICKS) {
      const x = PLOT_LEFT + (hz / MAX_HZ) * PLOT_WIDTH;
      ctx.beginPath();
      ctx.moveTo(x, FREQ_AXIS_Y - 3);
      ctx.lineTo(x, FREQ_AXIS_Y + 3);
      ctx.stroke();
      ctx.textAlign = hz === 0 ? 'left' : hz === MAX_HZ ? 'right' : 'center';
      ctx.fillText(`${hz}Hz`, x, FREQ_AXIS_Y + 6);
    }

    if (!spectrum && !reference) {
      ctx.fillStyle = META;
      ctx.font = '12px ui-monospace, "JetBrains Mono", monospace';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(
        t(locale, 'spectrumCompare.empty'),
        PLOT_LEFT + PLOT_WIDTH / 2,
        PLOT_TOP + PLOT_HEIGHT / 2,
      );
      return;
    }

    const sliceUpTo = (binHz: number, powers: number[]) => {
      const lastBinIndex = Math.min(powers.length - 1, Math.floor(MAX_HZ / binHz));
      return { lastBinIndex, binHz };
    };

    let maxPower = 0;
    if (spectrum) {
      const { lastBinIndex } = sliceUpTo(spectrum.binHz, spectrum.powers);
      for (let i = 1; i <= lastBinIndex; i += 1) {
        if (spectrum.powers[i] > maxPower) maxPower = spectrum.powers[i];
      }
    }
    if (reference) {
      const { lastBinIndex } = sliceUpTo(reference.binHz, reference.powers);
      for (let i = 1; i <= lastBinIndex; i += 1) {
        if (reference.powers[i] > maxPower) maxPower = reference.powers[i];
      }
    }
    if (maxPower === 0) maxPower = 1e-12;

    ctx.fillStyle = META;
    ctx.font = '11px ui-monospace, "JetBrains Mono", monospace';
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';
    ctx.fillText(formatPower(maxPower), PLOT_LEFT - 8, PLOT_TOP + 4);
    ctx.fillText('0', PLOT_LEFT - 8, PLOT_BOTTOM - 4);
    ctx.fillText(formatPower(maxPower / 2), PLOT_LEFT - 8, PLOT_TOP + PLOT_HEIGHT / 2);

    ctx.save();
    ctx.beginPath();
    ctx.rect(PLOT_LEFT, PLOT_TOP, PLOT_WIDTH, PLOT_HEIGHT);
    ctx.clip();

    const drawBars = (
      binHz: number,
      powers: number[],
      style: 'fill' | 'stroke',
    ): void => {
      const lastBinIndex = Math.min(powers.length - 1, Math.floor(MAX_HZ / binHz));
      const barWidth = Math.max(1, (PLOT_WIDTH * binHz) / MAX_HZ - 1);
      for (let i = 1; i <= lastBinIndex; i += 1) {
        const hz = i * binHz;
        const x = PLOT_LEFT + (hz / MAX_HZ) * PLOT_WIDTH - barWidth / 2;
        const h = (powers[i] / maxPower) * PLOT_HEIGHT;
        const y = PLOT_BOTTOM - h;
        if (style === 'fill') {
          ctx.fillStyle = CURRENT_FILL;
          ctx.globalAlpha = 0.85;
          ctx.fillRect(x, y, barWidth, h);
          ctx.globalAlpha = 1;
        } else {
          ctx.strokeStyle = REFERENCE_STROKE;
          ctx.lineWidth = 1.2;
          ctx.setLineDash([3, 3]);
          ctx.strokeRect(x + 0.5, y + 0.5, barWidth - 1, h - 1);
          ctx.setLineDash([]);
        }
      }
    };

    if (spectrum) {
      drawBars(spectrum.binHz, spectrum.powers, 'fill');
    }
    if (reference) {
      drawBars(reference.binHz, reference.powers, 'stroke');
    }

    ctx.restore();
  }, [spectrum, reference, locale]);

  const canSnapshot = spectrum !== null;
  const canClear = reference !== null;

  return (
    <Card ariaLabelledBy="spectrum-compare-title">
      <CardHeader
        eyebrow={t(locale, 'spectrumCompare.eyebrow')}
        title={t(locale, 'spectrumCompare.title')}
        titleId="spectrum-compare-title"
        trailing={
          <div className="flex items-center gap-2">
            <Button variant="ghost" onClick={captureSnapshot} disabled={!canSnapshot}>
              <Camera size={14} strokeWidth={1.5} />
              {t(locale, 'spectrumCompare.snapshot')}
            </Button>
            <Button variant="ghost" onClick={clearSnapshot} disabled={!canClear}>
              <X size={14} strokeWidth={1.5} />
              {t(locale, 'spectrumCompare.clear')}
            </Button>
          </div>
        }
      />
      <CardBody className="flex flex-col gap-3">
        <div className="rounded-md border border-hairline bg-card overflow-hidden">
          <canvas
            ref={canvasRef}
            style={{ width: '100%', height: `${CANVAS_HEIGHT}px`, display: 'block' }}
            aria-label={t(locale, 'spectrumCompare.title')}
            role="img"
          />
        </div>
        <div className="flex flex-wrap items-center gap-4 font-mono text-[0.72rem] text-meta tabular">
          <span className="flex items-center gap-1.5">
            <span
              aria-hidden
              className="inline-block h-2.5 w-3"
              style={{ background: CURRENT_FILL, opacity: 0.85 }}
            />
            {t(locale, 'spectrumCompare.legendCurrent')}
          </span>
          <span className="flex items-center gap-1.5">
            <span
              aria-hidden
              className="inline-block h-2.5 w-3 border"
              style={{ borderColor: REFERENCE_STROKE, borderStyle: 'dashed' }}
            />
            {t(locale, 'spectrumCompare.legendReference')}
          </span>
          {reference && (
            <span>
              {t(locale, 'spectrumCompare.referenceLabel')}: {reference.filterLabel}
            </span>
          )}
        </div>
      </CardBody>
    </Card>
  );
}
