// Turning a clip (source range + edit decisions + composition) into an FFmpeg command.
// Everything visible in the preview is rendered here by FFmpeg, so exports match.
import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { CaptionStyle, Clip, Composition, Headline, Interval, MediaInfo, PresetId, TranscriptSegment } from "../shared/types";
import { keepRanges } from "./audio";
import { defaultTools, run, type RunOptions, type Tools } from "./ffmpeg";
import type { SilenceSettings } from "../shared/types";

export const PRESETS: Record<PresetId, Composition> = {
  "blurred-portrait": { preset: "blurred-portrait", width: 1080, height: 1920, mode: "blur", fgScale: 1, fgOffsetY: 0, bgBlur: 20, bgDarken: 0.25, bgZoom: 1.0, safeTop: 160, safeBottom: 260 },
  "fullscreen-vertical": { preset: "fullscreen-vertical", width: 1080, height: 1920, mode: "fill", fgScale: 1, fgOffsetY: 0, bgBlur: 0, bgDarken: 0, bgZoom: 1, safeTop: 160, safeBottom: 260 },
  "clean-landscape": { preset: "clean-landscape", width: 1920, height: 1080, mode: "landscape", fgScale: 1, fgOffsetY: 0, bgBlur: 0, bgDarken: 0, bgZoom: 1, safeTop: 60, safeBottom: 80 },
  "hook-clip": { preset: "hook-clip", width: 1080, height: 1920, mode: "blur", fgScale: 1, fgOffsetY: 120, bgBlur: 22, bgDarken: 0.35, bgZoom: 1.05, safeTop: 160, safeBottom: 260 },
  "custom": { preset: "custom", width: 1080, height: 1920, mode: "blur", fgScale: 1, fgOffsetY: 0, bgBlur: 20, bgDarken: 0.25, bgZoom: 1, safeTop: 160, safeBottom: 260 },
};

export const DEFAULT_HEADLINE: Headline = { enabled: false, text: "", font: "Anton", size: 78, color: "#FFFFFF", outline: "#000000", outlineWidth: 6, box: false, boxColor: "#000000AA", align: "center", y: 260, durationSec: 0 };
export const DEFAULT_CAPTIONS: CaptionStyle = { font: "Inter", size: 64, color: "#FFFFFF", outline: "#000000", outlineWidth: 4, shadow: 0, position: "bottom", box: false };

const even = (n: number) => Math.max(2, Math.round(n / 2) * 2);

/** The video filter chain for a composition. Input label [v0], output label [vout]. */
export function compositionFilter(c: Composition, src: { width: number; height: number }): string {
  const W = even(c.width), H = even(c.height);
  if (c.mode === "landscape") {
    return `[v0]scale=${W}:${H}:force_original_aspect_ratio=decrease,pad=${W}:${H}:(ow-iw)/2:(oh-ih)/2:color=black,setsar=1[vout]`;
  }
  if (c.mode === "fill") {
    const z = Math.max(1, c.bgZoom);
    return `[v0]scale=${even(W * z)}:${even(H * z)}:force_original_aspect_ratio=increase,crop=${W}:${H}:(iw-${W})/2:(ih-${H})/2+${Math.round(c.fgOffsetY)},setsar=1[vout]`;
  }
  // foreground: fit the canvas width (or height, for tall sources), times fgScale
  const portraitSource = src.height > src.width;
  const fg = portraitSource
    ? `scale=-2:${even(H * c.fgScale)}`
    : `scale=${even(W * c.fgScale)}:-2`;
  const y = `(${H}-h)/2+${Math.round(c.fgOffsetY)}`;
  if (c.mode === "black") {
    return `[v0]${fg},setsar=1[fg];color=c=black:s=${W}x${H}[bg];[bg][fg]overlay=(${W}-w)/2:${y}:shortest=1,setsar=1[vout]`;
  }
  // blurred duplicate: blur at quarter resolution (fast, and smoother), then scale up to cover
  const z = Math.max(1, c.bgZoom), bw = even((W * z) / 4), bh = even((H * z) / 4);
  const r = Math.max(1, Math.round(c.bgBlur / 4));
  const d = Math.min(0.9, Math.max(0, c.bgDarken));
  const darken = d > 0 ? `,colorchannelmixer=rr=${1 - d}:gg=${1 - d}:bb=${1 - d}` : "";
  return [
    `[v0]split=2[bgsrc][fgsrc]`,
    `[bgsrc]scale=${bw}:${bh}:force_original_aspect_ratio=increase,crop=${even(W / 4)}:${even(H / 4)},boxblur=${r}:2${darken},scale=${W}:${H}:flags=bicubic,setsar=1[bg]`,
    `[fgsrc]${fg},setsar=1[fg]`,
    `[bg][fg]overlay=(${W}-w)/2:${y}[vout]`,
  ].join(";");
}

/** Map a time in the source to the output timeline after silence removal (or null if cut). */
export function mapTime(t: number, ranges: Interval[]): number | null {
  let acc = 0;
  for (const r of ranges) {
    if (t < r.start) return null;
    if (t <= r.end) return acc + (t - r.start);
    acc += r.end - r.start;
  }
  return null;
}

const assColor = (hex: string) => {
  const h = hex.replace("#", "").padEnd(8, "F");
  const [r, g, b, a] = [h.slice(0, 2), h.slice(2, 4), h.slice(4, 6), h.slice(6, 8)];
  const alpha = (255 - parseInt(a!, 16)).toString(16).padStart(2, "0").toUpperCase();
  return `&H${alpha}${b}${g}${r}`.toUpperCase();
};
const assTime = (s: number) => {
  const cs = Math.round(s * 100), h = Math.floor(cs / 360000), m = Math.floor((cs % 360000) / 6000), sec = Math.floor((cs % 6000) / 100), c = cs % 100;
  return `${h}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}.${String(c).padStart(2, "0")}`;
};

export interface CaptionLine { start: number; end: number; text: string }

/** Group transcript words in the clip into short caption lines on the OUTPUT timeline. */
export function captionLines(segs: TranscriptSegment[], ranges: Interval[], maxChars = 28, maxSec = 2.6): CaptionLine[] {
  const words = segs.flatMap((s) => s.words?.length ? s.words : [{ start: s.start, end: s.end, text: s.text }]);
  const lines: CaptionLine[] = [];
  let cur: CaptionLine | null = null;
  for (const w of words) {
    const a = mapTime(w.start, ranges), b = mapTime(w.end, ranges) ?? (a !== null ? a + (w.end - w.start) : null);
    if (a === null || b === null) continue;
    if (cur && (cur.text.length + w.text.length + 1 > maxChars || b - cur.start > maxSec || a - cur.end > 0.6)) { lines.push(cur); cur = null; }
    cur = cur ? { start: cur.start, end: b, text: `${cur.text} ${w.text}` } : { start: a, end: b, text: w.text };
  }
  if (cur) lines.push(cur);
  return lines.map((l) => ({ ...l, end: Math.max(l.end, l.start + 0.4) }));
}

export function assFile(lines: CaptionLine[], s: CaptionStyle, c: Composition): string {
  const align = s.position === "top" ? 8 : s.position === "middle" ? 5 : 2;
  const marginV = s.position === "bottom" ? c.safeBottom : s.position === "top" ? c.safeTop : 0;
  const esc = (t: string) => t.replace(/\\/g, "\\\\").replace(/[{}]/g, "").replace(/\n/g, "\\N");
  return `[Script Info]
ScriptType: v4.00+
PlayResX: ${c.width}
PlayResY: ${c.height}
WrapStyle: 0
ScaledBorderAndShadow: yes

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Default,${s.font},${s.size},${assColor(s.color)},${assColor(s.color)},${assColor(s.outline)},&H80000000,1,0,0,0,100,100,0,0,${s.box ? 3 : 1},${s.outlineWidth},${s.shadow},${align},60,60,${marginV},1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
${lines.map((l) => `Dialogue: 0,${assTime(l.start)},${assTime(l.end)},Default,,0,0,0,,${esc(l.text)}`).join("\n")}
`;
}

/** Escape a path for use inside an FFmpeg filter argument (handles Windows drive colons). */
export function filterPath(p: string): string {
  return p.replace(/\\/g, "/").replace(/:/g, "\\:").replace(/'/g, "\\'");
}

export interface RenderInputs {
  clip: Clip;
  info: MediaInfo;
  silences?: Interval[];
  silenceSettings?: SilenceSettings;
  transcript?: TranscriptSegment[];
  fontsDir: string;           // folder with the bundled OFL fonts (Anton, Inter)
  workDir: string;            // temp folder for this render (ass, headline text)
  output: string;
  quality?: { crf: number; preset: string; audioKbps: number; normalize: boolean; threads?: number };
}

/** Hash of everything that affects the output: unchanged clips aren't re-rendered. */
export function renderHash(i: Omit<RenderInputs, "output" | "workDir" | "fontsDir">): string {
  const { clip } = i;
  return createHash("sha256").update(JSON.stringify({
    src: i.info.path, size: i.info.sizeBytes, s: clip.start, e: clip.end, rs: clip.removeSilence, cap: clip.captions,
    comp: clip.composition, head: clip.headline, cs: clip.captionStyle, sil: clip.removeSilence ? [i.silences, i.silenceSettings] : null,
    tr: clip.captions ? i.transcript?.filter((s) => s.end > clip.start && s.start < clip.end) : null, q: i.quality,
  })).digest("hex").slice(0, 16);
}

export async function buildRender(i: RenderInputs): Promise<{ args: string[]; durationSec: number; ranges: Interval[] }> {
  const { clip, info } = i;
  const q = i.quality ?? { crf: 20, preset: "veryfast", audioKbps: 160, normalize: true };
  if (!info.video) throw new Error("This source has no video track.");
  if (!(clip.end > clip.start)) throw new Error("The clip's end must be after its start.");
  const within = { start: Math.max(0, clip.start), end: Math.min(info.durationSec, clip.end) };
  const ranges = clip.removeSilence && i.silences && i.silenceSettings ? keepRanges(info.durationSec, i.silences, i.silenceSettings, within) : [within];
  if (!ranges.length) throw new Error("Silence removal left nothing to render in this clip.");
  const hasAudio = info.audioTracks.length > 0;
  await mkdir(i.workDir, { recursive: true });

  // 1) cut: trim each kept range (relative to the input seek point) and concatenate
  const seek = ranges[0]!.start, until = ranges[ranges.length - 1]!.end;
  const parts: string[] = [];
  ranges.forEach((r, k) => {
    const a = (r.start - seek).toFixed(3), b = (r.end - seek).toFixed(3), len = r.end - r.start;
    parts.push(`[0:v]trim=start=${a}:end=${b},setpts=PTS-STARTPTS[v${k}c]`);
    if (hasAudio) {
      const f = Math.min(0.02, len / 4).toFixed(3);   // tiny fades: no clicks at cut points
      parts.push(`[0:a:0]atrim=start=${a}:end=${b},asetpts=PTS-STARTPTS,afade=t=in:d=${f},afade=t=out:st=${(len - Number(f)).toFixed(3)}:d=${f}[a${k}c]`);
    }
  });
  const n = ranges.length;
  parts.push(ranges.map((_, k) => `[v${k}c]${hasAudio ? `[a${k}c]` : ""}`).join("") + `concat=n=${n}:v=1:a=${hasAudio ? 1 : 0}[v0]${hasAudio ? "[a0]" : ""}`);

  // 2) compose
  parts.push(compositionFilter(clip.composition, info.video));
  let last = "vout";

  // 3) captions (off by default; only from real transcript words)
  if (clip.captions) {
    if (!i.transcript?.length) throw new Error("Captions are on, but this source has no transcript yet. Run transcription first.");
    const lines = captionLines(i.transcript, ranges);
    const ass = join(i.workDir, "captions.ass");
    await writeFile(ass, assFile(lines, clip.captionStyle, clip.composition), "utf8");
    parts.push(`[${last}]subtitles=filename='${filterPath(ass)}':fontsdir='${filterPath(i.fontsDir)}'[vcap]`);
    last = "vcap";
  }

  // 4) headline (independent of captions)
  const h = clip.headline;
  if (h.enabled && h.text.trim()) {
    const txt = join(i.workDir, "headline.txt");
    await writeFile(txt, h.text.trim(), "utf8");
    const font = join(i.fontsDir, h.font === "Inter" ? "Inter.ttf" : "Anton-Regular.ttf");
    const x = h.align === "left" ? "80" : "(w-text_w)/2";
    const until_ = h.durationSec > 0 ? `:enable='lte(t,${h.durationSec})'` : "";
    const box = h.box ? `:box=1:boxcolor=${h.boxColor.replace("#", "0x")}:boxborderw=24` : "";
    parts.push(`[${last}]drawtext=fontfile='${filterPath(font)}':textfile='${filterPath(txt)}':fontsize=${h.size}:fontcolor=${h.color.replace("#", "0x")}:borderw=${h.outlineWidth}:bordercolor=${h.outline.replace("#", "0x")}:line_spacing=10:x=${x}:y=${Math.round(h.y)}${box}${until_}[vhead]`);
    last = "vhead";
  }
  parts.push(`[${last}]format=yuv420p[vfinal]`);
  if (hasAudio) parts.push(q.normalize ? `[a0]loudnorm=I=-14:TP=-1.5:LRA=11,aresample=48000[afinal]` : `[a0]aresample=48000[afinal]`);

  const durationSec = ranges.reduce((s, r) => s + r.end - r.start, 0);
  // threads > 0 caps encoder/filter threads: less memory and CPU on small machines
  const thr = q.threads && q.threads > 0 ? ["-threads", String(q.threads), "-filter_complex_threads", String(q.threads)] : [];
  const args = ["-hide_banner", "-y", "-nostats", ...thr, "-ss", seek.toFixed(3), "-to", until.toFixed(3), "-i", info.path,
    "-filter_complex", parts.join(";"), "-map", "[vfinal]", ...(hasAudio ? ["-map", "[afinal]"] : []),
    ...(q.threads && q.threads > 0 ? ["-threads", String(q.threads)] : []),
    "-c:v", "libx264", "-preset", q.preset, "-crf", String(q.crf), "-r", String(Math.min(60, Math.round(info.video.fps) || 30)),
    ...(hasAudio ? ["-c:a", "aac", "-b:a", `${q.audioKbps}k`] : []), "-movflags", "+faststart", "-progress", "pipe:1", i.output];
  return { args, durationSec, ranges };
}

export async function render(i: RenderInputs, opts: RunOptions = {}, tools: Tools = defaultTools): Promise<{ output: string; durationSec: number }> {
  const { args, durationSec } = await buildRender(i);
  await run(tools.ffmpeg, args, { ...opts, durationSec });
  return { output: i.output, durationSec };
}
