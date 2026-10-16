# Feature status (2026-10-16)

Legend: ✅ tested and working · 🟡 implemented, not yet verified on the target OS · ⏳ in progress · ⬜ not started · ⛔ blocked

| # | Definition of done | Status | Evidence |
|---|---|---|---|
| 1 | Launch LocalCut on Windows | 🟡 | Launches and works on Linux under a virtual display (`tests/app.e2e.mjs`). Windows installer is built by CI (`package-windows`), not yet run on a Windows machine. |
| 2 | Import a recording, or bring one in from OBS | ✅ import / ⛔ OBS live | Import through the real UI button tested. OBS connection code uses obs-websocket 5; no OBS on the build server, so a live connection test is blocked. The error path (OBS not running) is tested. |
| 3 | View and inspect footage | ✅ | Player loads and seeks; metadata from FFprobe shown (duration, resolution, fps, audio tracks, size). |
| 4 | Portrait clip, sharp foreground and blurred duplicate | ✅ | Test B: 1080×1920. Foreground measured 3× sharper than the blurred bands. Exported from the UI and checked with FFprobe. |
| 5 | Analyse audio and propose silence removal | ✅ | Test C: finds the 2 deliberate silences. The rendered edit is the expected length and has no long silences left. |
| 6 | Local transcription when a model is installed | 🟡 | whisper.cpp integration and JSON parsing unit-tested; not yet run with a real model on this server (memory-limited). |
| 7 | Generate and review several clip suggestions | ✅ | Test D, and in the UI: suggestions are distinct, scored, with visible signals, and turn into clips. |
| 8 | Export selected clips in a batch | ✅ | Test D (queue) and the UI batch export. Unchanged clips are skipped. |
| 9 | Captions off, or on and editable | ✅ off/on · 🟡 transcript editing | Test E: off by default; when on, they render from transcript words. Inline transcript editing is not built yet. |
| 10 | Close and reopen without losing decisions | ✅ | UI test closes and relaunches the app; clips and export status persist. |
| 11 | No paid API or cloud account | ✅ | No network calls except OBS on localhost and links the user opens. |
| 13 | Editor that looks and works like a familiar desktop editor | ✅ | Four-zone layout, filmstrip and waveform tracks, split/trim/move/snap/zoom, undo/redo, keyboard shortcuts. `tests/app.e2e.mjs` drives split, undo, redo and trim-drag through the real UI and checks the export. Gaps vs CapCut are listed in `docs/CAPCUT_COMPARISON.md`. |
| 12 | Build/install from the published instructions | 🟡 | `npm ci && npm run build && npm start` verified on Linux. Windows packaging via CI. |

## Tests A–H
| Test | Result |
|---|---|
| A: import and export | ✅ passed (`tests/integration.test.ts`) |
| B: portrait treatment | ✅ passed |
| C: silence removal | ✅ passed |
| D: clip suggestions | ✅ passed |
| E: captions | ✅ passed (off by default; rendered from transcript data) |
| F: OBS | ⛔ blocked: no OBS on the build server. Error handling tested. Needs a run against OBS 28+ on a desktop. |
| G: offline behaviour | 🟡 the app has no network code paths for core features; a formal "network unplugged" run is still to do on a desktop |
| H: recovery | ✅ passed (failed render reported, project intact, retry works, cancel works) |

Notes
- The UI checks (`tests/app.e2e.mjs`, 27 checks) and 26 unit/integration tests pass on Linux (2026-10-16).
- The build server has about 500 MB of free RAM, so the UI test exports with the fastest preset and one thread. A normal desktop doesn't need this.
