import type { Locale } from '../i18n';
import type { CandidateBandEventV1 } from './bandStats';
import {
  type AiAnalysisOutputV1,
  type BandMetric,
  type BandMetricSummaryV1,
  type DetailLookupResultV1,
  type TimeRangeMsV1,
} from './protocol';
import {
  parseAiQuestionIntent,
  type AiQuestionIntent,
  type EegMentalStateTarget,
} from './questionIntent';
import {
  FIVE_BAND_METRICS,
  createBandEventMap,
  createBandMeanMap,
  getBandMean,
  getFocusInference,
  getMentalStateSupport,
  type MentalStateSupport,
} from './fiveBandInference';

type EventDirection = CandidateBandEventV1['direction'];

export interface NaturalReportRequest {
  userGoal: string;
  timeRange: TimeRangeMsV1;
}

export interface NaturalReportContext {
  frameCount: number;
  summary: BandMetricSummaryV1[];
  candidateEvents: CandidateBandEventV1[];
  detailTrace?: DetailLookupResultV1[];
}

function formatMetricName(metric: BandMetric): string {
  return metric.replace('Power', '');
}

function formatBandLabel(metric: BandMetric): string {
  const label = formatMetricName(metric);
  return label.charAt(0).toUpperCase() + label.slice(1);
}

const reportTimeFormatters = new Map<Locale, Intl.DateTimeFormat>();

function formatReportTime(locale: Locale, timestampMs: number): string {
  let formatter = reportTimeFormatters.get(locale);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat(locale, {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
    reportTimeFormatters.set(locale, formatter);
  }
  return formatter.format(new Date(timestampMs));
}

function formatDurationSeconds(timeRange: TimeRangeMsV1): number {
  return Math.max(0, Math.round((timeRange.endMs - timeRange.startMs) / 1000));
}

function formatPowerValue(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return 'n/a';
  const abs = Math.abs(value);
  if (abs === 0) return '0';
  if (abs >= 0.01 && abs < 10_000) return value.toFixed(3);
  return value.toExponential(2);
}

function describeDirection(locale: Locale, direction: EventDirection): string {
  if (locale === 'zh-CN') {
    if (direction === 'high') return '升高';
    if (direction === 'low') return '降低';
    return '呈趋势性变化';
  }
  if (direction === 'high') return 'increased';
  if (direction === 'low') return 'decreased';
  return 'showed a trend';
}

function describeAnxietyInference(
  locale: Locale,
  metric: BandMetric,
  direction: EventDirection,
): string {
  if (locale === 'zh-CN') {
    if (direction === 'trend') {
      return '这个频带呈趋势性变化，可作为状态变化线索，但还不足以单独指向焦虑。';
    }
    if (metric === 'betaPower') {
      return direction === 'high'
        ? 'Beta 升高更接近警觉度或紧张相关的高唤醒线索，因此数据略偏向支持“可能存在紧张/焦虑相关唤醒升高”的推断。'
        : 'Beta 降低不支持高唤醒增强的推断，更像警觉度或紧张相关活动减弱。';
    }
    if (metric === 'gammaPower') {
      return direction === 'high'
        ? 'Gamma 升高可作为高频唤醒增强的线索，但也容易受到肌电、运动或接触质量影响，需要结合原始波形确认。'
        : 'Gamma 降低不支持高频唤醒增强的推断。';
    }
    if (metric === 'alphaPower') {
      return direction === 'high'
        ? 'Alpha 升高通常更偏向放松、闭眼或视觉负荷降低相关线索，不是典型的焦虑高唤醒证据。'
        : 'Alpha 降低可能出现在注意或警觉度上升时，可作为紧张/唤醒变化的弱线索，但需要和 Beta、Gamma 一起看。';
    }
    if (metric === 'thetaPower') {
      return direction === 'high'
        ? 'Theta 升高更常见于困倦、认知负荷或低频伪迹相关变化，不能直接推向焦虑。'
        : 'Theta 降低本身不构成焦虑相关高唤醒的强线索。';
    }
    return direction === 'high'
      ? 'Delta 升高更像低频波动、眼动/运动伪迹或困倦相关线索，不是焦虑高唤醒的典型证据。'
      : 'Delta 降低本身不构成焦虑相关高唤醒的强线索。';
  }

  if (direction === 'trend') {
    return 'This band shows a trend-level change, which is a state-change clue but is not enough by itself to point to anxiety.';
  }
  if (metric === 'betaPower') {
    return direction === 'high'
      ? 'Higher Beta is closer to an alertness or tension-related arousal clue, so the data weakly supports an inference of possible anxiety/tension-related arousal.'
      : 'Lower Beta does not support increased high-arousal activity and points more toward reduced alertness or tension-related activity.';
  }
  if (metric === 'gammaPower') {
    return direction === 'high'
      ? 'Higher Gamma can be a high-frequency arousal clue, but it can also be affected by muscle activity, movement, or contact quality, so the raw waveform should be checked.'
      : 'Lower Gamma does not support increased high-frequency arousal.';
  }
  if (metric === 'alphaPower') {
    return direction === 'high'
      ? 'Higher Alpha more often points toward relaxation, eyes-closed state, or reduced visual load, and is not typical evidence of anxiety-related high arousal.'
      : 'Lower Alpha can appear with increased attention or alertness, so it is a weak clue for tension/arousal change when read together with Beta and Gamma.';
  }
  if (metric === 'thetaPower') {
    return direction === 'high'
      ? 'Higher Theta more often points to drowsiness, cognitive load, or low-frequency artifact, so it should not be read directly as anxiety.'
      : 'Lower Theta is not a strong clue for anxiety-related high arousal by itself.';
  }
  return direction === 'high'
    ? 'Higher Delta more often points to low-frequency fluctuation, eye/movement artifact, or drowsiness, and is not typical evidence of anxiety-related high arousal.'
    : 'Lower Delta is not a strong clue for anxiety-related high arousal by itself.';
}

function describeFocusBandEvidence(
  locale: Locale,
  metric: BandMetric,
  direction: EventDirection,
): string {
  if (locale === 'zh-CN') {
    if (direction === 'trend') {
      return '这个频带呈趋势性变化，说明状态可能在变，但还不能单独说明专注增强。';
    }
    if (metric === 'betaPower') {
      return direction === 'high'
        ? 'Beta 升高通常更贴近警觉度、任务参与或专注增强的线索。'
        : 'Beta 降低会削弱“专注增强”的推断，更像任务参与度下降的线索。';
    }
    if (metric === 'alphaPower') {
      return direction === 'high'
        ? 'Alpha 升高通常更偏向放松、闭眼或视觉负荷降低，和高专注推断并不一致。'
        : 'Alpha 降低可作为注意投入或视觉/认知负荷升高的弱线索。';
    }
    if (metric === 'thetaPower') {
      return direction === 'high'
        ? 'Theta 升高可能来自困倦、认知负荷或低频伪迹，会让专注推断变得不稳。'
        : 'Theta 降低通常不会反驳专注推断，可作为低频干扰较少的辅助线索。';
    }
    if (metric === 'gammaPower') {
      return direction === 'high'
        ? 'Gamma 升高可能与高频处理或肌电/运动伪迹有关，需要结合原始波形确认。'
        : 'Gamma 降低本身不是专注增强的强证据。';
    }
    return direction === 'high'
      ? 'Delta 升高更可能是低频波动、眼动/运动伪迹或困倦线索，会削弱专注推断。'
      : 'Delta 降低通常不是专注增强的直接证据，但低频干扰较少时有助于解释其他频带。';
  }

  if (direction === 'trend') {
    return 'This band shows a trend-level change, which suggests state movement but does not by itself establish stronger focus.';
  }
  if (metric === 'betaPower') {
    return direction === 'high'
      ? 'Higher Beta is usually closer to alertness, task engagement, or stronger focus.'
      : 'Lower Beta weakens an inference of stronger focus and points more toward reduced task engagement.';
  }
  if (metric === 'alphaPower') {
    return direction === 'high'
      ? 'Higher Alpha often fits relaxation, eyes-closed state, or reduced visual load, so it is not aligned with high-focus inference.'
      : 'Lower Alpha can be a weak clue for increased attention or visual/cognitive load.';
  }
  if (metric === 'thetaPower') {
    return direction === 'high'
      ? 'Higher Theta may reflect drowsiness, cognitive load, or low-frequency artifact, which makes the focus inference less stable.'
      : 'Lower Theta does not argue against focus and can be a supporting clue when low-frequency interference is limited.';
  }
  if (metric === 'gammaPower') {
    return direction === 'high'
      ? 'Higher Gamma may reflect high-frequency processing, but it can also be muscle or movement artifact, so the raw waveform should be checked.'
      : 'Lower Gamma is not strong evidence of increased focus by itself.';
  }
  return direction === 'high'
    ? 'Higher Delta more likely reflects low-frequency fluctuation, eye/movement artifact, or drowsiness, which weakens a focus inference.'
    : 'Lower Delta is not direct evidence of stronger focus, but less low-frequency interference can help interpret other bands.';
}

function describeOpenEegInference(
  locale: Locale,
  metric: BandMetric,
  direction: EventDirection,
): string {
  if (locale === 'zh-CN') {
    if (direction === 'trend') {
      return '这个频带呈趋势性变化，说明状态可能在移动，但需要结合任务事件和原始波形判断方向。';
    }
    if (metric === 'betaPower') {
      return direction === 'high'
        ? 'Beta 升高通常更像警觉度、任务参与或紧张度升高的线索。'
        : 'Beta 降低更像警觉度或任务参与度下降的线索。';
    }
    if (metric === 'alphaPower') {
      return direction === 'high'
        ? 'Alpha 升高更常见于放松、闭眼或视觉负荷降低。'
        : 'Alpha 降低可作为注意投入、视觉负荷或警觉度上升的弱线索。';
    }
    if (metric === 'thetaPower') {
      return direction === 'high'
        ? 'Theta 升高可能来自困倦、认知负荷增加，也可能混入低频伪迹。'
        : 'Theta 降低通常表示这类低频活动减弱，但单独不能说明明确心理状态。';
    }
    if (metric === 'gammaPower') {
      return direction === 'high'
        ? 'Gamma 升高可能对应高频处理或唤醒增强，也需要排除肌电、运动和接触质量影响。'
        : 'Gamma 降低说明高频活动线索减弱，单独解释力度有限。';
    }
    return direction === 'high'
      ? 'Delta 升高更常见于低频漂移、眼动/运动伪迹或困倦相关变化。'
      : 'Delta 降低通常说明低频波动减少，可辅助解释其他频带。';
  }

  if (direction === 'trend') {
    return 'This band shows a trend-level change, suggesting state movement that should be checked against task markers and the raw waveform.';
  }
  if (metric === 'betaPower') {
    return direction === 'high'
      ? 'Higher Beta usually points toward higher alertness, task engagement, or tension.'
      : 'Lower Beta more often points toward reduced alertness or task engagement.';
  }
  if (metric === 'alphaPower') {
    return direction === 'high'
      ? 'Higher Alpha more often fits relaxation, eyes-closed state, or reduced visual load.'
      : 'Lower Alpha can be a weak clue for increased attention, visual load, or alertness.';
  }
  if (metric === 'thetaPower') {
    return direction === 'high'
      ? 'Higher Theta may reflect drowsiness, increased cognitive load, or low-frequency artifact.'
      : 'Lower Theta means this low-frequency activity is reduced, but it does not identify a mental state by itself.';
  }
  if (metric === 'gammaPower') {
    return direction === 'high'
      ? 'Higher Gamma may reflect high-frequency processing or arousal, but muscle activity, movement, and contact quality should be ruled out.'
      : 'Lower Gamma means high-frequency clues are weaker and is limited on its own.';
  }
  return direction === 'high'
    ? 'Higher Delta more often reflects low-frequency drift, eye/movement artifact, or drowsiness-related change.'
    : 'Lower Delta usually means reduced low-frequency fluctuation and can help interpret the other bands.';
}

function formatMentalStateTarget(locale: Locale, target: EegMentalStateTarget): string {
  if (locale === 'zh-CN') {
    switch (target) {
      case 'anxiety':
        return '焦虑相关唤醒';
      case 'depression':
        return '抑郁/低落相关低唤醒';
      case 'tension':
        return '紧张/压力';
      case 'relaxation':
        return '放松';
      case 'fatigue':
        return '疲劳';
      case 'drowsiness':
        return '困倦';
      case 'alertness':
        return '清醒/警觉';
      case 'arousal':
        return '唤醒水平';
      case 'focus':
        return '专注';
    }
  }

  switch (target) {
    case 'anxiety':
      return 'anxiety-related arousal';
    case 'depression':
      return 'depression/low-mood-related low arousal';
    case 'tension':
      return 'tension/stress';
    case 'relaxation':
      return 'relaxation';
    case 'fatigue':
      return 'fatigue';
    case 'drowsiness':
      return 'drowsiness';
    case 'alertness':
      return 'alertness';
    case 'arousal':
      return 'arousal level';
    case 'focus':
      return 'focus';
  }
}

function describeMentalStateSupport(locale: Locale, support: MentalStateSupport): string {
  if (locale === 'zh-CN') {
    if (support === 'supports') return '倾向支持';
    if (support === 'weakly-supports') return '弱支持';
    if (support === 'does-not-support') return '暂不支持';
    return '线索不明确';
  }
  if (support === 'supports') return 'tends to support';
  if (support === 'weakly-supports') return 'weakly supports';
  if (support === 'does-not-support') return 'does not currently support';
  return 'is mixed or unclear for';
}

function describeMentalStateBandEvidence(
  locale: Locale,
  target: EegMentalStateTarget,
  metric: BandMetric,
  direction: EventDirection,
): string {
  if (target === 'anxiety' || target === 'tension') {
    return describeAnxietyInference(locale, metric, direction);
  }
  if (target === 'focus') {
    return describeFocusBandEvidence(locale, metric, direction);
  }

  if (locale === 'zh-CN') {
    if (target === 'relaxation') {
      if (metric === 'alphaPower') {
        return direction === 'high'
          ? 'Alpha 升高更贴近放松、闭眼或视觉负荷降低，因此可作为放松相关线索。'
          : 'Alpha 降低会削弱放松推断，更像注意投入或警觉度上升。';
      }
      if (metric === 'betaPower' || metric === 'gammaPower') {
        return direction === 'low'
          ? '高频活动降低可作为放松或低唤醒的辅助线索。'
          : '高频活动升高更像警觉、任务参与或紧张，不支持放松增强。';
      }
    }
    if (target === 'fatigue' || target === 'drowsiness') {
      if (metric === 'thetaPower' || metric === 'deltaPower') {
        return direction === 'high'
          ? '低频活动升高更贴近困倦、疲劳或低频伪迹线索，需要结合原始波形确认。'
          : '低频活动降低不支持困倦/疲劳增强。';
      }
      if (metric === 'betaPower') {
        return direction === 'low'
          ? 'Beta 降低可作为警觉度下降的弱线索。'
          : 'Beta 升高通常反而指向警觉或任务参与增强。';
      }
    }
    if (target === 'alertness' || target === 'arousal') {
      if (metric === 'betaPower' || metric === 'gammaPower') {
        return direction === 'high'
          ? '高频活动升高更贴近警觉度或唤醒水平升高，但也要排除肌电和运动影响。'
          : '高频活动降低不支持警觉/唤醒增强。';
      }
      if (metric === 'alphaPower') {
        return direction === 'low'
          ? 'Alpha 降低可作为注意投入或警觉度上升的弱线索。'
          : 'Alpha 升高更偏向放松、闭眼或视觉负荷降低。';
      }
    }
    if (target === 'depression') {
      if (metric === 'thetaPower' || metric === 'alphaPower') {
        return direction === 'high'
          ? '这个模式最多只能弱提示低唤醒、疲劳或退缩样状态，不能据此判断抑郁。'
          : '该频带降低不支持低唤醒/低落相关推断。';
      }
      if (metric === 'betaPower') {
        return direction === 'low'
          ? 'Beta 降低可作为低警觉或低任务参与的弱线索，但不能单独指向抑郁。'
          : 'Beta 升高更像警觉或紧张线索，不支持低落/低唤醒推断。';
      }
      return '抑郁不能靠这类五频带变化直接判断，只能作为状态观察线索。';
    }
  }

  if (target === 'relaxation') {
    if (metric === 'alphaPower') {
      return direction === 'high'
        ? 'Higher Alpha is more aligned with relaxation, eyes-closed state, or reduced visual load.'
        : 'Lower Alpha weakens a relaxation inference and may point toward attention or alertness.';
    }
    if (metric === 'betaPower' || metric === 'gammaPower') {
      return direction === 'low'
        ? 'Lower high-frequency activity can be an auxiliary low-arousal or relaxation clue.'
        : 'Higher high-frequency activity points more toward alertness, task engagement, or tension than relaxation.';
    }
  }
  if (target === 'fatigue' || target === 'drowsiness') {
    if (metric === 'thetaPower' || metric === 'deltaPower') {
      return direction === 'high'
        ? 'Higher low-frequency activity is closer to a drowsiness, fatigue, or low-frequency artifact clue, so the raw waveform should be checked.'
        : 'Lower low-frequency activity does not support stronger drowsiness or fatigue.';
    }
    if (metric === 'betaPower') {
      return direction === 'low'
        ? 'Lower Beta can be a weak clue for reduced alertness.'
        : 'Higher Beta usually points toward stronger alertness or task engagement.';
    }
  }
  if (target === 'alertness' || target === 'arousal') {
    if (metric === 'betaPower' || metric === 'gammaPower') {
      return direction === 'high'
        ? 'Higher high-frequency activity is closer to increased alertness or arousal, while muscle and movement artifacts should still be ruled out.'
        : 'Lower high-frequency activity does not support increased alertness or arousal.';
    }
    if (metric === 'alphaPower') {
      return direction === 'low'
        ? 'Lower Alpha can be a weak clue for increased attention or alertness.'
        : 'Higher Alpha more often points toward relaxation, eyes-closed state, or reduced visual load.';
    }
  }
  if (target === 'depression') {
    if (metric === 'thetaPower' || metric === 'alphaPower') {
      return direction === 'high'
        ? 'This can only weakly suggest low-arousal, fatigue, or withdrawal-like state; it cannot diagnose depression.'
        : 'This decrease does not support a low-arousal or low-mood inference.';
    }
    if (metric === 'betaPower') {
      return direction === 'low'
        ? 'Lower Beta can be a weak clue for reduced alertness or task engagement, but it does not identify depression.'
        : 'Higher Beta points more toward alertness or tension and does not support a low-mood/low-arousal inference.';
    }
    return 'Depression cannot be determined from five-band changes alone; this is only a state-observation clue.';
  }

  return describeOpenEegInference(locale, metric, direction);
}

function describeFiveBandMeanProfile(
  locale: Locale,
  means: ReadonlyMap<BandMetric, number | null>,
): string {
  const parts = FIVE_BAND_METRICS.map((metric) => {
    const label = formatBandLabel(metric);
    return `${label} ${formatPowerValue(getBandMean(means, metric))}`;
  });
  return locale === 'zh-CN'
    ? `五频均值画像：${parts.join('；')}。`
    : `Five-band mean profile: ${parts.join('; ')}.`;
}

function describeFiveBandEventProfile(
  locale: Locale,
  eventsByMetric: ReadonlyMap<BandMetric, CandidateBandEventV1>,
): string {
  const parts = FIVE_BAND_METRICS.map((metric) => {
    const event = eventsByMetric.get(metric) ?? null;
    const label = formatBandLabel(metric);
    if (!event) {
      return locale === 'zh-CN'
        ? `${label} 未见突出局部波动`
        : `${label} no prominent local excursion`;
    }
    return locale === 'zh-CN'
      ? `${label} ${describeDirection(locale, event.direction)}`
      : `${label} ${describeDirection(locale, event.direction)}`;
  });
  return parts.join(locale === 'zh-CN' ? '；' : '; ');
}

function createFiveBandProfileEvidence(
  locale: Locale,
  context: NaturalReportContext,
): string[] {
  if (context.frameCount === 0) return [];
  const meanProfile = describeFiveBandMeanProfile(
    locale,
    createBandMeanMap(context.summary),
  );
  const eventProfile = describeFiveBandEventProfile(
    locale,
    createBandEventMap(context.candidateEvents),
  );
  return locale === 'zh-CN'
    ? [
        meanProfile,
        `五频局部波动画像：${eventProfile}。判断必须综合五频，不能只凭单一频带定性。`,
      ]
    : [
        meanProfile,
        `Five-band local-excursion profile: ${eventProfile}. The judgment must integrate all five bands and cannot rest on a single band alone.`,
      ];
}

function getSuccessfulDetailLookups(context: NaturalReportContext): DetailLookupResultV1[] {
  return (context.detailTrace ?? []).filter(
    (detail) => detail.status === 'success' && detail.frameCount > 0,
  );
}

function createDetailLookupEvidence(locale: Locale, context: NaturalReportContext): string[] {
  return getSuccessfulDetailLookups(context).slice(0, 2).map((detail) => {
    const orderedSummary = FIVE_BAND_METRICS.map((metric) =>
      detail.summary.find((item) => item.metric === metric),
    ).filter((item): item is BandMetricSummaryV1 => Boolean(item));
    const summaryParts = orderedSummary.map((item) => {
      const band = formatBandLabel(item.metric);
      return locale === 'zh-CN'
        ? `${band} 均值 ${formatPowerValue(item.mean)}，范围 ${formatPowerValue(item.min)}~${formatPowerValue(item.max)}`
        : `${band} mean ${formatPowerValue(item.mean)}, range ${formatPowerValue(item.min)}-${formatPowerValue(item.max)}`;
    });

    return locale === 'zh-CN'
      ? `已回查 ${detail.frameCount} 个细粒度五频带帧：${summaryParts.join('；')}。`
      : `Back-checked ${detail.frameCount} fine-grained five-band frames: ${summaryParts.join('; ')}.`;
  });
}

function createFocusReportParts(
  locale: Locale,
  request: NaturalReportRequest,
  context: NaturalReportContext,
  supportRatioThreshold?: number,
): Pick<AiAnalysisOutputV1['humanReport'], 'conclusion' | 'evidence' | 'caveats' | 'suggestions'> {
  const durationSeconds = formatDurationSeconds(request.timeRange);
  const focusInference = getFocusInference(createBandMeanMap(context.summary), {
    supportRatioThreshold,
  });

  if (focusInference.status === 'insufficient') {
    return locale === 'zh-CN'
      ? {
          conclusion: `这不是校准后的专注力判定。最近 ${durationSeconds}s 内缺少足够的 Beta、Alpha、Theta 摘要，因此暂时不能给出稳定的专注倾向推断。`,
          evidence: [
            `所选时间窗内读取到 ${context.frameCount} 个五频带特征帧，但专注推断所需的核心频带摘要不足。`,
          ],
          caveats: [
            '这里使用 live 记录的五频带数据做倾向性推断，不读取专注力页的校准 Focus 状态。',
            '专注状态最好结合任务内容、行为表现、baseline 和更长时间窗一起判断。',
          ],
          suggestions: [
            '继续采集一段包含有效 FFT 输出的数据后再分析，或选择包含更多五频带特征帧的时间窗。',
          ],
        }
      : {
          conclusion: `This is not a calibrated focus classification. The most recent ${durationSeconds}s do not contain enough Beta, Alpha, and Theta summary data for a stable focus inference.`,
          evidence: [
            `The selected window contains ${context.frameCount} five-band feature frames, but the core band summaries needed for focus inference are incomplete.`,
          ],
          caveats: [
            'This uses the live five-band data for a tendency-level inference and does not read the calibrated Focus state from the Focus page.',
            'Focus should be interpreted with task context, behavior, baseline, and a longer observation window.',
          ],
          suggestions: [
            'Continue recording until valid FFT outputs are available, or choose a window with more five-band feature frames.',
          ],
        };
  }

  const inference = focusInference.status;
  const fiveBandEvidence = createFiveBandProfileEvidence(locale, context);

  if (locale === 'zh-CN') {
    const conclusion =
      inference === 'supports'
        ? `这不是校准后的专注力判定。综合最近 ${durationSeconds}s 的 Delta、Theta、Alpha、Beta、Gamma 五频数据，Beta 相对 Alpha+Theta 偏高，同时需要用 Delta/Theta 和 Gamma 排除困倦、低频伪迹或肌电影响；整体倾向支持“这段时间专注/任务参与度较高”的推断。`
        : inference === 'mixed'
          ? `这不是校准后的专注力判定。综合最近 ${durationSeconds}s 的 Delta、Theta、Alpha、Beta、Gamma 五频数据，Beta 相对 Alpha+Theta 处于中间区间，且仍需结合 Delta/Theta/Gamma 的伪迹和低警觉线索；因此只能给出“专注倾向不明确、可能有一定任务参与”的弱推断。`
          : `这不是校准后的专注力判定。综合最近 ${durationSeconds}s 的 Delta、Theta、Alpha、Beta、Gamma 五频数据，Beta 相对 Alpha+Theta 偏低，整体暂不支持“这段时间明显专注”的推断。`;
      const detailEvidence = createDetailLookupEvidence(locale, context);
      return {
        conclusion,
        evidence: [
          '专注推断综合五频：核心看 Beta 相对 Alpha+Theta，同时用 Delta/Theta 复核困倦或低频伪迹，用 Gamma 复核高频处理或肌电影响；不能靠单一频带判断。',
          ...fiveBandEvidence,
          ...detailEvidence,
        ],
        caveats: [
          '这里使用 live 记录的五频带数据做倾向性推断，不读取专注力页的校准 Focus 状态。',
          'Alpha、Theta、Delta 或 Gamma 的异常波动可能来自闭眼、困倦、肌电、运动或接触质量变化，需要结合原始波形和任务事件确认。',
        ],
        suggestions: [
          '如果要得到更稳定的专注判断，可以先在专注力页完成 baseline，再用同一任务条件下的更长窗口复核。',
        ],
      };
  }

  const conclusion =
    inference === 'supports'
      ? `This is not a calibrated focus classification. Integrating the most recent ${durationSeconds}s of Delta, Theta, Alpha, Beta, and Gamma data, Beta is high relative to Alpha+Theta while Delta/Theta and Gamma still need artifact review, so the overall pattern tends to support higher focus or task engagement.`
      : inference === 'mixed'
        ? `This is not a calibrated focus classification. Integrating the most recent ${durationSeconds}s of Delta, Theta, Alpha, Beta, and Gamma data, Beta relative to Alpha+Theta is in a middle range and Delta/Theta/Gamma artifact or low-alertness clues still matter, so the focus inference is weak or mixed.`
        : `This is not a calibrated focus classification. Integrating the most recent ${durationSeconds}s of Delta, Theta, Alpha, Beta, and Gamma data, Beta is low relative to Alpha+Theta, so the overall pattern does not currently support clearly high focus.`;
  const detailEvidence = createDetailLookupEvidence(locale, context);
  return {
    conclusion,
    evidence: [
      'The focus inference integrates all five bands: Beta relative to Alpha+Theta is the main task-engagement clue, while Delta/Theta check drowsiness or low-frequency artifact and Gamma checks high-frequency processing or muscle artifact; it cannot be judged from one band alone.',
      ...fiveBandEvidence,
      ...detailEvidence,
    ],
    caveats: [
      'This uses the live five-band data for a tendency-level inference and does not read the calibrated Focus state from the Focus page.',
      'Alpha, Theta, Delta, or Gamma excursions may reflect eyes-closed state, drowsiness, muscle activity, movement, or contact quality, so raw waveform and task markers should be checked.',
    ],
    suggestions: [
      'For a steadier focus judgment, collect a baseline on the Focus page and compare a longer window under the same task conditions.',
    ],
  };
}

function createNaturalEvidence(
  locale: Locale,
  context: NaturalReportContext,
  questionIntent: AiQuestionIntent,
): string[] {
  const events = context.candidateEvents.slice(0, 3);
  if (events.length > 0) {
    const eventEvidence = events.map((event) => {
      const bandLabel = formatBandLabel(event.metric);
      const eventTime = formatReportTime(
        locale,
        Math.round((event.timeRange.startMs + event.timeRange.endMs) / 2),
      );
      if (locale === 'zh-CN') {
        const inferenceNote = questionIntent.asksAnxiety
          ? `这不是诊断依据，但可作为推断线索：${describeAnxietyInference(locale, event.metric, event.direction)}`
          : questionIntent.asksSignalQuality
            ? `这可以作为信号质量复核线索：${describeOpenEegInference(locale, event.metric, event.direction)}`
            : `这可以作为脑电场景推论线索：${describeOpenEegInference(locale, event.metric, event.direction)}`;
        return `${eventTime} 附近，${bandLabel} 频带功率相对该时间窗内的整体波动更突出，主要表现为${describeDirection(locale, event.direction)}。${inferenceNote}`;
      }
      const inferenceNote = questionIntent.asksAnxiety
        ? ` This is not diagnostic evidence, but it is useful for inference: ${describeAnxietyInference(locale, event.metric, event.direction)}`
        : questionIntent.asksSignalQuality
          ? ` This is a signal-quality review clue: ${describeOpenEegInference(locale, event.metric, event.direction)}`
          : ` This is a clue for EEG-context inference: ${describeOpenEegInference(locale, event.metric, event.direction)}`;
      return `Around ${eventTime}, ${bandLabel} band power stood out relative to the rest of the selected window and mainly ${describeDirection(locale, event.direction)}.${inferenceNote}`;
    });
    return [...createFiveBandProfileEvidence(locale, context), ...eventEvidence];
  }

  if (context.frameCount > 0) {
    const profileEvidence = createFiveBandProfileEvidence(locale, context);
    if (questionIntent.asksAbnormality) {
      return locale === 'zh-CN'
        ? [
            ...profileEvidence,
            questionIntent.asksAnxiety
              ? `所选时间窗内读取到 ${context.frameCount} 个五频带特征帧，未发现足够突出的异常波动，因此暂不支持焦虑相关生理唤醒明显升高的推断。`
              : `所选时间窗内读取到 ${context.frameCount} 个五频带特征帧，未发现足够突出的异常波动。`,
          ]
        : [
            ...profileEvidence,
            questionIntent.asksAnxiety
              ? `The selected window contains ${context.frameCount} five-band feature frames, and no strong abnormal fluctuation was detected, so it does not currently support an inference of clearly elevated anxiety-related arousal.`
              : `The selected window contains ${context.frameCount} five-band feature frames, and no strong abnormal fluctuation was detected.`,
          ];
    }
    return locale === 'zh-CN'
      ? [
          ...profileEvidence,
          `所选时间窗内读取到 ${context.frameCount} 个五频带特征帧，但没有发现足够突出的局部波动。`,
        ]
      : [
          ...profileEvidence,
          `The selected window contains ${context.frameCount} five-band feature frames, but no strong local excursion was detected.`,
        ];
  }

  return locale === 'zh-CN'
    ? ['所选时间窗内没有可用的五频带特征帧。']
    : ['The selected window does not contain usable five-band feature frames.'];
}

function createOutOfScopeReport(locale: Locale): AiAnalysisOutputV1['humanReport'] {
  return locale === 'zh-CN'
    ? {
        title: '脑电问答',
        conclusion:
          '我当前只能基于 EEG 采集场景和五频带特征做推论。这个问题没有明显指向脑电、实验任务、信号质量或脑电相关状态，因此不适合用当前分析器回答。',
        evidence: [
          '内部分析器只接入 Delta、Theta、Alpha、Beta、Gamma 五个频带功率和所选时间窗的候选波动。',
        ],
        caveats: [
          '为了避免编造，非脑电场景问题不会被当作普通聊天内容展开。',
        ],
        suggestions: [
          '可以改问“刚才脑电有什么变化？”、“这段数据像不像困倦？”或“有没有可能是接触质量问题？”。',
        ],
      }
    : {
        title: 'EEG Q&A',
        conclusion:
          'I can currently make inferences only from the EEG recording context and five-band features. This question does not clearly refer to EEG, the experiment scene, signal quality, or an EEG-related state, so it is outside the analyzer scope.',
        evidence: [
          'The internal analyzer only has Delta, Theta, Alpha, Beta, and Gamma band powers plus candidate fluctuations in the selected window.',
        ],
        caveats: [
          'To avoid inventing context, unrelated questions are not expanded as general chat.',
        ],
        suggestions: [
          'Try asking what changed in the EEG, whether the segment suggests drowsiness, or whether the pattern may reflect contact quality.',
        ],
      };
}

function createMentalStateEvidence(
  locale: Locale,
  context: NaturalReportContext,
  target: EegMentalStateTarget,
): string[] {
  const events = context.candidateEvents.slice(0, 3);
  const targetLabel = formatMentalStateTarget(locale, target);

  if (events.length > 0) {
    const eventEvidence = events.map((event) => {
      const bandLabel = formatBandLabel(event.metric);
      const eventTime = formatReportTime(
        locale,
        Math.round((event.timeRange.startMs + event.timeRange.endMs) / 2),
      );
      const inference = describeMentalStateBandEvidence(
        locale,
        target,
        event.metric,
        event.direction,
      );

      return locale === 'zh-CN'
        ? `${eventTime} 附近，${bandLabel} 频带功率表现为${describeDirection(locale, event.direction)}，这是“${targetLabel}”相关的推断线索：${inference}`
        : `Around ${eventTime}, ${bandLabel} band power ${describeDirection(locale, event.direction)}. This is an inference clue for ${targetLabel}: ${inference}`;
    });
    return [...createFiveBandProfileEvidence(locale, context), ...eventEvidence];
  }

  if (context.frameCount > 0) {
    return locale === 'zh-CN'
      ? [
          ...createFiveBandProfileEvidence(locale, context),
          `所选时间窗内读取到 ${context.frameCount} 个五频带特征帧，但没有发现足够突出的局部波动，因此“${targetLabel}”相关推论只能保持谨慎。`,
        ]
      : [
          ...createFiveBandProfileEvidence(locale, context),
          `The selected window contains ${context.frameCount} five-band feature frames, but no strong local fluctuation was detected, so the ${targetLabel} inference remains cautious.`,
        ];
  }

  return locale === 'zh-CN'
    ? ['所选时间窗内没有可用的五频带特征帧。']
    : ['The selected window does not contain usable five-band feature frames.'];
}

function createEvidenceWithDetailLookup(
  locale: Locale,
  baseEvidence: string[],
  context: NaturalReportContext,
): string[] {
  return [...baseEvidence, ...createDetailLookupEvidence(locale, context)];
}

function createMentalStateReportParts(
  locale: Locale,
  request: NaturalReportRequest,
  context: NaturalReportContext,
  target: EegMentalStateTarget,
): Pick<AiAnalysisOutputV1['humanReport'], 'conclusion' | 'evidence' | 'caveats' | 'suggestions'> {
  const durationSeconds = formatDurationSeconds(request.timeRange);
  const support = getMentalStateSupport(target, context.candidateEvents);
  const targetLabel = formatMentalStateTarget(locale, target);
  const supportLabel = describeMentalStateSupport(locale, support);
  const fiveBandPattern = describeFiveBandEventProfile(
    locale,
    createBandEventMap(context.candidateEvents),
  );
  const detailWasChecked = getSuccessfulDetailLookups(context).length > 0;
  const evidence = createEvidenceWithDetailLookup(
    locale,
    createMentalStateEvidence(locale, context, target),
    context,
  );

  if (locale === 'zh-CN') {
    const diagnosisPrefix =
      target === 'depression'
        ? '这不能诊断抑郁。'
        : target === 'relaxation' ||
            target === 'fatigue' ||
            target === 'drowsiness' ||
            target === 'alertness' ||
            target === 'arousal'
          ? '这不是临床判断。'
          : '这不是诊断。';
    const lookupPrefix = detailWasChecked ? '已回查细粒度五频带帧后，' : '';
    const conclusion =
      context.frameCount === 0
        ? `${diagnosisPrefix}基于所选 ${durationSeconds}s 窗口，目前没有可用五频带特征帧，所以不能对“${targetLabel}”做数据推论。`
        : context.candidateEvents.length === 0
          ? `${diagnosisPrefix}用户意图识别为“${targetLabel}”相关脑电推论。${lookupPrefix}综合最近 ${durationSeconds}s 的 Delta、Theta、Alpha、Beta、Gamma 五频数据，没有明显突出的局部波动，因此暂不支持强烈的“${targetLabel}”判断。`
          : `${diagnosisPrefix}用户意图识别为“${targetLabel}”相关脑电推论。${lookupPrefix}综合最近 ${durationSeconds}s 的 Delta、Theta、Alpha、Beta、Gamma 五频组合，当前数据${supportLabel}“${targetLabel}”相关判断；五频局部波动组合为：${fiveBandPattern}。单个频带只能作为辅助证据，不能单独定性。`;

    return {
      conclusion,
      evidence,
      caveats: [
        '这里基于当前 EEG 五频带数据做倾向性推论，不能替代主观报告、任务情境、行为表现或临床评估。',
        '没有个体 baseline 时，推论只能说明“这段数据是否出现相符线索”，不能输出确定心理状态。',
      ],
      suggestions:
        target === 'depression'
          ? ['如果关注抑郁风险，应结合量表、主观报告、长期趋势和专业评估；当前 EEG 只适合作为辅助线索。']
          : ['建议结合实验事件标记、原始波形、接触质量和更长窗口复核这个推论。'],
    };
  }

  const diagnosisPrefix =
    target === 'depression'
      ? 'This cannot diagnose depression. '
      : target === 'relaxation' ||
          target === 'fatigue' ||
          target === 'drowsiness' ||
          target === 'alertness' ||
          target === 'arousal'
        ? 'This is not a clinical judgment. '
        : 'This is not a diagnosis. ';
  const lookupPrefix = detailWasChecked
    ? 'After back-checking fine-grained five-band frames, '
    : '';
  const conclusion =
    context.frameCount === 0
      ? `${diagnosisPrefix}The selected ${durationSeconds}s window does not contain usable five-band feature frames, so I cannot make a data-backed inference about ${targetLabel}.`
      : context.candidateEvents.length === 0
        ? `${diagnosisPrefix}The user intent is an EEG-based inference about ${targetLabel}. ${lookupPrefix}integrating the most recent ${durationSeconds}s of Delta, Theta, Alpha, Beta, and Gamma data, no strong local fluctuation was detected, so this does not support a strong ${targetLabel} judgment.`
        : `${diagnosisPrefix}The user intent is an EEG-based inference about ${targetLabel}. ${lookupPrefix}integrating the most recent ${durationSeconds}s of Delta, Theta, Alpha, Beta, and Gamma data, the current five-band pattern ${supportLabel} a ${targetLabel} judgment; the five-band local-excursion pattern is: ${fiveBandPattern}. A single band is only supporting evidence and cannot determine the judgment by itself.`;

  return {
    conclusion,
    evidence,
    caveats: [
      'This is a tendency-level inference from the current EEG five-band data and should be read with subjective report, task context, behavior, and clinical context when relevant.',
      'Without an individual baseline, the answer only says whether this segment contains compatible clues; it cannot determine a mental state with certainty.',
    ],
    suggestions:
      target === 'depression'
        ? ['If depression risk matters, combine validated scales, subjective report, longer-term trends, and professional evaluation; EEG here is only an auxiliary clue.']
        : ['Review event markers, the raw waveform, contact quality, and a longer window before relying on this inference.'],
  };
}

function createOpenEegReportParts(
  locale: Locale,
  request: NaturalReportRequest,
  context: NaturalReportContext,
  questionIntent: AiQuestionIntent,
): Pick<AiAnalysisOutputV1['humanReport'], 'conclusion' | 'evidence' | 'caveats' | 'suggestions'> {
  const durationSeconds = formatDurationSeconds(request.timeRange);
  const detailWasChecked = getSuccessfulDetailLookups(context).length > 0;
  const fiveBandPattern = describeFiveBandEventProfile(
    locale,
    createBandEventMap(context.candidateEvents),
  );
  const evidence = createEvidenceWithDetailLookup(
    locale,
    createNaturalEvidence(locale, context, questionIntent),
    context,
  );

  if (locale === 'zh-CN') {
    const lookupPrefix = detailWasChecked ? '已回查细粒度五频带帧后，' : '';
    const conclusion =
      context.frameCount === 0
        ? `基于所选 ${durationSeconds}s 窗口，目前没有可用的五频带特征帧，所以不能给出数据推论。`
        : context.candidateEvents.length === 0
          ? `${lookupPrefix}综合所选 ${durationSeconds}s 窗口的 Delta、Theta、Alpha、Beta、Gamma 五频数据，我能给出的推论是：这段数据没有明显突出的局部波动，更像相对平稳的 EEG 片段；暂不支持明显状态突变或强异常的判断。`
          : questionIntent.asksSignalQuality
            ? `${lookupPrefix}综合所选 ${durationSeconds}s 窗口的 Delta、Theta、Alpha、Beta、Gamma 五频组合，信号质量上需要复核的整体画像是：${fiveBandPattern}。信号质量不能只看单一频带，需要结合原始波形排查低频漂移、肌电、运动和接触质量。`
            : `${lookupPrefix}综合所选 ${durationSeconds}s 窗口的 Delta、Theta、Alpha、Beta、Gamma 五频组合，我能给出的推论是：五频局部波动画像为 ${fiveBandPattern}。这些是脑电场景线索，但不能只凭某一个频带单独定性。`;

    return {
      conclusion,
      evidence,
      caveats: [
        '这里是基于当前 EEG 五频带数据的推论，不是医学诊断，也不能单独确定真实主观感受。',
        '当前问答只使用 Delta、Theta、Alpha、Beta、Gamma 频带功率；原始波形、事件标记、接触质量和任务内容仍需要一起看。',
      ],
      suggestions:
        context.frameCount >= 20
          ? ['可以继续围绕某个时间段或频带追问，例如“刚才 Alpha 升高可能说明什么？”']
          : ['建议继续采集，或选择包含更多五频带特征帧的时间窗后再追问。'],
    };
  }

  const lookupPrefix = detailWasChecked
    ? 'After back-checking fine-grained five-band frames, '
    : '';
  const conclusion =
    context.frameCount === 0
      ? `The selected ${durationSeconds}s window does not contain usable five-band feature frames, so I cannot make a data-backed inference yet.`
      : context.candidateEvents.length === 0
        ? `${lookupPrefix}integrating the selected ${durationSeconds}s window of Delta, Theta, Alpha, Beta, and Gamma data, this EEG segment looks relatively stable, without a strong local fluctuation. It does not currently support a clear state shift or strong abnormality.`
        : questionIntent.asksSignalQuality
          ? `${lookupPrefix}integrating the selected ${durationSeconds}s window of Delta, Theta, Alpha, Beta, and Gamma data, the signal-quality profile to review is: ${fiveBandPattern}. Signal quality cannot be judged from one band alone; the raw waveform should be checked for drift, muscle activity, movement, and contact quality.`
          : `${lookupPrefix}integrating the selected ${durationSeconds}s window of Delta, Theta, Alpha, Beta, and Gamma data, the five-band local-excursion profile is: ${fiveBandPattern}. These are EEG-context clues, but no single band should determine the interpretation by itself.`;

  return {
    conclusion,
    evidence,
    caveats: [
      'This is an inference from the current EEG five-band data, not a medical diagnosis or a direct readout of subjective experience.',
      'The answer uses only Delta, Theta, Alpha, Beta, and Gamma band powers; raw waveform, event markers, contact quality, and task context should still be checked.',
    ],
    suggestions:
      context.frameCount >= 20
        ? ['You can continue with a more specific follow-up, such as what the Alpha increase may suggest.']
        : ['Continue recording or choose a window with more five-band feature frames, then ask again.'],
  };
}

export function createNaturalHumanReport(input: {
  locale: Locale;
  request: NaturalReportRequest;
  context: NaturalReportContext;
  focusSupportRatioThreshold?: number;
}): AiAnalysisOutputV1['humanReport'] {
  const questionIntent = parseAiQuestionIntent(input.request.userGoal);
  const mentalStateTarget = questionIntent.primaryMentalStateTarget;
  const title = !questionIntent.isEegRelated
    ? input.locale === 'zh-CN'
      ? '脑电问答'
      : 'EEG Q&A'
    : questionIntent.asksFocus
      ? input.locale === 'zh-CN'
        ? '关于专注推断的回答'
        : 'Focus inference'
      : questionIntent.asksAnxiety
        ? input.locale === 'zh-CN'
          ? '关于焦虑推断的回答'
          : 'Anxiety inference'
        : questionIntent.asksSignalQuality
          ? input.locale === 'zh-CN'
            ? '信号质量推论'
            : 'Signal-quality inference'
          : mentalStateTarget !== null
            ? input.locale === 'zh-CN'
              ? `关于${formatMentalStateTarget(input.locale, mentalStateTarget)}的脑电推论`
              : `${formatMentalStateTarget(input.locale, mentalStateTarget)} EEG inference`
          : input.locale === 'zh-CN'
            ? '脑电场景推论'
            : 'EEG-context inference';

  if (!questionIntent.isEegRelated) {
    return createOutOfScopeReport(input.locale);
  }

  if (questionIntent.asksFocus) {
    return {
      title,
      ...createFocusReportParts(
        input.locale,
        input.request,
        input.context,
        input.focusSupportRatioThreshold,
      ),
    };
  }

  if (mentalStateTarget !== null) {
    return {
      title,
      ...createMentalStateReportParts(
        input.locale,
        input.request,
        input.context,
        mentalStateTarget,
      ),
    };
  }

  return {
    title,
    ...createOpenEegReportParts(input.locale, input.request, input.context, questionIntent),
  };
}
