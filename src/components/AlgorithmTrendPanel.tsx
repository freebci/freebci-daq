import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type FormEvent,
  type KeyboardEvent,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import { Plus, Timer, X } from 'lucide-react';
import {
  EEG_LIVE_WINDOW_MAX_SECONDS,
  EEG_LIVE_WINDOW_MIN_SECONDS,
} from '../config/eeg';
import type { Locale } from '../i18n';
import { t } from '../i18n';
import { useEegStore } from '../store/eegStore';
import { getEegChannelNames } from '../transport/eegChannels';
import type {
  EegAnalysisPoint,
  EegAnnotationKind,
  EegAnnotationLabel,
  EegAnnotationRecord,
} from '../types/eeg';
import { formatAnalysisMetric } from '../utils/analysisFormat';
import {
  EngagementAlertOverlay,
  ENGAGEMENT_ALERT_COLOR,
  isBelowEngagementAlert,
} from './EngagementAlertOverlay';
import {
  Button,
  Card,
  CardBody,
  CardHeader,
  Field,
  NumberInput,
  TextInput,
  ToggleSwitch,
} from './ui';

interface AlgorithmTrendPanelProps {
  locale: Locale;
}

const SVG_WIDTH = 900;
const SVG_HEIGHT = 460;
export const SHARED_PLOT_LEFT = 78;
export const SHARED_PLOT_RIGHT = 24;
const PLOT_TOP = 20;
const PLOT_HEIGHT = 340;
const PLOT_BOTTOM = PLOT_TOP + PLOT_HEIGHT;
const PLOT_WIDTH = SVG_WIDTH - SHARED_PLOT_LEFT - SHARED_PLOT_RIGHT;
const TIME_AXIS_Y = PLOT_BOTTOM + 14;
const BASELINE_VALUES = [0.5, 1.0] as const;
const TIME_TICK_COUNT = 5;
const VALUE_TICK_COUNT = 5;
const CLICK_DRAG_THRESHOLD_PX = 4;
// Floor on the auto Y span so a single spike can't dominate the view, and
// so per-hop autoMin/autoMax wiggles don't visibly shift the polyline as
// new samples arrive. Engagement index sits in 0–1 in normal use; 1.2
// keeps the 0.5 / 1.0 baselines comfortably in frame.
const MIN_AUTO_VALUE_SPAN = 1.2;

const ACCENT = '#0e7490';
const SECONDARY = '#b45309';
const EXTRA_CHANNEL_COLORS = ['#7c3aed', '#059669', '#db2777', '#4f46e5', '#dc2626', '#0891b2'] as const;
const INITIAL_UNRELIABLE_COLOR = '#ca8a04';
const SELECTION_HOLE = '#ffffff';
const ANNOTATION_LABEL_MAX_LENGTH = 14;
const EMPTY_ANALYSIS_POINTS: EegAnalysisPoint[] = [];

interface ValueRange {
  min: number;
  max: number;
}

function getAutoValueRange(points: EegAnalysisPoint[]): ValueRange {
  let min = Infinity;
  let max = -Infinity;
  for (const p of points) {
    const v = p.engagementIndex;
    if (v === null || !Number.isFinite(v)) continue;
    if (v < min) min = v;
    if (v > max) max = v;
  }
  if (!Number.isFinite(min) || !Number.isFinite(max)) return { min: 0, max: MIN_AUTO_VALUE_SPAN };
  const padding = min === max ? Math.max(Math.abs(min) * 0.1, 0.01) : (max - min) * 0.1;
  let paddedMin = Math.max(0, min - padding);
  let paddedMax = max + padding;
  const span = paddedMax - paddedMin;
  if (span < MIN_AUTO_VALUE_SPAN) {
    const center = (paddedMin + paddedMax) / 2;
    const half = MIN_AUTO_VALUE_SPAN / 2;
    paddedMin = Math.max(0, center - half);
    paddedMax = paddedMin + MIN_AUTO_VALUE_SPAN;
  }
  return { min: paddedMin, max: paddedMax };
}

function getTrendChannelColor(channelName: string, channelIndex: number): string {
  if (channelName === 'ch0') return ACCENT;
  if (channelName === 'ch1') return SECONDARY;
  return EXTRA_CHANNEL_COLORS[
    (channelIndex - 2 + EXTRA_CHANNEL_COLORS.length) % EXTRA_CHANNEL_COLORS.length
  ];
}

function formatRelativeSeconds(secondsAgo: number): string {
  if (secondsAgo <= 0.001) return 'now';
  if (secondsAgo < 10) return `-${secondsAgo.toFixed(1)}s`;
  return `-${Math.round(secondsAgo)}s`;
}

interface DragState {
  pointerId: number;
  startClientX: number;
  startClientY: number;
  moved: boolean;
}

interface VisibleIntervalAnnotation {
  label: EegAnnotationLabel;
  record: Extract<EegAnnotationRecord, { kind: 'interval' }>;
  startX: number;
  endX: number;
  showStartLine: boolean;
  showEndLine: boolean;
  active: boolean;
}

interface VisibleEventAnnotation {
  label: EegAnnotationLabel;
  record: Extract<EegAnnotationRecord, { kind: 'event' }>;
  x: number;
}

function truncateAnnotationName(name: string): string {
  if (name.length <= ANNOTATION_LABEL_MAX_LENGTH) return name;
  return `${name.slice(0, ANNOTATION_LABEL_MAX_LENGTH)}...`;
}

export function AlgorithmTrendPanel({ locale }: AlgorithmTrendPanelProps) {
  const stream = useEegStore((state) => state.stream);
  const channelCount = useEegStore((state) => state.acquisition.channelCount);
  const isDrawingEnabled = useEegStore((state) => state.drawing.engagementTrend);
  const setDrawingEnabled = useEegStore((state) => state.setDrawingEnabled);
  const allPoints = useEegStore((state) =>
    isDrawingEnabled ? state.analysisPoints : EMPTY_ANALYSIS_POINTS,
  );
  const liveWindowSeconds = useEegStore((state) => state.analysis.liveWindowSeconds);
  const engagementAlertThreshold = useEegStore(
    (state) => state.analysis.engagementAlertThreshold,
  );
  const initialUnreliableSeconds = useEegStore(
    (state) => state.analysis.initialUnreliableSeconds,
  );
  const annotationLabels = useEegStore((state) => state.annotationLabels);
  const annotationRecords = useEegStore((state) => state.annotationRecords);
  const setLiveWindowSeconds = useEegStore((state) => state.setLiveWindowSeconds);
  const addAnnotationLabel = useEegStore((state) => state.addAnnotationLabel);
  const removeAnnotationLabel = useEegStore((state) => state.removeAnnotationLabel);
  const recordAnnotation = useEegStore((state) => state.recordAnnotation);
  const clearAnnotationRecords = useEegStore((state) => state.clearAnnotationRecords);
  const alertClipId = `engagement-alert-clip-${useId().replace(/:/g, '')}`;
  const isStreamBusy = stream.isStarting || stream.isStreaming;
  const canConfigureAnnotations = !isStreamBusy;
  const canRecordAnnotations = stream.isStreaming;

  const latestTimeSeconds = allPoints[allPoints.length - 1]?.timeSeconds ?? 0;
  const points = useMemo(
    () => allPoints.filter((p) => latestTimeSeconds - p.timeSeconds <= liveWindowSeconds),
    [allPoints, latestTimeSeconds, liveWindowSeconds],
  );
  const configuredChannelNames = useMemo(
    () => getEegChannelNames(channelCount),
    [channelCount],
  );
  const channelNames = useMemo(() => {
    const names = new Set(configuredChannelNames);
    for (const point of points) {
      names.add(point.channelName || 'ch0');
    }
    return [...names];
  }, [configuredChannelNames, points]);
  const hasTrend = points.length > 0;
  const primaryPoints = points.filter((point) => point.channelName === 'ch0');
  const latestPoint = primaryPoints[primaryPoints.length - 1] ?? points[points.length - 1];

  const xStart = latestTimeSeconds - liveWindowSeconds;
  const xSpan = liveWindowSeconds;

  const autoRange = useMemo(() => getAutoValueRange(points), [points]);
  const effectiveMin = autoRange.min;
  const effectiveMax = autoRange.max;
  const valueSpan = Math.max(effectiveMax - effectiveMin, Number.EPSILON);

  const svgRef = useRef<SVGSVGElement | null>(null);
  const dragRef = useRef<DragState | null>(null);
  const [selectedSampleIndex, setSelectedSampleIndex] = useState<number | null>(null);
  const [hostRect, setHostRect] = useState<{ width: number; height: number } | null>(null);
  const [liveWindowDraft, setLiveWindowDraft] = useState(String(liveWindowSeconds));
  const [annotationNameDraft, setAnnotationNameDraft] = useState('');
  const [annotationKindDraft, setAnnotationKindDraft] =
    useState<EegAnnotationKind>('interval');

  useEffect(() => {
    if (!isDrawingEnabled) {
      setSelectedSampleIndex(null);
    }
  }, [isDrawingEnabled]);

  useEffect(() => {
    setLiveWindowDraft(String(liveWindowSeconds));
  }, [liveWindowSeconds]);

  useEffect(() => {
    if (selectedSampleIndex !== null) {
      const stillExists = points.some((p) => p.sampleIndex === selectedSampleIndex);
      if (!stillExists) setSelectedSampleIndex(null);
    }
  }, [points, selectedSampleIndex]);

  useEffect(() => {
    function onResize() {
      const el = svgRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      setHostRect({ width: rect.width, height: rect.height });
    }
    onResize();
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  function clientToSvg(clientX: number, clientY: number): { x: number; y: number } | null {
    const el = svgRef.current;
    if (!el) return null;
    const rect = el.getBoundingClientRect();
    const x = ((clientX - rect.left) / rect.width) * SVG_WIDTH;
    const y = ((clientY - rect.top) / rect.height) * SVG_HEIGHT;
    return { x, y };
  }

  function getXForTime(timeSeconds: number): number {
    if (xSpan <= 0) return SHARED_PLOT_LEFT;
    return SHARED_PLOT_LEFT + ((timeSeconds - xStart) / xSpan) * PLOT_WIDTH;
  }

  function getYForValue(value: number): number {
    return PLOT_TOP + ((effectiveMax - value) / valueSpan) * PLOT_HEIGHT;
  }

  function findNearestPoint(svgX: number): EegAnalysisPoint | null {
    if (points.length === 0) return null;
    let bestPoint: EegAnalysisPoint | null = null;
    let bestDistance = Infinity;
    for (const p of primaryPoints) {
      if (p.engagementIndex === null) continue;
      const px = getXForTime(p.timeSeconds);
      const dist = Math.abs(px - svgX);
      if (dist < bestDistance) {
        bestDistance = dist;
        bestPoint = p;
      }
    }
    return bestPoint;
  }

  function handlePointerDown(event: ReactPointerEvent<SVGSVGElement>) {
    if (!hasTrend) return;
    if (event.button !== 0) return;
    (event.target as Element).setPointerCapture?.(event.pointerId);
    dragRef.current = {
      pointerId: event.pointerId,
      startClientX: event.clientX,
      startClientY: event.clientY,
      moved: false,
    };
  }

  function handlePointerMove(event: ReactPointerEvent<SVGSVGElement>) {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    const dx = event.clientX - drag.startClientX;
    const dy = event.clientY - drag.startClientY;
    if (!drag.moved && Math.hypot(dx, dy) > CLICK_DRAG_THRESHOLD_PX) {
      drag.moved = true;
    }
  }

  function handlePointerUp(event: ReactPointerEvent<SVGSVGElement>) {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    dragRef.current = null;
    if (drag.moved) return;
    const svgPt = clientToSvg(event.clientX, event.clientY);
    if (!svgPt) return;
    if (
      svgPt.x < SHARED_PLOT_LEFT ||
      svgPt.x > SHARED_PLOT_LEFT + PLOT_WIDTH ||
      svgPt.y < PLOT_TOP ||
      svgPt.y > PLOT_BOTTOM
    ) {
      setSelectedSampleIndex(null);
      return;
    }
    const nearest = findNearestPoint(svgPt.x);
    setSelectedSampleIndex(nearest ? nearest.sampleIndex : null);
  }

  function commitLiveWindowSeconds(raw: string) {
    const parsed = Number(raw);
    if (!Number.isFinite(parsed)) {
      setLiveWindowDraft(String(liveWindowSeconds));
      return;
    }

    const next = Math.max(
      EEG_LIVE_WINDOW_MIN_SECONDS,
      Math.min(EEG_LIVE_WINDOW_MAX_SECONDS, Math.round(parsed)),
    );
    setLiveWindowSeconds(next);
    setLiveWindowDraft(String(next));
    setSelectedSampleIndex(null);
  }

  function handleLiveWindowSecondsChange(event: ChangeEvent<HTMLInputElement>) {
    const raw = event.currentTarget.value;
    setLiveWindowDraft(raw);

    const parsed = Number(raw);
    if (
      Number.isFinite(parsed) &&
      parsed >= EEG_LIVE_WINDOW_MIN_SECONDS &&
      parsed <= EEG_LIVE_WINDOW_MAX_SECONDS
    ) {
      setLiveWindowSeconds(Math.round(parsed));
      setSelectedSampleIndex(null);
    }
  }

  function handleLiveWindowSecondsKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key !== 'Enter') return;
    commitLiveWindowSeconds(event.currentTarget.value);
    event.currentTarget.blur();
  }

  function handleAddAnnotationLabel(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canConfigureAnnotations) return;

    const trimmedName = annotationNameDraft.trim();
    if (trimmedName.length === 0) return;

    addAnnotationLabel(trimmedName, annotationKindDraft);
    setAnnotationNameDraft('');
  }

  function handleAnnotationKindChange(event: ChangeEvent<HTMLSelectElement>) {
    setAnnotationKindDraft(event.currentTarget.value as EegAnnotationKind);
  }

  const selectedPoint = selectedSampleIndex !== null
    ? points.find((p) => p.sampleIndex === selectedSampleIndex) ?? null
    : null;

  const annotationRecordByLabel = useMemo(() => {
    const records = new Map<string, EegAnnotationRecord>();
    for (const record of annotationRecords) {
      records.set(record.labelId, record);
    }
    return records;
  }, [annotationRecords]);

  const valueTicks = Array.from({ length: VALUE_TICK_COUNT }, (_, index) => {
    const ratio = index / (VALUE_TICK_COUNT - 1);
    const value = effectiveMax - valueSpan * ratio;
    return { y: PLOT_TOP + ratio * PLOT_HEIGHT, label: formatAnalysisMetric(value) };
  });

  const timeTicks = Array.from({ length: TIME_TICK_COUNT }, (_, index) => {
    const ratio = index / (TIME_TICK_COUNT - 1);
    const secondsAgo = liveWindowSeconds * (1 - ratio);
    return {
      x: SHARED_PLOT_LEFT + ratio * PLOT_WIDTH,
      label: formatRelativeSeconds(secondsAgo),
    };
  });

  const channelCurves = channelNames.map((channelName) => {
    const curve = points
      .filter((p) => p.channelName === channelName && p.engagementIndex !== null)
      .map((p) => ({
        x: getXForTime(p.timeSeconds),
        y: getYForValue(p.engagementIndex ?? 0),
        point: p,
      }));

    return {
      channelName,
      curve,
      polyline: curve.map((p) => `${p.x.toFixed(2)},${p.y.toFixed(2)}`).join(' '),
    };
  });
  const primaryCurve = channelCurves.find((entry) => entry.channelName === 'ch0');
  const hasAnyChannelCurve = channelCurves.some((entry) => entry.curve.length > 0);
  const curve = primaryCurve?.curve ?? [];
  const polyline = primaryCurve?.polyline ?? '';
  const initialUnreliableCurve = curve.filter(
    (p) => p.point.timeSeconds <= initialUnreliableSeconds,
  );
  const initialUnreliablePolyline = initialUnreliableCurve
    .map((p) => `${p.x.toFixed(2)},${p.y.toFixed(2)}`)
    .join(' ');
  const lastCurvePoint = curve[curve.length - 1];
  const alertThresholdY = getYForValue(engagementAlertThreshold);
  const visibleIntervalAnnotations: VisibleIntervalAnnotation[] = [];
  const visibleEventAnnotations: VisibleEventAnnotation[] = [];

  for (const label of annotationLabels) {
    const record = annotationRecordByLabel.get(label.id);
    if (!record) continue;

    if (record.kind === 'event') {
      if (record.timeSeconds < xStart || record.timeSeconds > latestTimeSeconds) continue;
      visibleEventAnnotations.push({
        label,
        record,
        x: getXForTime(record.timeSeconds),
      });
      continue;
    }

    const active = record.endTimeSeconds === null;
    const effectiveEndTime = record.endTimeSeconds ?? latestTimeSeconds;
    if (effectiveEndTime < xStart || record.startTimeSeconds > latestTimeSeconds) continue;

    const clampedStart = Math.max(record.startTimeSeconds, xStart);
    const clampedEnd = Math.min(effectiveEndTime, latestTimeSeconds);
    if (clampedEnd < clampedStart) continue;

    visibleIntervalAnnotations.push({
      label,
      record,
      startX: getXForTime(clampedStart),
      endX: getXForTime(clampedEnd),
      showStartLine: record.startTimeSeconds >= xStart,
      showEndLine: !active && effectiveEndTime <= latestTimeSeconds,
      active,
    });
  }

  const headerTrailing = (
    <div className="flex flex-wrap items-center justify-end gap-2">
      <span className="font-mono text-[0.65rem] font-medium uppercase tracking-[0.08em] text-meta">
        {t(locale, 'chart.windowFixed', { seconds: liveWindowSeconds })}
      </span>
      <ToggleSwitch
        label={t(locale, 'chart.drawToggle')}
        checked={isDrawingEnabled}
        onCheckedChange={(checked) => setDrawingEnabled('engagementTrend', checked)}
        disabled={!isStreamBusy}
      />
    </div>
  );

  const heroCurrent = latestPoint?.engagementIndex ?? null;
  const heroLatestSeconds = latestPoint?.timeSeconds ?? null;
  const isHeroUnreliable =
    (heroLatestSeconds ?? Infinity) <= initialUnreliableSeconds;
  const heroCurrentTone = isHeroUnreliable
    ? 'text-warn'
    : isBelowEngagementAlert(heroCurrent, engagementAlertThreshold)
      ? 'text-error'
      : 'text-ink';

  function getTrendPointColor(point: EegAnalysisPoint): string {
    if (point.timeSeconds <= initialUnreliableSeconds) {
      return INITIAL_UNRELIABLE_COLOR;
    }
    return isBelowEngagementAlert(point.engagementIndex, engagementAlertThreshold)
      ? ENGAGEMENT_ALERT_COLOR
      : ACCENT;
  }

  let heroAvg30s: number | null = null;
  let heroDelta30s: number | null = null;
  if (heroCurrent !== null && heroLatestSeconds !== null) {
    const cutoff = heroLatestSeconds - 30;
    let sum = 0;
    let count = 0;
    let earliest: number | null = null;
    for (const p of points) {
      if (p.timeSeconds < cutoff) continue;
      if (p.engagementIndex === null || !Number.isFinite(p.engagementIndex)) continue;
      if (earliest === null) earliest = p.engagementIndex;
      sum += p.engagementIndex;
      count += 1;
    }
    if (count > 0) {
      heroAvg30s = sum / count;
      heroDelta30s = earliest === null ? null : heroCurrent - earliest;
    }
  }

  function deltaPresentation(value: number | null): { glyph: string; toneClass: string } {
    if (value === null || !Number.isFinite(value)) return { glyph: '—', toneClass: 'text-meta' };
    if (value > 0.005) return { glyph: `▲ +${formatAnalysisMetric(value)}`, toneClass: 'text-success' };
    if (value < -0.005) return { glyph: `▼ ${formatAnalysisMetric(value)}`, toneClass: 'text-warn' };
    return { glyph: `· ${formatAnalysisMetric(0)}`, toneClass: 'text-meta' };
  }
  const deltaShown = deltaPresentation(heroDelta30s);

  // tooltip pixel position (HTML overlay coords)
  let tooltipStyle: { left: string; top: string } | null = null;
  if (selectedPoint && hostRect) {
    const svgX = getXForTime(selectedPoint.timeSeconds);
    const svgY = getYForValue(selectedPoint.engagementIndex ?? 0);
    const cssX = (svgX / SVG_WIDTH) * hostRect.width;
    const cssY = (svgY / SVG_HEIGHT) * hostRect.height;
    const TOOLTIP_W = 160;
    const flip = cssX + TOOLTIP_W + 12 > hostRect.width;
    tooltipStyle = {
      left: `${flip ? cssX - TOOLTIP_W - 8 : cssX + 8}px`,
      top: `${Math.max(8, cssY - 28)}px`,
    };
  }

  return (
    <Card ariaLabelledBy="algorithm-trend-title">
      <CardHeader
        eyebrow={t(locale, 'trend.eyebrow')}
        title={t(locale, 'trend.title')}
        titleId="algorithm-trend-title"
        trailing={headerTrailing}
      />
      <CardBody className="flex flex-col gap-6">
        <div className="grid gap-3 sm:grid-cols-2">
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
              value={liveWindowDraft}
              onChange={handleLiveWindowSecondsChange}
              onBlur={(event) => commitLiveWindowSeconds(event.currentTarget.value)}
              onKeyDown={handleLiveWindowSecondsKeyDown}
            />
          </Field>
        </div>

        <section className="rounded-sm border border-hairline bg-surface-2 p-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2 min-w-0">
              <Timer size={15} strokeWidth={1.5} className="shrink-0 text-meta" />
              <span className="font-mono text-[0.65rem] font-medium uppercase tracking-[0.08em] text-meta">
                {t(locale, 'annotations.title')}
              </span>
            </div>
            <Button
              variant="quiet"
              size="sm"
              onClick={clearAnnotationRecords}
              disabled={annotationRecords.length === 0}
            >
              <X size={14} strokeWidth={1.5} />
              {t(locale, 'annotations.clearRecords')}
            </Button>
          </div>

          {canConfigureAnnotations && (
            <form
              className="mt-3 grid gap-2 sm:grid-cols-[1fr_9rem_auto] sm:items-end"
              onSubmit={handleAddAnnotationLabel}
            >
              <Field label={t(locale, 'annotations.nameLabel')} htmlFor="annotation-label-name">
                <TextInput
                  id="annotation-label-name"
                  value={annotationNameDraft}
                  onChange={(event) => setAnnotationNameDraft(event.currentTarget.value)}
                  placeholder={t(locale, 'annotations.namePlaceholder')}
                  autoComplete="off"
                  spellCheck={false}
                />
              </Field>
              <Field label={t(locale, 'annotations.kindLabel')} htmlFor="annotation-label-kind">
                <select
                  id="annotation-label-kind"
                  value={annotationKindDraft}
                  onChange={handleAnnotationKindChange}
                  className="w-full rounded-sm border border-hairline bg-card px-3 py-2.5 font-mono text-[0.9rem] text-ink focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent focus-visible:border-accent"
                >
                  <option value="interval">{t(locale, 'annotations.kindInterval')}</option>
                  <option value="event">{t(locale, 'annotations.kindEvent')}</option>
                </select>
              </Field>
              <Button
                type="submit"
                className="sm:self-end"
                disabled={annotationNameDraft.trim().length === 0}
              >
                <Plus size={14} strokeWidth={1.5} />
                {t(locale, 'annotations.add')}
              </Button>
            </form>
          )}

          <div className="mt-3 flex flex-wrap gap-2">
            {annotationLabels.length === 0 && (
              <span className="text-[0.8rem] text-meta">{t(locale, 'annotations.empty')}</span>
            )}
            {annotationLabels.map((label) => {
              const record = annotationRecordByLabel.get(label.id);
              const isActiveInterval = record?.kind === 'interval' && record.endTimeSeconds === null;
              const buttonText =
                label.kind === 'event'
                  ? t(locale, 'annotations.mark')
                  : isActiveInterval
                    ? t(locale, 'annotations.end')
                    : t(locale, 'annotations.start');

              return (
                <div key={label.id} className="inline-flex max-w-full items-center gap-1">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => recordAnnotation(label.id)}
                    disabled={!canRecordAnnotations}
                    className={`max-w-[14rem] min-w-0 ${isActiveInterval ? 'bg-card' : ''}`}
                    style={{ borderColor: label.color }}
                    title={label.name}
                  >
                    <span
                      className="h-2.5 w-2.5 shrink-0 rounded-full"
                      style={{ backgroundColor: label.color }}
                      aria-hidden="true"
                    />
                    <span className="truncate">{label.name}</span>
                    <span className="shrink-0 text-meta">{buttonText}</span>
                  </Button>
                  {canConfigureAnnotations && (
                    <Button
                      variant="quiet"
                      size="sm"
                      onClick={() => removeAnnotationLabel(label.id)}
                      aria-label={t(locale, 'annotations.removeLabel')}
                    >
                      <X size={14} strokeWidth={1.5} />
                    </Button>
                  )}
                </div>
              );
            })}
          </div>
        </section>

        <div className="flex items-center gap-2 font-mono text-[0.72rem] text-meta">
          <span
            className="h-2.5 w-6 rounded-sm"
            style={{ backgroundColor: INITIAL_UNRELIABLE_COLOR }}
            aria-hidden="true"
          />
          <span>
            {t(locale, 'trend.initialSettlingWarning', {
              seconds: initialUnreliableSeconds,
            })}
          </span>
        </div>

        {!isDrawingEnabled && (
          <p className="m-0 text-[0.85rem] text-meta">
            {stream.isStreaming ? t(locale, 'chart.drawOff') : t(locale, 'chart.drawNeedsStream')}
          </p>
        )}

        {isDrawingEnabled && !hasTrend && (
          <p className="m-0 text-[0.85rem] text-meta">{t(locale, 'trend.empty')}</p>
        )}

        {isDrawingEnabled && hasTrend && heroCurrent !== null && (
          <div className="flex items-end justify-between gap-6 border-b border-hairline pb-5">
            <div className="flex flex-col gap-2 min-w-0">
              <span className="font-mono text-[0.65rem] font-medium uppercase tracking-[0.08em] text-meta">
                {t(locale, 'analysis.engagementIndex')}
                {' · '}
                {t(locale, 'analysis.title')}
              </span>
              <span className={`font-mono text-[3.25rem] font-medium leading-none tabular ${heroCurrentTone}`}>
                {formatAnalysisMetric(heroCurrent)}
              </span>
            </div>
            <div className="flex flex-col items-end gap-1.5 shrink-0">
              <div className="flex items-baseline gap-2.5">
                <span className="font-mono text-[0.65rem] font-medium uppercase tracking-[0.08em] text-meta">
                  {t(locale, 'trend.delta30s')}
                </span>
                <span className={`font-mono text-[0.95rem] tabular ${deltaShown.toneClass}`}>
                  {deltaShown.glyph}
                </span>
              </div>
              <div className="flex items-baseline gap-2.5">
                <span className="font-mono text-[0.65rem] font-medium uppercase tracking-[0.08em] text-meta">
                  {t(locale, 'trend.avg30s')}
                </span>
                <span className="font-mono text-[0.95rem] tabular text-ink">
                  {formatAnalysisMetric(heroAvg30s)}
                </span>
              </div>
            </div>
          </div>
        )}

        {isDrawingEnabled && hasTrend && (
          <div className="relative rounded-sm border border-hairline bg-card overflow-hidden">
            <svg
              ref={svgRef}
              className="algorithm-trend-svg"
              viewBox={`0 0 ${SVG_WIDTH} ${SVG_HEIGHT}`}
              role="img"
              aria-label={t(locale, 'trend.title')}
              preserveAspectRatio="none"
              style={{ touchAction: 'auto', cursor: 'crosshair' }}
              onPointerDown={handlePointerDown}
              onPointerMove={handlePointerMove}
              onPointerUp={handlePointerUp}
              onPointerCancel={handlePointerUp}
            >
              <rect
                className="algorithm-trend-plot-background"
                x={SHARED_PLOT_LEFT}
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
                {t(locale, 'trend.yAxisTitle')}
              </text>

              {BASELINE_VALUES.map((baseline) => {
                if (baseline <= effectiveMin || baseline >= effectiveMax) return null;
                const y = getYForValue(baseline);
                return (
                  <g key={`baseline-${baseline}`}>
                    <line
                      x1={SHARED_PLOT_LEFT}
                      x2={SHARED_PLOT_LEFT + PLOT_WIDTH}
                      y1={y}
                      y2={y}
                      stroke="var(--color-hairline)"
                      strokeDasharray="3 4"
                    />
                    <text
                      className="algorithm-trend-axis-label"
                      x={SHARED_PLOT_LEFT + PLOT_WIDTH + 4}
                      y={y + 4}
                      textAnchor="start"
                    >
                      {baseline.toFixed(1)}
                    </text>
                  </g>
                );
              })}

              {valueTicks.map((tick) => (
                <g key={`v-${tick.y}-${tick.label}`}>
                  <line
                    className="algorithm-trend-grid-line"
                    x1={SHARED_PLOT_LEFT}
                    x2={SHARED_PLOT_LEFT + PLOT_WIDTH}
                    y1={tick.y}
                    y2={tick.y}
                  />
                  <text
                    className="algorithm-trend-axis-label"
                    textAnchor="end"
                    x={SHARED_PLOT_LEFT - 10}
                    y={tick.y + 4}
                  >
                    {tick.label}
                  </text>
                </g>
              ))}

              {visibleIntervalAnnotations.map((annotation) => {
                const width = Math.max(1, annotation.endX - annotation.startX);
                return (
                  <rect
                    key={`annotation-fill-${annotation.label.id}`}
                    x={annotation.startX}
                    y={PLOT_TOP}
                    width={width}
                    height={PLOT_HEIGHT}
                    fill={annotation.label.color}
                    opacity={annotation.active ? 0.14 : 0.1}
                  />
                );
              })}

              {hasAnyChannelCurve && (
                <>
                  {channelCurves.map((entry, index) =>
                    entry.curve.length > 0 ? (
                      <polyline
                        key={entry.channelName}
                        fill="none"
                        stroke={getTrendChannelColor(entry.channelName, index)}
                        strokeWidth={entry.channelName === 'ch0' ? '1.5' : '1.35'}
                        strokeLinejoin="round"
                        strokeLinecap="round"
                        points={entry.polyline}
                      />
                    ) : null,
                  )}
                  <EngagementAlertOverlay
                    clipId={alertClipId}
                    polyline={polyline}
                    plotLeft={SHARED_PLOT_LEFT}
                    plotTop={PLOT_TOP}
                    plotBottom={PLOT_BOTTOM}
                    plotWidth={PLOT_WIDTH}
                    thresholdValue={engagementAlertThreshold}
                    thresholdY={alertThresholdY}
                    rangeMin={effectiveMin}
                    rangeMax={effectiveMax}
                    strokeWidth={1.5}
                  />
                  {initialUnreliableCurve.length > 1 && (
                    <polyline
                      fill="none"
                      stroke={INITIAL_UNRELIABLE_COLOR}
                      strokeWidth="2"
                      strokeLinejoin="round"
                      strokeLinecap="round"
                      points={initialUnreliablePolyline}
                    />
                  )}
                  {lastCurvePoint && (
                    <>
                      <circle
                        cx={lastCurvePoint.x}
                        cy={lastCurvePoint.y}
                        r="8"
                        fill={getTrendPointColor(lastCurvePoint.point)}
                        opacity={0.15}
                      />
                      <circle
                        cx={lastCurvePoint.x}
                        cy={lastCurvePoint.y}
                        r="3"
                        fill={getTrendPointColor(lastCurvePoint.point)}
                      />
                    </>
                  )}
                </>
              )}

              {hasAnyChannelCurve && (
                <g>
                  {channelCurves.map((entry, index) => (
                    <g
                      key={`legend-${entry.channelName}`}
                      transform={`translate(${SHARED_PLOT_LEFT + PLOT_WIDTH - 52 * (channelCurves.length - index)}, ${PLOT_TOP + 12})`}
                    >
                      <circle r="4" fill={getTrendChannelColor(entry.channelName, index)} />
                      <text x="10" y="4" className="algorithm-trend-axis-label">
                        {entry.channelName}
                      </text>
                    </g>
                  ))}
                </g>
              )}

              {visibleIntervalAnnotations.map((annotation, index) => {
                const labelX = Math.min(
                  Math.max(annotation.startX + 6, SHARED_PLOT_LEFT + 6),
                  SHARED_PLOT_LEFT + PLOT_WIDTH - 6,
                );
                const textAnchor = labelX > SHARED_PLOT_LEFT + PLOT_WIDTH - 96 ? 'end' : 'start';
                const labelY = PLOT_TOP + 16 + (index % 5) * 16;
                return (
                  <g key={`annotation-interval-${annotation.label.id}`}>
                    <title>{annotation.label.name}</title>
                    {annotation.showStartLine && (
                      <line
                        x1={annotation.startX}
                        x2={annotation.startX}
                        y1={PLOT_TOP}
                        y2={PLOT_BOTTOM}
                        stroke={annotation.label.color}
                        strokeOpacity={0.65}
                        strokeWidth={1.2}
                      />
                    )}
                    {annotation.showEndLine && (
                      <line
                        x1={annotation.endX}
                        x2={annotation.endX}
                        y1={PLOT_TOP}
                        y2={PLOT_BOTTOM}
                        stroke={annotation.label.color}
                        strokeOpacity={0.65}
                        strokeWidth={1.2}
                        strokeDasharray="3 3"
                      />
                    )}
                    <text
                      x={labelX}
                      y={labelY}
                      fill={annotation.label.color}
                      fontSize="11"
                      fontFamily="ui-monospace, JetBrains Mono, monospace"
                      fontWeight={600}
                      textAnchor={textAnchor}
                    >
                      {truncateAnnotationName(annotation.label.name)}
                      {annotation.active ? ` ${t(locale, 'annotations.active')}` : ''}
                    </text>
                  </g>
                );
              })}

              {visibleEventAnnotations.map((annotation, index) => {
                const labelX = Math.min(
                  Math.max(annotation.x + 6, SHARED_PLOT_LEFT + 6),
                  SHARED_PLOT_LEFT + PLOT_WIDTH - 6,
                );
                const textAnchor = labelX > SHARED_PLOT_LEFT + PLOT_WIDTH - 96 ? 'end' : 'start';
                const labelY =
                  PLOT_TOP + 16 + ((visibleIntervalAnnotations.length + index) % 5) * 16;
                return (
                  <g key={`annotation-event-${annotation.label.id}`}>
                    <title>{annotation.label.name}</title>
                    <line
                      x1={annotation.x}
                      x2={annotation.x}
                      y1={PLOT_TOP}
                      y2={PLOT_BOTTOM}
                      stroke={annotation.label.color}
                      strokeOpacity={0.75}
                      strokeWidth={1.2}
                      strokeDasharray="2 3"
                    />
                    <circle cx={annotation.x} cy={PLOT_TOP + 6} r={3} fill={annotation.label.color} />
                    <text
                      x={labelX}
                      y={labelY}
                      fill={annotation.label.color}
                      fontSize="11"
                      fontFamily="ui-monospace, JetBrains Mono, monospace"
                      fontWeight={600}
                      textAnchor={textAnchor}
                    >
                      {truncateAnnotationName(annotation.label.name)}
                    </text>
                  </g>
                );
              })}

              {selectedPoint && selectedPoint.engagementIndex !== null && (
                <>
                  <line
                    x1={getXForTime(selectedPoint.timeSeconds)}
                    x2={getXForTime(selectedPoint.timeSeconds)}
                    y1={PLOT_TOP}
                    y2={PLOT_BOTTOM}
                    stroke={ACCENT}
                    strokeOpacity={0.4}
                    strokeDasharray="2 3"
                  />
                  <circle
                    cx={getXForTime(selectedPoint.timeSeconds)}
                    cy={getYForValue(selectedPoint.engagementIndex)}
                    r="4"
                    fill={SELECTION_HOLE}
                    stroke={getTrendPointColor(selectedPoint)}
                    strokeWidth={1.5}
                  />
                </>
              )}

              <line
                className="algorithm-trend-axis"
                x1={SHARED_PLOT_LEFT}
                x2={SHARED_PLOT_LEFT + PLOT_WIDTH}
                y1={TIME_AXIS_Y}
                y2={TIME_AXIS_Y}
              />
              {timeTicks.map((tick) => (
                <g key={`t-${tick.x}-${tick.label}`}>
                  <line
                    className="algorithm-trend-axis-tick"
                    x1={tick.x}
                    x2={tick.x}
                    y1={TIME_AXIS_Y - 3}
                    y2={TIME_AXIS_Y + 4}
                  />
                  <text
                    className="algorithm-trend-axis-label"
                    textAnchor={
                      tick.x === SHARED_PLOT_LEFT
                        ? 'start'
                        : tick.x === SHARED_PLOT_LEFT + PLOT_WIDTH
                          ? 'end'
                          : 'middle'
                    }
                    x={tick.x}
                    y={TIME_AXIS_Y + 20}
                  >
                    {tick.label}
                  </text>
                </g>
              ))}
            </svg>

            {selectedPoint && tooltipStyle && (
              <div
                className="absolute z-10 rounded-sm border border-accent bg-surface-2 px-2.5 py-1.5 pointer-events-auto"
                style={tooltipStyle}
              >
                <div className="flex items-center justify-between gap-3">
                  <span className="font-mono text-[0.7rem] tabular text-meta">
                    {t(locale, 'chart.tooltipTime')}
                  </span>
                  <span className="font-mono text-[0.78rem] tabular text-ink">
                    {formatRelativeSeconds(latestTimeSeconds - selectedPoint.timeSeconds)}
                  </span>
                </div>
                <div className="mt-1 flex items-center justify-between gap-3">
                  <span className="font-mono text-[0.7rem] tabular text-meta">
                    {t(locale, 'chart.tooltipValue')}
                  </span>
                  <span
                    className={`font-mono text-[0.78rem] tabular ${
                      selectedPoint.timeSeconds <= initialUnreliableSeconds
                        ? 'text-warn'
                        : isBelowEngagementAlert(
                            selectedPoint.engagementIndex,
                            engagementAlertThreshold,
                          )
                          ? 'text-error'
                          : 'text-accent'
                    }`}
                  >
                    {formatAnalysisMetric(selectedPoint.engagementIndex)}
                  </span>
                </div>
                <button
                  type="button"
                  onClick={() => setSelectedSampleIndex(null)}
                  aria-label={t(locale, 'chart.tooltipClose')}
                  className="absolute -top-2 -right-2 h-4 w-4 rounded-full border border-hairline bg-surface-2 text-[0.6rem] leading-none text-meta hover:text-ink"
                >
                  ×
                </button>
              </div>
            )}
          </div>
        )}

      </CardBody>
    </Card>
  );
}
