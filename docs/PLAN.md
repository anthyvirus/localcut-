# LocalCut — implementation plan (2026-10-16)

## Environment findings
- Built on a Linux server (Ubuntu, Node 22.22, Git 2.53, FFmpeg/FFprobe 8.0.1 with gpl, libx264, libass, libfreetype, boxblur/gblur, silencedetect, ebur128, loudnorm, subtitles, drawtext).
- Not available here: OBS Studio, Windows, Wine, a GPU, Whisper. Memory is tight (~400 MB free, shared with other production services), so heavy jobs run niced and briefly.
- Consequences: the media engine, analysis, persistence and export queue are tested for real here with FFmpeg; the Electron app is launched under a virtual display (xvfb) for smoke tests; Windows installers are built by GitHub Actions on `windows-latest`; the OBS test (Test F) is **blocked** until run against a real OBS.

## Architecture
- **Electron + React + TypeScript (strict) + Vite.** Main process owns files, FFmpeg, OBS and jobs. Renderer is a sandboxed UI with `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`, a strict CSP, and a typed, validated preload bridge (no generic fs/shell access).
- **`src/core/`** — pure TypeScript engine with no Electron imports, unit-testable in Node: ffprobe metadata, silence detection, transcript model, moment detection and ranking, edit decisions, portrait/caption/headline FFmpeg filtergraphs, export command building, filename rules, project store, job queue.
- **`src/main/`** — Electron main: window, IPC handlers (validated), job runner (child processes with progress parsing, cancel, retry), OBS client, settings, model manager.
- **`src/renderer/`** — React UI: Library/Projects, Project workspace (player, timeline, transcript, clip gallery, inspector), OBS, Settings, persistent job tray.
- **Projects** are JSON files (`<project>/project.json`, atomic write + backup) holding sources, analysis results, clips and edit decisions. Originals are never modified. JSON over SQLite: human-readable, no native module to rebuild per Electron version, easy to diff and recover.
- **Transcription**: whisper.cpp CLI (MIT) with ggml Whisper models (MIT, OpenAI). Optional; the user installs the binary/model explicitly. Everything else works without it.
- **OBS**: `obs-websocket-js` v5 (MIT) against OBS WebSocket 5.x (built into OBS 28+).
- **FFmpeg** is not bundled in the first release: the user installs it (or points to it) and Settings → Diagnostics checks it. This avoids GPL redistribution obligations in our binaries; the app is MIT.

## Dependencies (licences)
electron (MIT), react/react-dom (MIT), vite (MIT), @vitejs/plugin-react (MIT), typescript (Apache-2.0), vitest (MIT), electron-builder (MIT), obs-websocket-js (MIT), eslint (MIT). Runtime external tools: FFmpeg (LGPL/GPL depending on build — user-supplied), whisper.cpp (MIT), Whisper models (MIT).

## MVP priority (phases)
1. Foundation: app shell, security, navigation, theme, diagnostics, import + metadata.
2. Video engine: thumbnails, preview, Blurred Portrait export (1080×1920) and the other presets.
3. OBS: connect, status, recording dir, latest recording import, completed-recording detection.
4. Audio analysis: silencedetect + loudness curve, silence-removal proposals, whisper.cpp transcription.
5. Moment detection: candidates from transcript + energy + speech density, dedup, ranking, gallery, batch export.
6. Captions (default OFF) + headline layer + presets.
7. Release: tests, docs, licence review, CI, Windows packaging.

Deferred: multi-track NLE, platform VOD downloaders (adapter interface only; no downloads that platforms don't permit), local LLM ranking (optional Ollama hook later), GPU encoders beyond auto-detect.

## Risks
- Moment "interest" can't be truly understood by heuristics → present as ranked suggestions with visible signals.
- Long recordings: analysis must stream and checkpoint; never load whole files in memory.
- Windows path/quoting differences for FFmpeg filters (subtitles path escaping) → covered by tests in CI on Windows.
- whisper.cpp binaries per OS → documented install; app detects path.

## Acceptance tests
Tests A–H from the brief; each is recorded in `docs/STATUS.md` as run/passed/blocked with evidence.
