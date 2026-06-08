import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type KeyboardEvent,
} from 'react';
import { Play, RotateCcw, Upload, X } from 'lucide-react';
import {
  EEG_LIVE_WINDOW_MAX_SECONDS,
  EEG_LIVE_WINDOW_MIN_SECONDS,
} from '../config/eeg';
import type { Locale } from '../i18n';
import { t } from '../i18n';
import { useEegStore } from '../store/eegStore';
import { getEffectiveEegHardwareSampleRateHz } from '../transport/eegHardwareConfig';
import { formatAnalysisMetric, formatAnalysisSeconds } from '../utils/analysisFormat';
import { Button, Card, CardBody, CardHeader, Field, NumberInput, ToggleSwitch } from '../components/ui';
import {
  FOCUS_BASELINE_SECONDS,
  FOCUS_DECISION_MAX_SECONDS,
  FOCUS_DECISION_MIN_SECONDS,
  FOCUS_WARMUP_SECONDS,
} from './config';
import type { EegFocusCalibrationPhase, EegFocusStatePoint } from './types';

interface FocusStatePanelProps {
  locale: Locale;
}

const SVG_WIDTH = 900;
const SVG_HEIGHT = 300;
const PLOT_LEFT = 78;
const PLOT_RIGHT = 24;
const PLOT_TOP = 24;
const PLOT_BOTTOM = 220;
const PLOT_WIDTH = SVG_WIDTH - PLOT_LEFT - PLOT_RIGHT;
const PLOT_HEIGHT = PLOT_BOTTOM - PLOT_TOP;
const TIME_TICK_COUNT = 5;
const FOCUS_LINE_COLOR = '#0e7490';
const GRID_COLOR = '#d7dde5';
const EMPTY_FOCUS_STATE_POINTS: EegFocusStatePoint[] = [];

function clampWindowSeconds(seconds: number): number {
  if (!Number.isFinite(seconds)) return 300;
  return Math.max(
    EEG_LIVE_WINDOW_MIN_SECONDS,
    Math.min(EEG_LIVE_WINDOW_MAX_SECONDS, Math.round(seconds)),
  );
}

function clampOutputWindowSeconds(seconds: number): number {
  if (!Number.isFinite(seconds)) return 30;
  return Math.max(
    FOCUS_DECISION_MIN_SECONDS,
    Math.min(FOCUS_DECISION_MAX_SECONDS, Math.round(seconds)),
  );
}

function getCurrentStreamTimeSeconds(sampleCount: number, sampleRateHz: number): number {
  if (!Number.isFinite(sampleCount) || sampleCount <= 0) return 0;
  return (sampleCount - 1) / sampleRateHz;
}

function getPhaseLabel(locale: Locale, phase: EegFocusCalibrationPhase): string {
  switch (phase) {
    case 'waiting-warmup':
      return t(locale, 'focus.phaseWaitingWarmup');
    case 'collecting-baseline':
      return t(locale, 'focus.phaseCollectingBaseline');
    case 'active':
      return t(locale, 'focus.phaseActive');
    default:
      return t(locale, 'focus.phaseIdle');
  }
}

function getFocusStateLabel(locale: Locale, state: 0 | 1 | null): string {
  if (state === 1) return t(locale, 'focus.focused');
  if (state === 0) return t(locale, 'focus.notFocused');
  return '-';
}

function getX(timeSeconds: number, visibleStartSeconds: number, visibleEndSeconds: number): number {
  const span = Math.max(1, visibleEndSeconds - visibleStartSeconds);
  return PLOT_LEFT + ((timeSeconds - visibleStartSeconds) / span) * PLOT_WIDTH;
}

function getY(state: 0 | 1): number {
  return state === 1 ? PLOT_TOP : PLOT_BOTTOM;
}

function buildStepPath(
  points: EegFocusStatePoint[],
  visibleStartSeconds: number,
  visibleEndSeconds: number,
): string {
  if (points.length === 0) return '';

  let path = `M ${getX(points[0].timeSeconds, visibleStartSeconds, visibleEndSeconds)} ${getY(
    points[0].state,
  )}`;

  for (let index = 1; index < points.length; index += 1) {
    const point = points[index];
    const x = getX(point.timeSeconds, visibleStartSeconds, visibleEndSeconds);
    const y = getY(point.state);
    path += ` H ${x} V ${y}`;
  }

  path += ` H ${getX(visibleEndSeconds, visibleStartSeconds, visibleEndSeconds)}`;
  return path;
}

export function FocusStatePanel({ locale }: FocusStatePanelProps) {
  const stream = useEegStore((state) => state.stream);
  const hardwareConfig = useEegStore((state) => state.acquisition.hardwareConfig);
  const isDrawingEnabled = useEegStore((state) => state.drawing.focusState);
  const setDrawingEnabled = useEegStore((state) => state.setDrawingEnabled);
  const focusOutputWindowSeconds = useEegStore(
    (state) => state.analysis.focusOutputWindowSeconds,
  );
  const focusCalibration = useEegStore((state) => state.analysis.focusCalibration);
  const focusStatePoints = useEegStore((state) =>
    isDrawingEnabled ? state.focusStatePoints : EMPTY_FOCUS_STATE_POINTS,
  );
  const liveWindowSeconds = useEegStore((state) => state.analysis.liveWindowSeconds);
  const beginFocusBaseline = useEegStore((state) => state.beginFocusBaseline);
  const setFocusReferenceValue = useEegStore((state) => state.setFocusReferenceValue);
  const setLiveWindowSeconds = useEegStore((state) => state.setLiveWindowSeconds);
  const setFocusOutputWindowSeconds = useEegStore(
    (state) => state.setFocusOutputWindowSeconds,
  );
  const isStreamBusy = stream.isStarting || stream.isStreaming;

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const videoFileInputRef = useRef<HTMLInputElement | null>(null);
  const [windowDraft, setWindowDraft] = useState(String(liveWindowSeconds));
  const [outputWindowDraft, setOutputWindowDraft] = useState(String(focusOutputWindowSeconds));
  const [referenceDraft, setReferenceDraft] = useState('');
  const [selectedVideoName, setSelectedVideoName] = useState<string | null>(null);
  const [selectedVideoObjectUrl, setSelectedVideoObjectUrl] = useState<string | null>(null);
  const [videoFailed, setVideoFailed] = useState(false);

  const sampleRateHz = getEffectiveEegHardwareSampleRateHz(hardwareConfig);
  const currentStreamTimeSeconds = getCurrentStreamTimeSeconds(
    stream.sampleCount,
    sampleRateHz,
  );
  const warmupRemainingSeconds = Math.max(
    0,
    FOCUS_WARMUP_SECONDS - currentStreamTimeSeconds,
  );
  const isWarmupReady = currentStreamTimeSeconds >= FOCUS_WARMUP_SECONDS;
  const isCollectingBaseline = focusCalibration.phase === 'collecting-baseline';
  const canCollectBaseline = stream.isStreaming && isWarmupReady;
  const baselineRemainingSeconds =
    isCollectingBaseline && focusCalibration.baselineEndsAtSeconds !== null
      ? Math.max(0, focusCalibration.baselineEndsAtSeconds - currentStreamTimeSeconds)
      : 0;
  const baselineProgress =
    isCollectingBaseline && focusCalibration.baselineStartedAtSeconds !== null
      ? Math.max(
          0,
          Math.min(
            1,
            (currentStreamTimeSeconds - focusCalibration.baselineStartedAtSeconds) /
              FOCUS_BASELINE_SECONDS,
          ),
        )
      : 0;
  const calibrationVideoSrc = selectedVideoObjectUrl;

  useEffect(() => {
    const value = focusCalibration.referenceValue;
    setReferenceDraft(value === null ? '' : formatAnalysisMetric(value));
  }, [focusCalibration.referenceValue]);

  useEffect(() => {
    setOutputWindowDraft(String(focusOutputWindowSeconds));
  }, [focusOutputWindowSeconds]);

  useEffect(() => {
    setWindowDraft(String(liveWindowSeconds));
  }, [liveWindowSeconds]);

  useEffect(() => {
    return () => {
      if (selectedVideoObjectUrl) {
        URL.revokeObjectURL(selectedVideoObjectUrl);
      }
    };
  }, [selectedVideoObjectUrl]);

  useEffect(() => {
    setVideoFailed(false);
    if (!calibrationVideoSrc) return;
    if (!isCollectingBaseline) return;

    const video = videoRef.current;
    if (!video) return;

    video.currentTime = 0;
    const playPromise = video.play();
    if (playPromise) {
      void playPromise.catch(() => setVideoFailed(true));
    }
  }, [calibrationVideoSrc, isCollectingBaseline, focusCalibration.baselineStartedAtSeconds]);

  const latestTimeSeconds = Math.max(
    currentStreamTimeSeconds,
    focusStatePoints[focusStatePoints.length - 1]?.timeSeconds ?? 0,
  );
  const visibleEndSeconds = Math.max(1, latestTimeSeconds);
  const visibleStartSeconds = Math.max(0, visibleEndSeconds - liveWindowSeconds);
  const chartPoints = useMemo(() => {
    const visiblePoints = focusStatePoints.filter(
      (point) =>
        point.timeSeconds >= visibleStartSeconds && point.timeSeconds <= visibleEndSeconds,
    );
    const precedingPoint = [...focusStatePoints]
      .reverse()
      .find((point) => point.timeSeconds < visibleStartSeconds);

    if (!precedingPoint) return visiblePoints;
    return [{ ...precedingPoint, timeSeconds: visibleStartSeconds }, ...visiblePoints];
  }, [focusStatePoints, visibleEndSeconds, visibleStartSeconds]);
  const stepPath = buildStepPath(chartPoints, visibleStartSeconds, visibleEndSeconds);
  const timeTicks = Array.from({ length: TIME_TICK_COUNT }, (_, index) => {
    const ratio = index / (TIME_TICK_COUNT - 1);
    return visibleStartSeconds + (visibleEndSeconds - visibleStartSeconds) * ratio;
  });

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

  function commitOutputWindowSeconds(raw: string): void {
    const next = clampOutputWindowSeconds(Number(raw));
    setFocusOutputWindowSeconds(next);
    setOutputWindowDraft(String(next));
  }

  function handleOutputWindowSecondsChange(event: ChangeEvent<HTMLInputElement>): void {
    const raw = event.currentTarget.value;
    setOutputWindowDraft(raw);

    const parsed = Number(raw);
    if (
      Number.isFinite(parsed) &&
      parsed >= FOCUS_DECISION_MIN_SECONDS &&
      parsed <= FOCUS_DECISION_MAX_SECONDS
    ) {
      setFocusOutputWindowSeconds(Math.round(parsed));
    }
  }

  function handleOutputWindowSecondsKeyDown(event: KeyboardEvent<HTMLInputElement>): void {
    if (event.key !== 'Enter') return;
    commitOutputWindowSeconds(event.currentTarget.value);
    event.currentTarget.blur();
  }

  function handleReferenceChange(event: ChangeEvent<HTMLInputElement>): void {
    const raw = event.currentTarget.value;
    setReferenceDraft(raw);

    const parsed = Number(raw);
    if (Number.isFinite(parsed) && parsed >= 0) {
      setFocusReferenceValue(parsed);
    }
  }

  function handleReferenceBlur(): void {
    const parsed = Number(referenceDraft);
    if (!Number.isFinite(parsed) || parsed < 0) {
      const value = focusCalibration.referenceValue;
      setReferenceDraft(value === null ? '' : formatAnalysisMetric(value));
    }
  }

  function handleChooseVideoClick(): void {
    videoFileInputRef.current?.click();
  }

  function handleVideoFileChange(event: ChangeEvent<HTMLInputElement>): void {
    const file = event.currentTarget.files?.[0] ?? null;
    if (!file) return;

    setSelectedVideoObjectUrl(URL.createObjectURL(file));
    setSelectedVideoName(file.name);
    setVideoFailed(false);
  }

  function handleClearVideoClick(): void {
    setSelectedVideoObjectUrl(null);
    setSelectedVideoName(null);
    setVideoFailed(false);

    if (videoFileInputRef.current) {
      videoFileInputRef.current.value = '';
    }
  }

  return (
    <Card ariaLabelledBy="focus-state-title">
      <CardHeader
        eyebrow={t(locale, 'focus.eyebrow')}
        title={t(locale, 'focus.title', { seconds: focusOutputWindowSeconds })}
        titleId="focus-state-title"
        trailing={
          <div className="flex flex-wrap items-center justify-end gap-2">
            <ToggleSwitch
              label={t(locale, 'chart.drawToggle')}
              checked={isDrawingEnabled}
              onCheckedChange={(checked) => setDrawingEnabled('focusState', checked)}
              disabled={!isStreamBusy}
            />
            <Button
              size="sm"
              variant={focusCalibration.phase === 'idle' ? 'primary' : 'ghost'}
              onClick={beginFocusBaseline}
              disabled={!canCollectBaseline}
              title={
                !stream.isStreaming
                  ? t(locale, 'focus.streamRequired')
                  : !isWarmupReady
                    ? t(locale, 'focus.warmupLocked', {
                        seconds: Math.ceil(warmupRemainingSeconds),
                      })
                    : undefined
              }
            >
              {focusCalibration.phase === 'idle' ? <Play size={15} /> : <RotateCcw size={15} />}
              {t(locale, 'focus.collectBaseline')}
            </Button>
          </div>
        }
      />

      <CardBody className="space-y-4">
        <div className="grid gap-3 lg:grid-cols-[1.05fr_0.95fr]">
          <div className="grid gap-3 sm:grid-cols-4">
            <div className="border border-hairline bg-surface-2 px-3 py-2">
              <div className="font-mono text-[0.62rem] uppercase tracking-[0.08em] text-meta">
                {t(locale, 'focus.phaseLabel')}
              </div>
              <div className="mt-1 text-[0.9rem] font-medium text-ink">
                {getPhaseLabel(locale, focusCalibration.phase)}
              </div>
            </div>
            <div className="border border-hairline bg-surface-2 px-3 py-2">
              <div className="font-mono text-[0.62rem] uppercase tracking-[0.08em] text-meta">
                {t(locale, 'focus.currentStateLabel')}
              </div>
              <div className="mt-1 text-[0.9rem] font-medium text-ink">
                {getFocusStateLabel(locale, focusCalibration.focusState)}
              </div>
            </div>
            <div className="border border-hairline bg-surface-2 px-3 py-2">
              <div className="font-mono text-[0.62rem] uppercase tracking-[0.08em] text-meta">
                {t(locale, 'focus.baselineLabel')}
              </div>
              <div className="mt-1 font-mono text-[0.9rem] text-ink">
                {formatAnalysisMetric(focusCalibration.baselineValue)}
              </div>
            </div>
            <div className="border border-hairline bg-surface-2 px-3 py-2">
              <div className="font-mono text-[0.62rem] uppercase tracking-[0.08em] text-meta">
                {t(locale, 'focus.lastWindowLabel', {
                  seconds: focusOutputWindowSeconds,
                })}
              </div>
              <div className="mt-1 font-mono text-[0.9rem] text-ink">
                {formatAnalysisMetric(focusCalibration.focusValue)}
              </div>
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <Field
              label={t(locale, 'focus.referenceLabel')}
              htmlFor="focus-reference-value"
              hint={t(locale, 'focus.referenceHint')}
            >
              <NumberInput
                id="focus-reference-value"
                value={referenceDraft}
                min={0}
                step={0.01}
                disabled={focusCalibration.baselineValue === null}
                onChange={handleReferenceChange}
                onBlur={handleReferenceBlur}
              />
            </Field>
            <Field
              label={t(locale, 'focus.videoSourceLabel')}
              hint={t(locale, 'focus.videoSourceHint')}
            >
              <div className="flex items-center gap-2">
                <input
                  ref={videoFileInputRef}
                  type="file"
                  accept="video/mp4,video/webm,video/quicktime,video/*"
                  className="sr-only"
                  onChange={handleVideoFileChange}
                />
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  className="shrink-0"
                  onClick={handleChooseVideoClick}
                >
                  <Upload size={14} strokeWidth={1.5} />
                  {t(locale, 'focus.chooseVideo')}
                </Button>
                {selectedVideoName && (
                  <Button
                    type="button"
                    size="sm"
                    variant="quiet"
                    onClick={handleClearVideoClick}
                    aria-label={t(locale, 'focus.clearVideo')}
                  >
                    <X size={14} strokeWidth={1.5} />
                  </Button>
                )}
              </div>
              <div className="truncate font-mono text-[0.72rem] text-meta">
                {selectedVideoName ?? t(locale, 'focus.placeholderVideo')}
              </div>
            </Field>
            <Field
              label={t(locale, 'focus.outputWindowSecondsLabel')}
              htmlFor="focus-output-window-seconds"
              hint={t(locale, 'focus.outputWindowSecondsHint')}
            >
              <NumberInput
                id="focus-output-window-seconds"
                value={outputWindowDraft}
                min={FOCUS_DECISION_MIN_SECONDS}
                max={FOCUS_DECISION_MAX_SECONDS}
                step={5}
                onChange={handleOutputWindowSecondsChange}
                onBlur={(event) => commitOutputWindowSeconds(event.currentTarget.value)}
                onKeyDown={handleOutputWindowSecondsKeyDown}
              />
            </Field>
            <Field
              label={t(locale, 'chart.windowSecondsLabel')}
              htmlFor="focus-window-seconds"
              hint={t(locale, 'chart.windowSecondsHint')}
            >
              <NumberInput
                id="focus-window-seconds"
                value={windowDraft}
                min={EEG_LIVE_WINDOW_MIN_SECONDS}
                max={EEG_LIVE_WINDOW_MAX_SECONDS}
                step={30}
                onChange={handleWindowSecondsChange}
                onBlur={(event) => commitWindowSeconds(event.currentTarget.value)}
                onKeyDown={handleWindowSecondsKeyDown}
              />
            </Field>
          </div>
        </div>

        {!stream.isStreaming && (
          <p className="m-0 text-[0.85rem] text-meta">{t(locale, 'focus.streamRequired')}</p>
        )}

        {stream.isStreaming && !isWarmupReady && (
          <p className="m-0 text-[0.85rem] text-meta">
            {t(locale, 'focus.warmupLocked', {
              seconds: Math.ceil(warmupRemainingSeconds),
            })}
          </p>
        )}

        {isCollectingBaseline && (
          <div className="grid gap-3 lg:grid-cols-[0.9fr_1.1fr]">
            <div className="relative min-h-[11rem] overflow-hidden rounded-sm border border-hairline bg-ink">
              {calibrationVideoSrc && !videoFailed && (
                <video
                  key={`${calibrationVideoSrc}-${focusCalibration.baselineStartedAtSeconds ?? 'baseline'}`}
                  ref={videoRef}
                  className="h-full min-h-[11rem] w-full object-cover"
                  muted
                  playsInline
                  autoPlay
                  src={calibrationVideoSrc}
                  onError={() => setVideoFailed(true)}
                />
              )}
              {(!calibrationVideoSrc || videoFailed) && (
                <div className="grid min-h-[11rem] place-items-center bg-[radial-gradient(circle_at_center,#e0f2fe_0,#67e8f9_18%,#164e63_52%,#020617_100%)]">
                  <div className="h-16 w-16 rounded-full border border-white/70 bg-white/15 shadow-[0_0_48px_rgba(255,255,255,0.55)] animate-pulse" />
                </div>
              )}
            </div>
            <div className="flex flex-col justify-center gap-3 border border-hairline bg-surface-2 px-4 py-3">
              <div className="flex items-baseline justify-between gap-3">
                <span className="font-mono text-[0.68rem] uppercase tracking-[0.08em] text-meta">
                  {t(locale, 'focus.baselineCountdown')}
                </span>
                <span className="font-mono text-[1.2rem] tabular text-ink">
                  {formatAnalysisSeconds(baselineRemainingSeconds)}
                </span>
              </div>
              <div className="h-2 overflow-hidden rounded-sm bg-paper">
                <div
                  className="h-full bg-accent transition-[width] duration-300"
                  style={{ width: `${baselineProgress * 100}%` }}
                />
              </div>
              <p className="m-0 text-[0.85rem] leading-snug text-meta">
                {t(
                  locale,
                  calibrationVideoSrc && !videoFailed
                    ? 'focus.videoCaption'
                    : 'focus.placeholderCaption',
                )}
              </p>
            </div>
          </div>
        )}

        <div className="overflow-hidden border border-hairline bg-surface-2">
          <svg
            className="block h-auto w-full"
            viewBox={`0 0 ${SVG_WIDTH} ${SVG_HEIGHT}`}
            role="img"
            aria-label={t(locale, 'focus.title', { seconds: focusOutputWindowSeconds })}
          >
            <rect
              x={PLOT_LEFT}
              y={PLOT_TOP}
              width={PLOT_WIDTH}
              height={PLOT_HEIGHT}
              fill="#ffffff"
              stroke={GRID_COLOR}
            />

            {[0, 1].map((state) => {
              const y = getY(state as 0 | 1);
              return (
                <g key={state}>
                  <line
                    x1={PLOT_LEFT}
                    x2={PLOT_LEFT + PLOT_WIDTH}
                    y1={y}
                    y2={y}
                    stroke={GRID_COLOR}
                    strokeDasharray={state === 0 ? '0' : '4 4'}
                  />
                  <text
                    x={PLOT_LEFT - 12}
                    y={y + 4}
                    textAnchor="end"
                    className="algorithm-trend-axis-label"
                  >
                    {state === 1 ? t(locale, 'focus.focused') : t(locale, 'focus.notFocused')}
                  </text>
                </g>
              );
            })}

            {timeTicks.map((tick) => {
              const x = getX(tick, visibleStartSeconds, visibleEndSeconds);
              return (
                <g key={tick}>
                  <line
                    x1={x}
                    x2={x}
                    y1={PLOT_TOP}
                    y2={PLOT_BOTTOM}
                    stroke={GRID_COLOR}
                    strokeDasharray="3 5"
                  />
                  <text
                    x={x}
                    y={PLOT_BOTTOM + 32}
                    textAnchor="middle"
                    className="algorithm-trend-axis-label"
                  >
                    {formatAnalysisSeconds(tick)}
                  </text>
                </g>
              );
            })}

            <line
              x1={PLOT_LEFT}
              x2={PLOT_LEFT + PLOT_WIDTH}
              y1={PLOT_BOTTOM}
              y2={PLOT_BOTTOM}
              className="algorithm-trend-axis"
            />
            <line
              x1={PLOT_LEFT}
              x2={PLOT_LEFT}
              y1={PLOT_TOP}
              y2={PLOT_BOTTOM}
              className="algorithm-trend-axis"
            />

            {isDrawingEnabled && stepPath && (
              <path
                d={stepPath}
                fill="none"
                stroke={FOCUS_LINE_COLOR}
                strokeWidth={4}
                strokeLinejoin="round"
                strokeLinecap="round"
              />
            )}

            {isDrawingEnabled && chartPoints.map((point) => (
              <circle
                key={`${point.windowEndSeconds}-${point.state}`}
                cx={getX(point.timeSeconds, visibleStartSeconds, visibleEndSeconds)}
                cy={getY(point.state)}
                r={4.5}
                fill="#ffffff"
                stroke={FOCUS_LINE_COLOR}
                strokeWidth={2}
              />
            ))}

            {(!isDrawingEnabled || !stepPath) && (
              <text
                x={PLOT_LEFT + PLOT_WIDTH / 2}
                y={PLOT_TOP + PLOT_HEIGHT / 2}
                textAnchor="middle"
                className="algorithm-trend-axis-label"
              >
                {isDrawingEnabled
                  ? t(locale, 'focus.empty', { seconds: focusOutputWindowSeconds })
                  : t(locale, stream.isStreaming ? 'chart.drawOff' : 'chart.drawNeedsStream')}
              </text>
            )}
          </svg>
        </div>
      </CardBody>
    </Card>
  );
}
