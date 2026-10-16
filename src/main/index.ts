// LocalCut main process: one window, a locked-down renderer, validated IPC, and a media
// protocol that only serves files the user has imported (with byte ranges for seeking).
import { app, BrowserWindow, dialog, ipcMain, protocol, safeStorage, session, shell } from "electron";
import { createReadStream, existsSync, statSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { Readable } from "node:stream";
import { ObsService } from "./obs";
import { Services, VIDEO_EXT } from "./services";

protocol.registerSchemesAsPrivileged([{ scheme: "lcmedia", privileges: { standard: true, secure: true, stream: true, supportFetchAPI: true } }]);

// tests and portable setups can point LocalCut at its own data folder
if (process.env.LOCALCUT_USER_DATA) app.setPath("userData", process.env.LOCALCUT_USER_DATA);

const isDev = !app.isPackaged && process.env.LOCALCUT_DEV === "1";
let win: BrowserWindow | null = null;
let svc: Services;
const obs = new ObsService();

const MIME: Record<string, string> = { mp4: "video/mp4", m4v: "video/mp4", mov: "video/quicktime", webm: "video/webm", mkv: "video/x-matroska", jpg: "image/jpeg" };

function mediaProtocol() {
  protocol.handle("lcmedia", async (req) => {
    try { return await serveMedia(req); } catch (e) { console.error("media protocol:", (e as Error).message); return new Response("Error", { status: 500 }); }
  });
}

async function serveMedia(req: Request): Promise<Response> {
  {
    const u = new URL(req.url);
    if (process.env.LOCALCUT_DEBUG_MEDIA) console.error("media request", req.url, req.headers.get("range"));
    const file = resolve(decodeURIComponent(u.searchParams.get("p") ?? ""));
    const isThumb = u.hostname === "thumb";
    if (!existsSync(file) || (!isThumb && !svc.allowedMedia.has(file)) || (isThumb && !file.startsWith(svc.projectsDir))) {
      return new Response("Not available", { status: 404 });
    }
    const size = statSync(file).size;
    const type = MIME[file.split(".").pop()!.toLowerCase()] ?? "application/octet-stream";
    const range = req.headers.get("range")?.match(/bytes=(\d*)-(\d*)/);
    if (range) {
      const start = range[1] ? Number(range[1]) : 0;
      const end = range[2] ? Math.min(Number(range[2]), size - 1) : size - 1;     // open-ended ranges get the rest of the file (streamed)
      return new Response(Readable.toWeb(createReadStream(file, { start, end })) as ReadableStream, { status: 206, headers: {
        "Content-Type": type, "Content-Length": String(end - start + 1), "Content-Range": `bytes ${start}-${end}/${size}`, "Accept-Ranges": "bytes" } });
    }
    return new Response(Readable.toWeb(createReadStream(file)) as ReadableStream, { headers: { "Content-Type": type, "Content-Length": String(size), "Accept-Ranges": "bytes" } });
  }
}

function createWindow() {
  win = new BrowserWindow({
    width: 1440, height: 900, minWidth: 1100, minHeight: 680, backgroundColor: "#0b0c0e", title: "LocalCut", show: false,
    webPreferences: { preload: join(__dirname, "../preload/index.js"), contextIsolation: true, nodeIntegration: false, sandbox: true, webSecurity: true, spellcheck: false },
  });
  win.once("ready-to-show", () => win?.show());
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https:\/\//.test(url)) void shell.openExternal(url);          // external links open in the browser, never in-app
    return { action: "deny" };
  });
  win.webContents.on("will-navigate", (e, url) => { if (!url.startsWith("file://")) e.preventDefault(); });
  void win.loadFile(join(__dirname, "../../renderer/index.html"));
  if (isDev) win.webContents.openDevTools({ mode: "detach" });
}

async function obsPassword(): Promise<string | undefined> {
  const f = join(app.getPath("userData"), "obs.secret");
  if (!existsSync(f) || !safeStorage.isEncryptionAvailable()) return undefined;
  return safeStorage.decryptString(await readFile(f));
}

const str = (v: unknown, max = 4096) => { if (typeof v !== "string" || v.length > max) throw new Error("Invalid input."); return v; };
const strs = (v: unknown) => { if (!Array.isArray(v) || v.length > 1000) throw new Error("Invalid input."); return v.map((x) => str(x)); };

function handle(channel: string, fn: (...args: never[]) => unknown) {
  ipcMain.handle(channel, async (e, ...args) => {
    if (e.senderFrame?.url && !e.senderFrame.url.startsWith("file://")) throw new Error("Blocked.");
    return fn(...(args as never[]));
  });
}

function registerIpc() {
  const send = (ch: string, data: unknown) => win?.webContents.send(ch, data);
  svc.queue.onChange((jobs) => send("jobs:changed", jobs));
  svc.onProjectChanged = (p) => send("project:changed", p);
  obs.onStatus = (s) => send("obs:status", s);
  obs.onRecordingFinished = (path) => {
    svc.allowedMedia.add(resolve(path));
    if (svc.settings.obs.autoImport) send("obs:recording", path);
  };

  handle("app:info", () => ({ version: app.getVersion(), platform: process.platform, userData: app.getPath("userData") }));
  handle("app:diagnostics", () => svc.diagnostics());
  handle("settings:get", () => svc.settings);
  handle("settings:set", (patch: Record<string, unknown>) => {
    const allowed = ["ffmpegPath", "ffprobePath", "exportDir", "whisperBinary", "whisperModel", "whisperLanguage", "obs", "quality"];
    return svc.setSettings(Object.fromEntries(Object.entries(patch ?? {}).filter(([k]) => allowed.includes(k))));
  });
  handle("settings:obsPassword", async (pw: string) => {
    const f = join(app.getPath("userData"), "obs.secret");
    if (!pw) { await writeFile(f, ""); await svc.setSettings({ obs: { hasPassword: false } }); return; }
    if (!safeStorage.isEncryptionAvailable()) throw new Error("Secure storage isn't available on this system, so the password can't be saved.");
    await writeFile(f, safeStorage.encryptString(str(pw, 200)));
    await svc.setSettings({ obs: { hasPassword: true } });
  });
  handle("settings:pickFile", async (kind: string) => {
    const r = await dialog.showOpenDialog(win!, { properties: ["openFile"], title: `Choose ${kind}`, filters: kind === "model" ? [{ name: "Whisper model", extensions: ["bin", "gguf"] }] : [] });
    return r.canceled ? null : r.filePaths[0] ?? null;
  });
  handle("settings:pickDir", async () => {
    const r = await dialog.showOpenDialog(win!, { properties: ["openDirectory", "createDirectory"] });
    return r.canceled ? null : r.filePaths[0] ?? null;
  });

  handle("projects:list", () => svc.list());
  handle("projects:create", (name: string) => svc.create(str(name, 200)));
  handle("projects:open", (id: string) => svc.open(str(id, 64)));
  handle("projects:rename", (id: string, name: string) => svc.rename(str(id, 64), str(name, 200)));
  handle("projects:remove", (id: string) => svc.remove(str(id, 64)));

  handle("media:pickFiles", async () => {
    const r = await dialog.showOpenDialog(win!, { properties: ["openFile", "multiSelections"], filters: [{ name: "Video", extensions: ["mp4", "mov", "mkv", "webm", "m4v", "avi", "flv", "ts"] }] });
    return r.canceled ? [] : r.filePaths;
  });
  handle("media:pickFolder", async () => {
    const r = await dialog.showOpenDialog(win!, { properties: ["openDirectory"] });
    return r.canceled ? [] : svc.expandPaths(r.filePaths);
  });
  handle("media:import", (id: string, paths: string[]) => svc.importMedia(str(id, 64), strs(paths).filter((p) => VIDEO_EXT.test(p) || !/\.\w{2,4}$/.test(p))));
  handle("media:removeSource", (id: string, sid: string) => svc.removeSource(str(id, 64), str(sid, 64)));
  handle("analysis:run", (id: string, sid: string, what: Record<string, unknown>) => svc.analyse(str(id, 64), str(sid, 64), what ?? {}));
  handle("analysis:keep", (id: string, sid: string, s: never, within: never) => svc.keep(str(id, 64), str(sid, 64), s, within));
  handle("moments:suggest", (id: string, sid: string, req: never) => svc.suggest(str(id, 64), str(sid, 64), req));
  handle("moments:toClips", (id: string, ids: string[]) => svc.candidatesToClips(str(id, 64), strs(ids)));
  handle("clips:create", (id: string, sid: string, a: number, b: number, name: string) => svc.createClip(str(id, 64), str(sid, 64), Number(a), Number(b), str(name, 200)));
  handle("clips:update", (id: string, clip: never) => svc.updateClip(str(id, 64), clip));
  handle("clips:remove", (id: string, cid: string) => svc.removeClip(str(id, 64), str(cid, 64)));
  handle("clips:srt", (id: string, cid: string) => svc.exportSrt(str(id, 64), str(cid, 64)));
  handle("exports:queue", (id: string, ids: string[], force: boolean) => svc.queueExports(str(id, 64), strs(ids), force === true));
  handle("exports:reveal", (p: string) => { const f = resolve(str(p)); if (svc.allowedMedia.has(f) || svc.queue.jobs.some((j) => j.output === f)) shell.showItemInFolder(f); });
  handle("exports:openFolder", () => shell.openPath(svc.settings.exportDir));
  handle("jobs:list", () => svc.queue.jobs);
  handle("jobs:cancel", (id: string) => svc.queue.cancel(str(id, 64)));
  handle("jobs:retry", (id: string) => svc.retry(str(id, 64)));
  handle("jobs:clear", () => svc.queue.clearFinished());
  handle("obs:connect", async () => obs.connect(svc.settings.obs.host, svc.settings.obs.port, await obsPassword()));
  handle("obs:disconnect", () => obs.disconnect());
  handle("obs:status", () => obs.status);
  handle("obs:latest", () => {
    const dir = svc.settings.obs.recordingDir || obs.status.recordDirectory || "";
    const list = dir ? ObsService.recentRecordings(dir) : [];
    for (const r of list) svc.allowedMedia.add(resolve(r.path));
    return list;
  });
}

app.whenReady().then(async () => {
  // a strict CSP on everything the window loads
  session.defaultSession.webRequest.onHeadersReceived((d, cb) => cb({ responseHeaders: { ...d.responseHeaders,
    "Content-Security-Policy": ["default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: lcmedia:; media-src lcmedia:; font-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'none'; form-action 'none'"] } }));
  session.defaultSession.setPermissionRequestHandler((_wc, _perm, cb) => cb(false));
  svc = new Services(app.getPath("userData"), app.isPackaged ? join(process.resourcesPath, "fonts") : join(__dirname, "../../../assets/fonts"), join(app.getPath("videos"), "LocalCut"));
  await svc.init();
  mediaProtocol();
  registerIpc();
  createWindow();
  app.on("activate", () => { if (!BrowserWindow.getAllWindows().length) createWindow(); });
});
app.on("window-all-closed", () => { if (process.platform !== "darwin") app.quit(); });
