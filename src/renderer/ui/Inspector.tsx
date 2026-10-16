// Settings for one clip. The 9:16 preview mirrors the FFmpeg composition (same maths) so
// framing decisions are visible before export; the export itself is rendered by FFmpeg.
import { useEffect, useRef, useState } from "react";
import type { Clip, Composition, PresetId, SourceMedia } from "../../shared/types";
import { clock } from "../lib";
import { Icon } from "./icons";

const PRESETS: Record<PresetId, { label: string; comp: Partial<Composition>; hint: string }> = {
  "blurred-portrait": { label: "Blurred Portrait", hint: "Sharp video in front of a blurred copy of itself.", comp: { width: 1080, height: 1920, mode: "blur", fgScale: 1, fgOffsetY: 0, bgBlur: 20, bgDarken: 0.25, bgZoom: 1 } },
  "fullscreen-vertical": { label: "Full-screen vertical", hint: "Crops the video to fill 9:16.", comp: { width: 1080, height: 1920, mode: "fill", fgOffsetY: 0, bgZoom: 1 } },
  "clean-landscape": { label: "Clean landscape", hint: "Keeps the original 16:9 shape.", comp: { width: 1920, height: 1080, mode: "landscape" } },
  "hook-clip": { label: "Hook clip", hint: "Blurred portrait, video lowered for a headline, captions off.", comp: { width: 1080, height: 1920, mode: "blur", fgScale: 1, fgOffsetY: 120, bgBlur: 22, bgDarken: 0.35, bgZoom: 1.05 } },
  "custom": { label: "Custom", hint: "Your own settings.", comp: {} },
};

export function Inspector({ clip, source, time, mediaUrl, onChange, onDelete, onExport, onSrt, onPreview }: { clip: Clip; source: SourceMedia; time: number; mediaUrl: string;
  onChange(c: Clip): void; onDelete(): void; onExport(): void; onSrt(): void; onPreview(): void }) {
  const [c, setC] = useState(clip);
  useEffect(() => setC(clip), [clip]);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const update = (next: Clip, immediate = false) => { setC(next); clearTimeout(timer.current); timer.current = setTimeout(() => onChange(next), immediate ? 0 : 300); };
  const comp = c.composition;
  const setComp = (patch: Partial<Composition>) => update({ ...c, composition: { ...comp, ...patch, preset: patch.preset ?? (comp.preset === "custom" ? "custom" : comp.preset) } });
  const hasTranscript = !!source.analysis.transcript;
  const hasSilence = !!source.analysis.silence;
  const applyPreset = (id: PresetId) => {
    const next: Clip = { ...c, composition: { ...comp, ...PRESETS[id].comp, preset: id } };
    if (id === "hook-clip") { next.captions = false; next.headline = { ...c.headline, enabled: true }; }
    update(next, true);
  };
  return (
    <div className="insp">
      <div className="insp-sec">
        <input className="title-input" value={c.name} aria-label="Clip name" onChange={(e) => update({ ...c, name: e.target.value })} />
        <div className="grid2">
          <label className="field"><span>Start</span><div className="row"><input className="input num" type="number" step={0.1} value={Number(c.start.toFixed(2))} onChange={(e) => update({ ...c, start: Number(e.target.value) })} /><button className="btn icon" title="Set to playhead" aria-label="Set start to playhead" onClick={() => update({ ...c, start: Math.min(time, c.end - 0.5) }, true)}><Icon name="inmark" /></button></div></label>
          <label className="field"><span>End</span><div className="row"><input className="input num" type="number" step={0.1} value={Number(c.end.toFixed(2))} onChange={(e) => update({ ...c, end: Number(e.target.value) })} /><button className="btn icon" title="Set to playhead" aria-label="Set end to playhead" onClick={() => update({ ...c, end: Math.max(time, c.start + 0.5) }, true)}><Icon name="outmark" /></button></div></label>
        </div>
        <p className="muted num">{clock(c.start, true)} → {clock(c.end, true)} · {(c.end - c.start).toFixed(1)}s</p>
      </div>

      <div className="insp-sec">
        <span className="label">Format</span>
        <select className="input" value={comp.preset} onChange={(e) => applyPreset(e.target.value as PresetId)}>{Object.entries(PRESETS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}</select>
        <p className="muted">{PRESETS[comp.preset].hint}</p>
        <FramePreview comp={comp} source={source} time={time} mediaUrl={mediaUrl} headline={c.headline.enabled ? c.headline.text : ""} />
        {comp.mode !== "landscape" && (<>
          <div className="seg" role="group" aria-label="Background">{(["blur", "fill", "black"] as const).map((m) => <button key={m} aria-pressed={comp.mode === m} onClick={() => setComp({ mode: m, preset: "custom" })}>{m === "blur" ? "Blurred copy" : m === "fill" ? "Crop to fill" : "Black"}</button>)}</div>
          {comp.mode !== "fill" && <Range label="Video size" v={comp.fgScale} min={0.6} max={1.8} step={0.02} fmt={(v) => `${Math.round(v * 100)}%`} on={(v) => setComp({ fgScale: v })} />}
          <Range label="Vertical position" v={comp.fgOffsetY} min={-600} max={600} step={10} fmt={(v) => `${v > 0 ? "+" : ""}${v}px`} on={(v) => setComp({ fgOffsetY: v })} />
          {comp.mode === "blur" && <>
            <Range label="Background blur" v={comp.bgBlur} min={4} max={60} step={1} fmt={(v) => `${v}`} on={(v) => setComp({ bgBlur: v })} />
            <Range label="Background darkness" v={comp.bgDarken} min={0} max={0.8} step={0.05} fmt={(v) => `${Math.round(v * 100)}%`} on={(v) => setComp({ bgDarken: v })} />
          </>}
          {comp.mode !== "black" && <Range label="Background zoom" v={comp.bgZoom} min={1} max={2} step={0.05} fmt={(v) => `${Math.round(v * 100)}%`} on={(v) => setComp({ bgZoom: v })} />}
          <div className="grid2"><Range label="Safe area top" v={comp.safeTop} min={0} max={400} step={10} fmt={(v) => `${v}px`} on={(v) => setComp({ safeTop: v })} /><Range label="Safe area bottom" v={comp.safeBottom} min={0} max={500} step={10} fmt={(v) => `${v}px`} on={(v) => setComp({ safeBottom: v })} /></div>
        </>)}
      </div>

      <div className="insp-sec">
        <label className="switch"><input type="checkbox" checked={c.removeSilence} disabled={!hasSilence} onChange={(e) => update({ ...c, removeSilence: e.target.checked }, true)} />Remove silences</label>
        {!hasSilence && <p className="muted">Analyse the audio first.</p>}
      </div>

      <div className="insp-sec">
        <label className="switch"><input type="checkbox" checked={c.headline.enabled} onChange={(e) => update({ ...c, headline: { ...c.headline, enabled: e.target.checked } }, true)} />Headline</label>
        {c.headline.enabled && (<>
          <textarea className="input" rows={3} maxLength={300} value={c.headline.text} placeholder="HE ALREADY HAD SOMEONE DOING HIS WEBSITE... I STILL BOOKED THE MEETING." onChange={(e) => update({ ...c, headline: { ...c.headline, text: e.target.value } })} />
          <div className="grid2">
            <label className="field"><span>Font</span><select className="input" value={c.headline.font} onChange={(e) => update({ ...c, headline: { ...c.headline, font: e.target.value } })}><option value="Anton">Anton (condensed bold)</option><option value="Inter">Inter</option></select></label>
            <label className="field"><span>Colour</span><input className="input" type="color" value={c.headline.color.slice(0, 7)} onChange={(e) => update({ ...c, headline: { ...c.headline, color: e.target.value } })} /></label>
          </div>
          <Range label="Size" v={c.headline.size} min={36} max={140} step={2} fmt={(v) => `${v}px`} on={(v) => update({ ...c, headline: { ...c.headline, size: v } })} />
          <Range label="Position from top" v={c.headline.y} min={40} max={comp.height - 200} step={10} fmt={(v) => `${v}px`} on={(v) => update({ ...c, headline: { ...c.headline, y: v } })} />
          <Range label="Outline" v={c.headline.outlineWidth} min={0} max={14} step={1} fmt={(v) => `${v}px`} on={(v) => update({ ...c, headline: { ...c.headline, outlineWidth: v } })} />
          <div className="row"><label className="switch"><input type="checkbox" checked={c.headline.box} onChange={(e) => update({ ...c, headline: { ...c.headline, box: e.target.checked } })} />Background panel</label>
            <div className="seg" role="group" aria-label="Alignment"><button aria-pressed={c.headline.align === "center"} onClick={() => update({ ...c, headline: { ...c.headline, align: "center" } })}>Centre</button><button aria-pressed={c.headline.align === "left"} onClick={() => update({ ...c, headline: { ...c.headline, align: "left" } })}>Left</button></div></div>
          <Range label="On screen for" v={c.headline.durationSec} min={0} max={30} step={1} fmt={(v) => (v === 0 ? "whole clip" : `${v}s`)} on={(v) => update({ ...c, headline: { ...c.headline, durationSec: v } })} />
        </>)}
      </div>

      <div className="insp-sec">
        <div className="seg" role="group" aria-label="Captions"><button aria-pressed={!c.captions} onClick={() => update({ ...c, captions: false }, true)}>Captions off</button><button aria-pressed={c.captions} disabled={!hasTranscript} onClick={() => update({ ...c, captions: true }, true)}>Captions on</button></div>
        {!hasTranscript && <p className="muted">Captions need a transcript. Transcribe this video first.</p>}
        {c.captions && (<>
          <div className="grid2">
            <label className="field"><span>Position</span><select className="input" value={c.captionStyle.position} onChange={(e) => update({ ...c, captionStyle: { ...c.captionStyle, position: e.target.value as "bottom" } })}><option value="bottom">Bottom</option><option value="middle">Middle</option><option value="top">Top</option></select></label>
            <label className="field"><span>Colour</span><input className="input" type="color" value={c.captionStyle.color.slice(0, 7)} onChange={(e) => update({ ...c, captionStyle: { ...c.captionStyle, color: e.target.value } })} /></label>
          </div>
          <Range label="Size" v={c.captionStyle.size} min={32} max={120} step={2} fmt={(v) => `${v}px`} on={(v) => update({ ...c, captionStyle: { ...c.captionStyle, size: v } })} />
          <label className="switch"><input type="checkbox" checked={c.captionStyle.box} onChange={(e) => update({ ...c, captionStyle: { ...c.captionStyle, box: e.target.checked } })} />Background box</label>
          <button className="btn ghost" onClick={onSrt}><Icon name="text" />Save .srt subtitles</button>
        </>)}
      </div>

      <div className="insp-actions">
        <button className="btn" onClick={onPreview}><Icon name="play" />Play clip</button>
        <button className="btn primary" onClick={onExport}><Icon name="export" />Export</button>
        <button className="btn ghost icon" aria-label="Delete clip" title="Delete clip" onClick={() => { if (confirm(`Delete "${c.name}"? Exported files are kept.`)) onDelete(); }}><Icon name="trash" /></button>
      </div>
      {c.lastOutput && <p className="muted insp-out">Last export: {c.lastOutput.split(/[\\/]/).pop()}</p>}
    </div>
  );
}

function Range({ label, v, min, max, step, fmt, on }: { label: string; v: number; min: number; max: number; step: number; fmt: (v: number) => string; on: (v: number) => void }) {
  return <label className="slider"><span>{label}</span><output className="num">{fmt(v)}</output><input type="range" min={min} max={max} step={step} value={v} onChange={(e) => on(Number(e.target.value))} /></label>;
}

/** Live framing preview using the same geometry as compositionFilter(). */
function FramePreview({ comp, source, time, mediaUrl, headline }: { comp: Composition; source: SourceMedia; time: number; mediaUrl: string; headline: string }) {
  const bg = useRef<HTMLVideoElement>(null), fg = useRef<HTMLVideoElement>(null);
  useEffect(() => { for (const v of [bg.current, fg.current]) if (v && Math.abs(v.currentTime - time) > 0.25) v.currentTime = time; }, [time]);
  const vw = source.info.video?.width ?? 1920, vh = source.info.video?.height ?? 1080;
  const boxW = comp.width >= comp.height ? 288 : 162, k = boxW / comp.width, boxH = comp.height * k;
  const portrait = vh > vw;
  const fgW = comp.mode === "landscape" ? Math.min(comp.width, (comp.height * vw) / vh) * k : portrait ? ((comp.height * comp.fgScale * vw) / vh) * k : comp.width * comp.fgScale * k;
  const fgH = (fgW * vh) / vw;
  const style = { width: fgW, height: fgH, left: (boxW - fgW) / 2, top: (boxH - fgH) / 2 + comp.fgOffsetY * k };
  return (
    <div className="frame" style={{ width: boxW, height: boxH }} aria-label="Framing preview">
      {comp.mode === "blur" && <video ref={bg} src={mediaUrl} muted className="frame-bg" style={{ filter: `blur(${comp.bgBlur * k * 2.2}px) brightness(${1 - comp.bgDarken})`, transform: `scale(${comp.bgZoom * 1.1})` }} />}
      {comp.mode === "fill"
        ? <video ref={fg} src={mediaUrl} muted className="frame-fill" style={{ transform: `scale(${comp.bgZoom}) translateY(${comp.fgOffsetY * k}px)` }} />
        : <video ref={fg} src={mediaUrl} muted className="frame-fg" style={style} />}
      {comp.mode !== "landscape" && <><i className="safe" style={{ top: 0, height: comp.safeTop * k }} /><i className="safe" style={{ bottom: 0, height: comp.safeBottom * k }} /></>}
      {headline && <span className="frame-head">{headline}</span>}
      <span className="frame-tag">Preview · export is rendered by FFmpeg</span>
    </div>
  );
}
