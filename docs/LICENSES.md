# Licences

| Component | Licence | How it's used |
|---|---|---|
| LocalCut | MIT | this repository |
| Electron | MIT | app runtime |
| React, React DOM | MIT | UI |
| obs-websocket-js | MIT | OBS connection (bundled), with deps ws (MIT), eventemitter3 (MIT), debug (MIT), ms (MIT), @msgpack/msgpack (ISC), crypto-js (MIT), isomorphic-ws (MIT), type-fest (MIT or CC0) |
| Vite, Vitest, TypeScript, electron-builder | MIT / Apache-2.0 | build and test only |
| Anton font | SIL OFL 1.1 | bundled for headlines (`assets/fonts/OFL-Anton.txt`) |
| Inter font | SIL OFL 1.1 | bundled for UI and captions (`assets/fonts/OFL-Inter.txt`) |
| FFmpeg / FFprobe | LGPL 2.1+ or GPL 2+ depending on the build | **not bundled**: installed by the user and run as a separate program. Builds with libx264 are GPL. Because LocalCut only runs FFmpeg as an external process, LocalCut's own licence is unaffected. If a future release bundles FFmpeg, it must ship the matching licence and source offer. |
| whisper.cpp | MIT | optional, installed by the user |
| Whisper models (ggml) | MIT (OpenAI Whisper) | optional, downloaded by the user |

No proprietary software, assets or model weights are included. Interface and features were designed independently; no code or assets from other editors were used.
