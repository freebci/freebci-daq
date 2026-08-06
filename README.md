# FreeBCI DAQ

Browser-based EEG acquisition and real-time analysis for the FreeBCI Web Serial workflow.

FreeBCI DAQ is a static React + TypeScript + Vite application. It talks to EEG hardware through Web Serial, renders raw and filtered waveforms, computes FFT band powers and engagement index (EI), records CSV and AI five-band frames locally, and provides focus calibration plus AI-assisted interpretation. There is no backend service in the production app; `dist/` is served as static files.

本项目是 [The FreeBCI Project](https://github.com/freebci) 的一部分，由 [北京脑机接口商业有限公司](https://www.bbci.net) 支持。

## Quick Start

Requirements:

- Node.js `^20.19.0` or `>=22.12.0`
- Chrome or Edge with Web Serial support
- `localhost`, `127.0.0.1`, or HTTPS
- Real EEG hardware for end-to-end acquisition testing

```bash
npm install
npm run dev
```

Open `http://localhost:5173`, then complete the setup flow:

1. Confirm serial/hardware parameters (including a baud rate matching the device UART).
2. Confirm acquisition site bindings.
3. Open the serial device.
4. Start collection and optionally choose a CSV output file.

## Commands

```bash
npm run dev          # Vite dev server
npm run typecheck    # TypeScript check for src/
npm run test:unit    # Vitest unit tests
npm test             # typecheck + unit tests
npm run build        # typecheck + production build to dist/
npm run preview      # preview the built dist/
```

The scripts call package-local CLIs directly instead of relying on `node_modules/.bin` shims. This keeps `dev`, `test`, and `build` usable even when local npm shims are malformed.

`package-lock.json` is committed and is allowed to change after `npm install` or dependency fixes. Keep those changes when they reflect npm's resolved tree, then verify with `npm ls`, `npm audit`, `npm test`, and `npm run build`.

## Current Features

| Area | What it does |
|---|---|
| Acquisition | Web Serial only; sends `EEGRST`, `EEGCFG`, `SW,START`; parses int24 binary frames |
| Waveforms | Raw and filtered channel rendering through observer buses |
| Spectral analysis | 2s FFT window, 0.5s hop, delta/theta/alpha/beta/gamma powers |
| Engagement Index | EI = beta / (alpha + theta), EMA-smoothed in the store |
| Page tuning | Algorithms page controls EMA alpha, EI alert threshold, and unreliable warmup |
| Focus state | Warmup + baseline calibration + rolling binary focused/not-focused state |
| AI analysis | Local IndexedDB five-band frames, natural-language reports, OpenAI-compatible providers, local fallback |
| Export | Raw CSV with channel/site metadata, annotation columns, and unreliable-warmup skipping |
| Languages | `zh-CN` default and `en-US` |

## Documentation Map

| Document | Purpose |
|---|---|
| [ARCHITECTURE.md](./ARCHITECTURE.md) | Runtime architecture, tuning, roadmap, technical debt |
| [docs/serial-protocol.md](./docs/serial-protocol.md) | Firmware-facing serial protocol |
| [CONTRIBUTING.md](./CONTRIBUTING.md) | Contributor setup, PR workflow, code boundaries |
| [AGENTS.md](./AGENTS.md) | Concise agent/developer operating notes |

Translations live in `src/i18n.ts`; keep `zh-CN` and `en-US` keys in sync when editing user-visible copy.

## Hard Boundaries

- Keep the app static; do not introduce a backend runtime.
- Current transport is Web Serial only; do not add Web Bluetooth, GATT, Notify, or UUID filtering code.
- Keep non-serializable Web API objects out of Zustand.
- Keep tuning in page UI state; do not add runtime config files for tuning.

## License

AGPL v3 with additional commercial terms. See [LICENSE](./LICENSE).

- Academic research, education, personal use: free
- Commercial use: requires a separate license

Copyright 2026 北京脑机接口商业有限公司 / Beijing Brain-Computer Interface Co., Ltd.

Commercial licensing: [https://www.bbci.net](https://www.bbci.net)
