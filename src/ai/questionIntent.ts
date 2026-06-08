export type EegMentalStateTarget =
  | 'anxiety'
  | 'depression'
  | 'tension'
  | 'relaxation'
  | 'fatigue'
  | 'drowsiness'
  | 'alertness'
  | 'arousal'
  | 'focus';

export interface AiQuestionIntent {
  requestedRecentWindowMs: number | null;
  isEegRelated: boolean;
  mentalStateTargets: EegMentalStateTarget[];
  primaryMentalStateTarget: EegMentalStateTarget | null;
  asksAnxiety: boolean;
  asksFocus: boolean;
  asksAbnormality: boolean;
  asksMentalState: boolean;
  asksSignalQuality: boolean;
}

export const DEFAULT_AI_RECENT_WINDOW_MS = 30_000;
const MIN_RECENT_WINDOW_MS = 1_000;
const MAX_RECENT_WINDOW_MS = 10 * 60_000;
const RECENT_WINDOW_PATTERN =
  /(?:最近|近|过去|last|past|recent)\s*(\d+(?:\.\d+)?)\s*(分钟|分|minutes|minute|mins|min|m|秒钟|秒|seconds|second|secs|sec|s)/i;
const MINUTE_UNITS = new Set(['分钟', '分', 'minutes', 'minute', 'mins', 'min', 'm']);
const ANXIETY_INTENT_PATTERN = /焦虑|焦躁|anxiety|anxious/;
const DEPRESSION_INTENT_PATTERN = /抑郁|低落|情绪低|心情低|depression|depressed|low mood/;
const TENSION_INTENT_PATTERN = /紧张|压力|压迫|stress|stressed|nervous|tense|tension/;
const RELAXATION_INTENT_PATTERN = /放松|平静|镇静|舒缓|relax|relaxed|relaxation|calm/;
const FATIGUE_INTENT_PATTERN = /疲劳|疲惫|累|乏力|fatigue|fatigued|tired/;
const DROWSINESS_INTENT_PATTERN = /困倦|犯困|困(?!难)|嗜睡|drowsy|drowsiness|sleepy/;
const ALERTNESS_INTENT_PATTERN = /清醒|警觉|alert|alertness|awake|vigilant/;
const AROUSAL_INTENT_PATTERN = /唤醒|兴奋|arousal|aroused|excited/;
const FOCUS_INTENT_PATTERN =
  /专注|注意力|集中|投入|走神|分心|focus|focused|attention|attentive|concentration|engagement|engaged|distracted/;
const ABNORMALITY_INTENT_PATTERN =
  /异常|异常值|离群|波动|突变|峰值|abnormal|anomaly|anomalies|outlier|spike|unusual/;
const EEG_DOMAIN_PATTERN =
  /脑电|脑波|脑信号|脑机|eeg|bbci|bci|delta|theta|alpha|beta|gamma|δ|θ|α|β|γ|德尔塔|西塔|阿尔法|贝塔|伽马|频带|频谱|功率|波形|fft|滤波|电极|导联|通道|ch0|ssvep|刺激|baseline|基线/;
const EEG_SCENE_ANALYSIS_PATTERN =
  /最近|刚才|过去|所选|这段|窗口|实验|任务|采集|记录|数据|趋势|变化|推断|判断|说明|状态|表现|线索/;
const MENTAL_STATE_PATTERN =
  /精神|情绪|状态|心理|心情|疲劳|疲惫|困倦|困(?!难)|清醒|放松|兴奋|警觉|唤醒|抑郁|mental|emotion|mood|tired|fatigue|sleepy|drowsy|relaxed|calm|alert|arousal|depression|depressed/;
const SIGNAL_QUALITY_PATTERN =
  /信号质量|质量问题|接触质量|伪迹|噪声|接触|掉线|漂移|眼动|眨眼|肌电|运动|artifact|noise|contact|drift|blink|movement|motion|emg/;

const MENTAL_STATE_TARGET_PATTERNS: Array<{
  target: EegMentalStateTarget;
  pattern: RegExp;
}> = [
  { target: 'anxiety', pattern: ANXIETY_INTENT_PATTERN },
  { target: 'depression', pattern: DEPRESSION_INTENT_PATTERN },
  { target: 'tension', pattern: TENSION_INTENT_PATTERN },
  { target: 'relaxation', pattern: RELAXATION_INTENT_PATTERN },
  { target: 'fatigue', pattern: FATIGUE_INTENT_PATTERN },
  { target: 'drowsiness', pattern: DROWSINESS_INTENT_PATTERN },
  { target: 'alertness', pattern: ALERTNESS_INTENT_PATTERN },
  { target: 'arousal', pattern: AROUSAL_INTENT_PATTERN },
  { target: 'focus', pattern: FOCUS_INTENT_PATTERN },
];

function clampRecentWindowMs(value: number): number {
  if (!Number.isFinite(value)) return DEFAULT_AI_RECENT_WINDOW_MS;
  return Math.max(MIN_RECENT_WINDOW_MS, Math.min(MAX_RECENT_WINDOW_MS, Math.round(value)));
}

export function parseRequestedRecentWindowMs(question: string): number | null {
  const normalized = question.trim();
  const match = normalized.match(RECENT_WINDOW_PATTERN);
  if (!match) return null;

  const amount = Number(match[1]);
  if (!Number.isFinite(amount) || amount <= 0) return null;

  const unit = match[2].toLowerCase();
  const multiplier = MINUTE_UNITS.has(unit) ? 60_000 : 1_000;
  return clampRecentWindowMs(amount * multiplier);
}

export function resolveAiQuestionTimeRange(
  question: string,
  nowMs = Date.now(),
): { startMs: number; endMs: number } {
  const durationMs = parseRequestedRecentWindowMs(question) ?? DEFAULT_AI_RECENT_WINDOW_MS;
  return {
    startMs: nowMs - durationMs,
    endMs: nowMs,
  };
}

export function parseAiQuestionIntent(question: string): AiQuestionIntent {
  const normalized = question.toLowerCase();
  const mentalStateTargets = MENTAL_STATE_TARGET_PATTERNS.filter(({ pattern }) =>
    pattern.test(normalized),
  ).map(({ target }) => target);
  const asksAnxiety = mentalStateTargets.includes('anxiety');
  const asksFocus = mentalStateTargets.includes('focus');
  const asksAbnormality = ABNORMALITY_INTENT_PATTERN.test(normalized);
  const asksMentalState =
    mentalStateTargets.length > 0 || MENTAL_STATE_PATTERN.test(normalized);
  const asksSignalQuality = SIGNAL_QUALITY_PATTERN.test(normalized);
  const isEegRelated =
    EEG_DOMAIN_PATTERN.test(normalized) ||
    mentalStateTargets.length > 0 ||
    asksAbnormality ||
    asksSignalQuality ||
    (asksMentalState && EEG_SCENE_ANALYSIS_PATTERN.test(normalized));

  return {
    requestedRecentWindowMs: parseRequestedRecentWindowMs(question),
    isEegRelated,
    mentalStateTargets,
    primaryMentalStateTarget: mentalStateTargets[0] ?? null,
    asksAnxiety,
    asksFocus,
    asksAbnormality,
    asksMentalState,
    asksSignalQuality,
  };
}
