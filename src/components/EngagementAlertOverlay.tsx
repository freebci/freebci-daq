import { formatAnalysisMetric } from '../utils/analysisFormat';

export const ENGAGEMENT_ALERT_COLOR = '#b91c1c';

export function isBelowEngagementAlert(value: number | null, threshold: number): boolean {
  return value !== null && Number.isFinite(value) && value < threshold;
}

interface EngagementAlertOverlayProps {
  clipId: string;
  polyline: string;
  plotLeft: number;
  plotTop: number;
  plotBottom: number;
  plotWidth: number;
  thresholdValue: number;
  thresholdY: number;
  rangeMin: number;
  rangeMax: number;
  strokeWidth: number;
}

export function EngagementAlertOverlay({
  clipId,
  polyline,
  plotLeft,
  plotTop,
  plotBottom,
  plotWidth,
  thresholdValue,
  thresholdY,
  rangeMin,
  rangeMax,
  strokeWidth,
}: EngagementAlertOverlayProps) {
  const clipTop = Math.max(plotTop, Math.min(plotBottom, thresholdY));
  const clipHeight = plotBottom - clipTop;
  const hasAlertCurve = polyline.length > 0 && thresholdValue > rangeMin && clipHeight > 0;
  const showsThresholdLine = thresholdValue > rangeMin && thresholdValue < rangeMax;

  return (
    <>
      {hasAlertCurve && (
        <defs>
          <clipPath id={clipId}>
            <rect x={plotLeft} y={clipTop} width={plotWidth} height={clipHeight} />
          </clipPath>
        </defs>
      )}

      {showsThresholdLine && (
        <g>
          <line
            x1={plotLeft}
            x2={plotLeft + plotWidth}
            y1={thresholdY}
            y2={thresholdY}
            stroke={ENGAGEMENT_ALERT_COLOR}
            strokeOpacity={0.75}
            strokeDasharray="4 4"
          />
          <text
            className="algorithm-trend-axis-label"
            style={{ fill: ENGAGEMENT_ALERT_COLOR }}
            x={plotLeft + plotWidth + 4}
            y={thresholdY + 4}
            textAnchor="start"
          >
            {formatAnalysisMetric(thresholdValue)}
          </text>
        </g>
      )}

      {hasAlertCurve && (
        <polyline
          fill="none"
          stroke={ENGAGEMENT_ALERT_COLOR}
          strokeWidth={strokeWidth}
          strokeLinejoin="round"
          strokeLinecap="round"
          points={polyline}
          clipPath={`url(#${clipId})`}
        />
      )}
    </>
  );
}
