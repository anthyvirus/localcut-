// The complete surface the UI (renderer) can call. Every call is validated in the main process.
import type { Candidate, Clip, Diagnostics, Interval, Job, Project, SilenceSettings, SourceMedia } from "./types";

export interface Settings {
  ffmpegPath: string;          // "" = use ffmpeg on PATH
  ffprobePath: string;
  exportDir: string;           // default export folder
  whisperBinary: string;       // path to whisper.cpp's whisper-cli
  whisperModel: string;        // path to a ggml model file
  whisperLanguage: string;     // "" = auto
  obs: { host: string; port: number; hasPassword: boolean; recordingDir: string; autoImport: boolean };
  quality: { crf: number; preset: string; audioKbps: number; normalize: boolean };
}

export interface ProjectSummary { id: string; name: string; updatedAt: string; sources: number; clips: number; dir: string }

export interface ObsStatus {
  state: "disconnected" | "connecting" | "connected" | "error";
  error?: string;
  obsVersion?: string; wsVersion?: string;
  recording?: boolean; recordTimecode?: string; streaming?: boolean;
  recordDirectory?: string; lastRecording?: string;
}

export interface MomentRequest { count: number; minSec: number; maxSec: number; contextSec: number }

export interface LocalCutApi {
  app: { info(): Promise<{ version: string; platform: string; userData: string }>; diagnostics(): Promise<Diagnostics & { whisper: { ok: boolean; reason?: string } }> };
  settings: { get(): Promise<Settings>; set(patch: Partial<Omit<Settings, "obs">> & { obs?: Partial<Settings["obs"]> }): Promise<Settings>; setObsPassword(pw: string): Promise<void>; pickFile(kind: "ffmpeg" | "ffprobe" | "whisper" | "model"): Promise<string | null>; pickDir(kind: "export" | "recordings"): Promise<string | null> };
  projects: { list(): Promise<ProjectSummary[]>; create(name: string): Promise<Project>; open(id: string): Promise<Project>; rename(id: string, name: string): Promise<Project>; remove(id: string): Promise<void> };
  media: { pickFiles(): Promise<string[]>; pickFolder(): Promise<string[]>; import(projectId: string, paths: string[]): Promise<{ project: Project; errors: { path: string; error: string }[] }>; removeSource(projectId: string, sourceId: string): Promise<Project>; mediaUrl(path: string): string };
  analysis: { run(projectId: string, sourceId: string, what: { silence?: SilenceSettings; energy?: boolean; transcribe?: boolean }): Promise<void>; keepRanges(projectId: string, sourceId: string, s: SilenceSettings, within?: Interval): Promise<Interval[]> };
  moments: { suggest(projectId: string, sourceId: string, req: MomentRequest): Promise<Candidate[]>; toClips(projectId: string, candidateIds: string[]): Promise<Project> };
  clips: { create(projectId: string, sourceId: string, start: number, end: number, name: string): Promise<Project>; update(projectId: string, clip: Clip): Promise<Project>; remove(projectId: string, clipId: string): Promise<Project>; exportSrt(projectId: string, clipId: string): Promise<string> };
  exports: { queue(projectId: string, clipIds: string[], force?: boolean): Promise<{ queued: number; skipped: number }>; reveal(path: string): Promise<void>; openFolder(dir?: string): Promise<void> };
  jobs: { list(): Promise<Job[]>; cancel(id: string): Promise<void>; retry(id: string): Promise<boolean>; clear(): Promise<void>; onChange(cb: (jobs: Job[]) => void): () => void };
  obs: { connect(): Promise<ObsStatus>; disconnect(): Promise<ObsStatus>; status(): Promise<ObsStatus>; onStatus(cb: (s: ObsStatus) => void): () => void; latestRecordings(): Promise<{ path: string; mtime: string; size: number }[]> };
  events: { onProjectChanged(cb: (p: Project) => void): () => void };
}

export type { Project, SourceMedia };
