import { useMemo, useState } from 'react';
import type { Locale } from '../i18n';
import { t } from '../i18n';
import { useAiStore } from '../store/aiStore';
import { useEegStore } from '../store/eegStore';
import type { EegAnalysisPoint } from '../types/eeg';
import { formatAnalysisMetric } from '../utils/analysisFormat';
import { Card, CardBody, CardHeader, Field, ToggleSwitch } from './ui';
import { SHARED_PLOT_LEFT, SHARED_PLOT_RIGHT } from './AlgorithmTrendPanel';

interface FiveBandFeaturePanelProps {
  locale: Locale;
}

const SVG_WIDTH = 900;
const SVG_HEIGHT = 300;
const PLOT_LEFT = SHARED_PLOT_LEFT;
const PLOT_RIGHT = SHARED_PLOT_RIGHT;
const PLOT_TOP = 24;
const PLOT_HEIGHT = 205;
const PLOT_BOTTOM = PLOT_TOP + PLOT_HEIGHT;
const PLOT_WIDTH = SVG_WIDTH - PLOT_LEFT - PLOT_RIGHT;
const TIME_AXIS_Y = PLOT_BOTTOM + 14;
const BUCKET_SECONDS = 0.5;
const VALUE_TICK_COUNT = 5;
const DEFAULT_POWER_SCALE = 1e-10;
const MIN_POWER_SCALE = 1e-18;
const ADAPTIVE_SCALE_PERCENTILE = 0.95;
const ADAPTIVE_SCALE_PADDING = 1.2;
const EMPTY_ANALYSIS_POINTS: EegAnalysisPoint[] = [];

const BAND_KEYS = ['delta', 'theta', 'alpha', 'beta', 'gamma'] as const;
type BandKey = (typeof BAND_KEYS)[number];

const BAND_COLORS: Record<BandKey, string> = {
  delta: '#2563eb',
  theta: '#0891b2',
  alpha: '#059669',
  beta: '#b45309',
  gamma: '#be123c',
};

const BAND_LABELS: Record<BandKey, string> = {
  delta: 'Delta',
  theta: 'Theta',
  alpha: 'Alpha',
  beta: 'Beta',
  gamma: 'Gamma',
};

interface FiveBandPlotPoint {
  timeSeconds: number;
  values: Record<BandKey, number>;
}

interface FiveBandChartConfig {
  id: string;
  siteName: string;
  channelName: string;
}

function normalizeSiteName(siteName: string): string {
  return siteName.trim() || 'custom';
}

function normalizeChannelName(channelName: string): string {
  return channelName.trim() || 'ch0';
}

function createFiveBandPlotPoints(points: readonly EegAnalysisPoint[]): FiveBandPlotPoint[] {
  const buckets = new Map<
    number,
    {
      count: number;
      sums: Record<BandKey, number>;
    }
  >();

  for (const point of points) {
    const bucketIndex = Math.round(point.timeSeconds / BUCKET_SECONDS);
    const bucket = buckets.get(bucketIndex) ?? {
      count: 0,
      sums: {
        delta: 0,
        theta: 0,
        alpha: 0,
        beta: 0,
        gamma: 0,
      },
    };
    bucket.count += 1;
    for (const key of BAND_KEYS) {
      bucket.sums[key] += point.bandPowers[key];
    }
    buckets.set(bucketIndex, bucket);
  }

  return [...buckets.entries()]
    .sort(([a], [b]) => a - b)
    .map(([bucketIndex, bucket]) => {
      const values = {} as Record<BandKey, number>;
      for (const key of BAND_KEYS) {
        values[key] = bucket.sums[key] / bucket.count;
      }
      return {
        timeSeconds: bucketIndex * BUCKET_SECONDS,
        values,
      };
    });
}

function percentile(values: number[], ratio: number): number {
  if (values.length === 0) return DEFAULT_POWER_SCALE;
  const clampedRatio = Math.max(0, Math.min(1, ratio));
  const index = Math.round((values.length - 1) * clampedRatio);
  return values[index] ?? values[values.length - 1] ?? DEFAULT_POWER_SCALE;
}

function createAdaptiveBandScales(
  points: readonly FiveBandPlotPoint[],
  bandKeys: readonly BandKey[],
): Record<BandKey, number> {
  const scales = {} as Record<BandKey, number>;

  for (const bandKey of BAND_KEYS) {
    if (!bandKeys.includes(bandKey)) {
      scales[bandKey] = DEFAULT_POWER_SCALE;
      continue;
    }

    const values = points
      .map((point) => point.values[bandKey])
      .filter((value) => Number.isFinite(value) && value > 0)
      .sort((a, b) => a - b);
    const high = percentile(values, ADAPTIVE_SCALE_PERCENTILE);
    const max = values[values.length - 1] ?? high;
    const scale = Math.max(high * ADAPTIVE_SCALE_PADDING, max * 0.25, MIN_POWER_SCALE);
    scales[bandKey] = scale;
  }

  return scales;
}

function buildPolyline(
  points: readonly FiveBandPlotPoint[],
  bandKey: BandKey,
  timeStartSeconds: number,
  timeEndSeconds: number,
  valueScale: number,
): string {
  const pathPoints = points
    .map((point) => {
      const yValue = point.values[bandKey];
      if (!Number.isFinite(yValue)) return null;
      const xRatio =
        (point.timeSeconds - timeStartSeconds) /
        Math.max(BUCKET_SECONDS, timeEndSeconds - timeStartSeconds);
      const yRatio = yValue <= 0 ? 0 : yValue / Math.max(MIN_POWER_SCALE, valueScale);
      return {
        x: PLOT_LEFT + Math.max(0, Math.min(1, xRatio)) * PLOT_WIDTH,
        y: PLOT_BOTTOM - Math.max(0, Math.min(1, yRatio)) * PLOT_HEIGHT,
      };
    })
    .filter((point): point is { x: number; y: number } => point !== null);

  if (pathPoints.length === 0) return '';
  return pathPoints
    .map((point) => `${point.x.toFixed(2)},${point.y.toFixed(2)}`)
    .join(' ');
}

function formatRelativeTick(secondsAgo: number): string {
  if (secondsAgo <= 0.001) return 'now';
  if (secondsAgo < 10) return `-${secondsAgo.toFixed(1)}s`;
  return `-${Math.round(secondsAgo)}s`;
}

function createRelativeValueTicks() {
  return Array.from({ length: VALUE_TICK_COUNT }, (_, index) => {
    const ratio = index / (VALUE_TICK_COUNT - 1);
    const value = 1 - ratio;
    return {
      y: PLOT_TOP + ratio * PLOT_HEIGHT,
      label: `${Math.round(value * 100)}%`,
    };
  });
}

function trimMetricZeros(value: string): string {
  return value.replace(/(\.\d*?[1-9])0+(e|$)/, '$1$2').replace(/\.0+(e|$)/, '$1');
}

function formatBandPowerMetric(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return '-';
  if (value === 0) return '0';
  if (Math.abs(value) < 0.01) {
    return trimMetricZeros(value.toExponential(2).replace('e+', 'e'));
  }
  return formatAnalysisMetric(value);
}

export function FiveBandFeaturePanel({ locale }: FiveBandFeaturePanelProps) {
  const isPlotEnabled = useEegStore((state) => state.drawing.fiveBand);
  const setDrawingEnabled = useEegStore((state) => state.setDrawingEnabled);
  const allPoints = useEegStore((state) =>
    isPlotEnabled ? state.analysisPoints : EMPTY_ANALYSIS_POINTS,
  );
  const isStreamBusy = useEegStore(
    (state) => state.stream.isStarting || state.stream.isStreaming,
  );
  const liveWindowSeconds = useEegStore((state) => state.analysis.liveWindowSeconds);
  const bindings = useAiStore((state) => state.bindings);
  const [visibleBands, setVisibleBands] = useState<BandKey[]>([...BAND_KEYS]);
  const chartConfigs = useMemo<FiveBandChartConfig[]>(
    () =>
      bindings.map((binding, index) => ({
        id: `${binding.bindingId}-${index}`,
        siteName: normalizeSiteName(binding.siteName),
        channelName: normalizeChannelName(binding.channelName),
      })),
    [bindings],
  );
  const activeBandKeys = useMemo(
    () => BAND_KEYS.filter((bandKey) => visibleBands.includes(bandKey)),
    [visibleBands],
  );
  const latestTimeSeconds = allPoints[allPoints.length - 1]?.timeSeconds ?? 0;
  const points = useMemo(
    () => allPoints.filter((point) => latestTimeSeconds - point.timeSeconds <= liveWindowSeconds),
    [allPoints, latestTimeSeconds, liveWindowSeconds],
  );
  const plotPoints = useMemo(() => createFiveBandPlotPoints(points), [points]);
  const plotPointsByChannel = useMemo(() => {
    const out = new Map<string, FiveBandPlotPoint[]>();
    for (const config of chartConfigs) {
      out.set(
        config.channelName,
        createFiveBandPlotPoints(
          points.filter((point) => point.channelName === config.channelName),
        ),
      );
    }
    return out;
  }, [chartConfigs, points]);
  const primaryPlotPoints = plotPointsByChannel.get('ch0') ?? plotPoints;
  const primaryBandScales = useMemo(
    () => createAdaptiveBandScales(primaryPlotPoints, activeBandKeys),
    [activeBandKeys, primaryPlotPoints],
  );
  const valueTicks = useMemo(() => createRelativeValueTicks(), []);

  const timeEndSeconds = latestTimeSeconds;
  const timeStartSeconds = timeEndSeconds - liveWindowSeconds;

  const tickTimes = useMemo(
    () =>
      Array.from({ length: 5 }, (_, index) => {
        const ratio = index / 4;
        return {
          x: PLOT_LEFT + ratio * PLOT_WIDTH,
          label: formatRelativeTick(liveWindowSeconds * (1 - ratio)),
        };
      }),
    [liveWindowSeconds],
  );

  function toggleBand(bandKey: BandKey): void {
    setVisibleBands((current) => {
      if (!current.includes(bandKey)) return [...current, bandKey];
      if (current.length <= 1) return current;
      return current.filter((item) => item !== bandKey);
    });
  }

  return (
    <Card ariaLabelledBy="five-band-feature-title">
      <CardHeader
        eyebrow={t(locale, 'fiveBand.eyebrow')}
        title={t(locale, 'fiveBand.title')}
        titleId="five-band-feature-title"
        trailing={
          <ToggleSwitch
            label={t(locale, 'chart.drawToggle')}
            checked={isPlotEnabled}
            onCheckedChange={(checked) => setDrawingEnabled('fiveBand', checked)}
            disabled={!isStreamBusy}
          />
        }
      />
      <CardBody className="flex flex-col gap-4">
        <div className="grid gap-4">
          <Field label={t(locale, 'fiveBand.visibleBands')} htmlFor="five-band-band-controls">
            <div id="five-band-band-controls" className="flex flex-wrap gap-2 py-1">
              {BAND_KEYS.map((bandKey) => {
                const isVisible = visibleBands.includes(bandKey);
                return (
                  <button
                    key={bandKey}
                    type="button"
                    aria-pressed={isVisible}
                    onClick={() => toggleBand(bandKey)}
                    disabled={isVisible && visibleBands.length <= 1}
                    className={`inline-flex h-8 items-center gap-2 rounded-sm border px-2.5 text-[0.78rem] font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
                      isVisible
                        ? 'border-accent bg-accent-soft text-ink'
                        : 'border-hairline bg-surface-2 text-meta hover:text-ink'
                    }`}
                  >
                    <span
                      className="h-2.5 w-2.5 rounded-full"
                      style={{ backgroundColor: BAND_COLORS[bandKey] }}
                    />
                    {BAND_LABELS[bandKey]}
                  </button>
                );
              })}
            </div>
          </Field>
        </div>
        <div className="grid gap-3">
          {chartConfigs.map((config) => {
            const chartPlotPoints = plotPointsByChannel.get(config.channelName) ?? [];
            const chartBandScales = createAdaptiveBandScales(chartPlotPoints, activeBandKeys);

            return (
              <div
                key={config.id}
                className="overflow-hidden rounded-sm border border-hairline bg-paper"
              >
              <div className="flex flex-wrap items-center justify-between gap-3 border-b border-hairline bg-surface-2 px-3 py-2">
                <div className="min-w-0">
                  <div className="text-[0.9rem] font-medium text-ink break-words">
                    {config.siteName}
                  </div>
                  <div className="mt-0.5 font-mono text-[0.7rem] uppercase tracking-[0.08em] text-meta">
                    {config.channelName}
                  </div>
                </div>
              </div>
              <svg
                viewBox={`0 0 ${SVG_WIDTH} ${SVG_HEIGHT}`}
                role="img"
                aria-label={`${config.siteName} ${config.channelName} ${t(locale, 'fiveBand.title')}`}
                className="five-band-chart-svg"
                preserveAspectRatio="none"
              >
                <rect
                  className="algorithm-trend-plot-background"
                  x={PLOT_LEFT}
                  y={PLOT_TOP}
                  width={PLOT_WIDTH}
                  height={PLOT_HEIGHT}
                />
                <text
                  className="algorithm-trend-axis-label"
                  transform={`rotate(-90 18 ${PLOT_TOP + PLOT_HEIGHT / 2})`}
                  x={18}
                  y={PLOT_TOP + PLOT_HEIGHT / 2}
                  textAnchor="middle"
                >
                  {t(locale, 'fiveBand.yAxisTitle')}
                </text>
                {valueTicks.map((tick) => (
                  <g key={`v-${config.id}-${tick.y}-${tick.label}`}>
                    <line
                      className="algorithm-trend-grid-line"
                      x1={PLOT_LEFT}
                      x2={PLOT_LEFT + PLOT_WIDTH}
                      y1={tick.y}
                      y2={tick.y}
                    />
                    <text
                      x={PLOT_LEFT - 10}
                      y={tick.y + 4}
                      textAnchor="end"
                      className="algorithm-trend-axis-label"
                    >
                      {tick.label}
                    </text>
                  </g>
                ))}
                {tickTimes.map((tick) => (
                  <g key={`t-${config.id}-${tick.x}-${tick.label}`}>
                    <line
                      className="algorithm-trend-axis-tick"
                      x1={tick.x}
                      x2={tick.x}
                      y1={TIME_AXIS_Y - 3}
                      y2={TIME_AXIS_Y + 4}
                    />
                    <line
                      className="algorithm-trend-grid-line"
                      x1={tick.x}
                      x2={tick.x}
                      y1={PLOT_TOP}
                      y2={PLOT_BOTTOM}
                    />
                    <text
                      x={tick.x}
                      y={TIME_AXIS_Y + 20}
                      textAnchor={
                        tick.x === PLOT_LEFT
                          ? 'start'
                          : tick.x === PLOT_LEFT + PLOT_WIDTH
                            ? 'end'
                            : 'middle'
                      }
                      className="algorithm-trend-axis-label"
                    >
                      {tick.label}
                    </text>
                  </g>
                ))}
                {activeBandKeys.map((bandKey) => (
                  <polyline
                    key={bandKey}
                    points={buildPolyline(
                      chartPlotPoints,
                      bandKey,
                      timeStartSeconds,
                      timeEndSeconds,
                      chartBandScales[bandKey],
                    )}
                    fill="none"
                    stroke={BAND_COLORS[bandKey]}
                    strokeWidth="1.8"
                    strokeLinejoin="round"
                    strokeLinecap="round"
                  />
                ))}
                <line
                  className="algorithm-trend-axis"
                  x1={PLOT_LEFT}
                  x2={PLOT_LEFT + PLOT_WIDTH}
                  y1={TIME_AXIS_Y}
                  y2={TIME_AXIS_Y}
                />
                <line
                  className="algorithm-trend-axis"
                  x1={PLOT_LEFT}
                  x2={PLOT_LEFT}
                  y1={PLOT_TOP}
                  y2={PLOT_BOTTOM}
                />
                {(!isPlotEnabled || chartPlotPoints.length === 0) && (
                  <text
                    x={PLOT_LEFT + PLOT_WIDTH / 2}
                    y={PLOT_TOP + PLOT_HEIGHT / 2}
                    textAnchor="middle"
                    className="algorithm-trend-axis-label"
                  >
                    {isPlotEnabled
                      ? t(locale, 'fiveBand.empty')
                      : t(locale, isStreamBusy ? 'chart.drawOff' : 'chart.drawNeedsStream')}
                  </text>
                )}
              </svg>
            </div>
            );
          })}
        </div>
        <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-5">
          {activeBandKeys.map((bandKey) => {
            const latestValue =
              primaryPlotPoints[primaryPlotPoints.length - 1]?.values[bandKey] ?? null;
            const hasLatestValue = latestValue !== null && Number.isFinite(latestValue);
            return (
              <div
                key={bandKey}
                className="rounded-sm border border-hairline bg-paper px-3 py-2"
              >
                <div className="flex min-w-0 items-center justify-between gap-3">
                  <span className="inline-flex min-w-0 items-center gap-1.5">
                    <span
                      className="h-2.5 w-2.5 shrink-0 rounded-full"
                      style={{ backgroundColor: BAND_COLORS[bandKey] }}
                    />
                    <span className="font-mono text-[0.72rem] font-medium text-ink">
                      {BAND_LABELS[bandKey]}
                    </span>
                  </span>
                  <span className="font-mono text-[0.78rem] text-ink tabular">
                    {hasLatestValue
                      ? formatBandPowerMetric(latestValue)
                      : t(locale, 'fiveBand.waitingValue')}
                  </span>
                </div>
                <div className="mt-1 flex items-center justify-between gap-3 font-mono text-[0.66rem] text-meta tabular">
                  <span>{t(locale, 'fiveBand.yMaxShort')}</span>
                  <span>{hasLatestValue ? formatBandPowerMetric(primaryBandScales[bandKey]) : '-'}</span>
                </div>
              </div>
            );
          })}
        </div>
        <p className="m-0 text-[0.78rem] leading-relaxed text-meta">
          {t(locale, 'fiveBand.unitNote')}
        </p>
      </CardBody>
    </Card>
  );
}
