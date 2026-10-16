// The preview stage. With a clip selected it shows the clip as it will export (canvas ratio,
// blurred copy or crop, safe areas, headline), using the same geometry as the FFmpeg
// renderer; otherwise it shows the source. The visible foreground video is the master clock.
import { useEffect, useRef, useState, type RefObject } from "react";
import type { Composition } from "../../shared/types";
import { api, clock } from "../lib";
import { Icon } from "../ui/icons";
import type { EditorCtx } from "./Editor";

export function Stage({ ctx, video, onTime }: { ctx: EditorCtx; video: RefObject<HTMLVideoElement | null>; onTime: (t: number) => void }) {
  const { p } = ctx;
  const src = p.sources.find((s) => s.id === ctx.sourceId);
  const clip = p.clips.find((c) => c.id === ctx.clipId);
  const area = useRef<HTMLDivElement>(null);
  const bg = useRef<HTMLVideoElement>(null);
  const [box, setBox] = useState({ w: 640, h: 360 });
  const [playing, setPlaying] = useState(false);
  const [vol, setVol] = useState(1);

  useEffect(() => {
    const ro = new ResizeObserver(() => { const el = area.current; if (el) setBox({ w: el.clientWidth - 32, h: el.clientHeight - 24 }); });
    if (area.current) ro.observe(area.current);
    return () => ro.disconnect();
  }, []);
  // keep the blurred copy in step with the master
  useEffect(() => {
    const m = video.current, b = bg.current;
    if (!m || !b) return;
    const sync = () => { if (Math.abs(b.currentTime - m.currentTime) > 0.15) b.currentTime = m.currentTime; };
    const play = () => { void b.play().catch(() => {}); }, pause = () => b.pause();
    m.addEventListener("seeked", sync); m.addEventListener("play", play); m.addEventListener("pause", pause); m.addEventListener("timeupdate", sync);
    return () => { m.removeEventListener("seeked", sync); m.removeEventListener("play", play); m.removeEventListener("pause", pause); m.removeEventListener("timeupdate", sync); };
  }, [video, clip?.composition.mode, src?.id]);
  useEffect(() => { if (video.current) video.current.volume = vol; }, [vol, video]);

  if (!src) return <section className="stage"><div className="stage-area"><div className="empty"><h3>Import a video to start</h3><p>Use the Media panel on the left, or drop files on it.</p></div></div></section>;
  const vw = src.info.video?.width ?? 1920, vh = src.info.video?.height ?? 1080;
  const comp: Composition | null = clip ? clip.composition : null;
  const cw = comp ? comp.width : vw, ch = comp ? comp.height : vh;
  const k = Math.min(box.w / cw, box.h / ch);
  const W = cw * k, H = ch * k;
  const url = api().media.mediaUrl(src.path);

  let fgStyle: React.CSSProperties = { left: 0, top: 0, width: W, height: H };
  if (comp && comp.mode !== "fill") {
    const portraitSrc = vh > vw;
    const fw = comp.mode === "landscape" ? Math.min(cw, (ch * vw) / vh) * k : portraitSrc ? ((ch * comp.fgScale * vw) / vh) * k : cw * comp.fgScale * k;
    const fh = (fw * vh) / vw;
    fgStyle = { width: fw, height: fh, left: (W - fw) / 2, top: (H - fh) / 2 + (comp.mode === "landscape" ? 0 : comp.fgOffsetY * k) };
  }
  const fill = comp?.mode === "fill";
  const toggle = () => { const v = video.current; if (v) v.paused ? void v.play() : v.pause(); };
  return (
    <section className="stage" aria-label="Preview">
      <div className="stage-bar">
        <span className="label">{clip ? clip.name : "Source"}</span>
        <span className="muted num">{comp ? `${cw}×${ch} · ${comp.preset.replace(/-/g, " ")}` : `${vw}×${vh} original`}</span>
      </div>
      <div className="stage-area" ref={area}>
        <div className="canvas" style={{ width: W, height: H }} onClick={toggle}>
          {comp?.mode === "blur" && <video ref={bg} src={url} muted className="cv-bg" style={{ filter: `blur(${Math.max(2, comp.bgBlur * k * 2.2)}px) brightness(${1 - comp.bgDarken})`, transform: `scale(${comp.bgZoom * 1.08})` }} />}
          <video ref={video} src={url} preload="auto" className={fill ? "cv-fill" : "cv-fg"} style={fill ? { transform: `scale(${comp!.bgZoom}) translateY(${comp!.fgOffsetY * k}px)` } : fgStyle}
            onTimeUpdate={(e) => onTime(e.currentTarget.currentTime)} onPlay={() => setPlaying(true)} onPause={() => setPlaying(false)} />
          {comp && comp.mode !== "landscape" && <><i className="safe" style={{ top: 0, height: comp.safeTop * k }} /><i className="safe" style={{ bottom: 0, height: comp.safeBottom * k }} /></>}
          {clip?.headline.enabled && clip.headline.text && (
            <span className="cv-head" style={{ top: clip.headline.y * k, fontSize: clip.headline.size * k, color: clip.headline.color, textAlign: clip.headline.align, WebkitTextStroke: `${Math.max(0.5, clip.headline.outlineWidth * k)}px ${clip.headline.outline}`,
              fontFamily: clip.headline.font === "Anton" ? "Anton, Impact, sans-serif" : "Inter, sans-serif", background: clip.headline.box ? "rgba(0,0,0,.6)" : "none" }}>{clip.headline.text}</span>)}
        </div>
      </div>
      <div className="transport">
        <span className="num tc">{clock(ctx.time, true)}<span className="dim"> / {clock(src.info.durationSec)}</span></span>
        <div className="tp-mid">
          <button className="btn ghost icon" aria-label="Back 5 seconds" onClick={() => ctx.seek(ctx.time - 5)}><Icon name="back" /></button>
          <button className="btn icon play" aria-label={playing ? "Pause" : "Play"} onClick={toggle}><Icon name={playing ? "pause" : "play"} /></button>
          <button className="btn ghost icon" aria-label="Forward 5 seconds" onClick={() => ctx.seek(ctx.time + 5)}><Icon name="fwd" /></button>
        </div>
        <label className="row vol" title="Preview volume"><Icon name="volume" /><input type="range" min={0} max={1} step={0.05} value={vol} onChange={(e) => setVol(Number(e.target.value))} aria-label="Preview volume" /></label>
        <button className="btn ghost icon" aria-label="Full screen" title="Full screen" onClick={() => area.current?.requestFullscreen?.()}><Icon name="full" /></button>
      </div>
    </section>
  );
}
