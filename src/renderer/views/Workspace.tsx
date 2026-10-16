// The editor for one project: sources, player + timeline, analysis, suggestions, clips, inspector.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Candidate, Clip, Interval, Project, SilenceSettings, SourceMedia } from "../../shared/types";
import { api, baseName, bytes, clock, errText } from "../lib";
import { Icon } from "../ui/icons";
import { Inspector } from "../ui/Inspector";
import { Timeline } from "../ui/Timeline";

const DEFAULT_SIL: SilenceSettings = { thresholdDb: -35, minSilenceSec: 0.6, paddingSec: 0.15, maxPauseSec: 0.8, mode: "shorten" };
const LENGTHS = { short: [15, 35], medium: [30, 60], long: [60, 120] } as const;

export function Workspace({ projectId, onRenamed }: { projectId: string; onRenamed: (name: string) => void }) {
  const [p, setP] = useState<Project | null>(null);
  const [err, setErr] = useState("");
  const [sourceId, setSourceId] = useState<string | null>(null);
  const [clipId, setClipId] = useState<string | null>(null);
  const [tab, setTab] = useState<"suggestions" | "clips" | "transcript">("suggestions");
  const [time, setTime] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [sel, setSel] = useState<Interval | null>(null);
  const [sil, setSil] = useState<SilenceSettings>(DEFAULT_SIL);
  const [keep, setKeep] = useState<Interval[] | null>(null);
  const [momentSet, setMomentSet] = useState({ count: 10, length: "short" as keyof typeof LENGTHS, contextSec: 1.5 });
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const video = useRef<HTMLVideoElement>(null);
  const loopTo = useRef<number | null>(null);

  const load = useCallback(async () => {
    try {
      const proj = await api().projects.open(projectId);
      setP(proj);
      setSourceId((cur) => cur ?? proj.sources[0]?.id ?? null);
    } catch (e) { setErr(errText(e)); }
  }, [projectId]);
  useEffect(() => { void load(); return api().events.onProjectChanged((x) => { if (x.id === projectId) setP(structuredClone(x)); }); }, [load, projectId]);

  const src: SourceMedia | undefined = p?.sources.find((s) => s.id === sourceId);
  const clips = useMemo(() => (p?.clips ?? []).filter((c) => c.sourceId === sourceId), [p, sourceId]);
  const clip = p?.clips.find((c) => c.id === clipId) ?? null;
  const cands = src?.analysis.candidates?.items ?? [];

  // silence-removal preview: what would be kept with the current settings
  useEffect(() => {
    if (!src?.analysis.silence) { setKeep(null); return; }
    void api().analysis.keepRanges(projectId, src.id, sil).then(setKeep).catch(() => setKeep(null));
  }, [projectId, src?.id, src?.analysis.silence, sil]);

  const seek = (t: number, play = false) => {
    const v = video.current;
    if (!v || !src) return;
    v.currentTime = Math.max(0, Math.min(src.info.durationSec, t));
    if (play) void v.play();
  };
  const previewRange = (a: number, b: number) => { loopTo.current = b; seek(a, true); };
  const onTime = () => {
    const v = video.current;
    if (!v) return;
    setTime(v.currentTime);
    if (loopTo.current !== null && v.currentTime >= loopTo.current) { v.pause(); loopTo.current = null; }
  };

  // keyboard: space play/pause, i/o mark in/out, arrows nudge (only when not typing)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (/^(input|textarea|select)$/i.test((e.target as HTMLElement).tagName)) return;
      const v = video.current;
      if (!v) return;
      if (e.code === "Space") { e.preventDefault(); v.paused ? void v.play() : v.pause(); }
      if (e.key === "i") setSel((s) => ({ start: v.currentTime, end: Math.max(v.currentTime + 1, s?.end ?? v.currentTime + 15) }));
      if (e.key === "o") setSel((s) => ({ start: Math.min(s?.start ?? Math.max(0, v.currentTime - 15), v.currentTime - 0.5), end: v.currentTime }));
      if (e.key === "ArrowLeft") seek(v.currentTime - (e.shiftKey ? 5 : 1));
      if (e.key === "ArrowRight") seek(v.currentTime + (e.shiftKey ? 5 : 1));
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  async function act(fn: () => Promise<unknown>) { setErr(""); try { await fn(); } catch (e) { setErr(errText(e)); } }

  if (!p) return <div className="page">{err ? <p className="note err">{err}</p> : <div className="skel" style={{ height: 300 }} />}</div>;
  const a = src?.analysis;
  return (
    <div className="ws">
      {/* sources */}
      <aside className="ws-sources" aria-label="Videos in this project">
        <div className="ws-title">
          <input className="title-input" defaultValue={p.name} aria-label="Project name" onBlur={(e) => { const n = e.target.value.trim(); if (n && n !== p.name) void api().projects.rename(p.id, n).then((x) => { setP(x); onRenamed(x.name); }); }} />
        </div>
        <ul className="srcs">
          {p.sources.map((s) => (
            <li key={s.id}>
              <button className="src" aria-current={s.id === sourceId ? "true" : undefined} onClick={() => { setSourceId(s.id); setClipId(null); setSel(null); }}>
                <span className="src-name">{baseName(s.path)}</span>
                <span className="muted num">{clock(s.info.durationSec)} · {s.info.video?.width}×{s.info.video?.height} · {Math.round(s.info.video?.fps ?? 0)} fps</span>
                <span className="dim num">{bytes(s.info.sizeBytes)} · {s.info.audioTracks.length} audio track{s.info.audioTracks.length === 1 ? "" : "s"}</span>
              </button>
            </li>
          ))}
        </ul>
        <button className="btn" onClick={() => act(async () => { const files = await api().media.pickFiles(); if (files.length) { const r = await api().media.import(p.id, files); setP(r.project); if (r.errors.length) setErr(r.errors.map((x) => `${baseName(x.path)}: ${x.error}`).join("\n")); } })}><Icon name="plus" />Add video</button>
      </aside>

      {/* center */}
      <section className="ws-center">
        {!src ? <div className="empty"><h3>No video in this project</h3><p>Add a video to start.</p></div> : (<>
          <div className="player">
            <video ref={video} src={api().media.mediaUrl(src.path)} preload="metadata" onTimeUpdate={onTime} onPlay={() => setPlaying(true)} onPause={() => setPlaying(false)} onClick={() => { const v = video.current; if (v) v.paused ? void v.play() : v.pause(); }} />
          </div>
          <div className="transport">
            <button className="btn icon" aria-label={playing ? "Pause" : "Play"} onClick={() => { const v = video.current; if (v) v.paused ? void v.play() : v.pause(); }}><Icon name={playing ? "pause" : "play"} /></button>
            <span className="num tc">{clock(time, true)} <span className="dim">/ {clock(src.info.durationSec)}</span></span>
            <span className="sep" />
            <button className="btn ghost" title="Mark in (I)" onClick={() => setSel((s) => ({ start: time, end: Math.max(time + 1, s?.end ?? time + 15) }))}><Icon name="inmark" />In</button>
            <button className="btn ghost" title="Mark out (O)" onClick={() => setSel((s) => ({ start: Math.min(s?.start ?? Math.max(0, time - 15), time - 0.5), end: time }))}><Icon name="outmark" />Out</button>
            {sel && <span className="num muted">{clock(sel.start, true)}–{clock(sel.end, true)} ({(sel.end - sel.start).toFixed(1)}s)</span>}
            {sel && <button className="btn" onClick={() => previewRange(sel.start, sel.end)}><Icon name="play" />Play selection</button>}
            {sel && <button className="btn primary" onClick={() => act(async () => { const x = await api().clips.create(p.id, src.id, sel.start, sel.end, `Clip at ${clock(sel.start)}`); setP(x); setClipId(x.clips[x.clips.length - 1]!.id); setTab("clips"); })}><Icon name="scissors" />Make clip</button>}
            <span className="grow" />
            <span className="muted">Space play · I/O mark · ←/→ nudge</span>
          </div>
          <Timeline duration={src.info.durationSec} time={time} levels={a?.energy?.db} levelStep={a?.energy?.stepSec ?? 0.5} silences={a?.silence?.intervals} keep={keep ?? undefined}
            candidates={cands} clips={clips} selection={sel} activeClipId={clipId} onSeek={(t) => seek(t)} onSelect={setSel} onPickClip={(id) => { setClipId(id); setTab("clips"); }} />

          {/* analysis bar */}
          <div className="analysis">
            <div className="an-step">
              <span className="label">1 · Audio</span>
              <div className="row">
                <button className="btn" onClick={() => act(() => api().analysis.run(p.id, src.id, { silence: sil, energy: true }))}><Icon name="wave" />{a?.silence ? "Re-analyse" : "Analyse audio"}</button>
                <span className="muted">{a?.silence ? `${a.silence.intervals.length} silences · ${a.energy ? "loudness measured" : "no loudness yet"}` : "Finds silences and loud moments"}</span>
              </div>
              <details className="pop"><summary>Silence settings</summary>
                <div className="pop-body">
                  <Slider label="Silent below" value={sil.thresholdDb} min={-60} max={-20} step={1} unit=" dB" onChange={(v) => setSil({ ...sil, thresholdDb: v })} />
                  <Slider label="Ignore pauses shorter than" value={sil.minSilenceSec} min={0.2} max={3} step={0.1} unit=" s" onChange={(v) => setSil({ ...sil, minSilenceSec: v })} />
                  <Slider label="Keep before and after speech" value={sil.paddingSec} min={0} max={0.6} step={0.05} unit=" s" onChange={(v) => setSil({ ...sil, paddingSec: v })} />
                  <Slider label="Longest pause to keep" value={sil.maxPauseSec} min={0.2} max={3} step={0.1} unit=" s" onChange={(v) => setSil({ ...sil, maxPauseSec: v })} />
                  <div className="seg" role="group" aria-label="Long pauses"><button aria-pressed={sil.mode === "shorten"} onClick={() => setSil({ ...sil, mode: "shorten" })}>Shorten long pauses</button><button aria-pressed={sil.mode === "remove"} onClick={() => setSil({ ...sil, mode: "remove" })}>Remove them</button></div>
                  <p className="muted">Changing "Silent below" or "Ignore pauses shorter than" needs Re-analyse. The other settings update the preview right away.</p>
                </div>
              </details>
              {keep && <p className="muted num">With these settings: {clock(src.info.durationSec)} → {clock(keep.reduce((x, r) => x + r.end - r.start, 0))} ({keep.length} pieces). Applied per clip with "Remove silences".</p>}
            </div>
            <div className="an-step">
              <span className="label">2 · Transcript (optional)</span>
              <div className="row">
                <button className="btn" onClick={() => act(() => api().analysis.run(p.id, src.id, { transcribe: true }))}><Icon name="text" />{a?.transcript ? "Transcribe again" : "Transcribe"}</button>
                <span className="muted">{a?.transcript ? `${a.transcript.segments.length} lines · ${a.transcript.model}` : "Better suggestions and captions"}</span>
              </div>
            </div>
            <div className="an-step">
              <span className="label">3 · Suggestions</span>
              <div className="row">
                <select className="input" aria-label="How many" value={momentSet.count} onChange={(e) => setMomentSet({ ...momentSet, count: Number(e.target.value) })}>{[5, 10, 20].map((n) => <option key={n} value={n}>{n} clips</option>)}</select>
                <div className="seg" role="group" aria-label="Clip length">{(["short", "medium", "long"] as const).map((k) => <button key={k} aria-pressed={momentSet.length === k} onClick={() => setMomentSet({ ...momentSet, length: k })}>{k === "short" ? "15–35s" : k === "medium" ? "30–60s" : "1–2 min"}</button>)}</div>
                <button className="btn primary" disabled={!a?.silence && !a?.transcript} onClick={() => act(async () => { const [minSec, maxSec] = LENGTHS[momentSet.length]; await api().moments.suggest(p.id, src.id, { count: momentSet.count, minSec, maxSec, contextSec: momentSet.contextSec }); setTab("suggestions"); await load(); })}><Icon name="spark" />Find moments</button>
              </div>
            </div>
          </div>
          {err && <p className="note err ws-err">{err}</p>}

          {/* bottom tabs */}
          <div className="tabs" role="tablist">
            {(["suggestions", "clips", "transcript"] as const).map((t) => <button key={t} role="tab" aria-selected={tab === t} onClick={() => setTab(t)}>{t === "suggestions" ? `Suggestions${cands.length ? ` (${cands.length})` : ""}` : t === "clips" ? `Clips (${clips.length})` : "Transcript"}</button>)}
            <span className="grow" />
            {tab === "suggestions" && checked.size > 0 && <button className="btn primary" onClick={() => act(async () => { setP(await api().moments.toClips(p.id, [...checked])); setChecked(new Set()); setTab("clips"); })}><Icon name="plus" />Make {checked.size} clip{checked.size > 1 ? "s" : ""}</button>}
            {tab === "clips" && clips.some((c) => c.status === "selected") && <button className="btn primary" onClick={() => act(async () => { const r = await api().exports.queue(p.id, clips.filter((c) => c.status === "selected").map((c) => c.id)); if (r.skipped) setErr(`${r.queued} queued. ${r.skipped} unchanged clip${r.skipped > 1 ? "s were" : " was"} already exported.`); })}><Icon name="export" />Export {clips.filter((c) => c.status === "selected").length} selected</button>}
          </div>
          <div className="tabpanel">
            {tab === "suggestions" && <Suggestions cands={cands} generatedAt={src.analysis.candidates?.generatedAt} hasTranscript={!!a?.transcript} checked={checked} setChecked={setChecked} onPreview={previewRange} />}
            {tab === "clips" && <ClipList clips={clips} activeId={clipId} onPick={(c) => { setClipId(c.id); seek(c.start); }} onPreview={(c) => previewRange(c.start, c.end)}
              onToggle={(c) => act(async () => setP(await api().clips.update(p.id, { ...c, status: c.status === "selected" ? "draft" : "selected" })))} />}
            {tab === "transcript" && <Transcript segs={a?.transcript?.segments} time={time} onSeek={(t) => seek(t, true)} />}
          </div>
        </>)}
      </section>

      {/* inspector */}
      <aside className="ws-inspector" aria-label="Clip settings">
        {clip && src ? <Inspector key={clip.id} clip={clip} source={src} time={time} mediaUrl={api().media.mediaUrl(src.path)}
          onChange={(c) => act(async () => setP(await api().clips.update(p.id, c)))}
          onDelete={() => act(async () => { setP(await api().clips.remove(p.id, clip.id)); setClipId(null); })}
          onExport={() => act(async () => { const r = await api().exports.queue(p.id, [clip.id]); if (r.skipped) setErr("This clip hasn't changed since its last export. Change a setting to export it again."); })}
          onSrt={() => act(async () => { const f = await api().clips.exportSrt(p.id, clip.id); await api().exports.reveal(f); })}
          onPreview={() => previewRange(clip.start, clip.end)} />
          : <div className="empty"><h3>No clip selected</h3><p>Pick a clip, turn a suggestion into a clip, or mark In and Out on the timeline.</p></div>}
      </aside>
    </div>
  );
}

function Slider({ label, value, min, max, step, unit, onChange }: { label: string; value: number; min: number; max: number; step: number; unit: string; onChange: (v: number) => void }) {
  return <label className="slider"><span>{label}</span><output className="num">{value}{unit}</output><input type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(Number(e.target.value))} /></label>;
}

function Suggestions({ cands, generatedAt, hasTranscript, checked, setChecked, onPreview }: { cands: Candidate[]; generatedAt?: string; hasTranscript: boolean; checked: Set<string>; setChecked: (s: Set<string>) => void; onPreview: (a: number, b: number) => void }) {
  if (!cands.length) return <div className="empty"><h3>No suggestions yet</h3><p>Analyse the audio, then press Find moments. Transcribing first gives better picks.</p></div>;
  return (
    <>
      <p className="muted gallery-note">Ranked by loudness, speech, {hasTranscript ? "transcript cues " : ""}and clean start and end points. These are suggestions to review, not guarantees. {generatedAt && <span className="dim">Found {new Date(generatedAt).toLocaleTimeString()}.</span>}</p>
      <ol className="gallery">
        {cands.map((c) => (
          <li key={c.id} className={`cand ${checked.has(c.id) ? "on" : ""}`}>
            <label className="cand-check"><input type="checkbox" checked={checked.has(c.id)} onChange={(e) => { const n = new Set(checked); e.target.checked ? n.add(c.id) : n.delete(c.id); setChecked(n); }} /><span className="sr">Select</span></label>
            <div className="cand-main">
              <div className="row"><b className="cand-title">{c.title}</b><span className="score num" title="Relative to the best moment in this recording">{c.score}</span></div>
              <p className="muted num">{clock(c.start)}–{clock(c.end)} · {Math.round(c.end - c.start)}s</p>
              {c.excerpt && <p className="cand-ex">{c.excerpt}</p>}
              <div className="signals">
                <Signal name="Loud" v={c.signals.energy} /><Signal name="Speech" v={c.signals.speech} />{hasTranscript && <Signal name="Cues" v={c.signals.cues} />}<Signal name="Clean edges" v={c.signals.boundary} />
              </div>
              {c.signals.cueWords.length > 0 && <p className="dim">Cues: {c.signals.cueWords.slice(0, 6).join(", ")}</p>}
            </div>
            <button className="btn" onClick={() => onPreview(c.start, c.end)}><Icon name="play" />Preview</button>
          </li>
        ))}
      </ol>
    </>
  );
}
const Signal = ({ name, v }: { name: string; v: number }) => <span className="sig"><span>{name}</span><i><b style={{ width: `${Math.round(v * 100)}%` }} /></i></span>;

function ClipList({ clips, activeId, onPick, onPreview, onToggle }: { clips: Clip[]; activeId: string | null; onPick: (c: Clip) => void; onPreview: (c: Clip) => void; onToggle: (c: Clip) => void }) {
  if (!clips.length) return <div className="empty"><h3>No clips yet</h3><p>Turn suggestions into clips, or mark In and Out and press Make clip.</p></div>;
  return (
    <ul className="cliplist">
      {clips.map((c) => (
        <li key={c.id} className={c.id === activeId ? "on" : ""}>
          <label className="switch" title="Include in the next batch export"><input type="checkbox" checked={c.status === "selected"} onChange={() => onToggle(c)} /><span className="sr">Selected for export</span></label>
          <button className="cl-main" onClick={() => onPick(c)}>
            <b>{c.name}</b>
            <span className="muted num">{clock(c.start)}–{clock(c.end)} · {Math.round(c.end - c.start)}s · {c.composition.preset.replace("-", " ")}{c.removeSilence ? " · silences removed" : ""}{c.captions ? " · captions" : ""}{c.headline.enabled ? " · headline" : ""}</span>
          </button>
          {c.lastOutput && <span className="dot ok" title="Exported" />}
          <button className="btn ghost icon" aria-label={`Play ${c.name}`} onClick={() => onPreview(c)}><Icon name="play" /></button>
        </li>
      ))}
    </ul>
  );
}

function Transcript({ segs, time, onSeek }: { segs?: { start: number; end: number; text: string }[]; time: number; onSeek: (t: number) => void }) {
  if (!segs) return <div className="empty"><h3>No transcript</h3><p>Press Transcribe to create one on this computer. Set up whisper.cpp in Settings first.</p></div>;
  return (
    <ol className="transcript">
      {segs.map((s, i) => (
        <li key={i} className={time >= s.start && time < s.end ? "now" : ""}><button onClick={() => onSeek(s.start)}><span className="num dim">{clock(s.start)}</span><span>{s.text}</span></button></li>
      ))}
    </ol>
  );
}
