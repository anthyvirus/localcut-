# Privacy

- **Stays on your computer:** your videos, analysis results, transcripts, projects, exports and settings.
- **LocalCut never uploads anything** and has no analytics, telemetry or account.
- **Network use happens only when you start it:**
  - connecting to OBS (normally on this same computer, `127.0.0.1`);
  - opening a link in your browser;
  - downloading whisper.cpp or a model yourself.
- **Where things are stored:**
  - projects and settings: the app's data folder (Windows `%APPDATA%\LocalCut`, macOS `~/Library/Application Support/LocalCut`, Linux `~/.config/LocalCut`);
  - exports: the folder you choose (default `Videos/LocalCut`).
- **OBS password:** encrypted with your operating system's secure storage (Electron `safeStorage`). It is never written to project files or logs.
- **Deleting a project** removes LocalCut's project data only. Your original videos and exported clips are never deleted.
