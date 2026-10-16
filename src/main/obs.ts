// OBS Studio through its built-in WebSocket server (obs-websocket 5.x, OBS 28+).
// Status is only "connected" after a real Identify handshake succeeds.
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { OBSWebSocket } from "obs-websocket-js";
import type { ObsStatus } from "../shared/api";

export class ObsService {
  private obs = new OBSWebSocket();
  private poll?: NodeJS.Timeout;
  status: ObsStatus = { state: "disconnected" };
  onStatus: (s: ObsStatus) => void = () => {};
  onRecordingFinished: (path: string) => void = () => {};

  constructor() {
    this.obs.on("ConnectionClosed", (e) => { this.stopPoll(); this.set({ state: this.status.state === "connecting" ? "error" : "disconnected", error: e?.message || undefined }); });
    this.obs.on("RecordStateChanged", (e) => {
      this.set({ recording: e.outputActive });
      if (e.outputState === "OBS_WEBSOCKET_OUTPUT_STOPPED" && e.outputPath) { this.set({ lastRecording: e.outputPath }); this.onRecordingFinished(e.outputPath); }
    });
    this.obs.on("StreamStateChanged", (e) => this.set({ streaming: e.outputActive }));
  }

  private set(patch: Partial<ObsStatus>) { this.status = { ...this.status, ...patch }; this.onStatus(this.status); }

  async connect(host: string, port: number, password?: string): Promise<ObsStatus> {
    if (!/^[\w.-]+$/.test(host)) return this.fail("That host name isn't valid.");
    this.set({ state: "connecting", error: undefined });
    try {
      const r = await this.obs.connect(`ws://${host}:${port}`, password || undefined, { rpcVersion: 1 });
      const v = await this.obs.call("GetVersion");
      const dir = await this.obs.call("GetRecordDirectory").catch(() => ({ recordDirectory: undefined }));
      this.set({ state: "connected", obsVersion: v.obsVersion, wsVersion: r.obsWebSocketVersion, recordDirectory: dir.recordDirectory });
      await this.refresh();
      this.poll = setInterval(() => void this.refresh(), 2000);
      return this.status;
    } catch (e) {
      const m = (e as Error).message || "";
      return this.fail(/auth/i.test(m) ? "OBS rejected the password. Check Tools → WebSocket Server Settings in OBS."
        : /ECONNREFUSED|connect|closed/i.test(m) ? `Couldn't reach OBS at ${host}:${port}. Is OBS open, and is the WebSocket server enabled (Tools → WebSocket Server Settings)?` : m);
    }
  }

  private fail(error: string) { this.stopPoll(); void this.obs.disconnect().catch(() => {}); this.set({ state: "error", error }); return this.status; }
  private stopPoll() { if (this.poll) clearInterval(this.poll); this.poll = undefined; }

  async refresh() {
    try {
      const rec = await this.obs.call("GetRecordStatus");
      const st = await this.obs.call("GetStreamStatus");
      this.set({ recording: rec.outputActive, recordTimecode: rec.outputTimecode, streaming: st.outputActive });
    } catch { /* connection events handle real failures */ }
  }

  async disconnect(): Promise<ObsStatus> { this.stopPoll(); await this.obs.disconnect().catch(() => {}); this.set({ state: "disconnected", error: undefined }); return this.status; }

  /** OBS's own WebSocket settings on this computer (OBS 30+ keeps them in user.ini/global.ini,
   *  OBS 28-29 in plugin_config/obs-websocket/config.json). Read locally, never sent anywhere. */
  static detectConfig(): { found: boolean; enabled?: boolean; port?: number; password?: string } {
    const base = process.platform === "win32" ? join(process.env.APPDATA ?? join(homedir(), "AppData", "Roaming"), "obs-studio")
      : process.platform === "darwin" ? join(homedir(), "Library", "Application Support", "obs-studio") : join(homedir(), ".config", "obs-studio");
    for (const f of ["user.ini", "global.ini"]) {
      const file = join(base, f);
      if (!existsSync(file)) continue;
      const r = parseObsIni(readFileSync(file, "utf8"));
      if (r) return { found: true, ...r };
    }
    const json = join(base, "plugin_config", "obs-websocket", "config.json");
    if (existsSync(json)) {
      try {
        const c = JSON.parse(readFileSync(json, "utf8"));
        return { found: true, enabled: !!c.server_enabled, port: Number(c.server_port) || 4455, password: c.auth_required === false ? "" : c.server_password };
      } catch { /* unreadable: fall through */ }
    }
    return { found: existsSync(base) };
  }

  /** Newest video files in a recordings folder (works without a live OBS connection). */
  static recentRecordings(dir: string, limit = 10): { path: string; mtime: string; size: number }[] {
    try {
      return readdirSync(dir).filter((f) => /\.(mp4|mkv|mov|flv|ts|m4v)$/i.test(f)).map((f) => {
        const st = statSync(join(dir, f));
        return { path: join(dir, f), mtime: st.mtime.toISOString(), size: st.size };
      }).sort((a, b) => b.mtime.localeCompare(a.mtime)).slice(0, limit);
    } catch { return []; }
  }
}

/** The [OBSWebSocket] section of OBS 30+'s user.ini / global.ini. */
export function parseObsIni(text: string): { enabled: boolean; port: number; password?: string } | null {
  const sec = /\[OBSWebSocket\]\r?\n([\s\S]*?)(?:\r?\n\[|$)/.exec(text.replace(/^\uFEFF/, ""))?.[1];
  if (!sec) return null;
  const val = (k: string) => new RegExp(`^${k}=(.*?)\\r?$`, "m").exec(sec)?.[1]?.trim();
  return { enabled: val("ServerEnabled") === "true", port: Number(val("ServerPort")) || 4455, password: val("AuthRequired") === "false" ? "" : val("ServerPassword") };
}
