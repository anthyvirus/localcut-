// Whole-recording timeline drawn on a canvas (fast even for multi-hour recordings):
// loudness curve, detected silences, what silence removal would keep, suggestions, clips,
// the selection and the playhead. Click to seek, drag to select, zoom with the slider.
import { useEffect, useRef, useState } from "react";
import type { Candidate, Clip, Interval } from "../../shared/types";
import { clock } from "../lib";

interface Props { duration: number; time: number; levels?: number[]; levelStep: number; silences?: Interval[]; keep?: Interval[]; candidates: Candidate[]; clips: Clip[]; selection: Interval | null; activeClipId: string | null;
  onSeek(t: number): void; onSelect(i: Interval | null): void; onPickClip(id: string): void }

const H = 132;

export function Timeline(p: Props) {
  const wrap = useRef<HTMLDivElement>(null);
  const cv = useRef<HTMLCanvasElement>(null);
  const [zoom, setZoom] = useState(1);
  const [width, setWidth] = useState(800);
  const drag = useRef<{ x0: number; t0: number; moved: boolean } | null>(null);

  useEffect(() => {
    const ro = new ResizeObserver(() => setWidth(wrap.current?.clientWidth ?? 800));
    if (wrap.current) ro.observe(wrap.current);
    return () => ro.disconnect();
  }, []);
  const W = Math.round(width * zoom);
  const x = (t: number) => (t / p.duration) * W;
  const tAt = (px: number) => Math.max(0, Math.min(p.duration, (px / W) * p.duration));

  useEffect(() => {
    const c = cv.current;
    if (!c) return;
    const dpr = window.devicePixelRatio || 1;
    c.width = W * dpr; c.height = H * dpr; c.style.width = `${W}px`; c.style.height = `${H}px`;
    const g = c.getContext("2d")!;
    g.scale(dpr, dpr);
    g.fillStyle = "#0d0e11"; g.fillRect(0, 0, W, H);
    // ruler
    const step = [1, 5, 10, 30, 60, 300, 600, 1800, 3600].find((s) => (s / p.duration) * W > 70) ?? 3600;
    g.fillStyle = "#5d626b"; g.font = "10px Inter, sans-serif";
    for (let t = 0; t <= p.duration; t += step) { g.fillRect(x(t), 0, 1, 6); g.fillText(clock(t), x(t) + 3, 10); }
    const top = 16, mid = 16 + 70;
    // silences
    g.fillStyle = "rgba(134,180,240,.14)";
    for (const s of p.silences ?? []) g.fillRect(x(s.start), top, Math.max(1, x(s.end) - x(s.start)), 70);
    // loudness curve
    if (p.levels?.length) {
      g.beginPath(); g.moveTo(0, mid);
      p.levels.forEach((db, i) => { const v = Math.max(0, (db + 60) / 60); g.lineTo(x(i * p.levelStep), mid - v * 66); });
      g.lineTo(x(p.levels.length * p.levelStep), mid); g.closePath();
      g.fillStyle = "rgba(233,234,237,.16)"; g.fill();
      g.strokeStyle = "rgba(233,234,237,.45)"; g.lineWidth = 1; g.stroke();
    } else {
      g.fillStyle = "#3d424a"; g.fillText("Analyse audio to see loudness and silences", 8, mid - 30);
    }
    // what silence removal keeps
    if (p.keep) { g.fillStyle = "rgba(127,207,154,.55)"; for (const k of p.keep) g.fillRect(x(k.start), mid + 2, Math.max(1, x(k.end) - x(k.start)), 3); }
    // suggestions
    for (const c of p.candidates) { g.strokeStyle = "rgba(233,169,62,.7)"; g.lineWidth = 1; g.strokeRect(x(c.start) + 0.5, mid + 9.5, x(c.end) - x(c.start) - 1, 12); }
    // clips
    for (const c of p.clips) {
      g.fillStyle = c.id === p.activeClipId ? "rgba(233,169,62,.85)" : "rgba(233,169,62,.35)";
      g.fillRect(x(c.start), mid + 26, Math.max(2, x(c.end) - x(c.start)), 14);
    }
    // selection
    if (p.selection) { g.fillStyle = "rgba(255,255,255,.08)"; g.fillRect(x(p.selection.start), top, x(p.selection.end) - x(p.selection.start), H - top); g.fillStyle = "#e9a93e"; g.fillRect(x(p.selection.start), top, 1, H - top); g.fillRect(x(p.selection.end), top, 1, H - top); }
    // playhead
    g.fillStyle = "#e9eaed"; g.fillRect(Math.round(x(p.time)), 0, 1.5, H);
  }, [p, W]);

  // keep the playhead in view when zoomed
  useEffect(() => {
    const el = wrap.current;
    if (!el || zoom === 1) return;
    const px = x(p.time);
    if (px < el.scrollLeft || px > el.scrollLeft + el.clientWidth - 40) el.scrollLeft = Math.max(0, px - el.clientWidth / 3);
  }, [p.time, zoom]);

  const pos = (e: React.PointerEvent) => e.clientX - (cv.current?.getBoundingClientRect().left ?? 0);
  return (
    <div className="timeline">
      <div className="tl-scroll" ref={wrap}>
        <canvas ref={cv} role="slider" aria-label="Timeline" aria-valuemin={0} aria-valuemax={Math.round(p.duration)} aria-valuenow={Math.round(p.time)} aria-valuetext={clock(p.time)} tabIndex={0}
          onKeyDown={(e) => { if (e.key === "Home") p.onSeek(0); if (e.key === "End") p.onSeek(p.duration); }}
          onPointerDown={(e) => { (e.target as Element).setPointerCapture(e.pointerId); drag.current = { x0: pos(e), t0: tAt(pos(e)), moved: false }; }}
          onPointerMove={(e) => { const d = drag.current; if (!d) return; if (Math.abs(pos(e) - d.x0) > 4) { d.moved = true; const t = tAt(pos(e)); p.onSelect({ start: Math.min(d.t0, t), end: Math.max(d.t0, t) }); } }}
          onPointerUp={(e) => {
            const d = drag.current; drag.current = null;
            if (!d || d.moved) return;
            const t = tAt(pos(e)), y = e.nativeEvent.offsetY;
            const hit = y > 110 ? p.clips.find((c) => t >= c.start && t <= c.end) : undefined;
            if (hit) p.onPickClip(hit.id); else p.onSeek(t);
          }} />
      </div>
      <div className="tl-foot">
        <span className="legend"><i className="lg-sil" />Silence</span><span className="legend"><i className="lg-keep" />Kept after silence removal</span><span className="legend"><i className="lg-cand" />Suggestion</span><span className="legend"><i className="lg-clip" />Clip</span>
        <span className="grow" />
        {p.selection && <button className="btn ghost" onClick={() => p.onSelect(null)}>Clear selection</button>}
        <label className="row muted">Zoom<input type="range" min={1} max={40} step={1} value={zoom} onChange={(e) => setZoom(Number(e.target.value))} aria-label="Timeline zoom" /></label>
      </div>
    </div>
  );
}
