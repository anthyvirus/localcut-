import { join } from "node:path";
import { parseObsIni } from "../src/main/obs";
import { describe, expect, it } from "vitest";
import { DEFAULT_SILENCE, keepRanges, parseLevels, parseSilence, totalLength } from "../src/core/audio";
import { sameMoment, suggestMoments } from "../src/core/moments";
import { safeName, uniqueOutput } from "../src/core/names";
import { captionLines, mapTime } from "../src/core/render";
import { parseWhisperJson } from "../src/core/transcript";
import { newClip, newProject, validateProject } from "../src/core/project";

describe("silence", () => {
  it("parses silencedetect output and closes an open silence at the end", () => {
    const err = "[silencedetect @ 0x1] silence_start: 6.01\n[silencedetect @ 0x1] silence_end: 9.0 | silence_duration: 2.99\n[silencedetect @ 0x1] silence_start: 38.5\n";
    expect(parseSilence(err, 40)).toEqual([{ start: 6.01, end: 9 }, { start: 38.5, end: 40 }]);
  });
  it("keeps short pauses, shortens long ones, never clips word edges", () => {
    const sil = [{ start: 6, end: 9 }, { start: 15, end: 15.5 }, { start: 22, end: 26 }];
    const keep = keepRanges(40, sil, { ...DEFAULT_SILENCE, mode: "shorten", maxPauseSec: 0.8, paddingSec: 0.15 });
    // the 0.5 s pause is untouched: 9..22 stays one range
    expect(keep.some((r) => r.start <= 9.1 && r.end >= 21.9)).toBe(true);
    // long pauses shrink to maxPause: 3 s and 4 s pauses become 0.8 s each
    expect(totalLength(keep)).toBeCloseTo(40 - (3 - 0.8) - (4 - 0.8), 1);
    // speech edges keep their padding
    for (const r of keep) expect(r.end - r.start).toBeGreaterThan(0.08);
  });
  it("remove mode keeps only padding", () => {
    const keep = keepRanges(20, [{ start: 5, end: 10 }], { ...DEFAULT_SILENCE, mode: "remove", paddingSec: 0.2, maxPauseSec: 0.8 });
    expect(keep).toEqual([{ start: 0, end: 5.2 }, { start: 9.8, end: 20 }]);
  });
  it("trims leading and trailing silence completely", () => {
    const keep = keepRanges(30, [{ start: 0, end: 4 }, { start: 26, end: 30 }], DEFAULT_SILENCE);
    expect(keep[0]!.start).toBeGreaterThanOrEqual(3.5);
    expect(keep[keep.length - 1]!.end).toBeLessThanOrEqual(26.5);
  });
  it("parses astats levels including -inf", () => {
    expect(parseLevels("lavfi.astats.Overall.RMS_level=-23.5\nlavfi.astats.Overall.RMS_level=-inf\n")).toEqual([-23.5, -90]);
  });
});

describe("moments", () => {
  const segs = Array.from({ length: 60 }, (_, i) => ({ start: i * 5, end: i * 5 + 4.5, text: i === 30 ? "No way, you actually booked the meeting?" : i % 7 === 0 ? "Here's the thing that changed everything!" : "And then we kept working on the site." }));
  const levels = Array.from({ length: 600 }, (_, i) => (i > 300 && i < 320 ? -12 : -28));
  const set = { count: 5, minSec: 15, maxSec: 35, contextSec: 1 };
  const c = suggestMoments({ sourceId: "s", duration: 300, silences: [], levels, levelStep: 0.5, transcript: segs }, set);
  it("respects min and max duration and the source bounds", () => {
    expect(c.length).toBe(5);
    for (const x of c) { expect(x.end - x.start).toBeGreaterThanOrEqual(15); expect(x.end - x.start).toBeLessThanOrEqual(35); expect(x.start).toBeGreaterThanOrEqual(0); expect(x.end).toBeLessThanOrEqual(300); }
  });
  it("returns distinct moments, best first, with visible signals", () => {
    for (let i = 0; i < c.length; i++) for (let j = i + 1; j < c.length; j++) expect(sameMoment(c[i]!, c[j]!)).toBe(false);
    expect(c[0]!.score).toBe(100);
    expect(c[0]!.start).toBeLessThanOrEqual(150 + 1);
    expect(c[0]!.end).toBeGreaterThanOrEqual(150);
    expect(c[0]!.signals.cueWords.length).toBeGreaterThan(0);
  });
  it("works without a transcript (speech regions + energy)", () => {
    const x = suggestMoments({ sourceId: "s", duration: 120, silences: [{ start: 30, end: 34 }, { start: 70, end: 75 }], levels: levels.slice(0, 240) }, { ...set, count: 3 });
    expect(x.length).toBeGreaterThan(0);
    expect(x.every((m) => m.signals.cues === 0)).toBe(true);
  });
  it("handles recordings shorter than the minimum", () => {
    expect(suggestMoments({ sourceId: "s", duration: 8, silences: [] }, set)).toEqual([]);
  });
});

describe("names", () => {
  it("makes safe, unique file names", () => {
    expect(safeName('He said: "no way"? <b>/\\|*')).toBe("He said no way b");
    expect(safeName("CON")).toBe("clip-CON");
    expect(safeName("...")).toBe("clip");
    const dir = join("tmp-nonexistent", "x");   // OS-native separators so this passes on Windows too
    const taken = new Set([join(dir, "My clip.mp4")]);
    expect(uniqueOutput(dir, "My clip", "mp4", taken)).toBe(join(dir, "My clip (2).mp4"));
  });
});

describe("captions and timing", () => {
  it("maps source time through silence cuts", () => {
    const r = [{ start: 10, end: 20 }, { start: 25, end: 30 }];
    expect(mapTime(12, r)).toBe(2);
    expect(mapTime(22, r)).toBeNull();
    expect(mapTime(26, r)).toBe(11);
  });
  it("builds caption lines only from transcript words inside kept ranges", () => {
    const segs = [{ start: 10, end: 14, text: "hello there friend how are you", words: [
      { start: 10, end: 10.4, text: "hello" }, { start: 10.5, end: 10.9, text: "there" }, { start: 11, end: 11.5, text: "friend" },
      { start: 21, end: 21.5, text: "cut" }, { start: 25.2, end: 25.6, text: "kept" }] }];
    const lines = captionLines(segs, [{ start: 10, end: 20 }, { start: 25, end: 30 }]);
    expect(lines.map((l) => l.text).join(" ")).toBe("hello there friend kept");
  });
  it("new clips have captions OFF", () => {
    expect(newClip("s", 0, 10, "x").captions).toBe(false);
  });
});

describe("transcript", () => {
  it("parses whisper.cpp full JSON into segments and words", () => {
    const j = JSON.stringify({ transcription: [{ text: " Hello world.", offsets: { from: 0, to: 1500 }, tokens: [
      { text: "[_BEG_]", offsets: { from: 0, to: 0 } }, { text: " Hello", offsets: { from: 0, to: 600 } }, { text: " wor", offsets: { from: 700, to: 1000 } }, { text: "ld.", offsets: { from: 1000, to: 1400 } }] }] });
    const s = parseWhisperJson(j);
    expect(s[0]!.text).toBe("Hello world.");
    expect(s[0]!.words!.map((w) => w.text)).toEqual(["Hello", "world."]);
    expect(s[0]!.words![1]!.end).toBe(1.4);
  });
});

describe("project", () => {
  it("rejects invalid files and forces unknown caption values off", () => {
    expect(() => validateProject({ schema: 2 })).toThrow();
    const p = newProject("t");
    p.clips.push({ ...newClip("s", 0, 5, "a"), captions: "yes" as unknown as boolean });
    expect(validateProject(JSON.parse(JSON.stringify(p))).clips[0]!.captions).toBe(false);
    p.clips[0]!.end = -1;
    expect(() => validateProject(JSON.parse(JSON.stringify(p)))).toThrow(/invalid times/);
  });
});

describe("OBS settings detection", () => {
  it("reads OBS 30's WebSocket section, Windows line endings included", () => {
    const ini = "\uFEFF[General]\r\nName=x\r\n[OBSWebSocket]\r\nFirstLoad=false\r\nServerEnabled=true\r\nServerPort=4456\r\nAlertsEnabled=false\r\nAuthRequired=true\r\nServerPassword=abc123XYZ\r\n[Other]\r\nA=1\r\n";
    expect(parseObsIni(ini)).toEqual({ enabled: true, port: 4456, password: "abc123XYZ" });
    expect(parseObsIni("[OBSWebSocket]\nServerEnabled=false\nAuthRequired=false\n")).toEqual({ enabled: false, port: 4455, password: "" });
    expect(parseObsIni("[General]\nA=1\n")).toBeNull();
  });
});
