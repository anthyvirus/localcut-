// Moment suggestions: an explainable ranking, not a judge of what's funny.
// Candidates are built from natural boundaries (transcript sentences, or speech regions
// between silences when there's no transcript), then scored by visible signals:
//   energy   – how loud the loudest part is vs. this recording's typical level
//   speech   – how much of the window is speech rather than dead air
//   cues     – transcript cues: questions, exclamations, laughter, reaction words
//   boundary – the clip starts and ends on sentence/speech boundaries
// Overlapping candidates are de-duplicated so suggestions cover different moments.
import type { Candidate, CandidateSignals, Interval, TranscriptSegment } from "../shared/types";

export interface MomentSettings { count: number; minSec: number; maxSec: number; contextSec: number }
export const DURATION_PRESETS: Record<"short" | "medium" | "long", Pick<MomentSettings, "minSec" | "maxSec">> = {
  short: { minSec: 15, maxSec: 35 }, medium: { minSec: 30, maxSec: 60 }, long: { minSec: 60, maxSec: 120 },
};

const CUES = ["no way", "oh my god", "wait", "what", "crazy", "insane", "never", "actually", "the thing is", "here's", "secret", "mistake",
  "story", "funny", "honestly", "can't believe", "guess what", "listen", "important", "lesson", "realised", "realized", "booked", "money",
  "how to", "why", "best", "worst", "first time", "finally"];
const LAUGH = /\[(laugh|laughter|laughs|applause)[^\]]*\]|\((laugh|laughter|laughs)[^)]*\)|\bhaha+\b|\blol\b/i;

interface Unit { start: number; end: number; text: string }

function sentences(segs: TranscriptSegment[]): Unit[] {
  const out: Unit[] = [];
  let cur: Unit | null = null;
  for (const s of segs) {
    const text = s.text.trim();
    if (!text) continue;
    cur = cur ? { start: cur.start, end: s.end, text: `${cur.text} ${text}` } : { start: s.start, end: s.end, text };
    if (/[.!?…]["')\]]?$/.test(text) || cur.end - cur.start > 12) { out.push(cur); cur = null; }
  }
  if (cur) out.push(cur);
  return out;
}

function speechRegions(duration: number, silences: Interval[]): Unit[] {
  const out: Unit[] = [];
  let t = 0;
  for (const s of [...silences].sort((a, b) => a.start - b.start)) {
    if (s.start - t > 0.4) out.push({ start: t, end: s.start, text: "" });
    t = Math.max(t, s.end);
  }
  if (duration - t > 0.4) out.push({ start: t, end: duration, text: "" });
  // split very long regions into ~8 s units so windows can still end at sensible points
  return out.flatMap((u) => {
    const n = Math.max(1, Math.round((u.end - u.start) / 8));
    const step = (u.end - u.start) / n;
    return Array.from({ length: n }, (_, i) => ({ start: u.start + i * step, end: u.start + (i + 1) * step, text: "" }));
  });
}

const overlap = (a: Interval, b: Interval) => Math.max(0, Math.min(a.end, b.end) - Math.max(a.start, b.start));

/** True when two windows cover mostly the same moment. */
export function sameMoment(a: Interval, b: Interval, threshold = 0.35): boolean {
  const o = overlap(a, b);
  return o / Math.min(a.end - a.start, b.end - b.start) > threshold;
}

function percentile(xs: number[], p: number): number {
  if (!xs.length) return -90;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor(p * (s.length - 1)))]!;
}

export function suggestMoments(input: { sourceId: string; duration: number; silences: Interval[]; levels?: number[]; levelStep?: number; transcript?: TranscriptSegment[] },
  set: MomentSettings, idPrefix = "c"): Candidate[] {
  const { duration, silences, levels = [], levelStep = 0.5, transcript } = input;
  const minSec = Math.max(3, Math.min(set.minSec, set.maxSec)), maxSec = Math.max(minSec, set.maxSec);
  if (duration < minSec) return [];
  const units = transcript?.length ? sentences(transcript) : speechRegions(duration, silences);
  if (!units.length) return [];
  const baseDb = percentile(levels.filter((v) => v > -80), 0.5);
  const loudDb = percentile(levels.filter((v) => v > -80), 0.95);

  const windows: Interval[] = [];
  for (let i = 0; i < units.length; i++) {
    let j = i, end = units[i]!.end;
    while (j + 1 < units.length && end - units[i]!.start < minSec) { j++; end = units[j]!.end; }
    // keep adding sentences while we stay under the target midpoint, so stories can finish
    const target = (minSec + maxSec) / 2;
    while (j + 1 < units.length && units[j + 1]!.end - units[i]!.start <= target) { j++; end = units[j]!.end; }
    const start = Math.max(0, units[i]!.start - set.contextSec);
    end = Math.min(duration, end + set.contextSec);
    if (end - start < minSec) continue;
    if (end - start > maxSec) end = start + maxSec;
    windows.push({ start, end });
  }

  const scored = windows.map((w) => {
    const sil = silences.reduce((a, s) => a + overlap(w, s), 0);
    const speech = Math.max(0, 1 - sil / (w.end - w.start));
    const lv = levels.slice(Math.floor(w.start / levelStep), Math.ceil(w.end / levelStep));
    const peak = percentile(lv, 0.9);
    const energy = loudDb > baseDb ? Math.max(0, Math.min(1, (peak - baseDb) / (loudDb - baseDb))) : 0;
    const text = (transcript ?? []).filter((s) => overlap(w, s) > 0).map((s) => s.text).join(" ");
    const lower = text.toLowerCase();
    const cueWords = CUES.filter((c) => lower.includes(c));
    if (LAUGH.test(text)) cueWords.push("laughter");
    const q = (text.match(/\?/g) ?? []).length, ex = (text.match(/!/g) ?? []).length;
    if (q) cueWords.push(`${q} question${q > 1 ? "s" : ""}`);
    if (ex) cueWords.push(`${ex} exclamation${ex > 1 ? "s" : ""}`);
    const cues = transcript?.length ? Math.min(1, cueWords.length / 4) : 0;
    const edges = units.some((u) => Math.abs(u.start - w.start - set.contextSec) < 0.6 || Math.abs(u.start - w.start) < 0.6)
      && units.some((u) => Math.abs(u.end - w.end + set.contextSec) < 0.6 || Math.abs(u.end - w.end) < 0.6);
    const boundary = edges ? 1 : 0.4;
    const signals: CandidateSignals = { energy: round(energy), speech: round(speech), cues: round(cues), boundary, cueWords };
    const raw = transcript?.length ? 0.3 * energy + 0.25 * speech + 0.3 * cues + 0.15 * boundary : 0.55 * energy + 0.3 * speech + 0.15 * boundary;
    return { w, raw, signals, text };
  }).sort((a, b) => b.raw - a.raw || a.w.start - b.w.start);

  const picked: typeof scored = [];
  for (const s of scored) {
    if (picked.length >= set.count) break;
    if (picked.some((p) => sameMoment(p.w, s.w))) continue;
    picked.push(s);
  }
  const best = picked[0]?.raw || 1;
  return picked.map((p, i) => ({
    id: `${idPrefix}${i + 1}-${Math.round(p.w.start * 10)}`,
    sourceId: input.sourceId,
    start: round(p.w.start), end: round(p.w.end),
    score: Math.round((p.raw / best) * 100),
    signals: p.signals,
    title: titleFrom(p.text, p.w.start),
    excerpt: p.text.slice(0, 280),
  }));
}

const round = (n: number) => Math.round(n * 100) / 100;

export function clock(sec: number): string {
  const s = Math.max(0, Math.floor(sec)), h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), r = s % 60;
  return h ? `${h}:${String(m).padStart(2, "0")}:${String(r).padStart(2, "0")}` : `${m}:${String(r).padStart(2, "0")}`;
}

function titleFrom(text: string, start: number): string {
  const words = text.replace(/\s+/g, " ").trim().split(" ").filter(Boolean);
  return words.length >= 3 ? words.slice(0, 8).join(" ").replace(/[,.;:!?]+$/, "") + (words.length > 8 ? "…" : "") : `Moment at ${clock(start)}`;
}
