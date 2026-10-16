// Full-width multi-track timeline: toolbar, track headers, ruler, Moments track (AI
// suggestions), Clips track (select, trim handles, drag to move, export tick), Video track
// (filmstrip) and Audio track (loudness waveform, silences, what silence removal keeps).
import { useEffect, useMemo, useRef, useState } from "react";
import type { Clip } from "../../shared/types";
import { api, clock } from "../lib";
import { Icon } from "../ui/icons";
import type { EditorCtx } from "./Editor";

const HEAD = 104;            // track header column
const TRACKS = [{ id: "moments", label: "Moments", h: 26 }, { id: "clips", label: "Clips", h: 44 }, { id: "video", label: "Video", h: 54 }, { id: "audio", label: "Audio", h: 46 }] as const;

export function TimelinePanel({ ctx }: { ctx: EditorCtx }) {
  const { p } = ctx;
  const src = p.sources.find((s) => s.id === ctx.sourceId);
  const scroller = useRef<HTMLDivElement>(null);
  const [vw, setVw] = useState(800);
  const [zoom, setZoom] = useState(1);
  const [snap, setSnap] = useState(true);
  const [drag, setDrag] = useState<null | { kind: "move" | "start" | "end"; id: string; x0: number; s0: number; e0: number; cur?: Clip }>(null);
  const range = useRef<{ x0: number; t0: number } | null>(null);
  const strip = useRef<HTMLImageElement | null>(null);
  const [stripReady, setStripReady] = useState(0);
  const videoCv = useRef<HTMLCanvasElement>(null), audioCv = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const ro = new ResizeObserver(() => setVw((scroller.current?.clientWidth ?? 800) - 2));
    if (scroller.current) ro.observe(scroller.current);
    return () => ro.disconnect();
  }, []);
  // filmstrip image (re-fetched when the strip appears or changes)
  useEffect(() => {
    if (!src?.strip) { strip.current = null; setStripReady((n) => n + 1); return; }
    const img = new Image();
    img.onload = () => { strip.current = img; setStripReady((n) => n + 1); };
    img.src = `${api().media.thumbUrl(p.id, src.id, "strip")}&v=${src.strip.count}`;
  }, [p.id, src?.id, src?.strip?.count]);

  const dur = src?.info.durationSec ?? 1;
  const W = Math.max(vw, Math.round(vw * zoom));
  const x = (t: number) => (t / dur) * W;
  const tAt = (px: number) => Math.max(0, Math.min(dur, (px / W) * dur));
  const clips = useMemo(() => p.clips.filter((c) => c.sourceId === ctx.sourceId), [p.clips, ctx.sourceId]);
  const cands = src?.analysis.candidates?.items ?? [];

  // snapping targets: playhead, other clip edges, silence edges (within 8 px)
  const snapT = (t: number, except?: string) => {
    if (!snap) return t;
    const pts = [ctx.time, ...clips.filter((c) => c.id !== except).flatMap((c) => [c.start, c.end]), ...(src?.analysis.silence?.intervals ?? []).flatMap((s) => [s.start, s.end])];
    let best = t, bd = (8 / W) * dur;
    for (const q of pts) { const d = Math.abs(q - t); if (d < bd) { bd = d; best = q; } }
    return best;
  };

  // draw the filmstrip and the waveform
  useEffect(() => {
    const dpr = window.devicePixelRatio || 1;
    const vc = videoCv.current, ac = audioCv.current;
    if (vc) {
      vc.width = W * dpr; vc.height = 54 * dpr; vc.style.width = `${W}px`;
      const g = vc.getContext("2d")!; g.scale(dpr, dpr);
      g.fillStyle = "#1a1c20"; g.fillRect(0, 0, W, 54);
      const img = strip.current, s = src?.strip;
      if (img && s) {
        const tileW = (img.width / s.count) * (54 / img.height);
        for (let px = 0; px < W; px += tileW) {
          const i = Math.min(s.count - 1, Math.floor((tAt(px + tileW / 2) / dur) * s.count));
          g.drawImage(img, i * (img.width / s.count), 0, img.width / s.count, img.height, px, 0, tileW, 54);
        }
      } else { g.fillStyle = "#5f646d"; g.font = "11px Inter"; g.fillText("Making filmstrip…", 8, 30); }
    }
    if (ac) {
      ac.width = W * dpr; ac.height = 46 * dpr; ac.style.width = `${W}px`;
      const g = ac.getContext("2d")!; g.scale(dpr, dpr);
      g.fillStyle = "#16201f"; g.fillRect(0, 0, W, 46);
      g.fillStyle = "rgba(134,180,240,.18)";
      for (const s of src?.analysis.silence?.intervals ?? []) g.fillRect(x(s.start), 0, Math.max(1, x(s.end) - x(s.start)), 46);
      const lv = src?.analysis.energy?.db, step = src?.analysis.energy?.stepSec ?? 0.5;
      if (lv?.length) {
        g.fillStyle = "rgba(44,199,207,.75)";
        const per = Math.max(1, Math.floor(lv.length / W));
        for (let i = 0; i < lv.length; i += per) { const v = Math.max(0, (lv[i]! + 60) / 60); const h = v * 40; g.fillRect(x(i * step), 23 - h / 2, Math.max(1, x(step * per) - 0.5), h); }
      } else { g.fillStyle = "#5f646d"; g.font = "11px Inter"; g.fillText("Analyse audio (Audio panel) to see the waveform and silences", 8, 27); }
      if (ctx.keep) { g.fillStyle = "rgba(127,207,154,.8)"; for (const k of ctx.keep) g.fillRect(x(k.start), 43, Math.max(1, x(k.end) - x(k.start)), 3); }
    }
  }, [W, src, stripReady, ctx.keep]);

  // keep the playhead visible while playing
  useEffect(() => {
    const el = scroller.current;
    if (!el || zoom === 1 || drag) return;
    const px = x(ctx.time);
    if (px < el.scrollLeft || px > el.scrollLeft + el.clientWidth - 40) el.scrollLeft = Math.max(0, px - el.clientWidth / 3);
  }, [ctx.time]);

  if (!src) return <section className="tl"><div className="empty"><p>The timeline appears when the project has a video.</p></div></section>;
  const sel = clips.find((c) => c.id === ctx.clipId);
  const shown = (c: Clip) => (drag?.id === c.id && drag.cur ? drag.cur : c);

  const split = () => {
    const t = ctx.time;
    if (sel && t > sel.start + 0.5 && t < sel.end - 0.5) {
      const a = { ...sel, end: t, lastOutput: undefined, renderHash: undefined };
      const b = { ...structuredClone(sel), id: crypto.randomUUID(), name: `${sel.name} (2)`, start: t, lastOutput: undefined, renderHash: undefined };
      void ctx.commitClips(p.clips.flatMap((c) => (c.id === sel.id ? [a, b] : [c])), "split");
      return;
    }
    const r = ctx.sel ?? { start: t, end: Math.min(dur, t + 20) };
    if (r.end - r.start < 0.5) return;
    void ctx.act(async () => { const np = await api().clips.create(p.id, src.id, r.start, r.end, `Clip at ${clock(r.start)}`); ctx.setProject(np); ctx.selectClip(np.clips.at(-1)!.id); ctx.setSel(null); });
  };
  const del = () => { if (sel) { void ctx.commitClips(p.clips.filter((c) => c.id !== sel.id), "delete clip"); ctx.selectClip(null); } };

  const onClipDown = (e: React.PointerEvent, c: Clip, kind: "move" | "start" | "end") => {
    e.stopPropagation();
    (e.currentTarget as Element).setPointerCapture(e.pointerId);
    ctx.selectClip(c.id);
    setDrag({ kind, id: c.id, x0: e.clientX, s0: c.start, e0: c.end });
  };
  const onMove = (e: React.PointerEvent) => {
    if (!drag) return;
    const dt = ((e.clientX - drag.x0) / W) * dur;
    const c = clips.find((k) => k.id === drag.id)!;
    let s = drag.s0, en = drag.e0;
    if (drag.kind === "start") s = Math.min(snapT(drag.s0 + dt, c.id), en - 0.5);
    else if (drag.kind === "end") en = Math.max(snapT(drag.e0 + dt, c.id), s + 0.5);
    else { const len = drag.e0 - drag.s0; s = Math.max(0, Math.min(dur - len, snapT(drag.s0 + dt, c.id))); en = s + len; }
    setDrag({ ...drag, cur: { ...c, start: Math.max(0, s), end: Math.min(dur, en) } });
  };
  const onUp = () => {
    if (!drag) return;
    const d = drag; setDrag(null);
    if (d.cur && (d.cur.start !== d.s0 || d.cur.end !== d.e0)) void ctx.commitClips(p.clips.map((c) => (c.id === d.id ? { ...d.cur!, lastOutput: c.lastOutput } : c)), d.kind === "move" ? "move clip" : "trim clip");
  };

  const pos = (e: React.PointerEvent) => e.clientX - (e.currentTarget as HTMLElement).getBoundingClientRect().left;
  return (
    <section className="tl" aria-label="Timeline">
      <div className="tl-tools">
        <button id="tl-split" className="btn ghost" title="Split the selected clip at the playhead, or make a clip from the selected range (Ctrl+B)" onClick={split}><Icon name="scissors" />{sel ? "Split" : ctx.sel ? "Make clip" : "Split"}</button>
        <button id="tl-delete" className="btn ghost" disabled={!sel} title="Delete the selected clip (Delete)" onClick={del}><Icon name="trash" />Delete</button>
        <span className="tl-sep" />
        <button className="btn ghost" aria-pressed={snap} onClick={() => setSnap(!snap)} title="Snap to the playhead, clip edges and silences"><Icon name="magnet" />Snap {snap ? "on" : "off"}</button>
        {ctx.sel && <span className="muted num">Range {clock(ctx.sel.start, true)}–{clock(ctx.sel.end, true)} · {(ctx.sel.end - ctx.sel.start).toFixed(1)}s <button className="linkish" onClick={() => ctx.setSel(null)}>Clear</button></span>}
        <span className="grow" />
        <span className="muted kbd-hint">Ctrl+B split · Del delete · Ctrl+Z undo · I/O range</span>
        <button className="btn ghost icon" aria-label="Zoom out" onClick={() => setZoom((z) => Math.max(1, z / 1.5))}><Icon name="minus" /></button>
        <input className="tl-zoom" type="range" min={1} max={60} step={0.5} value={zoom} onChange={(e) => setZoom(Number(e.target.value))} aria-label="Timeline zoom" />
        <button className="btn ghost icon" aria-label="Zoom in" onClick={() => setZoom((z) => Math.min(60, z * 1.5))}><Icon name="plus" /></button>
        <button className="btn ghost" onClick={() => setZoom(1)} title="Fit the whole video">Fit</button>
      </div>
      <div className="tl-main">
        <div className="tl-heads" style={{ width: HEAD }}>
          <div className="tl-ruler-head" />
          {TRACKS.map((t) => <div key={t.id} className="tl-head" style={{ height: t.h }}><Icon name={t.id === "moments" ? "spark" : t.id === "clips" ? "scissors" : t.id === "video" ? "film" : "wave"} size={13} />{t.label}</div>)}
        </div>
        <div className="tl-scroll" ref={scroller} onPointerMove={onMove} onPointerUp={onUp}>
          <div className="tl-content" style={{ width: W }}>
            <div className="tl-ruler" onPointerDown={(e) => { (e.currentTarget as Element).setPointerCapture(e.pointerId); ctx.seek(tAt(pos(e))); }} onPointerMove={(e) => { if (e.buttons) ctx.seek(tAt(pos(e))); }}>
              {ticks(dur, W).map((t) => <span key={t} className="tick" style={{ left: x(t) }}><i />{clock(t)}</span>)}
            </div>
            <div className="tl-track moments" style={{ height: 26 }}>
              {cands.map((c) => <button key={c.id} className="mk" style={{ left: x(c.start), width: Math.max(4, x(c.end) - x(c.start)) }} title={`${c.title} · score ${c.score}`} onClick={() => ctx.previewRange(c.start, c.end)}><span>{c.score}</span></button>)}
              {!cands.length && <span className="tl-hint">AI moments show here after Find moments</span>}
            </div>
            <div className="tl-track clips" style={{ height: 44 }}
              onPointerDown={(e) => { if (e.target !== e.currentTarget) return; range.current = { x0: pos(e), t0: tAt(pos(e)) }; ctx.selectClip(null); (e.currentTarget as Element).setPointerCapture(e.pointerId); }}
              onPointerMove={(e) => { const r = range.current; if (!r || Math.abs(pos(e) - r.x0) < 4) return; const t = tAt(pos(e)); ctx.setSel({ start: Math.min(r.t0, t), end: Math.max(r.t0, t) }); }}
              onPointerUp={(e) => { const r = range.current; range.current = null; if (r && Math.abs(pos(e) - r.x0) < 4) ctx.seek(r.t0); }}>
              {ctx.sel && <div className="range" style={{ left: x(ctx.sel.start), width: x(ctx.sel.end) - x(ctx.sel.start) }} />}
              {clips.map((c0) => { const c = shown(c0); return (
                <div key={c.id} className={`clip ${c.id === ctx.clipId ? "sel" : ""} ${c.status === "selected" ? "tick" : ""}`} style={{ left: x(c.start), width: Math.max(10, x(c.end) - x(c.start)) }}
                  onPointerDown={(e) => onClipDown(e, c0, "move")} title={`${c.name} · ${clock(c.start)}–${clock(c.end)}`}>
                  <span className="h l" onPointerDown={(e) => onClipDown(e, c0, "start")} />
                  <input type="checkbox" className="clip-tick" checked={c.status === "selected"} aria-label={`Export ${c.name}`} onPointerDown={(e) => e.stopPropagation()}
                    onChange={() => ctx.commitClips(p.clips.map((x2) => x2.id === c.id ? { ...x2, status: x2.status === "selected" ? "draft" : "selected" } : x2), "export selection")} />
                  <span className="clip-name">{c.name}</span>
                  <span className="clip-len num">{(c.end - c.start).toFixed(1)}s</span>
                  <span className="h r" onPointerDown={(e) => onClipDown(e, c0, "end")} />
                </div>); })}
            </div>
            <div className="tl-track" style={{ height: 54 }} onPointerDown={(e) => ctx.seek(tAt(pos(e)))}><canvas ref={videoCv} height={54} /></div>
            <div className="tl-track" style={{ height: 46 }} onPointerDown={(e) => ctx.seek(tAt(pos(e)))}><canvas ref={audioCv} height={46} /></div>
            <div className="playhead" style={{ left: x(ctx.time) }}
              onPointerDown={(e) => { (e.currentTarget as Element).setPointerCapture(e.pointerId); }}
              onPointerMove={(e) => { if (e.buttons) ctx.seek(tAt(e.clientX - (scroller.current!.getBoundingClientRect().left) + scroller.current!.scrollLeft)); }}><i /></div>
          </div>
        </div>
      </div>
    </section>
  );
}

function ticks(dur: number, W: number): number[] {
  const step = [1, 2, 5, 10, 15, 30, 60, 120, 300, 600, 1800, 3600].find((s) => (s / dur) * W > 80) ?? 3600;
  const out: number[] = [];
  for (let t = 0; t <= dur; t += step) out.push(t);
  return out;
}
