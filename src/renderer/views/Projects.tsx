import { useEffect, useState, type DragEvent } from "react";
import type { ProjectSummary } from "../../shared/api";
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
      <div className="page-head"><div><h1 className="h-page">Projects</h1><p className="muted">Import a stream recording or vlog. LocalCut finds the moments; you decide what ships.</p></div></div>
      <div className={`drop ${drag ? "over" : ""}`} onDragOver={(e) => { e.preventDefault(); setDrag(true); }} onDragLeave={() => setDrag(false)} onDrop={onDrop}>
        <Icon name="import" size={22} />
        <h2>Drop videos or a recordings folder here</h2>
        <p className="muted">MP4, MOV, MKV and WebM. Your footage is never copied or uploaded.</p>
        <div className="row">
          <button className="btn primary lg" disabled={busy} onClick={async () => startWith(await api().media.pickFiles())}><Icon name="import" />{busy ? "Importing…" : "Import Footage"}</button>
          <button className="btn lg" disabled={busy} onClick={async () => startWith(await api().media.pickFolder())}><Icon name="folder" />Import a folder</button>
        </div>
        {err && <p className="note err">{err}</p>}
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
