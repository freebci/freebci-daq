# Tech Debt / Code Issues

Known code quality issues, deferred for future refactoring.
Items are ordered by impact on contributor onboarding.

---

## 1. Oversized Files

Files exceeding 500 lines. Hardest for new contributors to understand.

| File | Lines | Concern |
|------|-------|---------|
| `src/hooks/useAcquisitionActions.ts` | 1376 | Mixes serial connect, stream start/stop, batch processing, CSV writing, AI recording, and analysis processor creation. Should be split into separate concerns. |
| `src/components/AlgorithmTrendPanel.tsx` | 1091 | Single component containing chart rendering, tooltip logic, drag handling, annotation markers, and hero stats. Candidate for extraction of chart core into a shared module. |
| `src/ai/naturalReport.ts` | 984 | Mostly template strings for report generation. Acceptable but could benefit from splitting by report section. |
| `src/components/AiAgentPanel.tsx` | 901 | Contains 4 sub-components (`AiModelSettingsPanel`, `AiSiteBindingPanel`, `AiAnalysisSidebar`, `AiSessionPanel`). Each should be its own file, with this file as a barrel re-export. |
| `src/store/eegStore.ts` | 877 | Large Zustand store with 40+ actions. Some slices (focus, annotations, heatmap) could be extracted into separate store modules. |
| `src/i18n.ts` | 856 | Naturally large key-value dictionary. Acceptable as-is but consider splitting into per-section files if it grows further. |
| `src/components/WaveformPanel.tsx` | 758 | Shared base component for `RawWaveformPanel`/`FilteredWaveformPanel`. Acceptable since it handles Canvas rendering for both. |
| `src/focus/FocusStatePanel.tsx` | 673 | SVG rendering + calibration UI. Candidate for splitting chart logic from control UI. |

---

## 2. Missing Barrel Exports

Most directories lack a public API surface. Contributors cannot tell what to import without reading every file.

| Directory | Has barrel? | Impact |
|-----------|------------|--------|
| `src/ai/` | None | Largest directory (14 files). No clear entry point. |
| `src/analysis/` | None | Filter, FFT, and heatmap exports scattered. |
| `src/serial/` | None | Contributors must guess which file to import from. |
| `src/transport/` | None | Protocol and config files without unified export. |
| `src/state/` | None | Bus singletons already exported from individual files. Barrel would clarify the two public buses. |
| `src/focus/` | `index.ts` | Good. Follow this pattern elsewhere. |
| `src/components/ui/` | `index.ts` | Good. |

---

## 3. Test Organization

| Issue | Detail |
|-------|--------|
| Flat directory | All 23 test files in `tests/` with no subdirectories. Should mirror `src/` structure: `tests/ai/`, `tests/serial/`, `tests/analysis/`. |
| Integration tests | `engagementTrend.test.ts` tests both the store and focus calibration together. Consider splitting into unit tests per module. |

---

## 4. Directory Naming

| Path | Issue |
|------|-------|
| `src/algorithms/` | Contains only one algorithm (engagement index). Name is misleading. Either add more algorithms or rename to `src/engagement/`. |

---

## 5. Missing Module Documentation

| Directory | Status |
|-----------|--------|
| `src/ai/` | No internal README describing the multi-agent pipeline. See `ARCHITECTURE.md` section 9 for public-facing docs, but nothing inside the module itself. |
| `src/serial/` | No documentation on protocol flow (`EEGRST → EEGCFG → SW,START → binary frames`). `AGENTS.md` has a one-liner. |

---

## 6. Untyped / Incomplete Patterns

| File | Issue |
|------|-------|
| `src/store/eegStore.ts` | `EegStore` interface not extracted into a separate type file. Combined with 877-line implementation makes it hard to see the store shape. |
| `src/hooks/useAcquisitionActions.ts` | Returns a large object of 15+ methods with no explicit type. New contributors have no way to see the API surface without reading the entire file. |

---

## Priorities for Next Refactor

1. Split `AiAgentPanel.tsx` into 4 files (lowest risk, highest clarity gain)
2. Add barrel exports to `ai/`, `analysis/`, `serial/` (low risk, high discoverability)
3. Extract `EegStore` type definition into a separate file
4. Split `useAcquisitionActions.ts` by concern (high risk, needs careful testing)
