# EEG 参数调参指南 / Parameter Tuning Guide

## 概述

本项目有两个配置字典，控制 EEG 信号处理、专注度分析和 UI 行为：

| 文件 | 定位 |
|------|------|
| `src/config/eeg.ts` | 全局 EEG 参数（采样、FFT、EMA、告警） |
| `src/focus/config.ts` | 专注模块专用参数（baseline、判定窗口） |

## 配置方式

场景绑定参数通过 **环境变量** 注入，构建时由 Vite 内联。默认值为保守通用值。

```bash
# 复制模板
cp .env.example .env

# 编辑 .env 填入针对你硬件的调参值
# 不设置则使用 .env.example 中的保守默认值
```

见 `.env.example` 了解所有可配置参数。

算法公式是公开的（见 `src/algorithms/engagementIndex.ts`），本文件记录的是**可调参数**。同样的算法，不同的参数，用户体验完全不同。

---

## 参数速查表

### `src/config/eeg.ts` — 全局 EEG 参数

| 常量 | 默认值 | 环境变量 | 类型 | 说明 |
|------|--------|---------|------|------|
| `EEG_SAMPLE_RATE_HZ` | 250 | — | 硬件固定 | 设备采样率，不应变动 |
| `EEG_ANALYSIS_WINDOW_SECONDS` | 2 | — | 硬件固定 | FFT 窗口时长（2s = 500 样本） |
| `EEG_ANALYSIS_HOP_SECONDS` | 0.5 | — | 硬件固定 | FFT 输出间隔（0.5s = 125 样本） |
| `EEG_DEFAULT_FFT_SIZE` | 512 | — | 硬件固定 | FFT 点数（大于窗口样本数的最小 2 的幂） |
| `EEG_LIVE_WINDOW_SECONDS` | 300 | — | UI 默认 | 波形/趋势图 X 轴默认秒数 |
| `EEG_LIVE_WINDOW_MIN_SECONDS` | 30 | — | UI 限制 | X 轴最小允许值 |
| `EEG_LIVE_WINDOW_MAX_SECONDS` | 600 | — | UI 限制 | X 轴最大允许值 |
| **`EEG_ENGAGEMENT_EMA_ALPHA`** | **0.1** | `VITE_EMA_ALPHA` | **可调** | **EI 指数 EMA 平滑因子** |
| **`EEG_ENGAGEMENT_ALERT_THRESHOLD`** | **0.3** | `VITE_ALERT_THRESHOLD` | **可调** | **趋势图 EI 告警红线** |
| **`EEG_INITIAL_UNRELIABLE_SECONDS`** | **30** | `VITE_INITIAL_UNRELIABLE` | **可调** | **初始不可信期秒数** |

### `src/focus/config.ts` — 专注模块参数

| 常量 | 默认值 | 环境变量 | 说明 |
|------|--------|---------|------|
| **`FOCUS_BASELINE_SECONDS`** | **15** | `VITE_FOCUS_BASELINE` | **baseline 采集窗口时长** |
| **`FOCUS_DECISION_SECONDS`** | **15** | `VITE_FOCUS_DECISION` | **专注判定窗口默认秒数** |
| `FOCUS_DECISION_MIN_SECONDS` | 5 | — | 判定窗口 UI 下限 |
| `FOCUS_DECISION_MAX_SECONDS` | 300 | — | 判定窗口 UI 上限 |
| **`FOCUS_WARMUP_SECONDS`** | **30** | `VITE_FOCUS_WARMUP` | **初始不可信期（需与 `VITE_INITIAL_UNRELIABLE` 同步）** |

---

## 调参指南

### 1. EI 平滑（`EEG_ENGAGEMENT_EMA_ALPHA`）

EI 的 EMA 平滑公式：`smoothEI = α × rawEI + (1−α) × prevSmoothEI`

| α 值 | 效果 | 适用场景 |
|------|------|---------|
| 0.1 | 非常平滑，响应慢。当前开源默认值 | 通用场景 |
| 0.25 | 中等，平衡 | 调优后推荐值 |
| 0.5 | 响应快，波动大 | 高信噪比硬件，需看实时变化 |
| 0.8 | 几乎跟原始值 | 调试阶段快速验证 |

### 2. 告警阈值（`EEG_ENGAGEMENT_ALERT_THRESHOLD`）

趋势图中 EI 低于此值会标红。AI 专注推断（`fiveBandInference.ts`）也使用此值：

```
FOCUS_SUPPORT_RATIO_THRESHOLD  = EEG_ENGAGEMENT_ALERT_THRESHOLD       (default 0.3)
FOCUS_MIXED_RATIO_THRESHOLD   = EEG_ENGAGEMENT_ALERT_THRESHOLD × 0.7 (0.35)
```

| 阈值 | 效果 |
|------|------|
| 0.3 | 宽松（开源默认），只有明显涣散才标红 |
| 0.5 | 中等严格，调优建议值 |
| 0.7 | 严格，轻微下降就标红 |
| 1.0 | 极严，通常不推荐 |

### 3. Baseline 窗口（`FOCUS_BASELINE_SECONDS`）

决定采集多少秒的 EI 中位数作为专注基线。

| 值 | 效果 |
|------|------|
| 15s | 快速启动，但基线可能不稳定 |
| 30s | 默认，平衡 |
| 60s | 基线更稳定，但等待更久 |

### 4. 判定窗口（`FOCUS_DECISION_SECONDS`）

每多少秒算一次专注/不专注。

| 值 | 效果 |
|------|------|
| 10s | 判定频繁，适合短程任务 |
| 30s | 默认，平衡响应与稳定 |
| 60s | 判定稀少，适合长期监测 |

### 5. 初始不可信期（`EEG_INITIAL_UNRELIABLE_SECONDS` + `FOCUS_WARMUP_SECONDS`）

采集启动后的前 N 秒数据不进入 CSV、分析点、专注判定。

| 值 | 效果 |
|------|------|
| 20s | 较快启用，但初期数据可能含开机噪声 |
| 40s | 默认，给设备充分的稳定时间 |
| 60s | 保守，适合慢稳定硬件 |

> **注意：** 这两个常量必须同步修改，保持值一致。

---

## 参数联动关系

```
EEG_INITIAL_UNRELIABLE_SECONDS  ←→  FOCUS_WARMUP_SECONDS
       （必须同步）
       
EEG_ENGAGEMENT_ALERT_THRESHOLD
       ├── AlgorithmTrendPanel（趋势图红线）
       └── fiveBandInference.ts（AI 专注推断）
       
EEG_ENGAGEMENT_EMA_ALPHA
       └── eegStore.smoothEngagementResults（EI 平滑）
       
FOCUS_BASELINE_SECONDS + FOCUS_DECISION_SECONDS
       └── advanceFocusCalibration（状态机）
```

---

## 场景示例

### 场景 A：噪声较大的硬件

```
EEG_ENGAGEMENT_EMA_ALPHA = 0.1       // 更平滑
EEG_ENGAGEMENT_ALERT_THRESHOLD = 0.3  // 更宽松
EEG_INITIAL_UNRELIABLE_SECONDS = 60   // 更保守
FOCUS_WARMUP_SECONDS = 60            // 同步
FOCUS_BASELINE_SECONDS = 60          // 更稳定基线
FOCUS_DECISION_SECONDS = 60           // 更长判定窗口
```

### 场景 B：高信噪比、需快速响应

```
EEG_ENGAGEMENT_EMA_ALPHA = 0.35      // 更快响应
EEG_ENGAGEMENT_ALERT_THRESHOLD = 0.6  // 更严格
EEG_INITIAL_UNRELIABLE_SECONDS = 20   // 更快启动
FOCUS_WARMUP_SECONDS = 20            // 同步
FOCUS_BASELINE_SECONDS = 15           // 快速基线
FOCUS_DECISION_SECONDS = 15           // 快速判定
```

### 场景 C：默认（通用开放源码值）

```
EEG_ENGAGEMENT_EMA_ALPHA = 0.1
EEG_ENGAGEMENT_ALERT_THRESHOLD = 0.3
EEG_INITIAL_UNRELIABLE_SECONDS = 30
FOCUS_WARMUP_SECONDS = 30
FOCUS_BASELINE_SECONDS = 15
FOCUS_DECISION_SECONDS = 15
```

---

## 相关文件

| 文件 | 说明 |
|------|------|
| `src/config/eeg.ts` | 全局 EEG 参数 |
| `src/focus/config.ts` | 专注模块参数 |
| `src/algorithms/engagementIndex.ts` | EI 公式 + 论文引用 |
| `src/focus/focusCalibration.ts` | 专注状态机实现 |
| `src/store/eegStore.ts` | EMA 平滑 + 告警阈值应用 |
| `src/ai/fiveBandInference.ts` | AI 专注推断（引用告警阈值） |
