// Running FFmpeg/FFprobe as child processes: never on the UI thread, always cancellable,
// with progress parsed from `-progress pipe:1` and stderr kept for diagnostics.
import { spawn } from "node:child_process";
import { statSync } from "node:fs";
import type { MediaInfo } from "../shared/types";

export interface Tools { ffmpeg: string; ffprobe: string }
export const defaultTools: Tools = { ffmpeg: process.env.LOCALCUT_FFMPEG || "ffmpeg", ffprobe: process.env.LOCALCUT_FFPROBE || "ffprobe" };

export class ToolError extends Error {
  constructor(message: string, public readonly stderrTail: string = "", public readonly code: number | null = null) { super(message); }
}

export interface RunOptions {
  signal?: AbortSignal;
  durationSec?: number;                       // for progress
  onProgress?: (fraction: number) => void;
  onStderrLine?: (line: string) => void;
}

/** Run a tool, collecting stdout and the tail of stderr. Rejects on non-zero exit or cancellation. */
export function run(bin: string, args: string[], opts: RunOptions = {}): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    if (opts.signal?.aborted) return reject(new ToolError("cancelled"));
    const child = spawn(bin, args, { windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "", stderr = "", partial = "";
    const onAbort = () => child.kill("SIGKILL");
    opts.signal?.addEventListener("abort", onAbort, { once: true });
    child.stdout.on("data", (d: Buffer) => {
      const s = d.toString();
      if (opts.onProgress && opts.durationSec) {
        for (const m of s.matchAll(/out_time_us=(\d+)/g)) opts.onProgress(Math.min(1, Number(m[1]) / 1e6 / opts.durationSec));
      }
      if (stdout.length < 50_000_000) stdout += s;      // bounded; ffprobe JSON is small
    });
    child.stderr.on("data", (d: Buffer) => {
      const s = partial + d.toString();
      const lines = s.split(/\r?\n/);
      partial = lines.pop() ?? "";
      for (const l of lines) opts.onStderrLine?.(l);
      stderr = (stderr + s).slice(-200_000);              // keep the tail only
    });
    child.on("error", (e: NodeJS.ErrnoException) => {
      opts.signal?.removeEventListener("abort", onAbort);
      reject(new ToolError(e.code === "ENOENT" ? `${bin} was not found. Install FFmpeg or set its path in Settings.` : e.message));
    });
    child.on("close", (code) => {
      opts.signal?.removeEventListener("abort", onAbort);
      if (opts.signal?.aborted) return reject(new ToolError("cancelled"));
      if (code === 0) resolve({ stdout, stderr });
      else reject(new ToolError(`${bin} exited with code ${code}`, stderr.split("\n").slice(-15).join("\n"), code));
    });
  });
}

export interface Diagnostics { ok: boolean; ffmpeg?: string; ffprobe?: string; missing: string[]; filters: Record<string, boolean>; encoders: Record<string, boolean>; error?: string }

const NEEDED_FILTERS = ["boxblur", "silencedetect", "astats", "ametadata", "subtitles", "drawtext", "loudnorm", "overlay", "scale", "crop"];
const ENCODERS = ["libx264", "h264_nvenc", "h264_qsv", "h264_amf", "h264_videotoolbox", "aac"];

export async function diagnose(tools: Tools = defaultTools): Promise<Diagnostics> {
  try {
    const v = await run(tools.ffmpeg, ["-hide_banner", "-version"]);
    const p = await run(tools.ffprobe, ["-hide_banner", "-version"]);
    const f = await run(tools.ffmpeg, ["-hide_banner", "-filters"]);
    const e = await run(tools.ffmpeg, ["-hide_banner", "-encoders"]);
    const filters = Object.fromEntries(NEEDED_FILTERS.map((n) => [n, new RegExp(`\\s${n}\\s`).test(f.stdout)]));
    const encoders = Object.fromEntries(ENCODERS.map((n) => [n, new RegExp(`\\s${n}\\s`).test(e.stdout)]));
    const missing = Object.entries(filters).filter(([, ok]) => !ok).map(([n]) => `filter ${n}`);
    if (!encoders.libx264) missing.push("encoder libx264");
    return { ok: missing.length === 0, ffmpeg: v.stdout.split("\n")[0], ffprobe: p.stdout.split("\n")[0], missing, filters, encoders };
  } catch (e) {
    return { ok: false, missing: ["ffmpeg"], filters: {}, encoders: {}, error: (e as Error).message };
  }
}

function fps(rate?: string): number {
  if (!rate) return 0;
  const [n, d] = rate.split("/").map(Number);
  return d ? Math.round(((n ?? 0) / d) * 1000) / 1000 : Number(n) || 0;
}

/** Read duration, streams and size with ffprobe. */
export async function probe(path: string, tools: Tools = defaultTools): Promise<MediaInfo> {
  const { stdout } = await run(tools.ffprobe, ["-v", "error", "-print_format", "json", "-show_format", "-show_streams", path]);
  const j = JSON.parse(stdout) as { format?: { duration?: string; format_name?: string; size?: string }; streams?: Record<string, unknown>[] };
  const streams = j.streams ?? [];
  const v = streams.find((s) => s.codec_type === "video" && !(s.disposition as { attached_pic?: number } | undefined)?.attached_pic);
  const rotation = Number(((v?.side_data_list as { rotation?: number }[] | undefined) ?? []).find((x) => x.rotation !== undefined)?.rotation ?? 0);
  const duration = Number(j.format?.duration ?? 0);
  if (!(duration > 0)) throw new ToolError("This file has no readable duration. It may be incomplete or not a video.");
  return {
    path,
    durationSec: duration,
    sizeBytes: Number(j.format?.size ?? statSync(path).size),
    container: String(j.format?.format_name ?? ""),
    video: v ? { codec: String(v.codec_name), width: Number(v.width), height: Number(v.height), fps: fps(String(v.avg_frame_rate || v.r_frame_rate)), rotation } : undefined,
    audioTracks: streams.filter((s) => s.codec_type === "audio").map((s) => ({
      index: Number(s.index), codec: String(s.codec_name), channels: Number(s.channels), sampleRate: Number(s.sample_rate),
      language: (s.tags as { language?: string } | undefined)?.language,
    })),
  };
}

/** One JPEG frame at a time offset, scaled to a width. */
export async function thumbnail(input: string, atSec: number, out: string, width = 480, tools: Tools = defaultTools): Promise<string> {
  await run(tools.ffmpeg, ["-hide_banner", "-y", "-ss", String(Math.max(0, atSec)), "-i", input, "-frames:v", "1", "-vf", `scale=${width}:-2`, "-q:v", "4", out]);
  return out;
}
