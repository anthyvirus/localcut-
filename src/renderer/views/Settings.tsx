import { useEffect, useState } from "react";
import type { Settings } from "../../shared/api";
import type { Diagnostics } from "../../shared/types";
import { api } from "../lib";
import { Icon } from "../ui/icons";

type Diag = Diagnostics & { whisper: { ok: boolean; reason?: string } };

export function SettingsView() {
  const [s, setS] = useState<Settings | null>(null);
  const [d, setD] = useState<Diag | null>(null);
  const refresh = async () => { setD(null); setD(await api().app.diagnostics()); };
  useEffect(() => { void api().settings.get().then(setS); void refresh(); }, []);
  if (!s) return <div className="page"><div className="skel" style={{ height: 200 }} /></div>;
  const save = async (patch: Parameters<ReturnType<typeof api>["settings"]["set"]>[0]) => { setS(await api().settings.set(patch)); };
  const pick = async (kind: "ffmpeg" | "ffprobe" | "whisper" | "model", key: keyof Settings) => { const f = await api().settings.pickFile(kind); if (f) { await save({ [key]: f } as never); void refresh(); } };
  return (
    <div className="page narrow">
      <div className="page-head"><h1 className="h-page">Settings</h1></div>

      <section className="panel pad">
        <div className="row" style={{ justifyContent: "space-between" }}><h2 className="h-sec">FFmpeg</h2><button className="btn ghost" onClick={refresh}><Icon name="retry" />Check again</button></div>
        {d === null ? <div className="skel" style={{ height: 40, marginTop: 10 }} /> : d.ok
          ? <p className="note ok" style={{ marginTop: 10 }}>{d.ffmpeg}<br />Encoders: {Object.entries(d.encoders).filter(([, v]) => v).map(([k]) => k).join(", ")}</p>
          : <p className="note err" style={{ marginTop: 10 }}>{d.error ?? `Missing: ${d.missing.join(", ")}`}. LocalCut needs FFmpeg with libx264 and libass. See the README for install steps.</p>}
        <div className="grid2" style={{ marginTop: 12 }}>
          <label className="field"><span>FFmpeg path</span><div className="row"><input className="input" value={s.ffmpegPath} placeholder="ffmpeg (from PATH)" onChange={(e) => setS({ ...s, ffmpegPath: e.target.value })} onBlur={() => save({ ffmpegPath: s.ffmpegPath })} /><button className="btn" onClick={() => pick("ffmpeg", "ffmpegPath")}>Browse</button></div></label>
          <label className="field"><span>FFprobe path</span><div className="row"><input className="input" value={s.ffprobePath} placeholder="ffprobe (from PATH)" onChange={(e) => setS({ ...s, ffprobePath: e.target.value })} onBlur={() => save({ ffprobePath: s.ffprobePath })} /><button className="btn" onClick={() => pick("ffprobe", "ffprobePath")}>Browse</button></div></label>
        </div>
      </section>

      <section className="panel pad">
        <h2 className="h-sec">Exports</h2>
        <div className="grid2" style={{ marginTop: 12 }}>
          <label className="field"><span>Export folder</span><div className="row"><input className="input" readOnly value={s.exportDir} /><button className="btn" onClick={async () => { const dir = await api().settings.pickDir("export"); if (dir) await save({ exportDir: dir }); }}>Change</button></div></label>
          <label className="field"><span>Quality</span><select className="input" value={s.quality.crf} onChange={(e) => save({ quality: { ...s.quality, crf: Number(e.target.value) } })}>
            <option value={17}>High (larger files)</option><option value={20}>Balanced</option><option value={24}>Smaller files</option></select></label>
          <label className="field"><span>Encoding speed</span><select className="input" value={s.quality.preset} onChange={(e) => save({ quality: { ...s.quality, preset: e.target.value } })}>
            <option value="veryfast">Fast</option><option value="medium">Better compression (slower)</option></select></label>
          <label className="field"><span>Computer load while exporting</span><select className="input" value={s.quality.threads} onChange={(e) => save({ quality: { ...s.quality, threads: Number(e.target.value) } })}>
            <option value={0}>Use all cores (fastest)</option><option value={2}>Light: 2 threads (less memory)</option><option value={1}>Minimal: 1 thread</option></select></label>
          <label className="switch" style={{ alignSelf: "end" }}><input type="checkbox" checked={s.quality.normalize} onChange={(e) => save({ quality: { ...s.quality, normalize: e.target.checked } })} />Even out loudness (−14 LUFS)</label>
        </div>
      </section>

      <section className="panel pad">
        <h2 className="h-sec">Transcription (optional)</h2>
        <p className="muted" style={{ marginTop: 4 }}>Transcripts power captions and better clip suggestions. They run with whisper.cpp on this computer. You download whisper.cpp and one model file once; after that it works offline.</p>
        {d && <p className={`note ${d.whisper.ok ? "ok" : ""}`} style={{ marginTop: 10 }}>{d.whisper.ok ? "Ready to transcribe." : d.whisper.reason}</p>}
        <div className="grid2" style={{ marginTop: 12 }}>
          <label className="field"><span>whisper.cpp program (whisper-cli)</span><div className="row"><input className="input" readOnly value={s.whisperBinary} /><button className="btn" onClick={() => pick("whisper", "whisperBinary")}>Browse</button></div></label>
          <label className="field"><span>Model file (.bin)</span><div className="row"><input className="input" readOnly value={s.whisperModel} /><button className="btn" onClick={() => pick("model", "whisperModel")}>Browse</button></div><small>"base.en" or "small" is a good start. See the README for links.</small></label>
          <label className="field"><span>Language</span><select className="input" value={s.whisperLanguage} onChange={(e) => save({ whisperLanguage: e.target.value })}>
            <option value="">Detect automatically</option><option value="en">English</option><option value="es">Spanish</option><option value="fr">French</option><option value="de">German</option><option value="pt">Portuguese</option><option value="hi">Hindi</option><option value="fj">Fijian</option></select></label>
        </div>
      </section>

      <section className="panel pad">
        <h2 className="h-sec">Privacy</h2>
        <p className="muted" style={{ marginTop: 4 }}>Your videos, transcripts, projects and settings stay on this computer. LocalCut makes no network requests on its own. The only connections are ones you start: to OBS on this machine, or links you open yourself.</p>
      </section>
    </div>
  );
}
