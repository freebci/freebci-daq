import { describe, expect, it } from 'vitest';
import {
  DEFAULT_AI_RECENT_WINDOW_MS,
  parseAiQuestionIntent,
  parseRequestedRecentWindowMs,
  resolveAiQuestionTimeRange,
} from '../src/ai/questionIntent';

describe('AI question intent', () => {
  it('extracts a recent 15 second window from Chinese user questions', () => {
    expect(parseRequestedRecentWindowMs('最近 15s 能判断出我焦虑么？有什么异常值？')).toBe(
      15_000,
    );
    expect(parseRequestedRecentWindowMs('最近15秒有什么异常？')).toBe(15_000);
  });

  it('extracts minute windows from English questions', () => {
    expect(parseRequestedRecentWindowMs('last 2 minutes, any abnormal value?')).toBe(120_000);
  });

  it('extracts Chinese minute windows from focus questions', () => {
    expect(parseRequestedRecentWindowMs('最近 3分钟能推断出我专注么')).toBe(180_000);
  });

  it('defaults sidecar analysis to the last 30 seconds when no time is described', () => {
    expect(parseRequestedRecentWindowMs('我现在焦虑么？')).toBeNull();
    expect(resolveAiQuestionTimeRange('我现在焦虑么？', 100_000)).toEqual({
      startMs: 100_000 - DEFAULT_AI_RECENT_WINDOW_MS,
      endMs: 100_000,
    });
  });

  it('uses the natural-language time window when one is described', () => {
    expect(resolveAiQuestionTimeRange('最近 2 分钟我专注么？', 200_000)).toEqual({
      startMs: 80_000,
      endMs: 200_000,
    });
  });

  it('detects anxiety and abnormality intent', () => {
    expect(parseAiQuestionIntent('最近 15s 能判断出我焦虑么？有什么异常值？')).toMatchObject({
      requestedRecentWindowMs: 15_000,
      isEegRelated: true,
      mentalStateTargets: ['anxiety'],
      primaryMentalStateTarget: 'anxiety',
      asksAnxiety: true,
      asksAbnormality: true,
    });
  });

  it('detects focus intent', () => {
    expect(parseAiQuestionIntent('最近 3分钟能推断出我专注么')).toMatchObject({
      requestedRecentWindowMs: 180_000,
      isEegRelated: true,
      mentalStateTargets: ['focus'],
      primaryMentalStateTarget: 'focus',
      asksFocus: true,
    });
    expect(parseAiQuestionIntent('was I focused in the last 3 minutes?')).toMatchObject({
      requestedRecentWindowMs: 180_000,
      isEegRelated: true,
      mentalStateTargets: ['focus'],
      primaryMentalStateTarget: 'focus',
      asksFocus: true,
    });
  });

  it('detects broader EEG mental-state targets before report generation', () => {
    expect(parseAiQuestionIntent('最近这段脑电能看出我抑郁么？')).toMatchObject({
      isEegRelated: true,
      mentalStateTargets: ['depression'],
      primaryMentalStateTarget: 'depression',
      asksMentalState: true,
    });
    expect(parseAiQuestionIntent('刚才是紧张还是放松？')).toMatchObject({
      isEegRelated: true,
      mentalStateTargets: ['tension', 'relaxation'],
      primaryMentalStateTarget: 'tension',
      asksMentalState: true,
    });
    expect(parseAiQuestionIntent('这段数据像困倦还是清醒？')).toMatchObject({
      isEegRelated: true,
      mentalStateTargets: ['drowsiness', 'alertness'],
      primaryMentalStateTarget: 'drowsiness',
      asksMentalState: true,
    });
  });

  it('detects open EEG scene and signal-quality questions', () => {
    expect(parseAiQuestionIntent('刚才脑电有什么变化，可能说明什么？')).toMatchObject({
      isEegRelated: true,
      asksAnxiety: false,
      asksFocus: false,
    });
    expect(parseAiQuestionIntent('这段数据有没有可能是接触质量问题？')).toMatchObject({
      isEegRelated: true,
      asksSignalQuality: true,
    });
  });

  it('keeps unrelated questions outside the EEG analyzer scope', () => {
    expect(parseAiQuestionIntent('帮我写一个晚饭菜单')).toMatchObject({
      isEegRelated: false,
      asksAnxiety: false,
      asksFocus: false,
      asksAbnormality: false,
    });
  });
});
