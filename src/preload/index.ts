// The only bridge between the UI and the system: named, typed calls. No raw ipcRenderer,
// no fs, no shell. Arguments are validated again in the main process.
import { contextBridge, ipcRenderer, webUtils, type IpcRendererEvent } from "electron";
import type { LocalCutApi } from "../shared/api";

const call = (ch: string) => (...args: unknown[]) => ipcRenderer.invoke(ch, ...args);
const sub = (ch: string) => (cb: (x: unknown) => void) => {
  const h = (_e: IpcRendererEvent, x: unknown) => cb(x);
  ipcRenderer.on(ch, h);
  return () => { ipcRenderer.removeListener(ch, h); };
};

const api: LocalCutApi = {
  app: { info: call("app:info") as never, diagnostics: call("app:diagnostics") as never },
  settings: { get: call("settings:get") as never, set: call("settings:set") as never, setObsPassword: call("settings:obsPassword") as never, pickFile: call("settings:pickFile") as never, pickDir: call("settings:pickDir") as never },
  projects: { list: call("projects:list") as never, create: call("projects:create") as never, open: call("projects:open") as never, rename: call("projects:rename") as never, remove: call("projects:remove") as never },
  media: { pickFiles: call("media:pickFiles") as never, pickFolder: call("media:pickFolder") as never, import: call("media:import") as never, removeSource: call("media:removeSource") as never,
    mediaUrl: (p: string) => `lcmedia://file/?p=${encodeURIComponent(p)}`,
    thumbUrl: (project: string, source: string, kind: string) => `lcmedia://thumb/?project=${encodeURIComponent(project)}&source=${encodeURIComponent(source)}&kind=${kind}` },
  analysis: { run: call("analysis:run") as never, keepRanges: call("analysis:keep") as never },
  moments: { suggest: call("moments:suggest") as never, toClips: call("moments:toClips") as never },
  clips: { create: call("clips:create") as never, update: call("clips:update") as never, remove: call("clips:remove") as never, setAll: call("clips:setAll") as never, exportSrt: call("clips:srt") as never },
  exports: { queue: call("exports:queue") as never, reveal: call("exports:reveal") as never, openFolder: call("exports:openFolder") as never },
  jobs: { list: call("jobs:list") as never, cancel: call("jobs:cancel") as never, retry: call("jobs:retry") as never, clear: call("jobs:clear") as never, onChange: sub("jobs:changed") as never },
  obs: { connect: call("obs:connect") as never, disconnect: call("obs:disconnect") as never, status: call("obs:status") as never, onStatus: sub("obs:status") as never, latestRecordings: call("obs:latest") as never, detect: call("obs:detect") as never, onAutoClip: sub("obs:autoclip") as never },
  events: { onProjectChanged: sub("project:changed") as never },
};

contextBridge.exposeInMainWorld("localcut", api);
// files dropped on the window: the renderer gets real paths via webUtils (Electron 32+)
contextBridge.exposeInMainWorld("localcutFiles", { pathFor: (f: File) => webUtils.getPathForFile(f) });
