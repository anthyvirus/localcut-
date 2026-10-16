// Local transcription with whisper.cpp (MIT). The user installs the binary and a ggml model
// explicitly (Settings -> Models). Nothing is uploaded. Output is parsed from whisper.cpp's
// full JSON (-ojf), which carries segment and token timestamps.
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import type { TranscriptSegment, TranscriptWord } from "../shared/types";
import { defaultTools, run, type RunOptions, type Tools } from "./ffmpeg";

export interface WhisperConfig { binary: string; model: string; language?: string; threads?: number }

interface WjToken { text: string; offsets?: { from: number; to: number }; p?: number }
interface WjSeg { text: string; offsets: { from: number; to: number }; tokens?: WjToken[] }

/** Parse whisper.cpp -ojf output. Tokens are merged into words on leading spaces. */
export function parseWhisperJson(json: string): TranscriptSegment[] {
  const j = JSON.parse(json) as { transcription?: WjSeg[] };
  return (j.transcription ?? []).map((s) => {
    const words: TranscriptWord[] = [];
    for (const t of s.tokens ?? []) {
      if (!t.offsets || /^\[_|^\[[A-Z_]+\]$/.test(t.text.trim())) continue;          // special tokens
      const text = t.text;
      if (/^\s/.test(text) || words.length === 0) words.push({ start: t.offsets.from / 1000, end: t.offsets.to / 1000, text: text.trim(), p: t.p });
      else { const w = words[words.length - 1]!; w.text += text; w.end = t.offsets.to / 1000; }
    }
    return { start: s.offsets.from / 1000, end: s.offsets.to / 1000, text: s.text.trim(), words: words.filter((w) => w.text) };
  }).filter((s) => s.text && s.end > s.start);
}

export function whisperAvailable(c: Partial<WhisperConfig>): { ok: boolean; reason?: string } {
  if (!c.binary || !existsSync(c.binary)) return { ok: false, reason: "whisper.cpp isn't installed. Settings → Transcription explains how to add it." };
  if (!c.model || !existsSync(c.model)) return { ok: false, reason: "No speech model is installed yet." };
  return { ok: true };
}

/** Extract 16 kHz mono audio, run whisper.cpp, return segments. */
export async function transcribe(input: string, workDir: string, cfg: WhisperConfig, duration: number, opts: RunOptions = {}, tools: Tools = defaultTools): Promise<TranscriptSegment[]> {
  const wav = `${workDir}/audio-16k.wav`;
  await run(tools.ffmpeg, ["-hide_banner", "-y", "-i", input, "-vn", "-ac", "1", "-ar", "16000", "-c:a", "pcm_s16le", wav], { signal: opts.signal });
  const base = `${workDir}/transcript`;
  const args = ["-m", cfg.model, "-f", wav, "-ojf", "-of", base, "-pp", "-t", String(cfg.threads ?? 4)];
  if (cfg.language) args.push("-l", cfg.language);
  await run(cfg.binary, args, {
    signal: opts.signal,
    onStderrLine: (l) => { const m = l.match(/progress\s*=\s*(\d+)%/); if (m) opts.onProgress?.(Number(m[1]) / 100); },
  });
  return parseWhisperJson(await readFile(`${base}.json`, "utf8"));
}
