import { Trash2 } from 'lucide-react';
import { useMemo } from 'react';
import {
  aggregateHeatmapSiteValues,
  getCoordinateSiteValues,
  type EegSiteCoordinate,
} from '../analysis/brainHeatmap';
import type { Locale } from '../i18n';
import { t } from '../i18n';
import { useAiStore } from '../store/aiStore';
import { useEegStore } from '../store/eegStore';
import type { EegHeatmapMetric, EegHeatmapSiteValue } from '../types/eeg';
import { formatAnalysisMetric } from '../utils/analysisFormat';
import { Button, Card, CardBody, CardHeader, Field, ToggleSwitch } from './ui';

interface BrainHeatmapPanelProps {
  locale: Locale;
}

interface HeatmapCell {
  x: number;
  y: number;
  value: number;
}

const SVG_WIDTH = 620;
const SVG_HEIGHT = 430;
const HEAD_LEFT = 175;
const HEAD_TOP = 46;
const HEAD_SIZE = 270;
const GRID_SIZE = 30;
const METRIC_OPTIONS: EegHeatmapMetric[] = [
  'alpha',
  'beta',
  'theta',
  'delta',
  'gamma',
  'engagementIndex',
];

const SELECT_CLASS =
  'w-full rounded-sm border border-hairline bg-surface-2 px-3 py-2 font-mono text-[0.88rem] text-ink focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent focus-visible:border-accent disabled:bg-paper disabled:text-meta';

const EMPTY_FRAMES: never[] = [];

function metricLabel(locale: Locale, metric: EegHeatmapMetric): string {
  const keyByMetric: Record<EegHeatmapMetric, Parameters<typeof t>[1]> = {
    delta: 'brainHeatmap.metricDelta',
    theta: 'brainHeatmap.metricTheta',
    alpha: 'brainHeatmap.metricAlpha',
    beta: 'brainHeatmap.metricBeta',
    gamma: 'brainHeatmap.metricGamma',
    engagementIndex: 'brainHeatmap.metricEi',
  };

  return t(locale, keyByMetric[metric]);
}

function siteToSvgX(x: number): number {
  return HEAD_LEFT + x * HEAD_SIZE;
}

function siteToSvgY(y: number): number {
  return HEAD_TOP + y * HEAD_SIZE;
}

function isInsideHead(x: number, y: number): boolean {
  const dx = x - 0.5;
  const dy = y - 0.5;
  return dx * dx + dy * dy <= 0.25;
}

function getValueRange(values: readonly EegHeatmapSiteValue[]): { min: number; max: number } {
  let min = Infinity;
  let max = -Infinity;

  for (const value of values) {
    if (value.value < min) min = value.value;
    if (value.value > max) max = value.value;
  }

  if (!Number.isFinite(min) || !Number.isFinite(max)) {
    return { min: 0, max: 1 };
  }

  if (min === max) {
    const pad = Math.max(Math.abs(min) * 0.1, 1e-12);
    return { min: Math.max(0, min - pad), max: max + pad };
  }

  return { min, max };
}

function hexToRgb(hex: string): { r: number; g: number; b: number } {
  const normalized = hex.replace('#', '');
  return {
    r: Number.parseInt(normalized.slice(0, 2), 16),
    g: Number.parseInt(normalized.slice(2, 4), 16),
    b: Number.parseInt(normalized.slice(4, 6), 16),
  };
}

function mixColor(a: string, b: string, ratio: number): string {
  const ca = hexToRgb(a);
  const cb = hexToRgb(b);
  const clamped = Math.max(0, Math.min(1, ratio));
  const r = Math.round(ca.r + (cb.r - ca.r) * clamped);
  const g = Math.round(ca.g + (cb.g - ca.g) * clamped);
  const blue = Math.round(ca.b + (cb.b - ca.b) * clamped);
  return `rgb(${r} ${g} ${blue})`;
}

function valueToColor(value: number, min: number, max: number): string {
  const ratio = (value - min) / Math.max(max - min, Number.EPSILON);
  if (ratio < 0.5) {
    return mixColor('#2563eb', '#f8fafc', ratio * 2);
  }
  return mixColor('#f8fafc', '#dc2626', (ratio - 0.5) * 2);
}

function interpolateValue(
  values: readonly EegHeatmapSiteValue[],
  x: number,
  y: number,
): number {
  let weighted = 0;
  let weightSum = 0;

  for (const value of values) {
    const dx = x - (value.x ?? 0);
    const dy = y - (value.y ?? 0);
    const distanceSquared = dx * dx + dy * dy;

    if (distanceSquared < 0.0001) {
      return value.value;
    }

    const weight = 1 / distanceSquared;
    weighted += value.value * weight;
    weightSum += weight;
  }

  return weightSum === 0 ? 0 : weighted / weightSum;
}

function createHeatmapCells(values: readonly EegHeatmapSiteValue[]): HeatmapCell[] {
  if (values.length < 2) {
    return [];
  }

  const cells: HeatmapCell[] = [];
  for (let row = 0; row < GRID_SIZE; row += 1) {
    for (let col = 0; col < GRID_SIZE; col += 1) {
      const x = (col + 0.5) / GRID_SIZE;
      const y = (row + 0.5) / GRID_SIZE;
      if (!isInsideHead(x, y)) continue;
      cells.push({ x, y, value: interpolateValue(values, x, y) });
    }
  }
  return cells;
}

function coordinateKey(value: Pick<EegSiteCoordinate, 'x' | 'y'>): string {
  return `${value.x.toFixed(3)}-${value.y.toFixed(3)}`;
}

export function BrainHeatmapPanel({ locale }: BrainHeatmapPanelProps) {
  const isDrawingEnabled = useEegStore((state) => state.drawing.brainHeatmap);
  const setDrawingEnabled = useEegStore((state) => state.setDrawingEnabled);
  const metric = useEegStore((state) => state.brainHeatmap.metric);
  const frames = useEegStore((state) =>
    isDrawingEnabled ? state.brainHeatmap.frames : EMPTY_FRAMES,
  );
  const liveWindowSeconds = useEegStore((state) => state.analysis.liveWindowSeconds);
  const isStreamBusy = useEegStore(
    (state) => state.stream.isStarting || state.stream.isStreaming,
  );
  const setMetric = useEegStore((state) => state.setBrainHeatmapMetric);
  const clearHeatmap = useEegStore((state) => state.clearBrainHeatmap);
  const binding = useAiStore((state) => state.binding);
  const latestTimeSeconds = frames[frames.length - 1]?.timeSeconds ?? 0;
  const siteValues = useMemo(
    () =>
      aggregateHeatmapSiteValues({
        frames,
        metric,
        latestTimeSeconds,
        windowSeconds: liveWindowSeconds,
      }),
    [frames, latestTimeSeconds, liveWindowSeconds, metric],
  );
  const coordinateValues = useMemo(() => getCoordinateSiteValues(siteValues), [siteValues]);
  const unknownSiteValues = siteValues.filter((value) => value.x === null || value.y === null);
  const { min, max } = getValueRange(coordinateValues);
  const cells = useMemo(() => createHeatmapCells(coordinateValues), [coordinateValues]);
  const cellSize = HEAD_SIZE / GRID_SIZE;
  const hasData = siteValues.length > 0;
  const hasInterpolatedMap = coordinateValues.length >= 2;

  return (
    <Card ariaLabelledBy="brain-heatmap-title">
      <CardHeader
        eyebrow={t(locale, 'brainHeatmap.eyebrow')}
        title={t(locale, 'brainHeatmap.title')}
        titleId="brain-heatmap-title"
        trailing={
          <ToggleSwitch
            label={t(locale, 'chart.drawToggle')}
            checked={isDrawingEnabled}
            onCheckedChange={(checked) => setDrawingEnabled('brainHeatmap', checked)}
            disabled={!isStreamBusy}
          />
        }
      />
      <CardBody className="flex flex-col gap-4">
        <div className="grid gap-4 xl:grid-cols-[14rem_1fr_auto] xl:items-end">
          <Field label={t(locale, 'brainHeatmap.metricLabel')} htmlFor="brain-heatmap-metric">
            <select
              id="brain-heatmap-metric"
              value={metric}
              onChange={(event) => setMetric(event.currentTarget.value as EegHeatmapMetric)}
              className={SELECT_CLASS}
            >
              {METRIC_OPTIONS.map((option) => (
                <option key={option} value={option}>
                  {metricLabel(locale, option)}
                </option>
              ))}
            </select>
          </Field>
          <div className="min-w-0 rounded-sm border border-hairline bg-paper px-3 py-2">
            <div className="font-mono text-[0.65rem] uppercase tracking-[0.08em] text-meta">
              {t(locale, 'brainHeatmap.currentSite')}
            </div>
            <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-[0.85rem] text-ink">
              <span>{binding.siteName}</span>
              <span className="font-mono text-meta">{binding.channelName}</span>
              <span className="font-mono text-meta">
                {t(locale, 'chart.windowFixed', { seconds: liveWindowSeconds })}
              </span>
            </div>
          </div>
          <Button variant="ghost" onClick={clearHeatmap} disabled={!hasData}>
            <Trash2 size={14} strokeWidth={1.5} />
            {t(locale, 'brainHeatmap.clear')}
          </Button>
        </div>

        <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_16rem]">
          <div className="overflow-hidden rounded-sm border border-hairline bg-paper">
            <svg
              viewBox={`0 0 ${SVG_WIDTH} ${SVG_HEIGHT}`}
              role="img"
              aria-label={t(locale, 'brainHeatmap.title')}
              className="brain-heatmap-svg"
            >
              <defs>
                <clipPath id="brain-heatmap-head-clip">
                  <circle cx={HEAD_LEFT + HEAD_SIZE / 2} cy={HEAD_TOP + HEAD_SIZE / 2} r={HEAD_SIZE / 2} />
                </clipPath>
                <linearGradient id="brain-heatmap-legend" x1="0" x2="1" y1="0" y2="0">
                  <stop offset="0%" stopColor="#2563eb" />
                  <stop offset="50%" stopColor="#f8fafc" />
                  <stop offset="100%" stopColor="#dc2626" />
                </linearGradient>
              </defs>

              <path
                d={`M ${HEAD_LEFT + HEAD_SIZE / 2 - 18} ${HEAD_TOP - 4} L ${
                  HEAD_LEFT + HEAD_SIZE / 2
                } ${HEAD_TOP - 26} L ${HEAD_LEFT + HEAD_SIZE / 2 + 18} ${HEAD_TOP - 4}`}
                fill="none"
                stroke="var(--color-meta)"
                strokeWidth="1.2"
                strokeLinejoin="round"
              />
              <ellipse
                cx={HEAD_LEFT - 15}
                cy={HEAD_TOP + HEAD_SIZE / 2}
                rx="13"
                ry="29"
                fill="none"
                stroke="var(--color-meta)"
                strokeWidth="1"
              />
              <ellipse
                cx={HEAD_LEFT + HEAD_SIZE + 15}
                cy={HEAD_TOP + HEAD_SIZE / 2}
                rx="13"
                ry="29"
                fill="none"
                stroke="var(--color-meta)"
                strokeWidth="1"
              />
              <circle
                cx={HEAD_LEFT + HEAD_SIZE / 2}
                cy={HEAD_TOP + HEAD_SIZE / 2}
                r={HEAD_SIZE / 2}
                fill="var(--color-card)"
                stroke="var(--color-hairline)"
                strokeWidth="1.5"
              />

              <g clipPath="url(#brain-heatmap-head-clip)">
                {cells.map((cell) => (
                  <rect
                    key={`${cell.x.toFixed(3)}-${cell.y.toFixed(3)}`}
                    x={siteToSvgX(cell.x) - cellSize / 2}
                    y={siteToSvgY(cell.y) - cellSize / 2}
                    width={cellSize + 1}
                    height={cellSize + 1}
                    fill={valueToColor(cell.value, min, max)}
                    opacity="0.82"
                  />
                ))}
                {!hasInterpolatedMap &&
                  coordinateValues.map((value) => (
                    <circle
                      key={`glow-${coordinateKey({ x: value.x ?? 0, y: value.y ?? 0 })}`}
                      cx={siteToSvgX(value.x ?? 0)}
                      cy={siteToSvgY(value.y ?? 0)}
                      r="45"
                      fill={valueToColor(value.value, min, max)}
                      opacity="0.35"
                    />
                  ))}
              </g>

              <circle
                cx={HEAD_LEFT + HEAD_SIZE / 2}
                cy={HEAD_TOP + HEAD_SIZE / 2}
                r={HEAD_SIZE / 2}
                fill="none"
                stroke="var(--color-meta)"
                strokeWidth="1.2"
              />

              {coordinateValues.map((value) => (
                <g key={`${value.siteName}-${value.channelName}`}>
                  <circle
                    cx={siteToSvgX(value.x ?? 0)}
                    cy={siteToSvgY(value.y ?? 0)}
                    r="5"
                    fill="#ffffff"
                    stroke="#0e7490"
                    strokeWidth="1.6"
                  />
                  <text
                    x={siteToSvgX(value.x ?? 0)}
                    y={siteToSvgY(value.y ?? 0) - 9}
                    textAnchor="middle"
                    className="algorithm-trend-axis-label"
                  >
                    {value.siteName}
                  </text>
                </g>
              ))}

              <rect x="126" y="365" width="220" height="10" fill="url(#brain-heatmap-legend)" />
              <text x="126" y="394" textAnchor="start" className="algorithm-trend-axis-label">
                {formatAnalysisMetric(min)}
              </text>
              <text x="236" y="394" textAnchor="middle" className="algorithm-trend-axis-label">
                {metricLabel(locale, metric)}
              </text>
              <text x="346" y="394" textAnchor="end" className="algorithm-trend-axis-label">
                {formatAnalysisMetric(max)}
              </text>

              {(!isDrawingEnabled || !hasData) && (
                <text
                  x={SVG_WIDTH / 2}
                  y={HEAD_TOP + HEAD_SIZE / 2}
                  textAnchor="middle"
                  className="algorithm-trend-axis-label"
                >
                  {isDrawingEnabled
                    ? t(locale, 'brainHeatmap.empty')
                    : t(locale, isStreamBusy ? 'chart.drawOff' : 'chart.drawNeedsStream')}
                </text>
              )}
            </svg>
          </div>

          <div className="flex min-w-0 flex-col gap-3">
            <div className="rounded-sm border border-hairline bg-paper px-3 py-2">
              <div className="font-mono text-[0.65rem] uppercase tracking-[0.08em] text-meta">
                {t(locale, 'brainHeatmap.coverage')}
              </div>
              <div className="mt-1 text-[0.9rem] text-ink">
                {coordinateValues.length} / {siteValues.length}
              </div>
              {!hasInterpolatedMap && hasData && (
                <p className="m-0 pt-2 text-[0.76rem] leading-snug text-warn">
                  {t(locale, 'brainHeatmap.lowCoverage')}
                </p>
              )}
            </div>
            <div className="rounded-sm border border-hairline bg-paper px-3 py-2">
              <div className="font-mono text-[0.65rem] uppercase tracking-[0.08em] text-meta">
                {t(locale, 'brainHeatmap.noteTitle')}
              </div>
              <p className="m-0 pt-1 text-[0.76rem] leading-snug text-meta">
                {t(locale, 'brainHeatmap.note')}
              </p>
            </div>
            {unknownSiteValues.length > 0 && (
              <div className="rounded-sm border border-hairline bg-paper px-3 py-2">
                <div className="font-mono text-[0.65rem] uppercase tracking-[0.08em] text-meta">
                  {t(locale, 'brainHeatmap.unknownSites')}
                </div>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {unknownSiteValues.map((value) => (
                    <span
                      key={`${value.siteName}-${value.channelName}`}
                      className="rounded-sm border border-hairline bg-surface-2 px-2 py-1 font-mono text-[0.7rem] text-meta"
                    >
                      {value.siteName} / {value.channelName}
                    </span>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      </CardBody>
    </Card>
  );
}
