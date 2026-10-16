// OBS: a real WebSocket connection (obs-websocket 5). Nothing here pretends to be connected.
import { useEffect, useState } from "react";
import type { ObsStatus, Settings } from "../../shared/api";
import { api, baseName, bytes, errText } from "../lib";
import { Icon } from "../ui/icons";
import { ObsCard } from "./Projects";

export function ObsView({ onImport, onOpen }: { onImport: (paths: string[]) => Promise<void>; onOpen: (id: string, name: string) => void }) {
  const [s, setS] = useState<Settings | null>(null);
  const [st, setSt] = useState<ObsStatus>({ state: "disconnected" });
  const [pw, setPw] = useState("");
  const [recs, setRecs] = useState<{ path: string; mtime: string; size: number }[] | null>(null);
  const [err, setErr] = useState("");
  useEffect(() => {
    void api().settings.get().then(setS);
    void api().obs.status().then(setSt);
    void api().obs.latestRecordings().then(setRecs);
    return api().obs.onStatus(setSt);
  }, []);
  useEffect(() => { if (st.state === "connected") void api().obs.latestRecordings().then(setRecs); }, [st.state, st.lastRecording]);
  if (!s) return <div className="page"><div className="skel" style={{ height: 200 }} /></div>;
  const save = async (patch: Partial<Settings["obs"]>) => setS(await api().settings.set({ obs: patch }));
  const connected = st.state === "connected";
  return (
    <div className="page narrow">
      <div className="page-head"><div><h1 className="h-page">OBS Studio</h1><p className="muted">Record in OBS. When you stop, LocalCut clips the recording for you on this computer.</p></div></div>
      <ObsCard onOpen={onOpen} />
      <details className="panel pad help" style={{ marginTop: 16 }}><summary>Manual connection (only if OBS runs on another computer or a custom port)</summary>
        <div style={{ marginTop: 12 }}>
        <div className="grid3">
          <label className="field"><span>Host</span><input className="input" value={s.obs.host} onChange={(e) => setS({ ...s, obs: { ...s.obs, host: e.target.value } })} onBlur={() => save({ host: s.obs.host })} /></label>
          <label className="field"><span>Port</span><input className="input num" type="number" value={s.obs.port} onChange={(e) => setS({ ...s, obs: { ...s.obs, port: Number(e.target.value) } })} onBlur={() => save({ port: s.obs.port })} /></label>
          <label className="field"><span>Password {s.obs.hasPassword && <span className="muted">(saved)</span>}</span>
            <div className="row"><input className="input" type="password" autoComplete="off" value={pw} placeholder={s.obs.hasPassword ? "••••••••" : ""} onChange={(e) => setPw(e.target.value)} />
              <button className="btn" disabled={!pw} onClick={async () => { try { await api().settings.setObsPassword(pw); setPw(""); setS(await api().settings.get()); } catch (e) { setErr(errText(e)); } }}>Save</button></div>
            <small>Stored encrypted by your operating system, never in project files.</small></label>
        </div>
        {err && <p className="note err" style={{ marginTop: 10 }}>{err}</p>}
        <details className="help"><summary>Connection help</summary>
          <ol><li>In OBS (version 28 or newer), open <b>Tools → WebSocket Server Settings</b>.</li><li>Tick <b>Enable WebSocket server</b>. The default port is 4455.</li><li>Click <b>Show Connect Info</b> and copy the password into the field above.</li><li>Keep OBS open, then press Connect.</li></ol></details>
              {connected ? <button className="btn" style={{ marginTop: 12 }} onClick={() => api().obs.disconnect()}>Disconnect</button>
          : <button className="btn" style={{ marginTop: 12 }} disabled={st.state === "connecting"} onClick={() => api().obs.connect()}>Connect with these settings</button>}
        {st.state === "error" && st.error && <p className="note err" style={{ marginTop: 10 }}>{st.error}</p>}
        </div>
      </details>

      <section className="panel pad" style={{ marginTop: 16 }}>
        <div className="row" style={{ justifyContent: "space-between" }}>
          <div><h2 className="h-sec">Past recordings</h2><p className="muted">{s.obs.recordingDir || st.recordDirectory || "Choose your OBS recording folder, or connect to OBS to detect it."}</p></div>
          <div className="row">
            <button className="btn" onClick={async () => { const d = await api().settings.pickDir("recordings"); if (d) { await save({ recordingDir: d }); setRecs(await api().obs.latestRecordings()); } }}><Icon name="folder" />Choose folder</button>
            <button className="btn ghost" onClick={async () => setRecs(await api().obs.latestRecordings())}><Icon name="retry" />Refresh</button>
          </div>
        </div>
                {recs === null ? <div className="skel" style={{ height: 80, marginTop: 12 }} /> : recs.length === 0 ? <p className="muted" style={{ marginTop: 12 }}>No recordings found yet.</p> : (
          <ul className="reclist">{recs.map((r) => (
            <li key={r.path}><span className="rec-name">{baseName(r.path)}</span><span className="muted num">{new Date(r.mtime).toLocaleString()} · {bytes(r.size)}</span>
              <button className="btn" onClick={() => onImport([r.path])}><Icon name="import" />Import</button></li>))}
          </ul>
        )}
        <p className="dim" style={{ marginTop: 12 }}>Platform VODs: LocalCut doesn't download from Twitch or YouTube. Download your own past broadcast from the platform's creator tools, then import the file here.</p>
      </section>
    </div>
  );
}
