// OBS Studio through its built-in WebSocket server (obs-websocket 5.x, OBS 28+).
// Status is only "connected" after a real Identify handshake succeeds.
import { readdirSync, statSync } from "node:fs";
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
