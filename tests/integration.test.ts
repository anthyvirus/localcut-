// Real FFmpeg runs (Tests A–E and H from the brief). Output goes to tests/.out (git-ignored).
import { existsSync, rmSync } from "node:fs";
import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { DEFAULT_SILENCE, detectSilence, keepRanges, loudnessCurve, totalLength } from "../src/core/audio";
import { probe, run, thumbnail } from "../src/core/ffmpeg";
import { suggestMoments } from "../src/core/moments";
import { newClip, newProject, addSource, saveProject, loadProject } from "../src/core/project";
import { JobQueue } from "../src/core/queue";
import { PRESETS, render, renderHash } from "../src/core/render";
import type { MediaInfo } from "../src/shared/types";
import { ensureFixture, OUT } from "./fixture";

const FONTS = join(__dirname, "..", "assets", "fonts");
let info: MediaInfo;

/** Average RGB of a small region of one frame, via ffmpeg -> raw rgb24. */
async function regionColor(file: string, at: number, x: number, y: number, w: number, h: number): Promise<[number, number, number]> {
  const { stdout } = await run("ffmpeg", ["-hide_banner", "-v", "error", "-ss", String(at), "-i", file, "-frames:v", "1", "-vf", `crop=${w}:${h}:${x}:${y},scale=1:1:flags=area`, "-f", "rawvideo", "-pix_fmt", "rgb24", "-"]);
  const b = Buffer.from(stdout, "binary");
  return [b[0] ?? 0, b[1] ?? 0, b[2] ?? 0];
}
/** Sharpness proxy: mean absolute Laplacian-ish difference via the "edgedetect" filter. */
async function edgeEnergy(file: string, at: number, x: number, y: number, w: number, h: number): Promise<number> {
  const { stderr } = await run("ffmpeg", ["-hide_banner", "-ss", String(at), "-i", file, "-frames:v", "1", "-vf", `crop=${w}:${h}:${x}:${y},format=gray,edgedetect=low=0.05:high=0.2,signalstats,metadata=print:key=lavfi.signalstats.YAVG`, "-f", "null", "-"]);
  return Number(stderr.match(/YAVG=([\d.]+)/)?.[1] ?? 0);
}

beforeAll(async () => {
  const f = await ensureFixture();
  info = await probe(f);
});

describe("Test A: import and export", () => {
  it("probes the source and exports a clean landscape clip", async () => {
    expect(info.durationSec).toBeCloseTo(40, 0);
    expect(info.video).toMatchObject({ width: 1280, height: 720 });
    expect(info.video!.fps).toBeCloseTo(30, 0);
    expect(info.audioTracks.length).toBe(1);
    const thumb = await thumbnail(info.path, 5, join(OUT, "thumb.jpg"));
    expect(existsSync(thumb)).toBe(true);
    const clip = newClip("s", 2, 8, "A");
    clip.composition = { ...PRESETS["clean-landscape"] };
    const out = join(OUT, "A-landscape.mp4");
    await render({ clip, info, fontsDir: FONTS, workDir: join(OUT, "wA"), output: out });
    const o = await probe(out);
    expect(o.video).toMatchObject({ width: 1920, height: 1080, codec: "h264" });
    expect(o.durationSec).toBeCloseTo(6, 0);
    expect(o.audioTracks[0]?.codec).toBe("aac");
  });
});

describe("Test B: blurred portrait", () => {
  it("renders 1080x1920 with a sharp centred foreground over a blurred duplicate", async () => {
    const clip = newClip("s", 0, 6, "B");
    const out = join(OUT, "B-portrait.mp4");
    const progress: number[] = [];
    await render({ clip, info, fontsDir: FONTS, workDir: join(OUT, "wB"), output: out }, { onProgress: (f) => progress.push(f) });
    const o = await probe(out);
    expect(o.video).toMatchObject({ width: 1080, height: 1920 });
    expect(progress.length).toBeGreaterThan(0);
    // foreground: 1080 wide, 608 tall, centred -> y 656..1264. Background bands above/below must not be black,
    // and the foreground must be much sharper than the blurred band.
    const top = await regionColor(out, 2, 100, 100, 880, 400);
    expect(top[0] + top[1] + top[2]).toBeGreaterThan(30);
    const sharp = await edgeEnergy(out, 2, 100, 760, 880, 400);
    const blurry = await edgeEnergy(out, 2, 100, 100, 880, 400);
    expect(sharp).toBeGreaterThan(blurry * 3);
  });
  it("the other presets produce their canvases", async () => {
    for (const [preset, w, h] of [["fullscreen-vertical", 1080, 1920], ["custom", 1080, 1920]] as const) {
      const clip = newClip("s", 0, 2, preset);
      clip.composition = { ...PRESETS[preset], mode: preset === "custom" ? "black" : PRESETS[preset].mode };
      const out = join(OUT, `B-${preset}.mp4`);
      await render({ clip, info, fontsDir: FONTS, workDir: join(OUT, `wB-${preset}`), output: out });
      expect((await probe(out)).video).toMatchObject({ width: w, height: h });
    }
  });
});

describe("Test C: silence removal", () => {
  it("finds the deliberate silences and renders a shorter, natural edit", async () => {
    const sil = await detectSilence(info.path, info.durationSec, DEFAULT_SILENCE);
    // expected silences: 6-9 and 22-26 (the 0.5 s pause is below minSilenceSec)
    expect(sil.length).toBe(2);
    expect(sil[0]!.start).toBeCloseTo(6, 0); expect(sil[0]!.end).toBeCloseTo(9, 0);
    expect(sil[1]!.start).toBeCloseTo(22, 0); expect(sil[1]!.end).toBeCloseTo(26, 0);
    const keep = keepRanges(info.durationSec, sil, DEFAULT_SILENCE);
    const expected = totalLength(keep);
    expect(expected).toBeGreaterThan(40 - 7 + 1);   // shortened, not removed: pauses kept at maxPause
    const clip = { ...newClip("s", 0, 40, "C"), removeSilence: true };
    const out = join(OUT, "C-silence.mp4");
    await render({ clip, info, silences: sil, silenceSettings: DEFAULT_SILENCE, fontsDir: FONTS, workDir: join(OUT, "wC"), output: out });
    const o = await probe(out);
    expect(Math.abs(o.durationSec - expected)).toBeLessThan(0.35);
    // the rendered file has no long silence left
    const after = await detectSilence(out, o.durationSec, { ...DEFAULT_SILENCE, minSilenceSec: 1.0 });
    expect(after.length).toBe(0);
  });
});

describe("Test D: clip suggestions", () => {
  it("suggests distinct, valid moments and exports them in a batch through the queue", async () => {
    const sil = await detectSilence(info.path, info.durationSec, DEFAULT_SILENCE);
    const levels = await loudnessCurve(info.path, info.durationSec, 0.5);
    expect(levels.length).toBeGreaterThan(70);
    const c = suggestMoments({ sourceId: "s", duration: info.durationSec, silences: sil, levels, levelStep: 0.5 }, { count: 3, minSec: 5, maxSec: 12, contextSec: 0.5 });
    expect(c.length).toBeGreaterThanOrEqual(2);
    // the louder section (15.5-22 s) should be the top suggestion
    expect(c[0]!.start).toBeLessThan(22); expect(c[0]!.end).toBeGreaterThan(15.5);
    const q = new JobQueue(join(OUT, "queue-D.json"));
    const outs: string[] = [];
    for (const m of c) {
      const clip = newClip("s", m.start, m.end, m.title);
      const out = join(OUT, `D-${m.id}.mp4`);
      outs.push(out);
      q.add("render", m.title, async (_j, signal, progress) => { await render({ clip, info, fontsDir: FONTS, workDir: join(OUT, `wD-${m.id}`), output: out }, { signal, onProgress: progress }); return out; });
    }
    await q.idle();
    expect(q.jobs.every((j) => j.state === "done")).toBe(true);
    for (const [k, out] of outs.entries()) expect((await probe(out)).durationSec).toBeCloseTo(c[k]!.end - c[k]!.start, 0);
  });
});

describe("Test E: captions", () => {
  it("are off by default, and render from transcript words when turned on", async () => {
    const clip = newClip("s", 0, 6, "E");
    expect(clip.captions).toBe(false);
    clip.captions = true;
    await expect(render({ clip, info, fontsDir: FONTS, workDir: join(OUT, "wE0"), output: join(OUT, "E-none.mp4") })).rejects.toThrow(/no transcript/);
    const transcript = [{ start: 0.5, end: 3, text: "CAPTION TEST", words: [{ start: 0.5, end: 1.5, text: "CAPTION" }, { start: 1.6, end: 3, text: "TEST" }] }];
    clip.captionStyle = { ...clip.captionStyle, size: 140, color: "#FF00FF", box: true };
    const out = join(OUT, "E-captions.mp4");
    await render({ clip, info, transcript, fontsDir: FONTS, workDir: join(OUT, "wE"), output: out });
    const off = { ...clip, captions: false };
    const outOff = join(OUT, "E-off.mp4");
    await render({ clip: off, info, transcript, fontsDir: FONTS, workDir: join(OUT, "wE2"), output: outOff });
    // the caption box sits in the bottom safe area; compare that region with and without captions
    const on = await regionColor(out, 1.2, 200, 1920 - 260 - 160, 680, 140);
    const without = await regionColor(outOff, 1.2, 200, 1920 - 260 - 160, 680, 140);
    expect(Math.abs(on[0] - without[0]) + Math.abs(on[1] - without[1]) + Math.abs(on[2] - without[2])).toBeGreaterThan(15);
  });
  it("headline text is independent of captions", async () => {
    const clip = newClip("s", 0, 3, "head");
    clip.headline = { ...clip.headline, enabled: true, text: "HE ALREADY HAD SOMEONE DOING HIS WEBSITE...\nI STILL BOOKED THE MEETING." };
    const out = join(OUT, "E-headline.mp4");
    await render({ clip, info, fontsDir: FONTS, workDir: join(OUT, "wE3"), output: out });
    expect((await probe(out)).video).toMatchObject({ width: 1080, height: 1920 });
  });
});

describe("Test H: recovery", () => {
  it("a failed render is reported, the project is untouched, and retry works", async () => {
    const dir = join(OUT, "projH");
    rmSync(dir, { recursive: true, force: true });
    const p = newProject("H");
    const src = addSource(p, info);
    const clip = newClip(src.id, 1, 4, "H");
    p.clips.push(clip);
    await saveProject(dir, p);
    const q = new JobQueue(join(OUT, "queue-H.json"));
    let fail = true;
    const out = join(OUT, "H.mp4");
    const work = async (_j: unknown, signal: AbortSignal, progress: (f: number) => void) => {
      const i = fail ? { ...info, path: join(OUT, "missing.mp4") } : info;
      await render({ clip, info: i, fontsDir: FONTS, workDir: join(OUT, "wH"), output: out }, { signal, onProgress: progress });
      return out;
    };
    const j = q.add("render", "H", work);
    await q.idle();
    expect(j.state).toBe("failed");
    expect(j.error).toMatch(/exited with code|No such file/);
    expect((await loadProject(dir)).clips[0]!.start).toBe(1);
    fail = false;
    expect(q.retry(j.id)).toBe(true);
    await q.idle();
    expect(j.state).toBe("done");
    expect(j.attempts).toBe(2);
    expect(existsSync(out)).toBe(true);
  });
  it("cancelling a running render stops it", async () => {
    const q = new JobQueue();
    const clip = newClip("s", 0, 40, "long");
    const j = q.add("render", "long", async (_j, signal, progress) => { await render({ clip, info, fontsDir: FONTS, workDir: join(OUT, "wHc"), output: join(OUT, "H-cancel.mp4"), quality: { crf: 18, preset: "slow", audioKbps: 160, normalize: true } }, { signal, onProgress: progress }); });
    setTimeout(() => q.cancel(j.id), 700);
    await q.idle();
    expect(j.state).toBe("cancelled");
  });
  it("unchanged clips have the same render hash; changes alter it", () => {
    const clip = newClip("s", 0, 5, "x");
    const a = renderHash({ clip, info }), b = renderHash({ clip: { ...clip }, info });
    expect(a).toBe(b);
    expect(renderHash({ clip: { ...clip, end: 6 }, info })).not.toBe(a);
  });
});
