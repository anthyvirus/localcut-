# LocalCut

**Turn hours of raw footage into multiple edited clips, without uploading your videos to a cloud service.**

LocalCut is an offline-first, open-source desktop app for streamers and vloggers. Import a recording (or pull one in from OBS), let it find silences and promising moments, review the suggestions, and export vertical clips in a batch. Everything runs on your computer with FFmpeg. No subscription, no account, no paid API.

> Status: early (v0.1). The core workflow works end to end and is covered by real FFmpeg tests. See [docs/STATUS.md](docs/STATUS.md) for exactly what's verified.

## What works today

- **Import** MP4, MOV, MKV, WebM (anything your FFmpeg can decode): files, several at once, or a whole folder. Duration, resolution, frame rate, audio tracks and size come from FFprobe.
- **Blurred Portrait** (the main format): 1080×1920 with the sharp original centred over a blurred, darkened, enlarged copy of itself. Adjustable size, position, blur, darkness and zoom, plus top and bottom safe areas. Also Full-screen vertical (crop to fill), Clean landscape, Hook clip, Black background, and Custom.
- **Silence removal**: FFmpeg `silencedetect` finds the pauses. You choose the threshold, the minimum pause, the padding kept around speech, and the longest pause to keep, then shorten or remove longer ones. You see the result on the timeline before exporting. Edits are non-destructive: your original file is never changed.
- **Moment suggestions**: the app builds candidate clips at sentence or speech boundaries and ranks them by visible signals: loudness peaks, how much is speech, transcript cues (questions, exclamations, reactions) and clean start and end points. Overlapping picks are removed. You get 5, 10 or 20 suggestions in short, medium or long lengths. These are suggestions to review, not predictions of what goes viral.
- **Batch export** through a background queue with progress, cancel, retry, unique file names, and recovery after a restart. Unchanged clips aren't re-rendered.
- **Headline layer** (optional): bold text such as "I STILL BOOKED THE MEETING." in Anton or Inter. You can set the size, colour, outline, background panel, position, alignment and time on screen. It's independent of captions.
- **Captions (optional, OFF by default)**: built only from real transcript words, burned in with libass. You can set the style and position, and save an `.srt` file.
- **Local transcription** with [whisper.cpp](https://github.com/ggml-org/whisper.cpp), if you install it and a model (see below).
- **OBS Studio**: connects over OBS WebSocket 5 (OBS 28+) and shows recording and streaming status. It can list and import your latest recordings and offer to import a recording when it stops. The password is stored with your operating system's secure storage.
- **Editor layout** familiar from desktop video editors: media/moments/clips/audio/captions panel on the left, a preview that shows the clip exactly as it will export, a properties panel on the right, and a timeline along the bottom with Moments, Clips, Video (filmstrip) and Audio (waveform and silences) tracks. Split (Ctrl+B), trim by dragging clip edges, drag to move, snapping, zoom, delete, and undo/redo (Ctrl+Z / Ctrl+Shift+Z) for clip edits. The layout is original work; no CapCut code or assets are used. See [docs/CAPCUT_COMPARISON.md](docs/CAPCUT_COMPARISON.md).
- **Computer load setting** (Settings → Quality): limit how many CPU threads an export uses, so a small machine stays responsive.
- **Projects** are saved as JSON and reopen exactly as you left them.

Planned (not built yet): word-level transcript editing, multiple video/overlay tracks, keyframes, transitions, stickers/effects, subject-aware reframing, optional local-LLM ranking (Ollama), and GPU encoder selection in the UI.

## Install and run

### Prerequisites
- **Node.js 22** and npm (to build from source).
- **FFmpeg** with libx264 and libass, on your PATH, or set its path in Settings.
  - Windows: `winget install Gyan.FFmpeg` (or download a "full" build from gyan.dev and point Settings at `ffmpeg.exe` and `ffprobe.exe`).
  - macOS: `brew install ffmpeg`. Linux: `sudo apt install ffmpeg`.
- Optional: **whisper.cpp** for transcripts and captions (see below).

### From source
```bash
git clone https://github.com/YOUR-ACCOUNT/localcut.git
cd localcut
npm ci
npm run build
npm start
```

### Windows installer
`npm run dist:win` builds an installer and a portable `.exe` in `release/`. GitHub Actions builds the same on every push (artifact "LocalCut-windows"). Builds aren't code-signed yet, so Windows SmartScreen will warn the first time.

## Transcription (optional)
1. Download whisper.cpp for your system from its [releases](https://github.com/ggml-org/whisper.cpp/releases), or build it. You need the `whisper-cli` program.
2. Download a model once, for example `ggml-base.en.bin` (English) or `ggml-small.bin` (multilingual), from the [whisper.cpp models page](https://huggingface.co/ggerganov/whisper.cpp).
3. In LocalCut → Settings → Transcription, choose `whisper-cli` and the model file.

After that, transcription runs offline. Without it, LocalCut still finds silences and suggests moments from audio alone. It just tells you suggestions would be better with a transcript.

## OBS setup
1. In OBS 28 or newer: **Tools → WebSocket Server Settings → Enable WebSocket server** (default port 4455).
2. Click **Show Connect Info** and copy the password.
3. In LocalCut → OBS: enter host and port (normally `127.0.0.1` and `4455`), save the password, and press Connect.

You can also just choose your OBS recordings folder: LocalCut lists the newest recordings even when it's not connected.

**Twitch and YouTube VODs**: LocalCut doesn't download from platforms. Download your own past broadcast with the platform's creator tools (Twitch Creator Dashboard, YouTube Studio), then import the file.

## Privacy
Your footage, transcripts, projects and settings never leave your computer. LocalCut makes no network requests on its own. See [docs/PRIVACY.md](docs/PRIVACY.md).

## Development
```bash
npm run typecheck   # strict TypeScript, main and UI
npm test            # unit tests and real FFmpeg integration tests (generates its own test video)
npm run build
xvfb-run -a node tests/app.e2e.mjs   # drives the real Electron app (Linux; needs Playwright)
```
The test video is generated with FFmpeg (a test pattern plus tones with deliberate silences), so no copyrighted footage is in the repo.

Architecture: `src/core` is the media engine (pure TypeScript and FFmpeg, no Electron). `src/main` holds the Electron main process: IPC, jobs, OBS, media protocol. `src/preload` is a narrow, typed bridge. `src/renderer` is the React UI. More in [docs/PLAN.md](docs/PLAN.md) and [docs/BLUEPRINT.md](docs/BLUEPRINT.md).

## Troubleshooting
- **"ffmpeg was not found"**: install FFmpeg or set its path in Settings → FFmpeg, then press "Check again".
- **Captions fail on Windows**: make sure your FFmpeg build includes libass (the "full" builds do).
- **OBS won't connect**: OBS must be open with the WebSocket server enabled. Check the port and password, and firewall software that blocks local connections.
- **Export stops on a low-memory computer**: a 1080×1920 encode needs a few hundred MB of RAM. Lower "Computer load while exporting" in Settings, or pick a faster quality preset.
- **A clip won't export**: open Jobs at the bottom of the window. The last FFmpeg lines are shown, and Retry runs it again.

## Licence
LocalCut is MIT licensed. Bundled fonts (Anton, Inter) are SIL Open Font License. FFmpeg and whisper.cpp are separate programs you install. See [docs/LICENSES.md](docs/LICENSES.md).
