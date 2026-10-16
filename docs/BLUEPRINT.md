# LocalCut — technical blueprint (2026-10-16)

LocalCut is an offline, MIT-licensed Electron + TypeScript + FFmpeg desktop app for turning long recordings into short vertical clips. This blueprint draws only on public documentation and open-source project pages (cited inline). We did not decompile, download or copy anything from CapCut. Where a claim is unverified, it says so.

Already in the repo (`src/core/`): ffprobe/diagnostics (`ffmpeg.ts`), silencedetect + loudness curve + keep-ranges (`audio.ts`), whisper.cpp transcription (`transcript.ts`), heuristic moment suggestions with duration presets and dedup (`moments.ts`), composition/caption/headline filtergraphs, ASS generation and render hashing (`render.ts`), the job queue (`queue.ts`), JSON projects (`project.ts`) and safe filenames (`names.ts`). The plan is in `docs/PLAN.md`.

---

## 1. What CapCut publicly offers, and which UX patterns to emulate

We copy patterns only. LocalCut's UI, wording, icons and assets are all our own.

| Capability | Public behaviour | Pattern worth emulating independently |
|---|---|---|
| Auto captions | Captions → Auto captions → pick audio source and language → Generate. Produces an editable caption track; optional bilingual and "Auto Highlight Keywords". Free-tier limits come only from third-party guides and are unconfirmed. [help](https://www.capcut.com/help/how-to-recognise-subtitles), [bilingual](https://www.capcut.com/help/bilingual-subtitles), [resource](https://www.capcut.com/resource/how-to-add-subtitle-in-capcut), [Movavi](https://www.movavi.com/learning-portal/how-to-add-captions-on-capcut), [Riverside](https://riverside.fm/blog/how-to-add-captions-in-capcut) | Keep settings minimal (language, highlight keywords). Caption segments are edited inline on the timeline. |
| Long video to shorts | Video longer than 1 min → range slider → length bucket (Auto, <60s, 60–90s, 90s–3min) → caption template → Convert. Returns a set of shorts, each with a suggested topic, title and description, each editable and exportable. May be region-limited; no public statement on whether it is Pro-only. [desktop page](https://capcut.com/desktop/long-video-to-shorts), [AI shorts maker](https://www.capcut.com/resource/ai-shorts-maker), [YT shorts guide](https://www.capcut.com/resource/how-to-make-shorts-from-youtube-videos), [SMT](https://www.socialmediatoday.com/news/capcut-adds-new-features-for-short-form-video-editing/703177/) | Range selector, length bucket, then a results gallery: one card per clip with its title and reason, open-in-editor, and export. |
| Auto Reframe | Video → Basic → Auto reframe: target ratio, stabilisation, camera speed, subject tracking. Pro-only according to CapCut's own help page. [help](https://www.capcut.com/help/why-do-i-have-to-pay-for-auto-reframe), [reframers](https://www.capcut.com/resource/best-video-reframers) | Ratio presets plus a draggable crop box in the preview. Subject tracking is deferred (see §4). |
| Blurred background | Built by hand: duplicate the track, blur the lower copy, keep the sharp copy on top. A Canvas blur fill is mentioned only by third parties. [guide](https://capcut.com/resource/how-to-blur-videos-in-capcut) | One-click "Blurred Portrait" preset (already LocalCut's default composition). |
| Silence removal | **Unverified**: third parties describe an "Auto remove silence" toolbar action with no adjustable threshold, aimed at clips under 10 minutes. [Hollyland](https://store.hollyland.com/blogs/creator-hub/remove-pauses-in-capcut), [Cutsio](https://cutsio.com/blog/capcut-silence-remover-vs-cutsio-comparison), [FreeAcademy](https://freeacademy.ai/lessons/ai-video-editing-remove-silences), [autocut](https://www.capcut.com/resource/autocut-for-videos) | Do better: expose threshold, minimum gap and padding, preview before applying, and keep cuts non-destructive and undoable. |
| Hooks / titles | Each short gets a suggested title and description; hook text otherwise comes from text templates. [desktop page](https://capcut.com/desktop/long-video-to-shorts) | Per-clip editable headline layer (off by default), pre-filled from the moment's reason or the transcript. |
| Batch export | No public documentation; shorts appear to export one at a time through the Export dialog. | One-pass batch export of all approved clips through the job queue. This is where LocalCut can clearly do better. |

Interaction principles we adopt: suggestions are ranked and come with visible reasons (never a black box); originals are never touched; every long operation runs in the persistent job tray with progress, cancel and retry; captions are **off by default**.

---

## 2. Feature-by-feature implementation

### 2.1 OBS recording integration
- Library: `obs-websocket-js` v5 (MIT) against obs-websocket 5.x, which is built into OBS 28 and later on port 4455 by default. [lib](https://github.com/obs-websocket-community-projects/obs-websocket-js), [protocol](https://raw.githubusercontent.com/obsproject/obs-websocket/master/docs/generated/protocol.md)
- Flow (main process, `src/main/obs.ts`):
  ```ts
  const obs = new OBSWebSocket();
  await obs.connect(`ws://127.0.0.1:${port}`, password); // lib does the auth hashing
  const { recordDirectory } = await obs.call('GetRecordDirectory');
  obs.on('RecordStateChanged', e => {
    if (e.outputState === 'OBS_WEBSOCKET_OUTPUT_STOPPED' && e.outputPath) queueImport(e.outputPath);
  });
  ```
  The status panel polls `GetRecordStatus` (outputActive, outputTimecode, outputBytes; check these fields against protocol.md). Start/Stop buttons call `StartRecord`/`StopRecord`; `StopRecord` returns `outputPath`. `SaveReplayBuffer` is an optional extra.
- Auth (for reference/tests): secret = base64(sha256(password + salt)); auth = base64(sha256(secret + challenge)). A wrong password closes the socket with code 4009, which the UI should show as "password rejected".
- Setup UX: guide the user to OBS → Tools → WebSocket Server Settings, enable it, copy the password. Store the password with Electron `safeStorage`, never in plain text.
- Import: wait until the file size stops changing, then probe. MKV recordings are remuxed (`ffmpeg -i in.mkv -c copy out.mp4`) into the project folder; the original stays untouched.
- Fallback without a connection: watch the record directory with `fs.watch` and use the same stable-size check.

### 2.2 VOD import (legitimate flows only)
Neither Twitch's Helix `GET /videos` nor the YouTube Data API v3 offers a download endpoint for full videos; both return metadata only. [Twitch](https://dev.twitch.tv/docs/api/reference/#get-videos), [YouTube](https://developers.google.com/youtube/v3/docs)
1. **Local file / drag-and-drop / folder watch**: the core path.
2. **Guided own-content download**: an in-app checklist (it opens the platform's site in the user's browser and does not automate it):
   - Twitch: enable "Store past broadcasts" → Creator Dashboard → Content → Video Producer → ⋯ → Download. VODs are kept for a limited time (about 7–14 days; sources disagree). [OTT](https://www.online-tech-tips.com/computer-tips/how-to-download-twitch-videos/), [TechAdvisor](https://www.techadvisor.com/article/740322/how-to-download-twitch-videos.html), [AndroidAuthority](https://androidauthority.com/save-vods-twitch-3188608)
   - YouTube Studio → Content → ⋯ → Download (third parties report it is often 720p and rate-limited), or Google Takeout for a whole channel. [HowToGeek](https://www.howtogeek.com/693705/how-to-download-your-own-youtube-videos/), [BI](https://www.businessinsider.in/how-to-download-your-own-youtube-videos-in-3-different-ways/articleshow/71225289.cms)
3. **Optional OAuth metadata** (Twitch Get Videos / YouTube Data API), used only to label and match imported files by title, date and duration.
4. **Twitch clips** through the official Get Clips Download endpoint, when the broadcaster authorises it.
- Not built: scrapers, stream rippers, a bundled yt-dlp. The `VodSource` adapter interface stays, with no downloading implementations.

### 2.3 Moment detection
Present results as ranked suggestions with their signals visible. Builds on `moments.ts` (`suggestMoments`, `sameMoment`, `DURATION_PRESETS`).
- **Signals** (all computed locally):
  - Speech density and silence gaps from `audio.ts` silencedetect, later Silero VAD.
  - Loudness curve (`loudnessCurve`, 0.5 s steps): z-score spikes catch laughs, shouts and hype.
  - Transcript, when whisper.cpp is present: sentence boundaries, keyword and question cues, and topic shifts (TextTiling-style, an idea taken from ClipsAI without the code or its dependencies). [ClipsAI](https://github.com/ClipsAI/clipsai)
  - Scene cuts, as an auxiliary signal only (facecams have few): `ffmpeg -i in -vf "select='gt(scene,0.3)',showinfo" -f null -`, following PySceneDetect's ContentDetector idea. [PySceneDetect](https://github.com/Breakthrough/PySceneDetect)
- **Boundaries**: snap the start to a sentence start or speech onset and the end to a sentence end or VAD gap, then apply the length bucket (mirroring Auto / <60 / 60–90 / 90–180 s), then dedup with `sameMoment` (IoU 0.35).
- **Optional LLM ranking** (deferred, off by default): a local Ollama hook that scores transcript windows and drafts a title. Never required, never in the cloud by default.
- **UI**: range slider + length bucket → Analyse → gallery of cards (thumbnail, time range, score, signal chips such as "loudness spike" or "question", editable title) → approve or reject.

### 2.4 Silence removal
Builds on `audio.ts` (`DEFAULT_SILENCE`: −35 dB, min 0.6 s, padding 0.15 s, max pause 0.8 s; `keepRanges`).
- Stage A (now): `silencedetect=noise=-35dB:d=0.6` → keep ranges with padding, merging small gaps (the same algorithm as auto-editor, reimplemented ourselves, not its code; auto-editor is Unlicense). [auto-editor](https://github.com/WyattBlue/auto-editor)
- Adaptive threshold: set the threshold relative to the file's measured noise floor (for example the 10th percentile of `loudnessCurve` + 6 dB), so quiet and loud streams both work.
- Stage B: Silero VAD (MIT, ONNX) through `onnxruntime-node`, on 16 kHz mono, 512-sample chunks from `ffmpeg -f s16le -ar 16000 -ac 1 -`. Reset its state per file and pin the onnxruntime version to the model's opset. [Silero](https://github.com/snakers4/silero-vad)
- UX: sliders for threshold, minimum gap and padding; a timeline overlay of the proposed cuts and the "saves Xs" total (`totalLength`); preview; apply stores the keep ranges as an edit decision, so it is reversible and the source is untouched.
- Render: frame-accurate cuts need a re-encode (stream-copy cuts land on keyframes, a lesson from LosslessCut's UX). Use `trim`/`atrim` + `concat`, or `select`/`aselect` with `between()`, on keep ranges inside the same filtergraph as the composition. `mapTime` already shifts caption times onto the cut timeline.

### 2.5 Optional captions (default OFF)
- whisper.cpp (MIT): `whisper-cli -m ggml-base.en.bin -f in.wav -oj -ml 1` on 16 kHz mono WAV, which gives word-level JSON; `--dtw` improves the timestamps. The user installs the binary and model explicitly; their absence is reported in Diagnostics. [whisper.cpp](https://github.com/ggml-org/whisper.cpp)
- `captionLines` groups words into lines (≤ 28 chars, ≤ 2.6 s); `assFile` writes ASS with `PlayResX=1080, PlayResY=1920`, a `[V4+ Styles]` block (white `&H00FFFFFF`, black outline, `BorderStyle=1`, `Alignment=2`, `MarginV`), and an optional per-word highlight with `{\c&H00FFFF&}` or karaoke `{\k}`. Colours are `&HAABBGGRR`. [ASS spec](http://www.tcax.org/docs/ass-specs.htm)
- Burn-in: `subtitles=filename='<escaped>':fontsdir='<bundled fonts>'` (libass, ISC). Bundle OFL fonts and always pass `fontsdir`. Escape `:` and `\` (Windows drive letters) with `filterPath`; this is the same class of bug as AETHER's past Windows-font-path failure. [subtitles filter](https://ffmpeg.org/ffmpeg-filters.html#subtitles-1)
- Also offer a sidecar `.srt` export, which needs no burn-in.
- Editor: a transcript panel where you edit text and nudge timing inline; edits are stored in the project and override whisper output.

### 2.6 Batch clip generation
- `queue.ts`: one job per approved clip, with concurrency 1 by default (configurable), niced child processes, `-progress pipe:1` parsing for percentage, and cancel, retry and resume.
- `renderHash` skips any clip whose inputs have not changed. `uniqueOutput`/`safeName` give collision-free names such as `<project>_<nn>_<title>.mp4`.
- Output: one folder per batch, plus a `manifest.json` listing each clip's source range, title, settings and hash.
- The "Export all approved" button stays usable while the batch runs; progress shows in the job tray.

### 2.7 Blurred duplicate-background portrait (exact filtergraph)
1080×1920 output from any landscape source:
```
ffmpeg -ss <start> -to <end> -i in.mp4 -filter_complex "
[0:v]split=2[bg][fg];
[bg]scale=270:480:force_original_aspect_ratio=increase,crop=270:480,
    gblur=sigma=10,scale=1080:1920,setsar=1[bgb];
[fg]scale=1080:-2[fgs];
[bgb][fgs]overlay=(W-w)/2:(H-h)/2,setsar=1,format=yuv420p[v]"
 -map "[v]" -map 0:a? -c:v libx264 -preset veryfast -crf 20 -c:a aac -b:a 160k -movflags +faststart out.mp4
```
- The background is blurred at quarter resolution and then upscaled. This is several times faster than blurring at full 1080×1920 and looks the same. The full-resolution reference version is `[bg]scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,gblur=sigma=20`. `boxblur=20:2` is a cheaper alternative. Sigma scales with the size being blurred. [gblur](https://ffmpeg.org/ffmpeg-filters.html#gblur), [overlay](https://ffmpeg.org/ffmpeg-filters.html#overlay-1)
- Use `-2` to keep dimensions even for yuv420p. For portrait or square sources, `fg` uses `scale=-2:1920` or a `min()` fit instead; `compositionFilter(c, src)` chooses this from the probed size.
- With keep ranges, the trims/concat run first, then `split`. Captions (`subtitles=`) and the headline (`drawtext` or ASS) are applied after the overlay, so they sit on the final frame.
- Encoder: libx264 needs a GPL FFmpeg build. LocalCut does not bundle FFmpeg (it is user-supplied), so the MIT app is unaffected. If we bundle it later, ship an LGPL build with hardware encoders (`h264_nvenc`/`h264_qsv`/`h264_amf`/`h264_videotoolbox`) or OpenH264, chosen by auto-detection in `diagnose`. [legal](https://ffmpeg.org/legal.html)

---

## 3. Reusable open-source components

| Component | Licence | Status | How LocalCut uses it |
|---|---|---|---|
| [FFmpeg](https://ffmpeg.org/legal.html) | LGPL-2.1 (GPL with `--enable-gpl`) | active | External binary that the user supplies; every filter and encode |
| [obs-websocket-js](https://github.com/obs-websocket-community-projects/obs-websocket-js) | MIT | active | npm dependency; OBS control and auto-import |
| [whisper.cpp](https://github.com/ggml-org/whisper.cpp) | MIT | active | External CLI; optional transcription |
| Whisper ggml models | MIT | n/a | User-downloaded by the model manager |
| [faster-whisper](https://github.com/SYSTRAN/faster-whisper) | MIT | active | Not used (needs Python); noted as an alternative |
| [Silero VAD](https://github.com/snakers4/silero-vad) | MIT | active | ONNX model through onnxruntime-node (MIT) for speech-aware cuts |
| [auto-editor](https://github.com/WyattBlue/auto-editor) | Unlicense | active | Algorithm reference; optionally run as an external binary |
| [PySceneDetect](https://github.com/Breakthrough/PySceneDetect) | BSD-3 | active | Algorithm reference; ported as FFmpeg `scene` scores |
| [ClipsAI](https://github.com/ClipsAI/clipsai) | MIT | stale (Jan 2024) | Idea reference only (topic segmentation); no dependency |
| [libass](https://github.com/libass/libass) | ISC | active | Through FFmpeg's `subtitles=` filter |
| [LosslessCut](https://github.com/mifi/lossless-cut) | GPL-2.0 | active | **UX reference only; copy no code** |
| [py-webrtcvad](https://github.com/wiseman/py-webrtcvad) | unclear (NOASSERTION) | stale | Avoid; Silero instead |
| Electron, React, Vite, Vitest, electron-builder | MIT | active | App shell and tooling |
| TypeScript | Apache-2.0 | active | Language |

---

## 4. Gaps and risks
- **Interest detection is heuristic.** Without an LLM it cannot judge humour or narrative. Mitigation: show the signals, let the user rank, and add the Ollama hook later.
- **No subject tracking.** Auto Reframe-style face or subject tracking is not in scope. The blurred portrait avoids the need; a manual crop box comes next; MediaPipe/ONNX face detection is a later option (check its licence first).
- **Silence removal on noisy streams.** Background music defeats loudness thresholds. Mitigation: the adaptive threshold now, Silero VAD next.
- **Whisper accuracy and speed.** Word timestamps are approximate (use `--dtw`), CPU-only runs are slow on long VODs, and GPU builds differ per OS. Captions stay optional.
- **Windows filter-path escaping and fonts.** Covered by `filterPath` tests and Windows CI; fonts are always bundled.
- **FFmpeg licensing if we ever bundle it.** See §2.7.
- **OBS**: v4 and v5 protocols are incompatible, the WebSocket server must be enabled by the user, and the `GetRecordStatus` field list is unverified against the spec. Test F stays **blocked** until we run against a real OBS.
- **VOD availability.** Twitch keeps VODs only for a limited time and keeps muted sections muted; YouTube Studio downloads may be low resolution. Tell users that local OBS recordings give the best quality.
- **CapCut facts.** Silence removal, batch export, the Canvas fill and free-tier limits are unverified (third-party sources only). Nothing in LocalCut depends on them.
- **Memory on the build server** is about 400 MB free, so analysis must stream (no whole-file loads) and heavy jobs run niced.

---

## 5. Priority order
1. **Blurred Portrait batch export, end to end**: import → manual or suggested ranges → `buildRender` with the quarter-resolution blur → queue with progress, cancel and hash-skip → manifest. This is LocalCut's core value.
2. **Silence removal with preview**: adaptive threshold, keep-range overlay, cuts applied inside the render filtergraph, undoable.
3. **Moment suggestions gallery**: range slider and length bucket, signal chips, approve/reject, then batch export.
4. **OBS auto-import**: connect, status, `RecordStateChanged` import with the stable-size check and MKV remux; folder-watch fallback.
5. **Guided VOD import**: drag-and-drop, folder watch, checklists for Twitch and YouTube downloads.
6. **Optional captions**: whisper.cpp detection, ASS burn-in with bundled fonts, SRT sidecar, inline transcript edits (default OFF).
7. **Next**: Silero VAD, scene-cut snapping, crop-box reframe, optional Ollama ranking, LGPL/hardware-encoder bundling, Windows packaging in CI.
