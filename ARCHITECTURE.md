# Architecture

FreeBCI DAQ is a static React + TypeScript + Vite application for EEG acquisition, real-time analysis, focus calibration, and AI-assisted interpretation. The current production transport is Web Serial only. All signal processing and persistence run in the browser.

## Runtime Shape

```text
index.html
  → src/main.tsx
  → App
      → WorkspaceShell
          setup: hardware, connection, site binding, filters, stream controls
          live: heatmap, five-band trend, raw/filtered waveform, spectrum, AI sidebar
          analysis: page tuning, EI trend, annotations, focus state
          sessions: AI recording import/export
          system: diagnostics, environment, protocol debug
```

Production output is `dist/` and can be hosted as static files.

## Acquisition Flow

```text
requestSerialPort
  → openSerialPort
  → EEGRST
  → EEGRSTACK
  → EEGCFG
  → EEGCFGACK
  → SW,START
  → SWACK
  → binary EEG frames
  → EegSampleBatch
```

The app only opens serial after serial/hardware parameters (including the baud
rate) and acquisition site bindings are confirmed. The selected baud rate is
used by Web Serial when the port is opened; it is not sent in `EEGCFG`.
Selecting a new serial device replaces the current device.

## Batch Processing Flow

```text
EegSampleBatch
  ├── stream counters in eegStore
  ├── optional CSV write
  │     └── skips page-configured initial unreliable samples
  ├── rawWaveformBus
  ├── per-channel filter
  │     └── filteredWaveformBus
  ├── FFT window/hop
  │     └── delta/theta/alpha/beta/gamma powers
  ├── engagement index
  │     └── EMA smoothing in eegStore
  ├── AI five-band frames
  │     └── IndexedDB
  ├── heatmap frames
  └── focus calibration state machine
```

Batch work is scheduled with a small processing budget to avoid blocking rendering.

## State Ownership

| Owner | Holds | Must not hold |
|---|---|---|
| `useAcquisitionActions()` refs | `SerialPort`, reader, parser, file stream, analyzer instances, timers | Serializable UI state |
| `useEegStore` | status, diagnostics, serializable stream stats, tuning, analysis points, focus state, annotations | Web API objects or class instances |
| `useAiStore` | conversation metadata, bindings, model config, AI frame counts | IndexedDB handles |
| waveform buses | raw/filtered sample ring buffers for Canvas rendering | UI control state |

Waveform panels render from observer buses, not from Zustand. This keeps 250Hz drawing data out of React state.

## Configuration and Tuning

Fixed defaults and bounds live in `src/config/eeg.ts`, `src/config/serial.ts`,
and `src/focus/config.ts`.

Connection and hardware values selected on the Setup page are serializable
acquisition state. Baud rate defaults to `921600`, is locked together with the
hardware parameters, and only takes effect on the next serial connection.

Scene-dependent values are page state:

- EI EMA alpha
- EI alert threshold
- initial unreliable seconds
- Focus baseline seconds
- Focus output window seconds

These values are stored in `useEegStore().analysis`. EI alpha, alert threshold, and initial unreliable seconds are configured from the Algorithms page tuning panel; Focus baseline seconds and output window seconds are configured from the Focus state panel. Do not add runtime config-file tuning.

## Page Tuning Reference

The public EI formula lives in `src/algorithms/engagementIndex.ts`. The Algorithms page exposes scenario-dependent parameters around that formula.

| Page field | Default | Range | Effect |
|---|---:|---:|---|
| EI EMA alpha | 0.1 | 0-1 | Store-level EI smoothing; higher responds faster, lower is smoother |
| EI alert threshold | 0.3 | >=0 | Trend red line and AI focus support threshold |
| Initial unreliable seconds | 30 | 0-300 | CSV skip, AI `initialUnreliable` flag, Focus warmup |

Focus timing fields live in the "User output 15s focus state" panel:

| Focus field | Default | Range | Effect |
|---|---:|---:|---|
| Focus baseline seconds | 15 | 5-300 | EI median window used as Focus reference |
| Focus output window seconds | 15 | 5-300 | Window for each binary focused/not-focused state point |

Fixed hardware and analysis constants remain code constants:

| Constant | Default | Meaning |
|---|---:|---|
| `EEG_SAMPLE_RATE_HZ` | 250 | Device sample rate |
| `EEG_ANALYSIS_WINDOW_SECONDS` | 2 | FFT window length |
| `EEG_ANALYSIS_HOP_SECONDS` | 0.5 | FFT output cadence |
| `EEG_DEFAULT_FFT_SIZE` | 512 | FFT size |
| `EEG_LIVE_WINDOW_SECONDS` | 300 | Default X-axis window |

EI smoothing:

```text
smoothEI = alpha * rawEI + (1 - alpha) * prevSmoothEI
```

AI focus support thresholds:

```text
supportThreshold = page EI alert threshold
mixedThreshold = supportThreshold * 0.7
```

Suggested presets:

| Scenario | EI alpha | Alert | Unreliable | Baseline | Output |
|---|---:|---:|---:|---:|---:|
| Noisy hardware | 0.1 | 0.3 | 60s | 60s | 60s |
| Fast response | 0.35 | 0.6 | 20s | 15s | 15s |
| General default | 0.1 | 0.3 | 30s | 15s | 15s |

Changing initial unreliable seconds or baseline seconds resets the current Focus calibration state so old windows are not mixed with new timing.

## Key Modules

| Path | Responsibility |
|---|---|
| `src/serial/` | Web Serial access, control commands, ACK parsing, protocol session helpers |
| `src/transport/` | Internal transport/channel/hardware abstractions and shared frame protocol utilities |
| `src/hooks/useAcquisitionActions.ts` | Serial lifecycle, stream lifecycle, batch queue, refs for non-serializable objects |
| `src/store/eegStore.ts` | Serializable acquisition and analysis UI state |
| `src/store/aiStore.ts` | Serializable AI session/config state |
| `src/state/` | Raw and filtered waveform observer buses |
| `src/analysis/` | Filters, FFT, frequency analyzer, heatmap, lead-off detection |
| `src/algorithms/` | Engagement index formula |
| `src/focus/` | Focus timing config, state machine, focus UI |
| `src/ai/` | Five-band frames, IndexedDB persistence, local inference, model provider, report generation |
| `src/components/` | UI panels and shared UI primitives |
| `src/utils/` | CSV, file output, formatting, timeout helpers |
| `src/i18n.ts` | `zh-CN` and `en-US` strings |

## Focus State Machine

```text
idle
  → waiting-warmup
  → collecting-baseline
  → active
      every outputWindow seconds:
        median(EI) >= referenceValue → 1
        median(EI) < referenceValue  → 0
```

Changing initial unreliable seconds or baseline seconds resets the current focus calibration state. Changing output window seconds resets active decision points so old and new windows are not mixed.

## AI Flow

```text
record five-band frames
  → persist in IndexedDB
  → user question
  → intent parse
  → summarize / lookup relevant frames
  → local fallback or OpenAI-compatible model
  → natural-language report
```

AI focus inference uses the current page-configured EI alert threshold as its support ratio threshold.

## Hard Constraints

- Static frontend only; no backend runtime.
- Web Serial is the only enabled transport in the current web app.
- Do not add Web Bluetooth, GATT, Notify, service UUID inputs, or legacy UUID filters.
- Keep hardware config and site binding locked before connecting.
- Keep analyzer/filter state compatible: changing filters rebuilds analyzers and requires a 2s fill gap.
- Keep FFT band powers unsmoothed; smooth EI only in the store.
- Keep Web API objects out of Zustand.

## Validation Expectations

Code changes should pass:

```bash
npm test
npm run build
```

Serial/UI behavior still needs manual Chrome or Edge testing on `localhost`, `127.0.0.1`, or HTTPS with real hardware.

## Roadmap

Current release line:

- Web Serial acquisition with `EEGRST -> EEGCFG -> SW,START`
- int24 binary frame parsing and channel mapping
- Raw and filtered waveform panels
- FFT five-band analysis, engagement index, and page tuning
- Focus calibration and binary state output
- AI five-band recording, local fallback reports, and OpenAI-compatible providers
- CSV export with metadata and annotation columns
- zh-CN / en-US UI

Near-term direction:

- Make the current serial workflow harder to misuse with stronger setup guidance and clearer diagnostics.
- Add more serial protocol simulation tests and session import/export polish.
- Define a small built-in algorithm interface before adding new analysis methods.
- Add artifact and signal-quality indicators without smoothing FFT band powers globally.
- Profile high-channel/high-sample-rate sessions before moving FFT or filters to WASM.
- Improve interoperability through offline replay, event marker import/export, and BIDS-oriented metadata review.

Future transports or local bridge work must connect to the same sample pipeline and preserve the current Web Serial-only web path.

## Technical Debt

Highest-impact cleanup targets:

| Area | Problem | Safer next step |
|---|---|---|
| `src/hooks/useAcquisitionActions.ts` | Serial connection, stream lifecycle, batch processing, CSV writing, AI recording, and analyzer creation live in one hook. | Extract pure batch/analysis helpers first, then split serial session lifecycle. |
| `src/store/eegStore.ts` | One large Zustand store owns stream stats, analysis points, heatmap, focus, annotations, tuning, and diagnostics. | Extract store type definitions and small helper reducers before attempting slices. |
| `src/components/AlgorithmTrendPanel.tsx` | Chart drawing, pointer interaction, annotations, tooltip, and hero stats are coupled. | Extract chart geometry and annotation rendering helpers with focused tests. |
| `src/components/AiAgentPanel.tsx` | Multiple panels share one file, making navigation and review noisy. | Split into model settings, site binding, analysis sidebar, and session panels. |

Medium-impact cleanup targets:

| Area | Problem | Safer next step |
|---|---|---|
| `src/ai/naturalReport.ts` | Long report template file. | Split by report type: focus, mental state, signal quality, fallback. |
| `src/focus/FocusStatePanel.tsx` | Calibration controls, video handling, and SVG chart live together. | Extract chart path/tick helpers and video picker UI. |
| `src/components/WaveformPanel.tsx` | Shared Canvas renderer is large but cohesive. | Keep as-is unless adding another waveform mode; then extract renderer math. |
| `src/i18n.ts` | Large dictionary is easy to edit incorrectly. | Add a small validation script for locale key parity and placeholder parity. |

Tests are currently flat under `tests/`. Split into `ai/`, `analysis/`, `focus/`, `serial/`, `store/`, and `transport/` only when touching those areas for other reasons.
