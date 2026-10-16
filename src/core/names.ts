// Output file names: readable, safe on Windows/macOS/Linux, never overwriting an existing file.
import { existsSync } from "node:fs";
import { join } from "node:path";

const RESERVED = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i;

export function safeName(name: string, max = 80): string {
  let s = name.normalize("NFKD").replace(/[̀-ͯ]/g, "").replace(/[<>:"/\\|?*\x00-\x1f]/g, " ").replace(/\s+/g, " ").trim();
  s = s.replace(/[. ]+$/, "").slice(0, max).trim();
  if (!s || RESERVED.test(s)) s = `clip${s ? `-${s}` : ""}`;
  return s;
}

/** "<dir>/<name>.mp4", or "<name> (2).mp4" etc. if taken (by a file or by another queued job). */
export function uniqueOutput(dir: string, name: string, ext = "mp4", taken: Set<string> = new Set()): string {
  const base = safeName(name);
  for (let n = 1; n < 10000; n++) {
    const p = join(dir, `${base}${n > 1 ? ` (${n})` : ""}.${ext}`);
    if (!existsSync(p) && !taken.has(p)) return p;
  }
  throw new Error("Couldn't find a free file name.");
}
