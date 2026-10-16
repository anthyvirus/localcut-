// Simple mode: the default way to use LocalCut. One screen, three steps:
// 1) LocalCut listens to the video and picks the best moments by itself,
// 2) you tick the ones you like (the top 5 are ticked for you),
// 3) one button exports them as vertical clips. The full editor is one click away.
import { useEffect, useRef, useState } from "react";
import type { Candidate, Job, Project } from "../../shared/types";
import { api, baseName, clock, errText } from "../lib";
import { Icon } from "../ui/icons";

const LENGTHS = { short: [15, 35], medium: [30, 60] } as const;
type Length = keyof typeof LENGTHS;

export function Quick({ projectId, onHome, onEditor }: { projectId: string; onHome: () => void; onEditor: () => void }) {
  const [p, setP] = useState<Project | null>(null);
  const [err, setErr] = useState("");
  const [length, setLength] = useState<Length>("short");
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [jobs, setJobs] = useState<Job[]>([]);
  const [jobsReady, setJobsReady] = useState(false);
  const [exportedIds, setExportedIds] = useState<string[] | null>(null);
  const oldJobs = useRef<Set<string>>(new Set());   // jobs that existed before this export, so old results don't count
  const [playing, setPlaying] = useState<string | null>(null);
  const started = useRef(false);

  useEffect(() => {
    void api().projects.open(projectId).then(setP).catch((e) => setErr(errText(e)));
    const off1 = api().events.onProjectChanged((x) => { if (x.id === projectId) setP(structuredClone(x)); });
    void api().jobs.list().then((j) => { setJobs(j); setJobsReady(true); });
    const off2 = api().jobs.onChange(setJobs);
    return () => { off1(); off2(); };
  }, [projectId]);

  const src = p?.sources[0];
  const a = src?.analysis;
  const analysed = !!(a?.silence && a?.energy);
  const candidates = a?.candidates?.items ?? [];
  const myJobs = jobs.filter((j) => j.projectId === projectId);
  const analysisFailed = myJobs.find((j) => (j.kind === "silence" || j.kind === "energy") && j.state === "failed");

  // step 1 runs on its own: analyse, then suggest
  useEffect(() => {
    if (!p || !src || !jobsReady || started.current) return;
    const pending = jobs.some((j) => j.projectId === p.id && (j.kind === "silence" || j.kind === "energy") && (j.state === "queued" || j.state === "running"));
    if (!analysed && !pending) { started.current = true; void api().analysis.run(p.id, src.id, { silence: { thresholdDb: -35, minSilenceSec: 0.6, paddingSec: 0.15, maxPauseSec: 0.8, mode: "shorten" }, energy: true }).catch((e) => setErr(errText(e))); }
  }, [p, src, analysed, jobs, jobsReady]);
  useEffect(() => { if (analysed && !a?.candidates) void find(length); }, [analysed]); // eslint-disable-line react-hooks/exhaustive-deps

  async function find(len: Length) {
    if (!p || !src) return;
    setErr("");
    try {
      const [minSec, maxSec] = LENGTHS[len];
      const items = await api().moments.suggest(p.id, src.id, { count: 10, minSec, maxSec, contextSec: 1.5 });
      setPicked(new Set(items.slice(0, 5).map((c) => c.id)));
    } catch (e) { setErr(errText(e)); }
  }
  // after a reopen, tick the top 5 again
  useEffect(() => { if (candidates.length && picked.size === 0 && !exportedIds) setPicked(new Set(candidates.slice(0, 5).map((c) => c.id))); }, [a?.candidates?.generatedAt]); // eslint-disable-line react-hooks/exhaustive-deps

  async function makeClips() {
    if (!p) return;
    setErr("");
    try {
      const chosen = candidates.filter((c) => picked.has(c.id));
      const proj = await api().moments.toClips(p.id, [...picked]);
      const ids = proj.clips.filter((k) => chosen.some((c) => c.sourceId === k.sourceId && c.start === k.start && c.end === k.end)).map((k) => k.id);
      oldJobs.current = new Set((await api().jobs.list()).map((j) => j.id));
      await api().exports.queue(p.id, ids);
      setExportedIds(ids);
    } catch (e) { setErr(errText(e)); }
  }

  if (!p) return <div className="quick"><div className="q-wrap">{err ? <p className="note err">{err}</p> : <div className="skel" style={{ height: 300 }} />}</div></div>;

  const exportJobs = exportedIds ? myJobs.filter((j) => j.kind === "render" && j.clipId && exportedIds.includes(j.clipId) && !oldJobs.current.has(j.id)) : [];
  const exportedClips = exportedIds ? p.clips.filter((k) => exportedIds.includes(k.id)) : [];
  // a clip is finished when its new job is done, or when it had no new job because it was already exported unchanged
  const jobOf = (id: string) => exportJobs.find((j) => j.clipId === id);
  const done = exportedClips.filter((k) => jobOf(k.id)?.state === "done" || (!jobOf(k.id) && k.lastOutput));
  const failed = exportJobs.filter((j) => j.state === "failed");
  const allDone = exportedIds && exportedIds.length > 0 && done.length + failed.length >= exportedIds.length;
  const step = exportedIds ? 3 : candidates.length ? 2 : 1;

  return (
    <div className="quick">
      <header className="q-top">
        <button className="btn ghost" onClick={onHome}><Icon name="projects" />Home</button>
        <span className="q-title">{p.name}</span>
        <button className="btn ghost" onClick={onEditor} title="Trim, split, change the look, add a headline or captions"><Icon name="scissors" />Advanced editor</button>
      </header>
      <div className="q-wrap">
        <ol className="q-steps" aria-label="Steps">
          {["Find moments", "Pick your clips", "Export"].map((t, i) => <li key={t} aria-current={step === i + 1 ? "step" : undefined} className={step > i + 1 ? "done" : ""}><span className="num">{step > i + 1 ? <Icon name="check" size={12} /> : i + 1}</span>{t}</li>)}
        </ol>
        {err && <p className="note err" role="alert">{err}</p>}

        {step === 1 && (
          <div className="q-busy">
            {analysisFailed ? <>
              <h2>Couldn't read the audio in this video</h2>
              <p className="muted">{analysisFailed.error ?? "Something went wrong."}</p>
              <button className="btn primary lg" onClick={() => { void api().jobs.retry(analysisFailed.id); }}>Try again</button>
            </> : <>
              <div className="q-spin" aria-hidden />
              <h2>Finding the best moments…</h2>
              <p className="muted">LocalCut is listening to <b>{src ? baseName(src.path) : "your video"}</b> for loud, lively parts and clean start and end points. A 1-hour video takes about a minute. Nothing leaves your computer.</p>
            </>}
          </div>
        )}

        {step === 2 && (<>
          <div className="q-head">
            <div>
              <h1>Pick the clips you want</h1>
              <p className="muted">{candidates.length > 5 ? "We ticked the 5 strongest." : candidates.length > 1 ? `We found ${candidates.length} and ticked them all.` : "We found one strong moment."} Click a clip to watch it. Each one exports as a 1080×1920 vertical video with a blurred background.</p>
            </div>
            <div className="seg" role="group" aria-label="Clip length">
              {(["short", "medium"] as Length[]).map((l) => <button key={l} aria-pressed={length === l} onClick={() => { setLength(l); void find(l); }}>{l === "short" ? "Short (15–35s)" : "Longer (30–60s)"}</button>)}
            </div>
          </div>
          <ul className="q-grid">
            {candidates.map((c, i) => <Card key={c.id} c={c} rank={i + 1} url={api().media.mediaUrl(src!.path)} portrait={(src!.info.video?.height ?? 0) > (src!.info.video?.width ?? 1)}
              on={picked.has(c.id)} toggle={() => setPicked((s) => { const n = new Set(s); n.has(c.id) ? n.delete(c.id) : n.add(c.id); return n; })}
              playing={playing === c.id} setPlaying={(v) => setPlaying(v ? c.id : null)} />)}
          </ul>
          <div className="q-bar">
            <span className="muted">{picked.size ? `${picked.size} clip${picked.size > 1 ? "s" : ""} ticked` : "Tick at least one clip"}</span>
            <button className="btn primary lg" disabled={!picked.size} onClick={makeClips}><Icon name="export" />Export {picked.size || ""} clip{picked.size === 1 ? "" : "s"}</button>
          </div>
        </>)}

        {step === 3 && (
          <div className="q-busy">
            {!allDone ? <>
              <div className="q-spin" aria-hidden />
              <h2>Making your clips… {done.length} of {exportedIds!.length}</h2>
              <div className="q-prog"><i style={{ width: `${Math.round(((done.length + (exportJobs.find((j) => j.state === "running")?.progress ?? 0)) / Math.max(1, exportedIds!.length)) * 100)}%` }} /></div>
              <p className="muted">You can keep using your computer. Big videos take a little longer.</p>
            </> : <>
              <div className="q-ok"><Icon name="check" size={22} /></div>
              <h2>{done.length} clip{done.length === 1 ? "" : "s"} ready</h2>
              {failed.length > 0 && <p className="note err">{failed.length} didn't export: {failed[0]!.error}. Open Jobs at the bottom to retry.</p>}
              <div className="row">
                {done[0]?.lastOutput && <button className="btn primary lg" onClick={() => api().exports.reveal(done[0]!.lastOutput!)}><Icon name="folder" />Show my clips</button>}
                <button className="btn lg" onClick={() => { setExportedIds(null); }}>Pick more clips</button>
              </div>
              <ul className="q-done">{exportedClips.map((k) => <li key={k.id}><Icon name="film" />{k.name}</li>)}</ul>
              <p className="muted">Want a headline, captions or tighter edits? Open the <button className="linkish" onClick={onEditor}>advanced editor</button>.</p>
            </>}
          </div>
        )}
      </div>
    </div>
  );
}

function Card({ c, rank, url, portrait, on, toggle, playing, setPlaying }: { c: Candidate; rank: number; url: string; portrait: boolean; on: boolean; toggle: () => void; playing: boolean; setPlaying: (v: boolean) => void }) {
  const v = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    const el = v.current; if (!el) return;
    if (playing) { el.currentTime = c.start; void el.play(); } else { el.pause(); el.currentTime = c.start + 0.1; }
  }, [playing, c.start]);
  return (
    <li className={`q-card ${on ? "on" : ""}`}>
      <div className={`q-vid ${portrait ? "portrait" : ""}`} onClick={() => setPlaying(!playing)} role="button" aria-label={playing ? "Stop preview" : `Play ${c.title}`}>
        <video ref={v} src={url} preload="metadata" onLoadedMetadata={(e) => { e.currentTarget.currentTime = c.start + 0.1; }} onTimeUpdate={(e) => { if (e.currentTarget.currentTime >= c.end) setPlaying(false); }} />
        {!playing && <span className="q-play"><Icon name="play" /></span>}
        <span className="q-len num">{Math.round(c.end - c.start)}s</span>
        {rank <= 3 && <span className="q-rank">Top {rank}</span>}
      </div>
      <label className="q-pick">
        <input type="checkbox" checked={on} onChange={toggle} />
        <span><b>{c.title}</b><span className="muted num">{clock(c.start)}–{clock(c.end)}</span></span>
      </label>
    </li>
  );
}
