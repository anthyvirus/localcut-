import { useEffect, useState, type DragEvent } from "react";
import type { ObsStatus, ProjectSummary, Settings } from "../../shared/api";
import { api, errText } from "../lib";
import { Icon } from "../ui/icons";

export function ProjectsView({ onOpen }: { onOpen: (id: string, name: string) => void }) {
  const [list, setList] = useState<ProjectSummary[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [drag, setDrag] = useState(false);
  useEffect(() => { void api().projects.list().then(setList); }, []);

  async function startWith(paths: string[]) {
    if (!paths.length) return;
    setBusy(true); setErr("");
    try {
      const first = paths[0]!.split(/[\\/]/).pop()!.replace(/\.[^.]+$/, "");
      const p = await api().projects.create(paths.length > 1 ? `${first} + ${paths.length - 1} more` : first);
      const r = await api().media.import(p.id, paths);
      if (!r.project.sources.length) { setErr(r.errors[0]?.error ?? "None of those files could be read as video."); await api().projects.remove(p.id); return; }
      onOpen(p.id, p.name);
    } catch (e) { setErr(errText(e)); } finally { setBusy(false); }
  }
  const onDrop = (e: DragEvent) => { e.preventDefault(); setDrag(false); void startWith([...e.dataTransfer.files].map((f) => window.localcutFiles.pathFor(f))); };

  return (
    <div className="page">
      <div className="home-hero">
        <h1>Clip your streams without uploading a thing.</h1>
        <p className="muted">Record in OBS as usual. When you stop, LocalCut finds the best moments and turns them into vertical clips, all on this computer.</p>
      </div>
      <div className="home-grid">
      <ObsCard onOpen={onOpen} />
      <div className={`drop ${drag ? "over" : ""}`} onDragOver={(e) => { e.preventDefault(); setDrag(true); }} onDragLeave={() => setDrag(false)} onDrop={onDrop}>
        <Icon name="import" size={22} />
        <h2>Or drop in a video</h2>
        <p className="muted">MP4, MOV, MKV and WebM. Your footage is never copied or uploaded.</p>
        <div className="row">
          <button className="btn primary lg" disabled={busy} onClick={async () => startWith(await api().media.pickFiles())}><Icon name="import" />{busy ? "Importing…" : "Import Footage"}</button>
          <button className="btn lg" disabled={busy} onClick={async () => startWith(await api().media.pickFolder())}><Icon name="folder" />Import a folder</button>
        </div>
        {err && <p className="note err">{err}</p>}
      </div>
      </div>
      <h2 className="h-sec" style={{ margin: "28px 0 10px" }}>Recent projects</h2>
      {list === null ? <div className="skel" style={{ height: 120 }} /> : list.length === 0 ? <p className="muted">No projects yet. Your first import creates one.</p> : (
        <ul className="plist">
          {list.map((p) => (
            <li key={p.id}>
              <button className="plist-item" onClick={() => onOpen(p.id, p.name)}>
                <span className="plist-name">{p.name}</span>
                <span className="muted num">{p.sources} video{p.sources === 1 ? "" : "s"} · {p.clips} clip{p.clips === 1 ? "" : "s"}</span>
                <span className="dim num">{new Date(p.updatedAt).toLocaleString()}</span>
              </button>
              <button className="btn ghost icon" title="Delete project (your video files are not touched)" aria-label={`Delete ${p.name}`} onClick={async () => {
                if (!confirm(`Delete the project "${p.name}"? Your original videos and exported clips are not deleted.`)) return;
                await api().projects.remove(p.id); setList(await api().projects.list());
              }}><Icon name="trash" /></button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** OBS is the main way in: connect by itself, then clip each recording the moment it stops. */
export function ObsCard({ onOpen }: { onOpen: (id: string, name: string) => void }) {
  const [st, setSt] = useState<ObsStatus>({ state: "disconnected" });
  const [s, setS] = useState<Settings | null>(null);
  const [det, setDet] = useState<{ found: boolean; enabled?: boolean } | null>(null);
  useEffect(() => {
    void api().obs.status().then(setSt);
    void api().settings.get().then(setS);
    void api().obs.detect().then(setDet);
    return api().obs.onStatus(setSt);
  }, []);
  useEffect(() => { if (st.state !== "connected") void api().obs.detect().then(setDet); }, [st.state]);
  const connected = st.state === "connected";
  const auto = s?.obs.autoImport ?? true;
  return (
    <section className={`obs-card ${connected ? "on" : ""}`} aria-label="OBS auto-clip">
      <div className="obs-card-head">
        <span className="obs-badge"><Icon name="obs" size={18} /></span>
        <div>
          <h2>Auto-clip from OBS</h2>
          <p className="row obs-state"><span className={`dot ${connected ? (st.recording ? "live" : "ok") : st.state === "connecting" ? "warn" : ""}`} />
            {connected ? (st.recording ? <>Recording <span className="num">{st.recordTimecode?.slice(0, 8)}</span>. Clips start when you stop.</> : <>Connected to OBS {st.obsVersion}. Waiting for your next recording.</>)
              : st.state === "connecting" ? "Looking for OBS…" : "Not connected"}</p>
        </div>
      </div>
      {connected ? (
        <div className="obs-body">
          <label className="switch"><input type="checkbox" checked={auto} onChange={async (e) => setS(await api().settings.set({ obs: { autoImport: e.target.checked } }))} />Clip every recording automatically when it stops</label>
          {st.lastRecording && <button className="btn" onClick={async () => { const p = await api().projects.create(st.lastRecording!.split(/[\\/]/).pop()!.replace(/\.[^.]+$/, "")); await api().media.import(p.id, [st.lastRecording!]); onOpen(p.id, p.name); }}><Icon name="spark" />Clip my last recording</button>}
        </div>
      ) : (
        <div className="obs-body">
          {det && !det.found ? <>
            <p className="muted">OBS Studio isn't installed on this computer. It's free and open source.</p>
            <a className="btn primary" href="https://obsproject.com/download" target="_blank" rel="noreferrer">Get OBS Studio</a>
          </> : <>
            <ol className="obs-steps">
              <li>Open OBS.</li>
              {det?.enabled === false && <li>In OBS, go to <b>Tools → WebSocket Server Settings</b>, tick <b>Enable WebSocket server</b>, then click <b>OK</b>.</li>}
              <li>That's it. LocalCut finds OBS and its password by itself and connects within a few seconds.</li>
            </ol>
            <button className="btn primary" disabled={st.state === "connecting"} onClick={() => api().obs.connect()}>{st.state === "connecting" ? "Connecting…" : "Connect now"}</button>
            {st.state === "error" && st.error && <p className="note err">{st.error}</p>}
          </>}
        </div>
      )}
    </section>
  );
}
