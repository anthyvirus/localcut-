// Projects are JSON files: <dir>/project.json, written atomically (temp file + rename) with
// the previous version kept as project.json.bak, so a crash mid-save can't corrupt a project.
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { copyFile, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { Clip, MediaInfo, Project, SourceMedia } from "../shared/types";
import { DEFAULT_CAPTIONS, DEFAULT_HEADLINE, PRESETS } from "./render";

export const PROJECT_FILE = "project.json";

export function newProject(name: string): Project {
  const now = new Date().toISOString();
  return { schema: 1, id: randomUUID(), name: name.trim() || "Untitled project", createdAt: now, updatedAt: now, sources: [], clips: [] };
}

export function addSource(p: Project, info: MediaInfo): SourceMedia {
  const existing = p.sources.find((s) => s.path === info.path);
  if (existing) { existing.info = info; return existing; }
  const s: SourceMedia = { id: randomUUID(), path: info.path, info, addedAt: new Date().toISOString(), analysis: {} };
  p.sources.push(s);
  return s;
}

export function newClip(sourceId: string, start: number, end: number, name: string): Clip {
  return {
    id: randomUUID(), sourceId, name, start, end, removeSilence: false,
    captions: false,                                   // captions are OFF unless the user turns them on
    composition: { ...PRESETS["blurred-portrait"] }, headline: { ...DEFAULT_HEADLINE }, captionStyle: { ...DEFAULT_CAPTIONS }, status: "draft",
  };
}

export function validateProject(x: unknown): Project {
  const p = x as Project;
  if (!p || p.schema !== 1 || typeof p.id !== "string" || !Array.isArray(p.sources) || !Array.isArray(p.clips)) {
    throw new Error("This isn't a LocalCut project file (or it's from a newer version).");
  }
  for (const c of p.clips) {
    if (typeof c.start !== "number" || typeof c.end !== "number" || !(c.end > c.start)) throw new Error(`Clip "${c.name}" has invalid times.`);
    c.captions = c.captions === true;                  // anything else counts as off
  }
  return p;
}

export async function saveProject(dir: string, p: Project): Promise<void> {
  await mkdir(dir, { recursive: true });
  p.updatedAt = new Date().toISOString();
  const file = join(dir, PROJECT_FILE), tmp = `${file}.tmp-${process.pid}`;
  await writeFile(tmp, JSON.stringify(p, null, 2), "utf8");
  if (existsSync(file)) await copyFile(file, `${file}.bak`);
  await rename(tmp, file);
}

export async function loadProject(dir: string): Promise<Project> {
  const file = join(dir, PROJECT_FILE);
  try {
    return validateProject(JSON.parse(await readFile(file, "utf8")));
  } catch (e) {
    if (existsSync(`${file}.bak`)) return validateProject(JSON.parse(await readFile(`${file}.bak`, "utf8")));
    throw e;
  }
}
