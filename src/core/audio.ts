// Audio analysis with FFmpeg, streamed (never loads the file in memory):
// - silencedetect -> silent intervals
// - astats per window -> loudness curve (dB) used by moment detection and the timeline
import type { Interval, SilenceSettings } from "../shared/types";
import { defaultTools, run, type RunOptions, type Tools } from "./ffmpeg";

export const DEFAULT_SILENCE: SilenceSettings = { thresholdDb: -35, minSilenceSec: 0.6, paddingSec: 0.15, maxPauseSec: 0.8, mode: "shorten" };

/** Parse silencedetect's stderr lines into intervals. An open silence at the end closes at `duration`. */
export function parseSilence(stderr: string, duration: number): Interval[] {
  const out: Interval[] = [];
  let open: number | null = null;
  for (const line of stderr.split(/\r?\n/)) {
    const s = line.match(/silence_start:\s*(-?[\d.]+)/);
    if (s) { open = Math.max(0, Number(s[1])); continue; }
    const e = line.match(/silence_end:\s*([\d.]+)/);
    if (e && open !== null) { out.push({ start: open, end: Math.min(duration, Number(e[1])) }); open = null; }
  }
  if (open !== null && duration > open) out.push({ start: open, end: duration });
  return out.filter((i) => i.end > i.start);
}

export async function detectSilence(input: string, duration: number, s: SilenceSettings, opts: RunOptions = {}, tools: Tools = defaultTools): Promise<Interval[]> {
  const { stderr } = await run(tools.ffmpeg, ["-hide_banner", "-nostats", "-i", input, "-vn", "-sn", "-dn", "-af", `silencedetect=noise=${s.thresholdDb}dB:d=${s.minSilenceSec}`, "-f", "null", "-progress", "pipe:1", "-"],
    { ...opts, durationSec: duration });
  return parseSilence(stderr, duration);
}

/** Per-window RMS level in dB (−90 for digital silence), one value per `stepSec`. */
export function parseLevels(stdout: string): number[] {
  const out: number[] = [];
  for (const m of stdout.matchAll(/lavfi\.astats\.Overall\.RMS_level=(-?inf|[-\d.]+)/g)) {
    const v = m[1] === "-inf" || m[1] === "inf" ? -90 : Number(m[1]);
    out.push(Number.isFinite(v) ? Math.max(-90, v) : -90);
  }
  return out;
}

export async function loudnessCurve(input: string, duration: number, stepSec = 0.5, opts: RunOptions = {}, tools: Tools = defaultTools): Promise<number[]> {
  const rate = 8000, n = Math.round(rate * stepSec);
  const { stdout } = await run(tools.ffmpeg, ["-hide_banner", "-nostats", "-i", input, "-vn", "-sn", "-dn",
    "-af", `aresample=${rate},asetnsamples=n=${n}:p=0,astats=metadata=1:reset=1,ametadata=print:key=lavfi.astats.Overall.RMS_level:file=-`,
    "-f", "null", "-"], { ...opts, durationSec: duration });
  return parseLevels(stdout);
}

/**
 * Turn detected silences into the ranges to KEEP.
 * - Pauses up to maxPauseSec are left alone (natural speech rhythm).
 * - Longer pauses are removed ("remove") or cut down to maxPauseSec ("shorten").
 * - paddingSec of the pause is kept on each side so word onsets and tails are never clipped.
 */
export function keepRanges(duration: number, silences: Interval[], s: SilenceSettings, within: Interval = { start: 0, end: duration }): Interval[] {
  const cuts: Interval[] = [];
  for (const sil of silences) {
    const a = Math.max(sil.start, within.start), b = Math.min(sil.end, within.end);
    const len = b - a;
    if (len <= s.maxPauseSec) continue;
    const leaveTotal = s.mode === "shorten" ? Math.max(s.maxPauseSec, 2 * s.paddingSec) : 2 * s.paddingSec;
    const cutStart = a + leaveTotal / 2, cutEnd = b - leaveTotal / 2;
    // pauses at the very start/end of the range: trim fully, keeping only the padding next to speech
    const cs = a <= within.start + 1e-6 ? within.start : cutStart;
    const ce = b >= within.end - 1e-6 ? within.end : cutEnd;
    if (ce - cs > 0.05) cuts.push({ start: cs, end: ce });
  }
  const keep: Interval[] = [];
  let t = within.start;
  for (const c of cuts.sort((x, y) => x.start - y.start)) {
    if (c.start > t) keep.push({ start: t, end: c.start });
    t = Math.max(t, c.end);
  }
  if (t < within.end) keep.push({ start: t, end: within.end });
  return keep.filter((k) => k.end - k.start >= 0.08);
}

export const totalLength = (ranges: Interval[]) => ranges.reduce((a, r) => a + (r.end - r.start), 0);
