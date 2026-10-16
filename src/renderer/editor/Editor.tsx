// The editor: a full-window, four-zone workspace (asset panel, preview stage, properties,
// multi-track timeline) in the layout desktop creators already know. Original UI; the
// engine underneath is unchanged.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Clip, Interval, Project, SilenceSettings } from "../../shared/types";
import { api, clock, errText } from "../lib";
import { Icon } from "../ui/icons";
import { AssetPanel, type AssetTab } from "./AssetPanel";
import { Properties } from "./Properties";
import { Stage } from "./Stage";
import { TimelinePanel } from "./TimelinePanel";

export const DEFAULT_SIL: SilenceSettings = { thresholdDb: -35, minSilenceSec: 0.6, paddingSec: 0.15, maxPauseSec: 0.8, mode: "shorten" };

export interface EditorCtx {
  p: Project;
  sourceId: string | null;
  setSourceId(id: string): void;
  clipId: string | null;
  selectClip(id: string | null): void;
  time: number;
  seek(t: number, play?: boolean): void;
  previewRange(a: number, b: number): void;
  act(fn: () => Promise<unknown>): Promise<void>;
  setProject(p: Project): void;
  commitClips(next: Clip[], label: string): Promise<void>;
  commitClipsFrom(before: Clip[], next: Clip[], label: string): Promise<void>;
  sil: SilenceSettings; setSil(s: SilenceSettings): void;
  keep: Interval[] | null;
  sel: Interval | null; setSel(i: Interval | null): void;
}

export function Editor({ projectId, onHome, onSimple, onRenamed }: { projectId: string; onHome: () => void; onSimple: () => void; onRenamed: (name: string) => void }) {
  const [p, setP] = useState<Project | null>(null);
  const [err, setErr] = useState("");
  const [sourceId, setSourceId] = useState<string | null>(null);
  const [clipId, setClipId] = useState<string | null>(null);
  const [tab, setTab] = useState<AssetTab>("media");
  const [time, setTime] = useState(0);
  const [sel, setSel] = useState<Interval | null>(null);
  const [sil, setSil] = useState<SilenceSettings>(DEFAULT_SIL);
  const [keep, setKeep] = useState<Interval[] | null>(null);
  const undo = useRef<{ clips: Clip[]; label: string }[]>([]);
  const redo = useRef<{ clips: Clip[]; label: string }[]>([]);
  const [, bump] = useState(0);
  const video = useRef<HTMLVideoElement>(null);
  const stopAt = useRef<number | null>(null);

  useEffect(() => {
    void api().projects.open(projectId).then((x) => { setP(x); setSourceId((s) => s ?? x.sources[0]?.id ?? null); }).catch((e) => setErr(errText(e)));
    return api().events.onProjectChanged((x) => { if (x.id === projectId) setP(structuredClone(x)); });
  }, [projectId]);

  const src = p?.sources.find((s) => s.id === sourceId);
  useEffect(() => {
    if (!src?.analysis.silence) { setKeep(null); return; }
    void api().analysis.keepRanges(projectId, src.id, sil).then(setKeep).catch(() => setKeep(null));
  }, [projectId, src?.id, src?.analysis.silence, sil]);

  const seek = useCallback((t: number, play = false) => {
    const v = video.current;
    if (!v || !src) return;
    v.currentTime = Math.max(0, Math.min(src.info.durationSec, t));
    setTime(v.currentTime);
    if (play) void v.play();
  }, [src]);
  const previewRange = (a: number, b: number) => { stopAt.current = b; seek(a, true); };

  async function act(fn: () => Promise<unknown>) { setErr(""); try { await fn(); } catch (e) { setErr(errText(e)); } }
  async function commitClips(next: Clip[], label: string) {
    if (!p) return;
    undo.current.push({ clips: structuredClone(p.clips), label });
    if (undo.current.length > 100) undo.current.shift();
    redo.current = [];
    await act(async () => setP(await api().clips.setAll(p.id, next)));
    bump((n) => n + 1);
  }
  async function commitClipsFrom(before: Clip[], next: Clip[], label: string) {
    if (!p) return;
    undo.current.push({ clips: before, label });
    if (undo.current.length > 100) undo.current.shift();
    redo.current = [];
    await act(async () => setP(await api().clips.setAll(p.id, next)));
    bump((n) => n + 1);
  }
  async function step(from: typeof undo, to: typeof redo) {
    const h = from.current.pop();
    if (!h || !p) return;
    to.current.push({ clips: structuredClone(p.clips), label: h.label });
    await act(async () => setP(await api().clips.setAll(p.id, h.clips)));
    if (!h.clips.some((c) => c.id === clipId)) setClipId(null);
    bump((n) => n + 1);
  }

  // shortcuts: Space play, Ctrl+B split / make clip, Delete remove clip, Ctrl+Z / Ctrl+Shift+Z undo/redo, I/O mark, arrows nudge
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (/^(input|textarea|select)$/i.test((e.target as HTMLElement).tagName)) return;
      const v = video.current, mod = e.ctrlKey || e.metaKey;
      if (e.code === "Space" && v) { e.preventDefault(); v.paused ? void v.play() : v.pause(); }
      else if (mod && e.key.toLowerCase() === "z") { e.preventDefault(); void (e.shiftKey ? step(redo, undo) : step(undo, redo)); }
      else if (mod && e.key.toLowerCase() === "y") { e.preventDefault(); void step(redo, undo); }
      else if (mod && e.key.toLowerCase() === "b") { e.preventDefault(); document.getElementById("tl-split")?.click(); }
      else if ((e.key === "Delete" || e.key === "Backspace") && clipId) { e.preventDefault(); document.getElementById("tl-delete")?.click(); }
      else if (e.key === "i" && v) setSel({ start: v.currentTime, end: Math.max(v.currentTime + 1, sel?.end ?? v.currentTime + 15) });
      else if (e.key === "o" && v) setSel({ start: Math.min(sel?.start ?? Math.max(0, v.currentTime - 15), v.currentTime - 0.5), end: v.currentTime });
      else if (e.key === "ArrowLeft" && v) seek(v.currentTime - (e.shiftKey ? 5 : 1 / 30));
      else if (e.key === "ArrowRight" && v) seek(v.currentTime + (e.shiftKey ? 5 : 1 / 30));
      else if (e.key === "Escape") { setSel(null); setClipId(null); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const ctx: EditorCtx | null = useMemo(() => p && ({
    p, sourceId, setSourceId: (id) => { setSourceId(id); setClipId(null); setSel(null); }, clipId, selectClip: (id) => { setClipId(id); if (id) setTab((t) => t); },
    time, seek, previewRange, act, setProject: setP, commitClips, commitClipsFrom, sil, setSil, keep, sel, setSel,
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [p, sourceId, clipId, time, sil, keep, sel, seek]);

  if (!p || !ctx) return <div className="page">{err ? <p className="note err">{err}</p> : <div className="skel" style={{ height: 300 }} />}</div>;
  const selected = p.clips.filter((c) => c.status === "selected");
  return (
    <div className="ed">
      <header className="ed-top">
        <button className="btn ghost" onClick={onHome} title="All projects"><Icon name="projects" />Projects</button>
        <button className="btn ghost" onClick={onSimple} title="Back to the simple pick-and-export screen"><Icon name="spark" />Simple mode</button>
        <div className="ed-hist">
          <button className="btn ghost icon" aria-label="Undo" title={undo.current.length ? `Undo ${undo.current.at(-1)!.label} (Ctrl+Z)` : "Nothing to undo"} disabled={!undo.current.length} onClick={() => step(undo, redo)}><Icon name="undo" /></button>
          <button className="btn ghost icon" aria-label="Redo" title={redo.current.length ? `Redo ${redo.current.at(-1)!.label} (Ctrl+Shift+Z)` : "Nothing to redo"} disabled={!redo.current.length} onClick={() => step(redo, undo)}><Icon name="redo" /></button>
        </div>
        <input className="ed-name" defaultValue={p.name} aria-label="Project name" onBlur={(e) => { const n = e.target.value.trim(); if (n && n !== p.name) void api().projects.rename(p.id, n).then((x) => { setP(x); onRenamed(x.name); }); }} />
        <span className="ed-meta muted num">{src ? `${clock(src.info.durationSec)} · ${src.info.video?.width}×${src.info.video?.height}` : ""}</span>
        <button className="btn primary ed-export" disabled={!selected.length} title={selected.length ? "" : "Tick clips on the timeline or in the Clips list to export them"}
          onClick={() => act(async () => { const r = await api().exports.queue(p.id, selected.map((c) => c.id)); if (r.skipped) setErr(`${r.queued} queued. ${r.skipped} unchanged clip${r.skipped > 1 ? "s were" : " was"} already exported.`); })}>
          <Icon name="export" />Export {selected.length ? `${selected.length} selected` : ""}
        </button>
      </header>
      <div className="ed-msg" role="alert">{err && <p className="note err ed-err">{err}<button className="btn ghost icon" aria-label="Dismiss" onClick={() => setErr("")}><Icon name="x" /></button></p>}</div>
      <div className="ed-body">
        <AssetPanel ctx={ctx} tab={tab} setTab={setTab} />
        <Stage ctx={ctx} video={video} onTime={(t) => { setTime(t); if (stopAt.current !== null && t >= stopAt.current) { video.current?.pause(); stopAt.current = null; } }} />
        <Properties ctx={ctx} />
      </div>
      <TimelinePanel ctx={ctx} />
    </div>
  );
}
