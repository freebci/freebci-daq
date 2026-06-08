# FreeBCI DAQ — Architecture Design

## 1. Project Overview

FreeBCI DAQ is a **static React + TypeScript + Vite** single-page application for EEG signal acquisition, real-time frequency-domain analysis, and AI-assisted interpretation. It communicates with EEG hardware exclusively via the **Web Serial API**. No backend — all processing runs in-browser.

- **Stack:** React 19, TypeScript, Vite, Zustand, fft.js, @ai-sdk/openai-compatible, Zod, IndexedDB
- **Production output:** `dist/` — static file hosting
- **Languages:** zh-CN (default), en-US

---

## 2. Directory Structure

```
src/
├── main.tsx                          # Entry point
├── App.tsx                           # Root component + page routing
├── i18n.ts                           # 414 keys × 2 locales
├── config/          (2 files)        # EEG + serial constants
├── transport/       (4 files)        # Transport abstraction + shared primitives
├── serial/          (8 files)        # Web Serial implementation
├── hooks/           (1 file)         # useAcquisitionActions — serial state machine
├── store/           (2 files)        # Zustand: eegStore + aiStore
├── analysis/        (7 files)        # FFT, filters, frequency analysis, heatmap
├── algorithms/      (2 files)        # Engagement Index (EI) formula
├── ai/              (14 files)       # AI pipeline: frames, inference, agent, export
├── state/           (3 files)        # Observer buses for waveform rendering
├── types/           (3 files)        # Type definitions
├── utils/           (4 files)        # CSV, file output, formatting, timeouts
├── focus/           (5 files)        # Focus calibration module
└── components/      (22 files)       # UI panels + ui/ primitives
```

---

## 3. Entry Point & Rendering Tree

```
main.tsx → <App>
  ├── <header>            Brand + status dot
  ├── <WorkspaceShell>    5-tab sidebar + content
  │     ├── setup          HardwareConfig, Connection, SiteBinding, Filter, Stream
  │     ├── live           Waveforms, Heatmap, 5-Band, Spectrum, AI Sidebar
  │     ├── analysis       AlgorithmTrend (EI chart) + FocusStatePanel
  │     ├── sessions       AI conversation import/export
  │     └── system         Diagnostics, model config test
  ├── <ErrorBanner>
  ├── <DiagnosticsPanel>
  └── <BottomStatusBar>    Status segments + GitHub link + language toggle
```

---

## 4. State Management

### Critical Design: Ref vs Zustand

| Layer | What lives there | Why |
|-------|-----------------|-----|
| `useRef()` (hook) | `SerialPort`, stream reader, serial parser, `EegFrequencyAnalyzer`, file handles | Non-serializable Web API objects |
| Zustand (`eegStore`) | Status, devices, stream stats, analysis points, focus points, annotations | Serializable UI state |
| Zustand (`aiStore`) | Conversation ID, bindings, model config, frame counts | Serializable AI state |

### Observer Buses (waveform rendering)

```
src/state/rawWaveformBus.ts      → 250Hz per-channel Float32Array ring buffers
src/state/filteredWaveformBus.ts → Filtered output ring buffers
```

Canvas panels read from these buses via `requestAnimationFrame` — **not** from Zustand. This avoids 60Hz React re-renders.

---

## 5. Data Flow

### 5.1 Serial Acquisition

```
navigator.serial.requestPort()
  → openSerialPort({ baudRate: 921600 })
  → send "EEGRST,1\n" → wait ACK
  → send "EEGCFG,1,SR=250,...\n" → wait ACK
  → send "SW,START\n" → wait ACK
  → read loop: binary frame parsing
       → 0xA5 0x5A magic → parse I24LE samples per channel
       → EegSampleBatch → pending queue
```

### 5.2 Batch Processing (budget-controlled)

```
pending batches → dequeue ≤2 per tick (≤8ms budget)
  ├── CSV write (optional, skips first 40s)
  ├── Lead-off detection + rawWaveformBus.push()
  ├── Per channel: filter → ring buffer → FFT (2s window, 0.5s hop)
  │     → delta/theta/alpha/beta/gamma band powers
  │     → EI = β / (α + θ)  [Pope et al. 1995]
  │     → EMA smooth
  ├── AI: band features → IndexedDB (if recording enabled)
  └── Focus: advance calibration → 0/1 state points
```

### 5.3 AI Pipeline

```
User question → intent parsing → context building (IndexedDB frames)
  ├── IF model configured: AI SDK stream (OpenAI-compatible)
  │     → tool calls: summarizeBandStats, lookupBandFrames
  │     → structured output: title, conclusion, evidence, suggestions
  └── ELSE: local rule-based fallback
```

---

## 6. Focus Module

```
src/focus/
  config.ts              FOCUS_WARMUP=40s, BASELINE=30s, DECISION=30s
  types.ts               Calibration phases, state point types
  focusCalibration.ts    State machine: idle → warmup → baseline → active
  FocusStatePanel.tsx    UI: phase indicator, 0/1 step chart, video playback
  index.ts               Barrel export

State machine:
  idle → waiting-warmup → collecting-baseline → active
                                                              │
                                              every outputWindow seconds:
                                              median(EI) ≥ referenceValue → 1 (focused)
                                              median(EI) < referenceValue → 0 (not focused)
```

---

## 7. Configuration

| File | Scope | Key Parameters |
|------|-------|---------------|
| `src/config/eeg.ts` | Global EEG | SR=250Hz, FFT window=2s, hop=0.5s. EMA, alert threshold, warmup configurable via env vars. |
| `src/config/serial.ts` | Serial I/O | Baud=921600, ACK timeout=2s, stall=2s |
| `src/focus/config.ts` | Focus only | Baseline, decision window, warmup configurable via env vars. |

See `TUNING.md` for parameter adjustment guide.

---

## 8. Transport Abstraction

```
src/transport/
  eegTransport.ts       Interfaces: EegTransportRuntime, EegTransportSession,
                        EegTransportConnectInput. ACTIVE mode = 'serial'.
  eegHardwareConfig.ts  HW config normalization, SR options, gain, RLD, AC
  eegChannels.ts        Channel count (1-8, default 2), naming (ch0..ch7)
  eegFrameProtocol.ts   Binary frame: 0xA5 0x5A magic, 8-byte header, I24LE
```

Current implementation: `serial` only. `bridge-coc` descriptor is a placeholder for future transports.

---

## 9. Design Patterns

| Pattern | Where | Purpose |
|---------|-------|---------|
| **Observer Bus** | `src/state/waveformBus.ts` | Decouple 250Hz rendering from React |
| **Ref-based state** | `useAcquisitionActions.ts` | Hold non-serializable Web API objects |
| **Deferred ACK** | `serialConnectionSession.ts` | Async command/response over serial |
| **Session ID guard** | `useAcquisitionActions.ts` | Prevent stale async operations |
| **Batch budget** | `useAcquisitionActions.ts:processBatchQueue` | ≤2 batches / ≤8ms to respect event loop |
| **Config-driven** | `src/config/`, `src/focus/config.ts` | No magic numbers in logic |
| **Zod validation** | `src/ai/protocol.ts` | Type-safe AI data crossing LLM boundary |
| **Filter chain** | `src/analysis/eegFilters.ts` | Composable filter pipeline |
| **Internal module** | `src/focus/` | Self-contained with barrel export |
| **Multi-agent pipeline** | `src/ai/agentPipeline.ts` | Intent → Context → Investigation → Report |
| **Dual-mode AI** | `src/ai/agentPipeline.ts` | AI SDK stream or local fallback |

---

## 10. Dependencies

| Dependency | Role |
|------------|------|
| `react`, `react-dom` | UI framework |
| `zustand` | State management |
| `fft.js` | Fast Fourier Transform |
| `zod` | AI protocol schema validation |
| `@ai-sdk/openai-compatible` | LLM provider abstraction |
| `ai` | Vercel AI SDK (streamText, tools) |
| `lucide-react` | Icons |
| `@radix-ui/*` | Accessible UI primitives |
| `vite` | Build tool |
| `vitest` | Test runner |

---

## 11. Key Constraints

- **Web Serial only** — no Web Bluetooth, GATT, or Notify code
- **Static deployment** — no backend, `dist/` is production
- **Hardware config + site binding must be confirmed before connecting**
- **Changing serial device replaces current device**
- **Switching filters rebuilds analyzer (2s fill gap)**
- **First 40s excluded from CSV and focus classification**
- **EI EMA smoothing happens in store, not in analysis layer**
