// Main-process services: settings, projects, analysis and export jobs.
// The renderer never touches files or processes directly; it calls these through IPC.
import { existsSync, readdirSync, statSync } from "node:fs";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import type { MomentRequest, ProjectSummary, Settings } from "../shared/api";
import type { Candidate, Clip, Interval, Job, Project, SilenceSettings, SourceMedia } from "../shared/types";
import { DEFAULT_SILENCE, detectSilence, keepRanges, loudnessCurve } from "../core/audio";
import { diagnose, probe, thumbnail, type Tools } from "../core/ffmpeg";
import { suggestMoments } from "../core/moments";
import { uniqueOutput } from "../core/names";
import { addSource, loadProject, newClip, newProject, saveProject, validateProject } from "../core/project";
import { JobQueue } from "../core/queue";
import { captionLines, render, renderHash } from "../core/render";
import { transcribe, whisperAvailable } from "../core/transcript";

export const VIDEO_EXT = /\.(mp4|mov|mkv|webm|m4v|avi|flv|ts)$/i;

export class Services {
  settings!: Settings;
  readonly queue: JobQueue;
  private projects = new Map<string, Project>();
  private saveTimers = new Map<string, NodeJS.Timeout>();
  /** files the UI may preview: sources of opened projects and finished exports */
  readonly allowedMedia = new Set<string>();
  onProjectChanged: (p: Project) => void = () => {};

  constructor(readonly userData: string, readonly fontsDir: string, readonly defaultExportDir: string) {
    this.queue = new JobQueue(join(userData, "jobs.json"));
  }

  get projectsDir() { return join(this.userData, "projects"); }
  get settingsFile() { return join(this.userData, "settings.json"); }
  tools(): Tools { return { ffmpeg: this.settings.ffmpegPath || "ffmpeg", ffprobe: this.settings.ffprobePath || "ffprobe" }; }

  async init() {
    await mkdir(this.projectsDir, { recursive: true });
    const defaults: Settings = {
      ffmpegPath: "", ffprobePath: "", exportDir: this.defaultExportDir, whisperBinary: "", whisperModel: "", whisperLanguage: "",
      obs: { host: "127.0.0.1", port: 4455, hasPassword: false, recordingDir: "", autoImport: false },
      quality: { crf: 20, preset: "veryfast", audioKbps: 160, normalize: true },
    };
    try {
      const s = JSON.parse(await readFile(this.settingsFile, "utf8")) as Partial<Settings>;
      this.settings = { ...defaults, ...s, obs: { ...defaults.obs, ...s.obs }, quality: { ...defaults.quality, ...s.quality } };
    } catch { this.settings = defaults; }
    await this.queue.restore();
  }

  async setSettings(patch: Partial<Omit<Settings, "obs">> & { obs?: Partial<Settings["obs"]> }): Promise<Settings> {
    const next: Settings = { ...this.settings, ...patch, obs: { ...this.settings.obs, ...patch.obs }, quality: { ...this.settings.quality, ...patch.quality } };
    next.obs.port = Math.max(1, Math.min(65535, Math.round(Number(next.obs.port) || 4455)));
    next.quality.crf = Math.max(12, Math.min(35, Math.round(next.quality.crf)));
    if (!["ultrafast", "superfast", "veryfast", "faster", "fast", "medium", "slow"].includes(next.quality.preset)) next.quality.preset = "veryfast";
    this.settings = next;
    await writeFile(this.settingsFile, JSON.stringify(next, null, 2), "utf8");
    return next;
  }

  async diagnostics() {
    const d = await diagnose(this.tools());
    return { ...d, whisper: whisperAvailable({ binary: this.settings.whisperBinary, model: this.settings.whisperModel }) };
  }

  // ------------------------------------------------------------- projects
  dirOf(id: string) {
    if (!/^[0-9a-f-]{36}$/.test(id)) throw new Error("Invalid project id.");
    return join(this.projectsDir, id);
  }

  async list(): Promise<ProjectSummary[]> {
    const out: ProjectSummary[] = [];
    for (const id of readdirSync(this.projectsDir)) {
      try {
        const p = this.projects.get(id) ?? await loadProject(join(this.projectsDir, id));
        out.push({ id: p.id, name: p.name, updatedAt: p.updatedAt, sources: p.sources.length, clips: p.clips.length, dir: join(this.projectsDir, id) });
      } catch { /* not a project folder */ }
    }
    return out.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  async create(name: string): Promise<Project> {
    const p = newProject(String(name).slice(0, 120));
    await saveProject(this.dirOf(p.id), p);
    this.projects.set(p.id, p);
    return p;
  }

  async open(id: string): Promise<Project> {
    const p = this.projects.get(id) ?? await loadProject(this.dirOf(id));
    this.projects.set(id, p);
    for (const s of p.sources) this.allowedMedia.add(resolve(s.path));
    return p;
  }

  async rename(id: string, name: string) { const p = await this.open(id); p.name = String(name).slice(0, 120) || p.name; await this.save(p, true); return p; }

  async remove(id: string) {
    this.projects.delete(id);
    await rm(this.dirOf(id), { recursive: true, force: true });        // project data only; footage and exports are never deleted
  }

  async save(p: Project, now = false) {
    clearTimeout(this.saveTimers.get(p.id));
    const doSave = () => saveProject(this.dirOf(p.id), p).then(() => this.onProjectChanged(p));
    if (now) return doSave();
    this.saveTimers.set(p.id, setTimeout(() => void doSave(), 250));
  }

  private source(p: Project, sourceId: string): SourceMedia {
    const s = p.sources.find((x) => x.id === sourceId);
    if (!s) throw new Error("That source isn't in this project.");
    return s;
  }

  // ------------------------------------------------------------- media import
  expandPaths(paths: string[]): string[] {
    const out: string[] = [];
    for (const raw of paths.slice(0, 500)) {
      const p = resolve(String(raw));
      if (!existsSync(p)) continue;
      const st = statSync(p);
      if (st.isDirectory()) {
        for (const f of readdirSync(p).sort()) if (VIDEO_EXT.test(f)) out.push(join(p, f));
      } else if (VIDEO_EXT.test(p)) out.push(p);
    }
    return [...new Set(out)];
  }

  async importMedia(projectId: string, paths: string[]) {
    const p = await this.open(projectId);
    const errors: { path: string; error: string }[] = [];
    for (const path of this.expandPaths(paths)) {
      try {
        const info = await probe(path, this.tools());
        if (!info.video) throw new Error("No video track.");
        const s = addSource(p, info);
        this.allowedMedia.add(resolve(path));
        const thumbs = join(this.dirOf(p.id), "thumbs");
        await mkdir(thumbs, { recursive: true });
        await thumbnail(path, Math.min(5, info.durationSec / 3), join(thumbs, `${s.id}.jpg`), 480, this.tools()).catch(() => undefined);
      } catch (e) { errors.push({ path, error: (e as Error).message }); }
    }
    await this.save(p, true);
    return { project: p, errors };
  }

  thumbPath(projectId: string, sourceId: string) { return join(this.dirOf(projectId), "thumbs", `${sourceId}.jpg`); }

  async removeSource(projectId: string, sourceId: string) {
    const p = await this.open(projectId);
    p.sources = p.sources.filter((s) => s.id !== sourceId);
    p.clips = p.clips.filter((c) => c.sourceId !== sourceId);
    await this.save(p, true);
    return p;
  }

  // ------------------------------------------------------------- analysis (background jobs, checkpointed in the project)
  async analyse(projectId: string, sourceId: string, what: { silence?: SilenceSettings; energy?: boolean; transcribe?: boolean }) {
    const p = await this.open(projectId);
    const s = this.source(p, sourceId);
    const tools = this.tools();
    const name = s.path.split(/[\\/]/).pop();
    if (what.silence) {
      const settings = { ...DEFAULT_SILENCE, ...what.silence };
      this.queue.add("silence", `Find silences · ${name}`, async (_j, signal, progress) => {
        const intervals = await detectSilence(s.path, s.info.durationSec, settings, { signal, onProgress: progress }, tools);
        s.analysis.silence = { settings, intervals, doneAt: new Date().toISOString() };
        await this.save(p, true);
      }, { projectId, sourceId });
    }
    if (what.energy) {
      this.queue.add("energy", `Measure loudness · ${name}`, async (_j, signal, progress) => {
        const db = await loudnessCurve(s.path, s.info.durationSec, 0.5, { signal, onProgress: progress }, tools);
        s.analysis.energy = { stepSec: 0.5, db, doneAt: new Date().toISOString() };
        await this.save(p, true);
      }, { projectId, sourceId });
    }
    if (what.transcribe) {
      const cfg = { binary: this.settings.whisperBinary, model: this.settings.whisperModel, language: this.settings.whisperLanguage || undefined };
      const ok = whisperAvailable(cfg);
      if (!ok.ok) throw new Error(ok.reason);
      this.queue.add("transcribe", `Transcribe · ${name}`, async (_j, signal, progress) => {
        const work = join(this.dirOf(p.id), "work", s.id);
        await mkdir(work, { recursive: true });
        const segments = await transcribe(s.path, work, cfg, s.info.durationSec, { signal, onProgress: progress }, tools);
        s.analysis.transcript = { model: cfg.model.split(/[\\/]/).pop() ?? "", language: cfg.language, segments, doneAt: new Date().toISOString() };
        await this.save(p, true);
      }, { projectId, sourceId });
    }
  }

  async keep(projectId: string, sourceId: string, set: SilenceSettings, within?: Interval) {
    const p = await this.open(projectId);
    const s = this.source(p, sourceId);
    if (!s.analysis.silence) throw new Error("Find silences first.");
    return keepRanges(s.info.durationSec, s.analysis.silence.intervals, { ...DEFAULT_SILENCE, ...set }, within);
  }

  async suggest(projectId: string, sourceId: string, req: MomentRequest): Promise<Candidate[]> {
    const p = await this.open(projectId);
    const s = this.source(p, sourceId);
    if (!s.analysis.silence && !s.analysis.transcript) throw new Error("Analyse the audio first (silences and loudness), and optionally transcribe it.");
    const items = suggestMoments({
      sourceId, duration: s.info.durationSec, silences: s.analysis.silence?.intervals ?? [], levels: s.analysis.energy?.db, levelStep: s.analysis.energy?.stepSec,
      transcript: s.analysis.transcript?.segments,
    }, { count: clampInt(req.count, 1, 50), minSec: clampNum(req.minSec, 3, 600), maxSec: clampNum(req.maxSec, 3, 900), contextSec: clampNum(req.contextSec, 0, 10) }, `${sourceId.slice(0, 4)}-`);
    s.analysis.candidates = { generatedAt: new Date().toISOString(), items };
    await this.save(p, true);
    return items;
  }

  async candidatesToClips(projectId: string, ids: string[]) {
    const p = await this.open(projectId);
    for (const s of p.sources) for (const c of s.analysis.candidates?.items ?? []) {
      if (!ids.includes(c.id) || p.clips.some((k) => k.sourceId === s.id && k.start === c.start && k.end === c.end)) continue;
      p.clips.push({ ...newClip(s.id, c.start, c.end, c.title), status: "selected" });
    }
    await this.save(p, true);
    return p;
  }

  // ------------------------------------------------------------- clips
  async createClip(projectId: string, sourceId: string, start: number, end: number, name: string) {
    const p = await this.open(projectId);
    const s = this.source(p, sourceId);
    const a = clampNum(start, 0, s.info.durationSec), b = clampNum(end, 0, s.info.durationSec);
    if (!(b - a >= 0.5)) throw new Error("A clip needs to be at least half a second long.");
    p.clips.push(newClip(sourceId, a, b, String(name).slice(0, 120) || "Clip"));
    await this.save(p, true);
    return p;
  }

  async updateClip(projectId: string, clip: Clip) {
    const p = await this.open(projectId);
    const i = p.clips.findIndex((c) => c.id === clip.id);
    if (i < 0) throw new Error("That clip no longer exists.");
    const s = this.source(p, p.clips[i]!.sourceId);
    const next: Clip = validateProject({ ...p, clips: [{ ...p.clips[i]!, ...clip, sourceId: p.clips[i]!.sourceId }] }).clips[0]!;
    next.start = clampNum(next.start, 0, s.info.durationSec);
    next.end = clampNum(next.end, next.start + 0.5, s.info.durationSec);
    next.name = String(next.name).slice(0, 120);
    next.headline.text = String(next.headline.text).slice(0, 300);
    p.clips[i] = next;
    await this.save(p);           // debounced: sliders don't hammer the disk
    return p;
  }

  async removeClip(projectId: string, clipId: string) {
    const p = await this.open(projectId);
    p.clips = p.clips.filter((c) => c.id !== clipId);
    await this.save(p, true);
    return p;
  }

  async exportSrt(projectId: string, clipId: string) {
    const p = await this.open(projectId);
    const c = p.clips.find((x) => x.id === clipId);
    if (!c) throw new Error("No such clip.");
    const s = this.source(p, c.sourceId);
    if (!s.analysis.transcript) throw new Error("Transcribe this source first.");
    const ranges = c.removeSilence && s.analysis.silence ? keepRanges(s.info.durationSec, s.analysis.silence.intervals, s.analysis.silence.settings, { start: c.start, end: c.end }) : [{ start: c.start, end: c.end }];
    const lines = captionLines(s.analysis.transcript.segments, ranges);
    const t = (x: number) => { const ms = Math.round(x * 1000); return `${String(Math.floor(ms / 3600000)).padStart(2, "0")}:${String(Math.floor(ms / 60000) % 60).padStart(2, "0")}:${String(Math.floor(ms / 1000) % 60).padStart(2, "0")},${String(ms % 1000).padStart(3, "0")}`; };
    const dir = p.exportDir || this.settings.exportDir;
    await mkdir(dir, { recursive: true });
    const out = uniqueOutput(dir, c.name, "srt");
    await writeFile(out, lines.map((l, i) => `${i + 1}\n${t(l.start)} --> ${t(l.end)}\n${l.text}\n`).join("\n"), "utf8");
    return out;
  }

  // ------------------------------------------------------------- export
  async queueExports(projectId: string, clipIds: string[], force = false) {
    const p = await this.open(projectId);
    const dir = p.exportDir || this.settings.exportDir;
    await mkdir(dir, { recursive: true });
    const taken = new Set(this.queue.jobs.filter((j) => j.state === "queued" || j.state === "running").map((j) => j.output ?? ""));
    let queued = 0, skipped = 0;
    for (const id of clipIds) {
      const clip = p.clips.find((c) => c.id === id);
      if (!clip) continue;
      const s = this.source(p, clip.sourceId);
      const hashInputs = { clip, info: s.info, silences: s.analysis.silence?.intervals, silenceSettings: s.analysis.silence?.settings, transcript: s.analysis.transcript?.segments, quality: this.settings.quality };
      const hash = renderHash(hashInputs);
      if (!force && clip.renderHash === hash && clip.lastOutput && existsSync(clip.lastOutput)) { skipped++; continue; }   // unchanged: no re-render
      if (this.queue.jobs.some((j) => j.clipId === clip.id && (j.state === "queued" || j.state === "running"))) { skipped++; continue; }
      const output = uniqueOutput(dir, clip.name, "mp4", taken);
      taken.add(output);
      this.queue.add("render", `Export · ${clip.name}`, this.renderWork(p, clip.id, output), { projectId, clipId: clip.id, output });
      queued++;
    }
    return { queued, skipped };
  }

  /** The work function for a render job; also used to re-attach work when retrying after a restart. */
  renderWork(p: Project, clipId: string, output: string) {
    return async (_j: Job, signal: AbortSignal, progress: (f: number) => void) => {
      const clip = p.clips.find((c) => c.id === clipId);
      if (!clip) throw new Error("This clip was deleted.");
      const s = this.source(p, clip.sourceId);
      const inputs = { clip, info: s.info, silences: s.analysis.silence?.intervals, silenceSettings: s.analysis.silence?.settings, transcript: s.analysis.transcript?.segments, quality: this.settings.quality };
      const tmp = `${output}.part.mp4`;
      await render({ ...inputs, fontsDir: this.fontsDir, workDir: join(this.dirOf(p.id), "work", `render-${clip.id}`), output: tmp }, { signal, onProgress: progress }, this.tools());
      const { rename } = await import("node:fs/promises");
      await rename(tmp, output);                       // only complete files get the real name
      clip.renderHash = renderHash(inputs);
      clip.lastOutput = output;
      this.allowedMedia.add(resolve(output));
      await this.save(p, true);
      return output;
    };
  }

  async retry(id: string) {
    const j = this.queue.jobs.find((x) => x.id === id);
    if (j?.kind === "render" && j.projectId && j.clipId && j.output) {
      const p = await this.open(j.projectId);
      return this.queue.retry(id, this.renderWork(p, j.clipId, j.output));
    }
    return this.queue.retry(id);
  }
}

const clampNum = (n: unknown, lo: number, hi: number) => Math.max(lo, Math.min(hi, Number(n) || 0));
const clampInt = (n: unknown, lo: number, hi: number) => Math.round(clampNum(n, lo, hi));
export { validateProject };
