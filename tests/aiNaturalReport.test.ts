import { describe, expect, it } from 'vitest';
import { createNaturalHumanReport, type NaturalReportContext } from '../src/ai/naturalReport';
import type { CandidateBandEventV1 } from '../src/ai/bandStats';
import {
  AI_SCHEMA_VERSION,
  type BandMetric,
  type BandMetricSummaryV1,
  type DetailLookupResultV1,
} from '../src/ai/protocol';

function metricSummary(metric: BandMetric, mean: number | null): BandMetricSummaryV1 {
  return {
    metric,
    min: mean,
    max: mean,
    mean,
    median: mean,
    p10: mean,
    p90: mean,
    std: mean === null ? null : 0,
    slopePerSecond: null,
  };
}

function bandEvent(
  metric: BandMetric,
  direction: CandidateBandEventV1['direction'],
): CandidateBandEventV1 {
  return {
    eventId: `${metric}-${direction}`,
    timeRange: { startMs: 30_000, endMs: 32_000 },
    metric,
    direction,
    score: 3,
    summary: `${metric} ${direction}`,
  };
}

function reportContext(input: {
  betaMean: number;
  alphaMean: number;
  thetaMean: number;
  events?: CandidateBandEventV1[];
  detailTrace?: DetailLookupResultV1[];
}): NaturalReportContext {
  return {
    frameCount: 30,
    summary: [
      metricSummary('betaPower', input.betaMean),
      metricSummary('alphaPower', input.alphaMean),
      metricSummary('thetaPower', input.thetaMean),
      metricSummary('gammaPower', 1),
      metricSummary('deltaPower', 1),
    ],
    candidateEvents: input.events ?? [],
    detailTrace: input.detailTrace,
  };
}

function detailLookup(metrics: BandMetric[]): DetailLookupResultV1 {
  return {
    schemaVersion: AI_SCHEMA_VERSION,
    lookupId: 'lookup-test',
    status: 'success',
    timeRange: { startMs: 10_000, endMs: 40_000 },
    frameCount: 12,
    frames: [],
    summary: metrics.map((metric, index) => ({
      metric,
      min: 0.1 + index,
      max: 0.4 + index,
      mean: 0.25 + index,
      median: 0.25 + index,
      p10: 0.12 + index,
      p90: 0.38 + index,
      std: 0.05,
      slopePerSecond: null,
    })),
    truncation: { truncated: false, reason: null },
    rejectionReason: null,
  };
}

describe('AI natural report', () => {
  it('answers focus questions with a tendency-level focus inference', () => {
    const report = createNaturalHumanReport({
      locale: 'zh-CN',
      request: {
        userGoal: '最近 3分钟能推断出我专注么',
        timeRange: { startMs: 0, endMs: 180_000 },
      },
      context: reportContext({
        betaMean: 2,
        alphaMean: 1,
        thetaMean: 1,
        events: [bandEvent('betaPower', 'high')],
      }),
    });

    expect(report.title).toBe('关于专注推断的回答');
    expect(report.conclusion).toContain('不是校准后的专注力判定');
    expect(report.conclusion).toContain('倾向支持');
    expect(report.evidence.join(' ')).toContain('Beta 相对 Alpha+Theta');
    expect(report.evidence.join(' ')).toContain('不能靠单一频带判断');
  });

  it('does not overstate focus when beta is low relative to alpha and theta', () => {
    const report = createNaturalHumanReport({
      locale: 'zh-CN',
      request: {
        userGoal: '最近 3分钟能推断出我专注么',
        timeRange: { startMs: 0, endMs: 180_000 },
      },
      context: reportContext({
        betaMean: 0.2,
        alphaMean: 1,
        thetaMean: 1,
      }),
    });

    expect(report.conclusion).toContain('暂不支持');
    expect(report.conclusion).toContain('明显专注');
  });

  it('answers anxiety questions as inference rather than diagnosis refusal', () => {
    const report = createNaturalHumanReport({
      locale: 'zh-CN',
      request: {
        userGoal: '最近 15s 能判断出我焦虑么？有什么异常值？',
        timeRange: { startMs: 0, endMs: 15_000 },
      },
      context: reportContext({
        betaMean: 2,
        alphaMean: 1,
        thetaMean: 1,
        events: [bandEvent('betaPower', 'high')],
      }),
    });

    expect(report.conclusion).toContain('这不是诊断');
    expect(report.conclusion).toContain('综合最近 15s 的 Delta、Theta、Alpha、Beta、Gamma');
    expect(report.conclusion).toContain('弱支持');
    expect(report.conclusion).toContain('不能单独定性');
    expect(report.conclusion).not.toContain('不能判断');
    expect(report.evidence.join(' ')).toContain('推断线索');
  });

  it('answers depression questions as cautious low-arousal inference', () => {
    const report = createNaturalHumanReport({
      locale: 'zh-CN',
      request: {
        userGoal: '最近这段脑电能看出我抑郁么？',
        timeRange: { startMs: 0, endMs: 60_000 },
      },
      context: reportContext({
        betaMean: 0.5,
        alphaMean: 1,
        thetaMean: 2,
        events: [bandEvent('thetaPower', 'high')],
      }),
    });

    expect(report.title).toContain('抑郁');
    expect(report.conclusion).toContain('不能诊断抑郁');
    expect(report.conclusion).toContain('弱支持');
    expect(report.evidence.join(' ')).toContain('低唤醒');
  });

  it('answers relaxation questions as target-specific inference', () => {
    const report = createNaturalHumanReport({
      locale: 'zh-CN',
      request: {
        userGoal: '刚才脑电是否放松？',
        timeRange: { startMs: 0, endMs: 60_000 },
      },
      context: reportContext({
        betaMean: 0.5,
        alphaMean: 2,
        thetaMean: 1,
        events: [bandEvent('alphaPower', 'high'), bandEvent('betaPower', 'low')],
      }),
    });

    expect(report.title).toContain('放松');
    expect(report.conclusion).toContain('倾向支持');
    expect(report.conclusion).toContain('放松');
    expect(report.evidence.join(' ')).toContain('放松相关线索');
  });

  it('does not make mental-state judgments from one band alone', () => {
    const report = createNaturalHumanReport({
      locale: 'zh-CN',
      request: {
        userGoal: '刚才脑电是否放松？',
        timeRange: { startMs: 0, endMs: 60_000 },
      },
      context: reportContext({
        betaMean: 1,
        alphaMean: 2,
        thetaMean: 1,
        events: [bandEvent('alphaPower', 'high')],
      }),
    });

    expect(report.conclusion).toContain('弱支持');
    expect(report.conclusion).toContain('单个频带只能作为辅助证据');
    expect(report.evidence.join(' ')).toContain('五频局部波动画像');
  });

  it('uses detail lookup evidence when an answer needed back-checking', () => {
    const report = createNaturalHumanReport({
      locale: 'zh-CN',
      request: {
        userGoal: '这段数据像困倦还是清醒？',
        timeRange: { startMs: 0, endMs: 60_000 },
      },
      context: reportContext({
        betaMean: 1,
        alphaMean: 1,
        thetaMean: 1,
        detailTrace: [detailLookup(['thetaPower', 'betaPower'])],
      }),
    });

    expect(report.conclusion).toContain('已回查细粒度五频带帧后');
    expect(report.evidence.join(' ')).toContain('已回查 12 个细粒度五频带帧');
    expect(report.evidence.join(' ')).toContain('Theta 均值');
  });

  it('answers open EEG scene questions as inference', () => {
    const report = createNaturalHumanReport({
      locale: 'zh-CN',
      request: {
        userGoal: '刚才脑电有什么变化，可能说明什么？',
        timeRange: { startMs: 0, endMs: 60_000 },
      },
      context: reportContext({
        betaMean: 1,
        alphaMean: 1,
        thetaMean: 1,
        events: [bandEvent('alphaPower', 'high')],
      }),
    });

    expect(report.title).toBe('脑电场景推论');
    expect(report.conclusion).toContain('我能给出的推论');
    expect(report.conclusion).toContain('Alpha');
    expect(report.conclusion).not.toContain('焦虑');
  });

  it('keeps unrelated questions scoped to EEG analysis', () => {
    const report = createNaturalHumanReport({
      locale: 'zh-CN',
      request: {
        userGoal: '帮我写一个晚饭菜单',
        timeRange: { startMs: 0, endMs: 60_000 },
      },
      context: reportContext({
        betaMean: 1,
        alphaMean: 1,
        thetaMean: 1,
        events: [bandEvent('betaPower', 'high')],
      }),
    });

    expect(report.title).toBe('脑电问答');
    expect(report.conclusion).toContain('只能基于 EEG');
    expect(report.conclusion).toContain('不适合');
  });
});
