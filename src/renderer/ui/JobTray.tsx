// Always-visible status of background work: analysis, transcription and exports.
import { useEffect, useState } from "react";
import type { Job } from "../../shared/types";
import { api } from "../lib";
import { Icon } from "./icons";

export function JobTray() {
  const [jobs, setJobs] = useState<Job[]>([]);
  const [open, setOpen] = useState(false);
  useEffect(() => { void api().jobs.list().then(setJobs); return api().jobs.onChange((j) => setJobs([...j])); }, []);
  const active = jobs.filter((j) => j.state === "running" || j.state === "queued");
  const running = jobs.find((j) => j.state === "running");
  const failed = jobs.filter((j) => j.state === "failed").length;
  const recent = [...jobs].reverse().slice(0, 30);
  return (
    <section className={`tray ${open ? "open" : ""}`} aria-label="Background jobs">
      <button className="tray-bar" onClick={() => setOpen(!open)} aria-expanded={open}>
        <span className={`dot ${running ? "warn" : failed ? "err" : "ok"}`} />
        {running ? <span className="tray-now"><b>{running.label}</b><span className="num">{Math.round(running.progress * 100)}%</span>{active.length > 1 && <span className="muted">+{active.length - 1} queued</span>}</span>
          : <span className="muted">{failed ? `${failed} job${failed > 1 ? "s" : ""} failed` : jobs.length ? "All jobs finished" : "No background jobs"}</span>}
        {running && <span className="tray-progress"><i style={{ width: `${running.progress * 100}%` }} /></span>}
        <span className="tray-toggle muted">{open ? "Hide" : "Jobs"}</span>
      </button>
      {open && (
        <div className="tray-list">
          {recent.length === 0 && <p className="muted" style={{ padding: 12 }}>Analysis and exports show up here while they run.</p>}
          {recent.map((j) => (
            <div key={j.id} className="job">
              <span className={`dot ${j.state === "done" ? "ok" : j.state === "failed" ? "err" : j.state === "running" ? "warn" : ""}`} />
              <div className="job-main">
                <div className="row"><b>{j.label}</b><span className="muted">{j.state === "running" ? `${Math.round(j.progress * 100)}%` : j.state}</span></div>
                {j.state === "running" && <span className="tray-progress"><i style={{ width: `${j.progress * 100}%` }} /></span>}
                {j.error && <pre className="job-err">{j.error.slice(0, 600)}</pre>}
              </div>
              <div className="row">
                {(j.state === "running" || j.state === "queued") && <button className="btn ghost" onClick={() => api().jobs.cancel(j.id)}><Icon name="x" />Cancel</button>}
                {(j.state === "failed" || j.state === "cancelled") && <button className="btn ghost" onClick={() => api().jobs.retry(j.id)}><Icon name="retry" />Retry</button>}
                {j.state === "done" && j.output && <button className="btn ghost" onClick={() => api().exports.reveal(j.output!)}><Icon name="reveal" />Show file</button>}
              </div>
            </div>
          ))}
          {recent.length > 0 && <div className="row" style={{ padding: "8px 12px" }}><button className="btn ghost" onClick={() => api().jobs.clear()}>Clear finished</button><button className="btn ghost" onClick={() => api().exports.openFolder()}><Icon name="folder" />Open export folder</button></div>}
        </div>
      )}
    </section>
  );
}
