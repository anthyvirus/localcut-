// Types shared by the engine (main process) and the UI (renderer). Plain data only.

export interface MediaInfo {
  path: string;
  durationSec: number;
  sizeBytes: number;
  container: string;
  video?: { codec: string; width: number; height: number; fps: number; rotation: number };
  audioTracks: { index: number; codec: string; channels: number; sampleRate: number; language?: string }[];
}

export interface Interval { start: number; end: number }

export interface SilenceSettings {
  thresholdDb: number;      // below this is "silent", e.g. -35
  minSilenceSec: number;    // shorter pauses are ignored, e.g. 0.6
  paddingSec: number;       // kept before and after speech, e.g. 0.15
  maxPauseSec: number;      // pauses longer than this get cut or shortened, e.g. 0.8
  mode: "remove" | "shorten";
}

export interface TranscriptWord { start: number; end: number; text: string; p?: number }
export interface TranscriptSegment { start: number; end: number; text: string; words?: TranscriptWord[] }

export interface CandidateSignals {
  energy: number;        // 0..1, loudness peak vs. the recording's typical level
  speech: number;        // 0..1, share of the window that is speech
  cues: number;          // 0..1, transcript cues (questions, exclamations, reactions)
  boundary: number;      // 0..1, starts/ends on sentence boundaries
  cueWords: string[];    // which cues fired, shown to the user
}

export interface Candidate {
  id: string;
  sourceId: string;
  start: number;
  end: number;
  score: number;         // 0..100, relative within this recording
  signals: CandidateSignals;
  title: string;
  excerpt: string;
}

export type PresetId = "blurred-portrait" | "fullscreen-vertical" | "clean-landscape" | "hook-clip" | "custom";

export interface Composition {
  preset: PresetId;
  width: number; height: number;          // output canvas
  mode: "blur" | "fill" | "black" | "landscape";
  fgScale: number;                         // 1 = fit canvas width
  fgOffsetY: number;                       // pixels, + moves down
  bgBlur: number;                          // boxblur radius
  bgDarken: number;                        // 0..1
  bgZoom: number;                          // 1 = cover
  safeTop: number; safeBottom: number;     // pixels
}

export interface CaptionStyle { font: string; size: number; color: string; outline: string; outlineWidth: number; shadow: number; position: "bottom" | "middle" | "top"; box: boolean }

export interface Headline { enabled: boolean; text: string; font: string; size: number; color: string; outline: string; outlineWidth: number; box: boolean; boxColor: string; align: "center" | "left"; y: number; durationSec: number }

export interface Clip {
  id: string;
  sourceId: string;
  name: string;
  start: number;
  end: number;
  removeSilence: boolean;
  captions: boolean;                 // default false
  composition: Composition;
  headline: Headline;
  captionStyle: CaptionStyle;
  status: "draft" | "selected" | "rejected";
  renderHash?: string;               // hash of the inputs of the last successful render
  lastOutput?: string;
}

export interface SourceMedia {
  id: string;
  path: string;
  info: MediaInfo;
  addedAt: string;
  strip?: { count: number; frameWidth: number; height: number };   // timeline filmstrip
  analysis: {
    silence?: { settings: SilenceSettings; intervals: Interval[]; doneAt: string };
    energy?: { stepSec: number; db: number[]; doneAt: string };
    transcript?: { model: string; language?: string; segments: TranscriptSegment[]; doneAt: string };
    candidates?: { generatedAt: string; items: Candidate[] };
  };
}

export interface Project {
  schema: 1;
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  exportDir?: string;
  sources: SourceMedia[];
  clips: Clip[];
}

export type JobKind = "probe" | "thumbnail" | "silence" | "energy" | "transcribe" | "render";
export type JobState = "queued" | "running" | "done" | "failed" | "cancelled";

export interface Job {
  id: string;
  kind: JobKind;
  label: string;
  projectId?: string;
  clipId?: string;
  sourceId?: string;
  state: JobState;
  progress: number;      // 0..1
  startedAt?: string;
  finishedAt?: string;
  error?: string;
  output?: string;
  attempts: number;
}

export interface Diagnostics { ok: boolean; ffmpeg?: string; ffprobe?: string; missing: string[]; filters: Record<string, boolean>; encoders: Record<string, boolean>; error?: string }
