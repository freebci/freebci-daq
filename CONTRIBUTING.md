# Contributing

Thanks for taking the time to contribute. Whether it's a bug report, a feature idea, a documentation fix, or a code PR — everything helps.

This project has a [Code of Conduct](./CODE_OF_CONDUCT.md). By participating, you are expected to uphold it.

## Where to start

- **Bug report?** Open a [GitHub Issue](https://github.com/freebci/freebci-daq/issues) with steps to reproduce, expected behavior, and screenshots if applicable.
- **Feature idea?** Open an issue describing what you want to achieve and why.
- **Code contribution?** See the [PR workflow](#pull-request-workflow) below.
- **Translation?** Edit `src/i18n.ts` and sync `I18N.md`. See the [i18n guide](./I18N.md).
- **Documentation?** README, ARCHITECTURE, TUNING, I18N — all open for improvement.

If you are unsure where to start, see the [roadmap](./ROADMAP.md) for upcoming priorities or pick an [open issue](https://github.com/freebci/freebci-daq/issues).

## Development setup

```bash
npm install
npm run dev        # → http://localhost:5173
npm test           # typecheck + 162 unit tests
```

Chrome or Edge with Web Serial support is required for end-to-end testing. Served from `localhost`, `127.0.0.1`, or HTTPS.

Full command reference and architecture notes: **[AGENTS.md](./AGENTS.md)**.

## Pull Request workflow

1. Fork the repository.
2. Create a branch from `main`.
3. Make your changes. Add tests if applicable.
4. Run `npm test && npm run build` and ensure everything passes.
5. Push and open a pull request to `main`.
6. In the PR description, explain **what** you changed and **why**.

Keep PRs focused. One PR should address one concern. If feedback expands scope, consider a separate follow-up. Rebase onto `main` rather than merging.

## Code guidelines

Read **[AGENTS.md](./AGENTS.md)** for the full set of constraints. At a minimum:

**Architecture**
- This is a static frontend. Do not introduce backend or server-side code.
- The only enabled connection method is Web Serial. Do not introduce Web Bluetooth, GATT, or Notify code.
- Zustand stores only serializable UI state. Use `useAcquisitionActions()` refs for `SerialPort`, stream readers, `EegFrequencyAnalyzer` instances, and file handles.

**Data flow**
- Waveform panels read from Observer Buses (`src/state/`) via `requestAnimationFrame`, not from React state.
- EI EMA smoothing happens in the store layer. Do not re-smooth FFT band powers.
- Switching filters rebuilds all analyzers with a 2-second window fill gap.

**Configuration**
- Scene-dependent tuning parameters are injected via `import.meta.env.VITE_*` with conservative defaults. New environment variables must be documented in `.env.example`. See **[TUNING.md](./TUNING.md)**.

**i18n**
- Every UI string must have both `zh-CN` and `en-US` entries in `src/i18n.ts`. English is the authoritative locale; Chinese aligns to it. After editing, update **[I18N.md](./I18N.md)**.

**Focus module**
- Focus calibration logic lives under `src/focus/` and is self-contained. New focus-related features should extend this module. See **[ARCHITECTURE.md](./ARCHITECTURE.md)**.

**Style**
- Follow the existing code conventions in each file. Do not introduce unnecessary comments.
- Use existing libraries and utility functions. Do not add dependencies without discussion.
- Write commit messages in English. One commit per logical change.

## License

By contributing, you agree that your code will be licensed under the same [AGPL v3 with additional commercial terms](./LICENSE) that covers the project.
