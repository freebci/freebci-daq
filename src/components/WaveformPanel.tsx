import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import type { Locale, TranslationKey } from '../i18n';
import { t } from '../i18n';
import type { WaveformBus } from '../state/waveformBus';
import { useEegStore } from '../store/eegStore';
import { getEegChannelNames } from '../transport/eegChannels';
import { getEffectiveEegHardwareSampleRateHz } from '../transport/eegHardwareConfig';
import type { EegDrawingState } from '../types/acquisition';
import { Card, CardBody, CardHeader, ToggleSwitch } from './ui';
import { SHARED_PLOT_LEFT, SHARED_PLOT_RIGHT } from './AlgorithmTrendPanel';

type WaveformSampleBus = Pick<
  WaveformBus,
  'getWriteIndex' | 'copyLatest' | 'copyLatestLeadOff' | 'getChannelNames' | 'getCapacity'
>;
type WaveformDrawingKey = Extract<keyof EegDrawingState, 'rawWaveform' | 'filteredWaveform'>;

interface WaveformPanelProps {
  locale: Locale;
  bus: WaveformSampleBus;
  drawingKey: WaveformDrawingKey;
  ariaLabelledBy: string;
  titleId: string;
  eyebrowKey: TranslationKey;
  titleKey: TranslationKey;
  emptyKey: TranslationKey;
  strokeColor: string;
  secondaryStrokeColor?: string;
  hairlineColor: string;
  metaColor: string;
  zeroLineColor: string;
}

const CANVAS_WIDTH = 900;
const MIN_CANVAS_HEIGHT = 360;
const MAX_CANVAS_HEIGHT = 560;
const PLOT_LEFT = SHARED_PLOT_LEFT;
const PLOT_RIGHT = SHARED_PLOT_RIGHT;
const PLOT_TOP = 18;
const PLOT_WIDTH = CANVAS_WIDTH - PLOT_LEFT - PLOT_RIGHT;
const AXIS_RESERVED_HEIGHT = 40;
const TIME_TICK_COUNT = 5;
const CLICK_DRAG_THRESHOLD_PX = 4;
const TARGET_FRAME_INTERVAL_MS = 1000 / 30;
const LEAD_OFF_STROKE_COLOR = '#d97706';
const EXTRA_CHANNEL_STROKES = [
  '#7c3aed',
  '#059669',
  '#db2777',
  '#4f46e5',
  '#dc2626',
  '#0891b2',
] as const;

function formatMicrovolts(volts: number): string {
  const microvolts = volts * 1_000_000;
  if (Math.abs(microvolts) >= 1000) return `${(microvolts / 1000).toFixed(2)} mV`;
  return `${microvolts.toFixed(1)} µV`;
}

function formatSecondsAgo(seconds: number): string {
  if (seconds < 10) return `t-${seconds.toFixed(2)}s`;
  return `t-${seconds.toFixed(1)}s`;
}

function getChannelStrokeColor(
  channelName: string,
  channelIndex: number,
  primaryStrokeColor: string,
  secondaryStrokeColor: string,
): string {
  if (channelName === 'ch0') return primaryStrokeColor;
  if (channelName === 'ch1') return secondaryStrokeColor;
  return EXTRA_CHANNEL_STROKES[
    (channelIndex - 2 + EXTRA_CHANNEL_STROKES.length) % EXTRA_CHANNEL_STROKES.length
  ];
}

interface DragState {
  pointerId: number;
  startClientX: number;
  startClientY: number;
  moved: boolean;
}

interface SelectedSample {
  channelName: string;
  writeIndex: number;
  value: number;
}

interface WaveformLayout {
  canvasHeight: number;
  plotBottom: number;
  plotHeight: number;
  laneGap: number;
  laneHeight: number;
  timeAxisY: number;
}

interface SampleRange {
  min: number;
  max: number;
  span: number;
}

function createWaveformLayout(channelCount: number): WaveformLayout {
  const count = Math.max(1, channelCount);
  const canvasHeight = Math.min(
    MAX_CANVAS_HEIGHT,
    Math.max(MIN_CANVAS_HEIGHT, 86 + count * 54),
  );
  const plotBottom = canvasHeight - AXIS_RESERVED_HEIGHT;
  const plotHeight = plotBottom - PLOT_TOP;
  const laneGap = count <= 2 ? 10 : count <= 4 ? 8 : 5;
  const laneHeight = (plotHeight - laneGap * (count - 1)) / count;

  return {
    canvasHeight,
    plotBottom,
    plotHeight,
    laneGap,
    laneHeight,
    timeAxisY: plotBottom + 14,
  };
}

function getLaneTop(index: number, layout: WaveformLayout): number {
  return PLOT_TOP + index * (layout.laneHeight + layout.laneGap);
}

function createSampleRange(buffer: Float32Array, actual: number): SampleRange {
  let min = Infinity;
  let max = -Infinity;

  for (let index = 0; index < actual; index += 1) {
    const value = buffer[index];
    if (value < min) min = value;
    if (value > max) max = value;
  }

  if (!Number.isFinite(min) || !Number.isFinite(max)) {
    min = -1e-6;
    max = 1e-6;
  } else if (min === max) {
    const pad = Math.max(Math.abs(min) * 0.08, 1e-6);
    min -= pad;
    max += pad;
  } else {
    const pad = (max - min) * 0.08;
    min -= pad;
    max += pad;
  }

  return {
    min,
    max,
    span: Math.max(max - min, Number.EPSILON),
  };
}

export function WaveformPanel({
  locale,
  bus,
  drawingKey,
  ariaLabelledBy,
  titleId,
  eyebrowKey,
  titleKey,
  emptyKey,
  strokeColor,
  secondaryStrokeColor = '#b45309',
  hairlineColor,
  metaColor,
  zeroLineColor,
}: WaveformPanelProps) {
  const isStreaming = useEegStore(
    (state) => state.stream.isStreaming || state.stream.isStarting,
  );
  const channelCount = useEegStore((state) => state.acquisition.channelCount);
  const hardwareConfig = useEegStore((state) => state.acquisition.hardwareConfig);
  const liveWindowSeconds = useEegStore((state) => state.analysis.liveWindowSeconds);
  const sampleRateHz = getEffectiveEegHardwareSampleRateHz(hardwareConfig);
  const windowSampleCount = Math.max(
    2,
    Math.min(bus.getCapacity(), Math.round(liveWindowSeconds * sampleRateHz)),
  );
  const visibleWindowSeconds = windowSampleCount / sampleRateHz;
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const metaRef = useRef<HTMLSpanElement | null>(null);
  const sampleBuffersRef = useRef<Map<string, Float32Array>>(new Map());
  const leadOffBuffersRef = useRef<Map<string, Uint8Array>>(new Map());

  const lastCurrentWriteIndexesRef = useRef<Map<string, number>>(new Map());
  const lastActualCountsRef = useRef<Map<string, number>>(new Map());
  const selectedRef = useRef<SelectedSample | null>(null);

  const dragRef = useRef<DragState | null>(null);
  const [selected, setSelected] = useState<SelectedSample | null>(null);
  const [tooltipTick, setTooltipTick] = useState(0);
  const isDrawingEnabled = useEegStore((state) => state.drawing[drawingKey]);
  const setDrawingEnabled = useEegStore((state) => state.setDrawingEnabled);
  const configuredChannelNames = useMemo(
    () => getEegChannelNames(channelCount),
    [channelCount],
  );
  const layout = useMemo(
    () => createWaveformLayout(configuredChannelNames.length),
    [configuredChannelNames.length],
  );

  for (const channelName of configuredChannelNames) {
    const existing = sampleBuffersRef.current.get(channelName);
    if (!existing || existing.length !== windowSampleCount) {
      sampleBuffersRef.current.set(channelName, new Float32Array(windowSampleCount));
    }
    const existingLeadOff = leadOffBuffersRef.current.get(channelName);
    if (!existingLeadOff || existingLeadOff.length !== windowSampleCount) {
      leadOffBuffersRef.current.set(channelName, new Uint8Array(windowSampleCount));
    }
  }

  selectedRef.current = selected;

  useEffect(() => {
    if (!isDrawingEnabled) {
      setSelected(null);
    }
  }, [isDrawingEnabled]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = CANVAS_WIDTH * dpr;
    canvas.height = layout.canvasHeight * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    let frameId: number | null = null;
    let tickCounter = 0;
    let lastPaintAt = 0;

    function draw(frameTimeMs: number): void {
      if (!ctx) return;
      if (!isDrawingEnabled) {
        ctx.clearRect(0, 0, CANVAS_WIDTH, layout.canvasHeight);
        ctx.fillStyle = metaColor;
        ctx.font = '12px ui-monospace, "JetBrains Mono", monospace';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(
          t(locale, isStreaming ? 'chart.drawOff' : emptyKey),
          CANVAS_WIDTH / 2,
          layout.canvasHeight / 2,
        );
        if (metaRef.current) {
          metaRef.current.textContent = isStreaming
            ? t(locale, 'chart.drawOff')
            : t(locale, emptyKey);
        }
        return;
      }

      if (frameTimeMs - lastPaintAt < TARGET_FRAME_INTERVAL_MS) {
        frameId = window.requestAnimationFrame(draw);
        return;
      }
      lastPaintAt = frameTimeMs;

      const channelBuffers = configuredChannelNames.map((channelName, channelIndex) => {
        let buffer = sampleBuffersRef.current.get(channelName);
        if (!buffer || buffer.length !== windowSampleCount) {
          buffer = new Float32Array(windowSampleCount);
          sampleBuffersRef.current.set(channelName, buffer);
        }
        let leadOffFlags = leadOffBuffersRef.current.get(channelName);
        if (!leadOffFlags || leadOffFlags.length !== windowSampleCount) {
          leadOffFlags = new Uint8Array(windowSampleCount);
          leadOffBuffersRef.current.set(channelName, leadOffFlags);
        }
        const writeIndex = bus.getWriteIndex(channelName);
        const actual = bus.copyLatest(buffer, windowSampleCount, channelName);
        bus.copyLatestLeadOff(leadOffFlags, windowSampleCount, channelName);
        lastCurrentWriteIndexesRef.current.set(channelName, writeIndex);
        lastActualCountsRef.current.set(channelName, actual);
        return {
          channelName,
          channelIndex,
          buffer,
          writeIndex,
          actual,
          leadOffFlags,
          color: getChannelStrokeColor(
            channelName,
            channelIndex,
            strokeColor,
            secondaryStrokeColor,
          ),
          range: createSampleRange(buffer, actual),
        };
      });
      const maxActual = Math.max(0, ...channelBuffers.map((entry) => entry.actual));

      ctx.clearRect(0, 0, CANVAS_WIDTH, layout.canvasHeight);

      ctx.strokeStyle = hairlineColor;
      ctx.lineWidth = 1;

      ctx.beginPath();
      ctx.moveTo(PLOT_LEFT, layout.timeAxisY);
      ctx.lineTo(PLOT_LEFT + PLOT_WIDTH, layout.timeAxisY);
      ctx.stroke();
      ctx.fillStyle = metaColor;
      ctx.font = '11px ui-monospace, "JetBrains Mono", monospace';
      ctx.textBaseline = 'top';
      for (let i = 0; i < TIME_TICK_COUNT; i += 1) {
        const ratio = i / (TIME_TICK_COUNT - 1);
        const x = PLOT_LEFT + ratio * PLOT_WIDTH;
        ctx.beginPath();
        ctx.moveTo(x, layout.timeAxisY - 3);
        ctx.lineTo(x, layout.timeAxisY + 3);
        ctx.stroke();
        const secondsAgo = (1 - ratio) * visibleWindowSeconds;
        const label = secondsAgo === 0 ? 'now' : `-${secondsAgo.toFixed(0)}s`;
        ctx.textAlign = i === 0 ? 'left' : i === TIME_TICK_COUNT - 1 ? 'right' : 'center';
        ctx.fillText(label, x, layout.timeAxisY + 6);
      }

      if (maxActual === 0) {
        ctx.fillStyle = metaColor;
        ctx.font = '12px ui-monospace, "JetBrains Mono", monospace';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(
          t(locale, emptyKey),
          PLOT_LEFT + PLOT_WIDTH / 2,
          PLOT_TOP + layout.plotHeight / 2,
        );
        if (metaRef.current) {
          metaRef.current.textContent = `${t(locale, 'rawWave.sampleCount')} 0`;
        }
        frameId = window.requestAnimationFrame(draw);
        return;
      }

      for (const entry of channelBuffers) {
        const laneTop = getLaneTop(entry.channelIndex, layout);
        const laneBottom = laneTop + layout.laneHeight;
        const laneCenterY = laneTop + layout.laneHeight / 2;
        const latestValue =
          entry.actual > 0 ? entry.buffer[Math.max(0, entry.actual - 1)] : null;

        ctx.strokeStyle = hairlineColor;
        ctx.setLineDash([]);
        ctx.globalAlpha = 1;
        ctx.strokeRect(PLOT_LEFT + 0.5, laneTop + 0.5, PLOT_WIDTH - 1, layout.laneHeight - 1);

        ctx.fillStyle = entry.color;
        ctx.font = '11px ui-monospace, "JetBrains Mono", monospace';
        ctx.textAlign = 'right';
        ctx.textBaseline = 'middle';
        ctx.fillText(entry.channelName, PLOT_LEFT - 10, laneCenterY - 7);
        ctx.fillStyle = metaColor;
        ctx.font = '10px ui-monospace, "JetBrains Mono", monospace';
        ctx.fillText(
          latestValue === null ? '-' : formatMicrovolts(latestValue),
          PLOT_LEFT - 10,
          laneCenterY + 8,
        );

        if (entry.range.min < 0 && entry.range.max > 0) {
          const zeroY =
            laneTop + ((entry.range.max - 0) / entry.range.span) * layout.laneHeight;
          ctx.strokeStyle = zeroLineColor;
          ctx.globalAlpha = 0.7;
          ctx.setLineDash([3, 4]);
          ctx.beginPath();
          ctx.moveTo(PLOT_LEFT, zeroY);
          ctx.lineTo(PLOT_LEFT + PLOT_WIDTH, zeroY);
          ctx.stroke();
          ctx.setLineDash([]);
          ctx.globalAlpha = 1;
        }

        if (entry.actual === 0) {
          ctx.fillStyle = metaColor;
          ctx.textAlign = 'center';
          ctx.font = '10px ui-monospace, "JetBrains Mono", monospace';
          ctx.fillText('-', PLOT_LEFT + PLOT_WIDTH / 2, laneCenterY);
        }
      }

      ctx.save();
      ctx.beginPath();
      ctx.rect(PLOT_LEFT, PLOT_TOP, PLOT_WIDTH, layout.plotHeight);
      ctx.clip();
      const stepX = PLOT_WIDTH / (windowSampleCount - 1);
      for (const entry of channelBuffers) {
        if (entry.actual === 0) continue;
        const laneTop = getLaneTop(entry.channelIndex, layout);
        ctx.strokeStyle = entry.color;
        ctx.lineWidth = entry.channelName === 'ch0' ? 1.3 : 1.1;
        ctx.lineJoin = 'round';
        ctx.beginPath();
        const offsetX = (windowSampleCount - entry.actual) * stepX;
        for (let i = 0; i < entry.actual; i += 1) {
          const x = PLOT_LEFT + offsetX + i * stepX;
          const y =
            laneTop +
            ((entry.range.max - entry.buffer[i]) / entry.range.span) * layout.laneHeight;
          if (i === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        }
        ctx.stroke();
      }

      for (const entry of channelBuffers) {
        if (entry.actual < 2) continue;
        const laneTop = getLaneTop(entry.channelIndex, layout);
        const offsetX = (windowSampleCount - entry.actual) * stepX;
        ctx.strokeStyle = LEAD_OFF_STROKE_COLOR;
        ctx.lineWidth = entry.channelName === 'ch0' ? 2.1 : 1.9;
        ctx.lineJoin = 'round';
        ctx.beginPath();
        for (let i = 1; i < entry.actual; i += 1) {
          if (!entry.leadOffFlags[i] && !entry.leadOffFlags[i - 1]) {
            continue;
          }

          const previousX = PLOT_LEFT + offsetX + (i - 1) * stepX;
          const previousY =
            laneTop +
            ((entry.range.max - entry.buffer[i - 1]) / entry.range.span) *
              layout.laneHeight;
          const x = PLOT_LEFT + offsetX + i * stepX;
          const y =
            laneTop +
            ((entry.range.max - entry.buffer[i]) / entry.range.span) * layout.laneHeight;
          ctx.moveTo(previousX, previousY);
          ctx.lineTo(x, y);
        }
        ctx.stroke();
      }
      ctx.restore();

      const sel = selectedRef.current;
      if (sel) {
        const writeIndex = lastCurrentWriteIndexesRef.current.get(sel.channelName) ?? 0;
        const ageSamples = writeIndex - sel.writeIndex;
        if (ageSamples >= 0 && ageSamples <= windowSampleCount - 1) {
          const entry = channelBuffers.find((item) => item.channelName === sel.channelName);
          const actual = entry?.actual ?? 0;
          const idxInBuf = actual - 1 - ageSamples;
          if (entry && idxInBuf >= 0 && idxInBuf < actual) {
            const offsetX = (windowSampleCount - actual) * stepX;
            const x = PLOT_LEFT + offsetX + idxInBuf * stepX;
            const laneTop = getLaneTop(entry.channelIndex, layout);
            const y =
              laneTop +
              ((entry.range.max - sel.value) / entry.range.span) * layout.laneHeight;
            ctx.strokeStyle = entry.color;
            ctx.globalAlpha = 0.4;
            ctx.setLineDash([2, 3]);
            ctx.beginPath();
            ctx.moveTo(x, laneTop);
            ctx.lineTo(x, laneTop + layout.laneHeight);
            ctx.stroke();
            ctx.setLineDash([]);
            ctx.globalAlpha = 1;
            ctx.fillStyle = '#ffffff';
            ctx.strokeStyle = entry.color;
            ctx.lineWidth = 1.5;
            ctx.beginPath();
            ctx.arc(x, y, 4, 0, Math.PI * 2);
            ctx.fill();
            ctx.stroke();
          }
        }
      }

      if (metaRef.current) {
        metaRef.current.textContent = `${t(locale, 'chart.channelsLabel')} ${
          configuredChannelNames.length
        } · ${t(locale, 'rawWave.sampleCount')} ${maxActual}`;
      }

      tickCounter += 1;
      if (sel && tickCounter % 6 === 0) {
        setTooltipTick((v) => v + 1);
      }

      frameId = window.requestAnimationFrame(draw);
    }

    frameId = window.requestAnimationFrame(draw);
    return () => {
      if (frameId !== null) window.cancelAnimationFrame(frameId);
    };
  }, [
    bus,
    configuredChannelNames,
    drawingKey,
    emptyKey,
    hairlineColor,
    isDrawingEnabled,
    isStreaming,
    layout,
    locale,
    metaColor,
    secondaryStrokeColor,
    strokeColor,
    visibleWindowSeconds,
    windowSampleCount,
    zeroLineColor,
  ]);

  useEffect(() => {
    setSelected(null);
  }, [configuredChannelNames, windowSampleCount]);

  useEffect(() => {
    if (!selected) return;
    const writeIndex = lastCurrentWriteIndexesRef.current.get(selected.channelName) ?? 0;
    const age = writeIndex - selected.writeIndex;
    if (age > windowSampleCount - 1) setSelected(null);
  }, [selected, tooltipTick, windowSampleCount]);

  function clientToCanvas(clientX: number, clientY: number): { x: number; y: number } | null {
    const el = canvasRef.current;
    if (!el) return null;
    const rect = el.getBoundingClientRect();
    return {
      x: ((clientX - rect.left) / rect.width) * CANVAS_WIDTH,
      y: ((clientY - rect.top) / rect.height) * layout.canvasHeight,
    };
  }

  function handlePointerDown(event: ReactPointerEvent<HTMLCanvasElement>) {
    if (event.button !== 0) return;
    (event.target as Element).setPointerCapture?.(event.pointerId);
    dragRef.current = {
      pointerId: event.pointerId,
      startClientX: event.clientX,
      startClientY: event.clientY,
      moved: false,
    };
  }

  function handlePointerMove(event: ReactPointerEvent<HTMLCanvasElement>) {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    const dx = event.clientX - drag.startClientX;
    const dy = event.clientY - drag.startClientY;
    if (!drag.moved && Math.hypot(dx, dy) > CLICK_DRAG_THRESHOLD_PX) {
      drag.moved = true;
    }
  }

  function handlePointerUp(event: ReactPointerEvent<HTMLCanvasElement>) {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    dragRef.current = null;
    if (drag.moved) return;
    const pt = clientToCanvas(event.clientX, event.clientY);
    if (!pt) return;
    if (
      pt.x < PLOT_LEFT ||
      pt.x > PLOT_LEFT + PLOT_WIDTH ||
      pt.y < PLOT_TOP ||
      pt.y > layout.plotBottom
    ) {
      setSelected(null);
      return;
    }
    const channelIndex = configuredChannelNames.findIndex((_, index) => {
      const laneTop = getLaneTop(index, layout);
      return pt.y >= laneTop && pt.y <= laneTop + layout.laneHeight;
    });
    if (channelIndex === -1) {
      setSelected(null);
      return;
    }

    const channelName = configuredChannelNames[channelIndex] ?? 'ch0';
    const writeIndex = lastCurrentWriteIndexesRef.current.get(channelName) ?? 0;
    const buf = sampleBuffersRef.current.get(channelName) ?? new Float32Array(windowSampleCount);
    const actual =
      lastActualCountsRef.current.get(channelName) ?? Math.min(writeIndex, windowSampleCount);
    if (actual === 0) {
      setSelected(null);
      return;
    }
    const stepX = PLOT_WIDTH / (windowSampleCount - 1);
    const offsetX = (windowSampleCount - actual) * stepX;
    const idxInBuf = Math.round((pt.x - PLOT_LEFT - offsetX) / stepX);
    if (idxInBuf < 0 || idxInBuf >= actual) {
      setSelected(null);
      return;
    }
    const ageSamples = actual - 1 - idxInBuf;
    setSelected({
      channelName,
      writeIndex: writeIndex - ageSamples,
      value: buf[idxInBuf],
    });
  }

  let tooltipStyle: { left: string; top: string } | null = null;
  let tooltipAgeSeconds = 0;
  let tooltipValue = 0;
  if (selected) {
    const writeIndex = lastCurrentWriteIndexesRef.current.get(selected.channelName) ?? 0;
    const ageSamples = writeIndex - selected.writeIndex;
    if (ageSamples >= 0 && ageSamples <= windowSampleCount - 1) {
      const el = canvasRef.current;
      if (el) {
        const rect = el.getBoundingClientRect();
        const actual =
          lastActualCountsRef.current.get(selected.channelName) ??
          Math.min(writeIndex, windowSampleCount);
        if (actual > 0) {
          const stepX = PLOT_WIDTH / (windowSampleCount - 1);
          const offsetX = (windowSampleCount - actual) * stepX;
          const idxInBuf = actual - 1 - ageSamples;
          const cx = PLOT_LEFT + offsetX + idxInBuf * stepX;
          const cssX = (cx / CANVAS_WIDTH) * rect.width;
          const selectedChannelIndex = Math.max(
            0,
            configuredChannelNames.indexOf(selected.channelName),
          );
          const laneTop = getLaneTop(selectedChannelIndex, layout);
          const cssLaneTop = (laneTop / layout.canvasHeight) * rect.height;
          const tooltipWidth = 170;
          const flip = cssX + tooltipWidth + 12 > rect.width;
          tooltipStyle = {
            left: `${flip ? cssX - tooltipWidth - 8 : cssX + 8}px`,
            top: `${Math.max(8, Math.min(rect.height - 72, cssLaneTop + 4))}px`,
          };
          tooltipAgeSeconds = ageSamples / sampleRateHz;
          tooltipValue = selected.value;
        }
      }
    }
  }

  return (
    <Card ariaLabelledBy={ariaLabelledBy}>
      <CardHeader
        eyebrow={t(locale, eyebrowKey)}
        title={t(locale, titleKey)}
        titleId={titleId}
        trailing={
          <div className="flex flex-wrap items-center justify-end gap-2">
            <span className="font-mono text-[0.65rem] font-medium uppercase tracking-[0.08em] text-meta">
              {t(locale, 'chart.windowFixed', { seconds: liveWindowSeconds })}
            </span>
            <ToggleSwitch
              label={t(locale, 'chart.drawToggle')}
              checked={isDrawingEnabled}
              onCheckedChange={(checked) => setDrawingEnabled(drawingKey, checked)}
              disabled={!isStreaming}
            />
          </div>
        }
      />
      <CardBody className="flex flex-col gap-3">
        <div className="relative rounded-sm border border-hairline bg-card overflow-hidden">
          <canvas
            ref={canvasRef}
            style={{
              width: '100%',
              height: `${layout.canvasHeight}px`,
              display: 'block',
              touchAction: 'auto',
              cursor: 'crosshair',
            }}
            aria-label={t(locale, titleKey)}
            role="img"
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
            onPointerCancel={handlePointerUp}
          />
          {selected && tooltipStyle && (
            <div
              className="absolute z-10 rounded-sm border border-accent bg-surface-2 px-2.5 py-1.5"
              style={tooltipStyle}
            >
              <div className="flex items-center justify-between gap-3">
                <span className="font-mono text-[0.7rem] tabular text-meta">
                  {t(locale, 'chart.tooltipTime')}
                </span>
                <span className="font-mono text-[0.78rem] tabular text-ink">
                  {formatSecondsAgo(tooltipAgeSeconds)}
                </span>
              </div>
              <div className="mt-1 flex items-center justify-between gap-3">
                <span className="font-mono text-[0.7rem] tabular text-meta">
                  {selected.channelName} · {t(locale, 'chart.tooltipValue')}
                </span>
                <span className="font-mono text-[0.78rem] tabular text-accent">
                  {formatMicrovolts(tooltipValue)}
                </span>
              </div>
              <button
                type="button"
                onClick={() => setSelected(null)}
                aria-label={t(locale, 'chart.tooltipClose')}
                className="absolute -top-2 -right-2 h-4 w-4 rounded-full border border-hairline bg-surface-2 text-[0.6rem] leading-none text-meta hover:text-ink"
              >
                ×
              </button>
            </div>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-4 font-mono text-[0.72rem] text-meta">
          {configuredChannelNames.map((channelName, index) => (
            <span key={channelName} className="inline-flex items-center gap-1.5">
              <span
                className="h-2 w-4 rounded-sm"
                style={{
                  backgroundColor: getChannelStrokeColor(
                    channelName,
                    index,
                    strokeColor,
                    secondaryStrokeColor,
                  ),
                }}
              />
              {channelName}
            </span>
          ))}
          {drawingKey === 'rawWaveform' && (
            <span className="inline-flex items-center gap-1.5">
              <span
                className="h-2 w-4 rounded-sm"
                style={{ backgroundColor: LEAD_OFF_STROKE_COLOR }}
              />
              {t(locale, 'chart.leadOff')}
            </span>
          )}
        </div>
        <span ref={metaRef} className="font-mono text-[0.72rem] text-meta tabular">
          {isStreaming ? '' : t(locale, emptyKey)}
        </span>
      </CardBody>
    </Card>
  );
}
