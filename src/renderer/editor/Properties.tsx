// Right-hand properties for the selected clip, in tabs. Each slider row has a number field
// and a reset, like the property panels creators are used to. Edits are debounced, saved
// in the project and undoable.
import { useEffect, useRef, useState } from "react";
import type { Clip, Composition, PresetId } from "../../shared/types";
import { api, clock } from "../lib";
import { Icon } from "../ui/icons";
import type { EditorCtx } from "./Editor";

export const PRESET_INFO: Record<PresetId, { label: string; comp: Partial<Composition>; hint: string }> = {
  "blurred-portrait": { label: "Blurred Portrait", hint: "Sharp video over a blurred copy of itself.", comp: { width: 1080, height: 1920, mode: "blur", fgScale: 1, fgOffsetY: 0, bgBlur: 20, bgDarken: 0.25, bgZoom: 1 } },
  "fullscreen-vertical": { label: "Full-screen vertical", hint: "Crops the video to fill 9:16.", comp: { width: 1080, height: 1920, mode: "fill", fgOffsetY: 0, bgZoom: 1 } },
  "clean-landscape": { label: "Clean landscape", hint: "Keeps the original 16:9 shape.", comp: { width: 1920, height: 1080, mode: "landscape" } },
  "hook-clip": { label: "Hook clip", hint: "Blurred portrait with the video lowered for a headline.", comp: { width: 1080, height: 1920, mode: "blur", fgScale: 1, fgOffsetY: 120, bgBlur: 22, bgDarken: 0.35, bgZoom: 1.05 } },
  "custom": { label: "Custom", hint: "Your own settings.", comp: {} },
};
type Tab = "video" | "text" | "captions" | "audio";

export function Properties({ ctx }: { ctx: EditorCtx }) {
  const { p } = ctx;
  const clip = p.clips.find((c) => c.id === ctx.clipId);
  const src = p.sources.find((s) => s.id === (clip?.sourceId ?? ctx.sourceId));
  const [tab, setTab] = useState<Tab>("video");
  const [c, setC] = useState<Clip | undefined>(clip);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const base = useRef<Clip[] | null>(null);
  useEffect(() => { setC(clip); }, [clip]);

  if (!clip || !c || !src) {
    return (
      <aside className="props" aria-label="Properties">
        <div className="props-tabs"><span className="props-title">Properties</span></div>
        <div className="props-body">
          <div className="empty"><h3>Nothing selected</h3><p>Select a clip on the timeline to edit its format, headline, captions and audio.</p></div>
          {src && <dl className="facts"><dt>Source</dt><dd>{src.path.split(/[\\/]/).pop()}</dd><dt>Length</dt><dd className="num">{clock(src.info.durationSec)}</dd><dt>Video</dt><dd className="num">{src.info.video?.width}×{src.info.video?.height}, {src.info.video?.fps} fps, {src.info.video?.codec}</dd><dt>Audio</dt><dd>{src.info.audioTracks.map((a) => `${a.codec} ${a.channels}ch`).join(", ") || "none"}</dd></dl>}
        </div>
      </aside>
    );
  }
  // debounced save; one undo step per burst of edits
  const update = (next: Clip, immediate = false) => {
    if (!base.current) base.current = structuredClone(p.clips);
    setC(next);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      const before = base.current!; base.current = null;
      void ctx.commitClipsFrom(before, p.clips.map((x) => (x.id === next.id ? next : x)), "clip settings");
    }, immediate ? 0 : 350);
  };
  const comp = c.composition;
  const setComp = (patch: Partial<Composition>) => update({ ...c, composition: { ...comp, ...patch, preset: comp.preset === "custom" ? "custom" : (patch.preset ?? comp.preset) } });
  const applyPreset = (id: PresetId) => {
    const next: Clip = { ...c, composition: { ...comp, ...PRESET_INFO[id].comp, preset: id } };
    if (id === "hook-clip") next.headline = { ...c.headline, enabled: true };
    update(next, true);
  };
  const hasTranscript = !!src.analysis.transcript, hasSilence = !!src.analysis.silence;
  return (
    <aside className="props" aria-label="Properties">
      <div className="props-tabs" role="tablist">
        {(["video", "text", "captions", "audio"] as Tab[]).map((t) => <button key={t} role="tab" aria-selected={tab === t} onClick={() => setTab(t)}>{t[0]!.toUpperCase() + t.slice(1)}</button>)}
      </div>
      <div className="props-body insp">
        <div className="insp-sec">
          <input className="title-input" value={c.name} aria-label="Clip name" onChange={(e) => update({ ...c, name: e.target.value })} />
          <div className="grid2">
            <label className="field"><span>Start</span><div className="row nowrap"><input className="input num" type="number" step={0.1} value={Number(c.start.toFixed(2))} onChange={(e) => update({ ...c, start: Number(e.target.value) })} /><button className="btn icon" title="Set to playhead" aria-label="Set start to playhead" onClick={() => update({ ...c, start: Math.min(ctx.time, c.end - 0.5) }, true)}><Icon name="inmark" /></button></div></label>
            <label className="field"><span>End</span><div className="row nowrap"><input className="input num" type="number" step={0.1} value={Number(c.end.toFixed(2))} onChange={(e) => update({ ...c, end: Number(e.target.value) })} /><button className="btn icon" title="Set to playhead" aria-label="Set end to playhead" onClick={() => update({ ...c, end: Math.max(ctx.time, c.start + 0.5) }, true)}><Icon name="outmark" /></button></div></label>
          </div>
          <p className="muted num">{(c.end - c.start).toFixed(1)}s · {clock(c.start, true)} → {clock(c.end, true)}</p>
        </div>

        {tab === "video" && (
          <div className="insp-sec">
            <label className="field"><span>Format</span><select className="input" value={comp.preset} onChange={(e) => applyPreset(e.target.value as PresetId)}>{Object.entries(PRESET_INFO).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}</select></label>
            <p className="muted">{PRESET_INFO[comp.preset].hint}</p>
            {comp.mode !== "landscape" && (<>
              <div className="field"><span>Background</span><div className="seg" role="group" aria-label="Background">{(["blur", "fill", "black"] as const).map((m) => <button key={m} aria-pressed={comp.mode === m} onClick={() => setComp({ mode: m, preset: "custom" })}>{m === "blur" ? "Blurred copy" : m === "fill" ? "Crop to fill" : "Black"}</button>)}</div></div>
              {comp.mode !== "fill" && <Prop label="Scale" v={comp.fgScale} def={1} min={0.6} max={1.8} step={0.01} show={(v) => Math.round(v * 100)} unit="%" parse={(x) => x / 100} on={(v) => setComp({ fgScale: v })} />}
              <Prop label="Position Y" v={comp.fgOffsetY} def={0} min={-600} max={600} step={10} unit="px" on={(v) => setComp({ fgOffsetY: v })} />
              {comp.mode === "blur" && <>
                <Prop label="Blur" v={comp.bgBlur} def={20} min={4} max={60} step={1} on={(v) => setComp({ bgBlur: v })} />
                <Prop label="Darken" v={comp.bgDarken} def={0.25} min={0} max={0.8} step={0.05} show={(v) => Math.round(v * 100)} unit="%" parse={(x) => x / 100} on={(v) => setComp({ bgDarken: v })} />
              </>}
              {comp.mode !== "black" && <Prop label="Background zoom" v={comp.bgZoom} def={1} min={1} max={2} step={0.05} show={(v) => Math.round(v * 100)} unit="%" parse={(x) => x / 100} on={(v) => setComp({ bgZoom: v })} />}
              <Prop label="Safe area top" v={comp.safeTop} def={160} min={0} max={400} step={10} unit="px" on={(v) => setComp({ safeTop: v })} />
              <Prop label="Safe area bottom" v={comp.safeBottom} def={260} min={0} max={500} step={10} unit="px" on={(v) => setComp({ safeBottom: v })} />
            </>)}
          </div>
        )}

        {tab === "text" && (
          <div className="insp-sec">
            <label className="switch"><input type="checkbox" checked={c.headline.enabled} onChange={(e) => update({ ...c, headline: { ...c.headline, enabled: e.target.checked } }, true)} />Headline</label>
            <textarea className="input" rows={3} maxLength={300} value={c.headline.text} disabled={!c.headline.enabled} placeholder="HE ALREADY HAD SOMEONE DOING HIS WEBSITE... I STILL BOOKED THE MEETING." onChange={(e) => update({ ...c, headline: { ...c.headline, text: e.target.value } })} aria-label="Headline text" />
            {c.headline.enabled && (<>
              <div className="grid2">
                <label className="field"><span>Font</span><select className="input" value={c.headline.font} onChange={(e) => update({ ...c, headline: { ...c.headline, font: e.target.value } })}><option value="Anton">Anton</option><option value="Inter">Inter</option></select></label>
                <label className="field"><span>Colour</span><input className="input" type="color" value={c.headline.color.slice(0, 7)} onChange={(e) => update({ ...c, headline: { ...c.headline, color: e.target.value } })} /></label>
              </div>
              <Prop label="Size" v={c.headline.size} def={78} min={36} max={140} step={2} unit="px" on={(v) => update({ ...c, headline: { ...c.headline, size: v } })} />
              <Prop label="Position Y" v={c.headline.y} def={260} min={40} max={comp.height - 200} step={10} unit="px" on={(v) => update({ ...c, headline: { ...c.headline, y: v } })} />
              <Prop label="Outline" v={c.headline.outlineWidth} def={6} min={0} max={14} step={1} unit="px" on={(v) => update({ ...c, headline: { ...c.headline, outlineWidth: v } })} />
              <Prop label="On screen for" v={c.headline.durationSec} def={0} min={0} max={30} step={1} unit="s" note="0 = whole clip" on={(v) => update({ ...c, headline: { ...c.headline, durationSec: v } })} />
              <div className="row wrap"><label className="switch"><input type="checkbox" checked={c.headline.box} onChange={(e) => update({ ...c, headline: { ...c.headline, box: e.target.checked } })} />Background panel</label>
                <div className="seg" role="group" aria-label="Alignment"><button aria-pressed={c.headline.align === "center"} onClick={() => update({ ...c, headline: { ...c.headline, align: "center" } })}>Centre</button><button aria-pressed={c.headline.align === "left"} onClick={() => update({ ...c, headline: { ...c.headline, align: "left" } })}>Left</button></div></div>
            </>)}
          </div>
        )}

        {tab === "captions" && (
          <div className="insp-sec">
            <div className="seg" role="group" aria-label="Captions"><button aria-pressed={!c.captions} onClick={() => update({ ...c, captions: false }, true)}>Captions off</button><button aria-pressed={c.captions} disabled={!hasTranscript} onClick={() => update({ ...c, captions: true }, true)}>Captions on</button></div>
            {!hasTranscript && <p className="muted">Captions come from a transcript. Transcribe this video in the Captions panel first.</p>}
            {c.captions && (<>
              <div className="grid2">
                <label className="field"><span>Position</span><select className="input" value={c.captionStyle.position} onChange={(e) => update({ ...c, captionStyle: { ...c.captionStyle, position: e.target.value as "bottom" } })}><option value="bottom">Bottom</option><option value="middle">Middle</option><option value="top">Top</option></select></label>
                <label className="field"><span>Colour</span><input className="input" type="color" value={c.captionStyle.color.slice(0, 7)} onChange={(e) => update({ ...c, captionStyle: { ...c.captionStyle, color: e.target.value } })} /></label>
              </div>
              <Prop label="Size" v={c.captionStyle.size} def={64} min={32} max={120} step={2} unit="px" on={(v) => update({ ...c, captionStyle: { ...c.captionStyle, size: v } })} />
              <label className="switch"><input type="checkbox" checked={c.captionStyle.box} onChange={(e) => update({ ...c, captionStyle: { ...c.captionStyle, box: e.target.checked } })} />Background box</label>
              <button className="btn ghost" onClick={() => ctx.act(async () => { const f = await api().clips.exportSrt(p.id, c.id); await api().exports.reveal(f); })}><Icon name="text" />Save .srt subtitles</button>
            </>)}
          </div>
        )}

        {tab === "audio" && (
          <div className="insp-sec">
            <label className="switch"><input type="checkbox" checked={c.removeSilence} disabled={!hasSilence} onChange={(e) => update({ ...c, removeSilence: e.target.checked }, true)} />Remove silences</label>
            <p className="muted">{hasSilence ? "Uses the settings in the Audio panel. Pauses are shortened, never cut mid-word." : "Analyse the audio first (Audio panel)."}</p>
          </div>
        )}
      </div>
      <div className="props-foot">
        <button className="btn" onClick={() => ctx.previewRange(c.start, c.end)}><Icon name="play" />Play clip</button>
        <button className="btn primary" onClick={() => ctx.act(async () => { const r = await api().exports.queue(p.id, [c.id]); if (r.skipped) throw new Error("This clip hasn't changed since its last export."); })}><Icon name="export" />Export clip</button>
      </div>
      {c.lastOutput && <p className="muted props-out">Last export: {c.lastOutput.split(/[\\/]/).pop()}</p>}
    </aside>
  );
}

/** A property row: label, slider, number field (in display units) and reset. */
function Prop({ label, v, def, min, max, step, on, show = (x) => x, parse = (x) => x, unit = "", note }: { label: string; v: number; def: number; min: number; max: number; step: number; on: (v: number) => void;
  show?: (v: number) => number; parse?: (x: number) => number; unit?: string; note?: string }) {
  return (
    <div className="prop">
      <div className="prop-top"><span>{label}{note && <span className="dim"> · {note}</span>}</span>
        {v !== def && <button className="linkish" onClick={() => on(def)} title={`Reset to ${show(def)}${unit}`}>Reset</button>}</div>
      <div className="prop-row">
        <input type="range" min={min} max={max} step={step} value={v} onChange={(e) => on(Number(e.target.value))} aria-label={label} />
        <span className="prop-num"><input className="input num" type="number" value={Math.round(show(v) * 100) / 100} onChange={(e) => { const x = parse(Number(e.target.value)); if (Number.isFinite(x)) on(Math.max(min, Math.min(max, x))); }} aria-label={`${label} value`} />{unit && <i>{unit}</i>}</span>
      </div>
    </div>
  );
}
