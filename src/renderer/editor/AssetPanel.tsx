import { useState, type DragEvent } from "react";
import type { Candidate } from "../../shared/types";
import { api, baseName, bytes, clock } from "../lib";
import { Icon } from "../ui/icons";
import type { EditorCtx } from "./Editor";

export type AssetTab = "media" | "moments" | "clips" | "audio" | "captions";
const TABS: { id: AssetTab; label: string; icon: string }[] = [
  { id: "media", label: "Media", icon: "film" }, { id: "moments", label: "Moments", icon: "spark" }, { id: "clips", label: "Clips", icon: "scissors" },
  { id: "audio", label: "Audio", icon: "wave" }, { id: "captions", label: "Captions", icon: "text" },
];
const LENGTHS = { short: [15, 35], medium: [30, 60], long: [60, 120] } as const;

export function AssetPanel({ ctx, tab, setTab }: { ctx: EditorCtx; tab: AssetTab; setTab: (t: AssetTab) => void }) {
  return (
    <aside className="assets" aria-label="Assets">
      <nav className="rail" aria-label="Asset panels">
        {TABS.map((t) => (
          <button key={t.id} className="rail-btn" aria-current={tab === t.id ? "page" : undefined} onClick={() => setTab(t.id)}><Icon name={t.icon} size={18} /><span>{t.label}</span></button>
        ))}
      </nav>
      <div className="assets-body">
        {tab === "media" && <Media ctx={ctx} />}
        {tab === "moments" && <Moments ctx={ctx} />}
        {tab === "clips" && <Clips ctx={ctx} />}
        {tab === "audio" && <Audio ctx={ctx} />}
        {tab === "captions" && <Captions ctx={ctx} />}
      </div>
    </aside>
  );
}

function Head({ title, children }: { title: string; children?: React.ReactNode }) {
  return <div className="as-head"><h2>{title}</h2>{children}</div>;
}

function Media({ ctx }: { ctx: EditorCtx }) {
  const { p } = ctx;
  const [drag, setDrag] = useState(false);
  const add = (paths: string[]) => ctx.act(async () => {
    if (!paths.length) return;
    const r = await api().media.import(p.id, paths);
    ctx.setProject(r.project);
    if (r.errors.length) throw new Error(r.errors.map((x) => `${baseName(x.path)}: ${x.error}`).join("\n"));
  });
  const onDrop = (e: DragEvent) => { e.preventDefault(); setDrag(false); void add([...e.dataTransfer.files].map((f) => window.localcutFiles.pathFor(f))); };
  return (
    <>
      <Head title="Media"><button className="btn" onClick={async () => add(await api().media.pickFiles())}><Icon name="import" />Import</button></Head>
      <div className={`media-grid ${drag ? "over" : ""}`} onDragOver={(e) => { e.preventDefault(); setDrag(true); }} onDragLeave={() => setDrag(false)} onDrop={onDrop}>
        {p.sources.map((s) => (
          <button key={s.id} className="src" aria-current={s.id === ctx.sourceId ? "true" : undefined} onClick={() => ctx.setSourceId(s.id)} title={s.path}>
            <span className="poster"><img src={api().media.thumbUrl(p.id, s.id, "poster")} alt="" onError={(e) => { (e.target as HTMLImageElement).style.visibility = "hidden"; }} /><span className="dur num">{clock(s.info.durationSec)}</span></span>
            <span className="src-name">{baseName(s.path)}</span>
            <span className="muted num">{s.info.video?.width}×{s.info.video?.height} · {Math.round(s.info.video?.fps ?? 0)} fps · {bytes(s.info.sizeBytes)}</span>
          </button>
        ))}
        <button className="src add" onClick={async () => add(await api().media.pickFiles())}><span className="poster"><Icon name="plus" size={20} /></span><span className="muted">Add video, or drop files here</span></button>
      </div>
    </>
  );
}

function Moments({ ctx }: { ctx: EditorCtx }) {
  const { p } = ctx;
  const src = p.sources.find((s) => s.id === ctx.sourceId);
  const [set, setSet] = useState({ count: 10, length: "short" as keyof typeof LENGTHS });
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const a = src?.analysis;
  const cands: Candidate[] = a?.candidates?.items ?? [];
  if (!src) return <Head title="Moments" />;
  return (
    <>
      <Head title="Moments" />
      <div className="as-sec">
        <p className="muted">Find stretches worth clipping. Ranked by loudness, speech, {a?.transcript ? "transcript cues, " : ""}and clean start and end points. Review them before you export.</p>
        <div className="row wrap">
          <select className="input" aria-label="How many" value={set.count} onChange={(e) => setSet({ ...set, count: Number(e.target.value) })}>{[5, 10, 20].map((n) => <option key={n} value={n}>{n} clips</option>)}</select>
          <div className="seg" role="group" aria-label="Clip length">{(["short", "medium", "long"] as const).map((k) => <button key={k} aria-pressed={set.length === k} onClick={() => setSet({ ...set, length: k })}>{k === "short" ? "15–35s" : k === "medium" ? "30–60s" : "1–2 min"}</button>)}</div>
        </div>
        {!a?.silence && !a?.transcript && <p className="note">Analyse the audio first (Audio tab). Transcribing too gives better picks.</p>}
        <button className="btn primary block" disabled={!a?.silence && !a?.transcript} onClick={() => ctx.act(async () => { const [minSec, maxSec] = LENGTHS[set.length]; await api().moments.suggest(p.id, src.id, { count: set.count, minSec, maxSec, contextSec: 1.5 }); ctx.setProject(await api().projects.open(p.id)); })}><Icon name="spark" />Find moments</button>
      </div>
      {cands.length > 0 && (
        <div className="as-list">
          <div className="row between"><span className="label">{cands.length} suggestions</span>
            {checked.size > 0 && <button className="btn primary" onClick={() => ctx.act(async () => { ctx.setProject(await api().moments.toClips(p.id, [...checked])); setChecked(new Set()); })}><Icon name="plus" />Add {checked.size} to timeline</button>}</div>
          <ol className="gallery">
            {cands.map((c) => (
              <li key={c.id} className={`cand ${checked.has(c.id) ? "on" : ""}`}>
                <label className="cand-check"><input type="checkbox" checked={checked.has(c.id)} onChange={(e) => { const n = new Set(checked); e.target.checked ? n.add(c.id) : n.delete(c.id); setChecked(n); }} /><span className="sr">Select {c.title}</span></label>
                <button className="cand-main" onClick={() => ctx.previewRange(c.start, c.end)} title="Preview this moment">
                  <span className="row"><b className="cand-title">{c.title}</b><span className="score num">{c.score}</span></span>
                  <span className="muted num">{clock(c.start)}–{clock(c.end)} · {Math.round(c.end - c.start)}s</span>
                  {c.excerpt && <span className="cand-ex">{c.excerpt}</span>}
                  <span className="signals"><Sig n="Loud" v={c.signals.energy} /><Sig n="Speech" v={c.signals.speech} />{a?.transcript && <Sig n="Cues" v={c.signals.cues} />}<Sig n="Clean edges" v={c.signals.boundary} /></span>
                </button>
              </li>
            ))}
          </ol>
        </div>
      )}
    </>
  );
}
const Sig = ({ n, v }: { n: string; v: number }) => <span className="sig"><span>{n}</span><i><b style={{ width: `${Math.round(v * 100)}%` }} /></i></span>;

function Clips({ ctx }: { ctx: EditorCtx }) {
  const { p } = ctx;
  const clips = p.clips.filter((c) => c.sourceId === ctx.sourceId);
  if (!clips.length) return <><Head title="Clips" /><div className="empty"><h3>No clips yet</h3><p>Add suggestions from Moments, or drag across the timeline and press Split (Ctrl+B).</p></div></>;
  const all = clips.every((c) => c.status === "selected");
  return (
    <>
      <Head title="Clips"><button className="btn ghost" onClick={() => ctx.commitClips(p.clips.map((c) => c.sourceId === ctx.sourceId ? { ...c, status: all ? "draft" : "selected" } : c), all ? "unselect all" : "select all")}>{all ? "Untick all" : "Tick all"}</button></Head>
      <ul className="cliplist">
        {clips.map((c) => (
          <li key={c.id} className={c.id === ctx.clipId ? "on" : ""}>
            <label className="switch" title="Include in export"><input type="checkbox" checked={c.status === "selected"} onChange={() => ctx.commitClips(p.clips.map((x) => x.id === c.id ? { ...x, status: x.status === "selected" ? "draft" : "selected" } : x), "export selection")} /><span className="sr">Export {c.name}</span></label>
            <button className="cl-main" onClick={() => { ctx.selectClip(c.id); ctx.seek(c.start); }}>
              <b>{c.name}</b>
              <span className="muted num">{clock(c.start)}–{clock(c.end)} · {Math.round(c.end - c.start)}s{c.removeSilence ? " · silences cut" : ""}{c.captions ? " · captions" : ""}{c.headline.enabled ? " · headline" : ""}</span>
            </button>
            {c.lastOutput && <span className="dot ok" title="Exported" />}
          </li>
        ))}
      </ul>
    </>
  );
}

function Audio({ ctx }: { ctx: EditorCtx }) {
  const { p, sil, setSil, keep } = ctx;
  const src = p.sources.find((s) => s.id === ctx.sourceId);
  if (!src) return <Head title="Audio" />;
  const a = src.analysis;
  const S = ({ label, k, min, max, step, unit }: { label: string; k: "thresholdDb" | "minSilenceSec" | "paddingSec" | "maxPauseSec"; min: number; max: number; step: number; unit: string }) =>
    <label className="slider"><span>{label}</span><output className="num">{sil[k]}{unit}</output><input type="range" min={min} max={max} step={step} value={sil[k]} onChange={(e) => setSil({ ...sil, [k]: Number(e.target.value) })} /></label>;
  return (
    <>
      <Head title="Audio" />
      <div className="as-sec">
        <button className="btn primary block" onClick={() => ctx.act(() => api().analysis.run(p.id, src.id, { silence: sil, energy: true }))}><Icon name="wave" />{a.silence ? "Re-analyse" : "Analyse audio"}</button>
        <p className="muted">{a.silence ? `${a.silence.intervals.length} silences · ${a.energy ? "loudness measured" : "no loudness yet"}` : "Finds silences and loud moments. Runs in the background."}</p>
      </div>
      <div className="as-sec">
        <span className="label">Silence removal</span>
        <S label="Silent below" k="thresholdDb" min={-60} max={-20} step={1} unit=" dB" />
        <S label="Ignore pauses shorter than" k="minSilenceSec" min={0.2} max={3} step={0.1} unit=" s" />
        <S label="Keep before and after speech" k="paddingSec" min={0} max={0.6} step={0.05} unit=" s" />
        <S label="Longest pause to keep" k="maxPauseSec" min={0.2} max={3} step={0.1} unit=" s" />
        <div className="seg" role="group" aria-label="Long pauses"><button aria-pressed={sil.mode === "shorten"} onClick={() => setSil({ ...sil, mode: "shorten" })}>Shorten</button><button aria-pressed={sil.mode === "remove"} onClick={() => setSil({ ...sil, mode: "remove" })}>Remove</button></div>
        {keep && <p className="muted num">Whole video: {clock(src.info.durationSec)} → {clock(keep.reduce((x, r) => x + r.end - r.start, 0))}. Turn on "Remove silences" for a clip in its Audio properties.</p>}
        <p className="dim">The first two settings need Re-analyse; the rest update the green "kept" line on the timeline straight away.</p>
      </div>
    </>
  );
}

function Captions({ ctx }: { ctx: EditorCtx }) {
  const { p } = ctx;
  const src = p.sources.find((s) => s.id === ctx.sourceId);
  if (!src) return <Head title="Captions" />;
  const segs = src.analysis.transcript?.segments;
  return (
    <>
      <Head title="Captions" />
      <div className="as-sec">
        <button className="btn block" onClick={() => ctx.act(() => api().analysis.run(p.id, src.id, { transcribe: true }))}><Icon name="text" />{segs ? "Transcribe again" : "Transcribe"}</button>
        <p className="muted">{segs ? `${segs.length} lines · ${src.analysis.transcript?.model}` : "Runs whisper.cpp on this computer. Set it up once in Settings."} Captions stay off until you turn them on for a clip.</p>
      </div>
      {segs && <ol className="transcript">{segs.map((s, i) => <li key={i} className={ctx.time >= s.start && ctx.time < s.end ? "now" : ""}><button onClick={() => ctx.seek(s.start, true)}><span className="num dim">{clock(s.start)}</span><span>{s.text}</span></button></li>)}</ol>}
    </>
  );
}
