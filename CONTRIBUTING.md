# Contributing

Thanks for helping improve FreeBCI DAQ. This project welcomes bug reports, docs fixes, translations, hardware protocol feedback, and focused code changes.

By participating, you agree to follow the [Code of Conduct](./CODE_OF_CONDUCT.md).

## Start Here

| Need | Where to go |
|---|---|
| Bug report | Open an issue with reproduction steps, expected behavior, actual behavior, screenshots/logs if useful |
| Feature idea | Open an issue describing the workflow and why it matters |
| Firmware/protocol feedback | Start from [docs/serial-protocol.md](./docs/serial-protocol.md) |
| Tuning questions | See [ARCHITECTURE.md](./ARCHITECTURE.md#page-tuning-reference) |
| Architecture change | Read [ARCHITECTURE.md](./ARCHITECTURE.md) and [AGENTS.md](./AGENTS.md) first |
| Translation update | Edit `src/i18n.ts` and keep both locales in sync |

## Local Development

```bash
npm install
npm run dev
npm test
npm run build
```

Notes:

- Node.js must satisfy `^20.19.0 || >=22.12.0` because the project uses Vite 8.
- `npm test` runs typecheck plus unit tests.
- `npm run build` runs typecheck before Vite build.
- `npm install` may update `package-lock.json`; keep valid npm-resolved lockfile changes and verify the resulting tree.
- Web Serial end-to-end behavior must be checked in Chrome or Edge from `localhost`, `127.0.0.1`, or HTTPS with real hardware.
- The package scripts call package-local CLIs directly instead of relying on `node_modules/.bin` shims.

## Pull Request Checklist

Before opening a PR:

1. Keep the PR scoped to one concern.
2. Add or update tests when behavior changes.
3. Run `npm test`.
4. Run `npm run build`.
5. For UI or serial changes, manually verify the relevant workflow in Chrome/Edge when hardware is available.
6. In the PR description, explain what changed and why.

## Project Boundaries

Do not cross these without a design discussion:

- Do not turn the app into a backend/server application. Production output is static `dist/`.
- Do not add Web Bluetooth, GATT, Notify, service UUID inputs, or old UUID filtering logic.
- Do not put `SerialPort`, readers, parsers, `FileSystemWritableFileStream`, or analyzer instances into Zustand.
- Do not add runtime config-file tuning for EMA, alert threshold, unreliable warmup, baseline, or focus decision windows.

## Code Guidelines

- Follow the existing module boundaries and naming style.
- Prefer existing utilities, stores, and UI primitives before adding new abstractions.
- Keep waveform rendering on observer buses under `src/state/`; do not move 250Hz drawing data into React state.
- Keep EI EMA smoothing in `src/store/eegStore.ts`; do not smooth FFT band powers.
- Switching filters must rebuild analyzers and allow the 2s analysis window to refill.
- Keep user-visible strings in both `zh-CN` and `en-US`.

## Documentation Guidelines

| Document | Update when |
|---|---|
| `README.md` | User-facing capabilities, quick start, command map, document map |
| `ARCHITECTURE.md` | Runtime flow, tuning, roadmap, known technical debt |
| `docs/serial-protocol.md` | Firmware wire protocol or serial timing changes |
| `src/i18n.ts` | Translation keys or user-facing copy change |

## License

By contributing, you agree that your contribution is licensed under the same [AGPL v3 with additional commercial terms](./LICENSE) as the project.
