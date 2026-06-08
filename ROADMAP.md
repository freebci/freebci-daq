# Roadmap

Each release focuses on one major theme. Order and scope may evolve based on community feedback and project priorities.

---

## v0.1 — Core Acquisition ✓

Current release.

- Web Serial EEG acquisition (int24 binary frame protocol)
- Real-time raw and filtered waveform display
- FFT spectral analysis: δ / θ / α / β / γ band powers
- Engagement Index: β / (α + θ) with EMA smoothing
- Focus calibration and binary state classification
- AI-assisted five-band analysis (local fallback included)
- Raw CSV export
- zh-CN / en-US bilingual UI

---

## v0.2 — Algorithms & Community

Algorithm plugin system + community protocol.

- Define plugin interface for algorithms (EI, focus, third-party)
- Refactor existing algorithms into built-in plugins
- Community algorithm protocol: standard format for sharing plugins
- Upload, download, and import community algorithms
- Open the first path for external contributions

---

## v0.3 — Performance & Signal Quality

WASM engine + artifact detection.

- Move FFT and filter chains to WASM
- Artifact detection: blink, muscle, and motion artifacts
- First complex real-world plugin to validate the v0.2 system
- Cleaner data with lower main-thread pressure

---

## v0.4 — Multi-device & Multi-protocol

Bluetooth + multiple devices + hardware support.

- Web Bluetooth as a second connection path
- Reuse the existing transport abstraction
- Multi-device synchronized acquisition on a shared timeline
- Support for additional EEG hardware beyond our own

---

## v0.5 — Data Interoperability

Connect to the academic toolchain.

- LSL / UDP streaming output (MATLAB, Python, EEGLAB)
- Offline replay from CSV / EDF files (analyze without hardware)
- EDF (European Data Format) / BDF (BioSemi Data Format) import and export
- Electrode impedance check before acquisition

---

## v0.6 — Desktop Edition

Electron packaging + full UI redesign + plugin marketplace.

- Native desktop application with automatic updates
- Complete visual design refresh
- Plugin marketplace UI for discovering and installing community algorithms
- Unified product experience

---

## Future (beyond v0.6)

Not yet scheduled. Candidate topics:

- Event-Related Potential (ERP): segmented averaging by event markers
- Real-time time-frequency spectrogram
- BIDS-compatible annotation import/export
- Synchronous multi-subject experiment support
