# FreeBCI DAQ

A static React + TypeScript + Vite browser app for EEG collection over Web Serial. It opens a serial EEG device, sends reset/config/start commands, parses int24 EEG frames, optionally writes raw CSV, and displays realtime filtered waveforms, spectral analysis, engagement index, and binary focus state.

The current implemented connection path is `serial`. `src/transport/` keeps the internal connection abstraction and shared EEG frame primitives so future bridge-backed transports can feed the same decoded sample pipeline, but this version intentionally contains no Web Bluetooth/GATT/Notify workflow.

## Requirements

- Chrome or Edge with Web Serial support.
- `localhost`, `127.0.0.1`, or HTTPS.
- Real EEG serial hardware for end-to-end collection testing.
- File System Access API support if raw CSV writing is enabled.

## Commands

```bash
npm install
npm run dev
npm run typecheck
npm run test:unit
npm test
npm run build
npm run preview
```

Run one test file:

```bash
npx vitest run tests/serialEegProtocol.test.ts
```

## Workflow

1. Confirm serial hardware parameters.
2. Confirm acquisition site/channel bindings.
3. Open the serial port.
4. The app sends `EEGRST`, waits for reset ACK, sends hardware config, and waits for config ACK.
5. Start collection; the app sends the acquisition start command and parses incoming EEG frames.
6. Realtime CSV, waveform buses, FFT analysis, EI, focus state, heatmap, and AI band features consume the decoded sample batches.

The first 40 seconds of each new stream are treated as initially unreliable and are excluded from CSV and focus classification.

## Key Paths

| Area | Path |
| --- | --- |
| Serial adapter and protocol | `src/serial/` |
| Connection abstraction and shared EEG frame primitives | `src/transport/` |
| Acquisition actions and non-serializable refs | `src/hooks/useAcquisitionActions.ts` |
| Serializable UI/app state | `src/store/eegStore.ts` |
| EEG analysis constants | `src/config/eeg.ts` |
| Serial constants | `src/config/serial.ts` |
| FFT/filter/frequency analysis | `src/analysis/` |
| Raw/filtered waveform observer buses | `src/state/` |

## State Boundary

Zustand stores only serializable UI state. Browser objects and runtime instances such as `SerialPort`, stream readers, file write streams, serial parsers, and `EegFrequencyAnalyzer` instances live in refs inside `useAcquisitionActions()`.

## Validation

After code changes, run:

```bash
npm test
npm run build
```

## License

FreeBCI DAQ is licensed under the GNU Affero General Public License v3
(AGPL v3) with additional commercial terms. See [LICENSE](./LICENSE) for
the full text.

In summary:

- **Free for academic research, education, and personal use.**
- **Commercial use requires a separate license agreement.**
- **Copyright (c) 2026 北京脑机接口商业有限公司 / Beijing Brain-Computer Interface Co., Ltd.**

For commercial licensing inquiries, visit [https://www.bbci.net](https://www.bbci.net).