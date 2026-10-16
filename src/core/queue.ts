// A small, persistent job queue. Media jobs run one (or `concurrency`) at a time in child
// processes; state is saved after every change so the queue survives an app restart
// (running jobs come back as "failed: interrupted" and can be retried).
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { readFile, rename, writeFile } from "node:fs/promises";
import type { Job, JobKind } from "../shared/types";

export type Work = (job: Job, signal: AbortSignal, progress: (f: number) => void) => Promise<string | void>;

export class JobQueue {
  jobs: Job[] = [];
  private work = new Map<string, Work>();
  private running = new Map<string, AbortController>();
  private listeners = new Set<(jobs: Job[]) => void>();
  private lastEmit = 0;

  constructor(private file?: string, private concurrency = 1) {}

  async restore(): Promise<void> {
    if (!this.file || !existsSync(this.file)) return;
    try {
      this.jobs = (JSON.parse(await readFile(this.file, "utf8")) as Job[]).map((j) =>
        j.state === "running" || j.state === "queued" ? { ...j, state: "failed" as const, error: "Interrupted when LocalCut closed. Retry to run it again." } : j);
    } catch { this.jobs = []; }
  }

  onChange(fn: (jobs: Job[]) => void): () => void { this.listeners.add(fn); return () => this.listeners.delete(fn); }

  private emit(force = false) {
    const now = Date.now();
    if (!force && now - this.lastEmit < 150) return;          // progress updates are throttled
    this.lastEmit = now;
    for (const fn of this.listeners) fn(this.jobs);
    void this.persist();
  }

  private async persist() {
    if (!this.file) return;
    const tmp = `${this.file}.tmp`;
    await writeFile(tmp, JSON.stringify(this.jobs.slice(-200)), "utf8").catch(() => {});
    await rename(tmp, this.file).catch(() => {});
  }

  add(kind: JobKind, label: string, work: Work, meta: Partial<Job> = {}): Job {
    const job: Job = { id: randomUUID(), kind, label, state: "queued", progress: 0, attempts: 0, ...meta };
    this.jobs.push(job);
    this.work.set(job.id, work);
    this.emit(true);
    this.pump();
    return job;
  }

  cancel(id: string) {
    const j = this.jobs.find((x) => x.id === id);
    if (!j) return;
    if (j.state === "queued") { j.state = "cancelled"; j.finishedAt = new Date().toISOString(); this.emit(true); }
    this.running.get(id)?.abort();
  }

  /** Retry a failed or cancelled job; needs its work function (re-registered after a restart). */
  retry(id: string, work?: Work): boolean {
    const j = this.jobs.find((x) => x.id === id);
    if (!j || !["failed", "cancelled"].includes(j.state)) return false;
    if (work) this.work.set(id, work);
    if (!this.work.has(id)) return false;
    Object.assign(j, { state: "queued", progress: 0, error: undefined, finishedAt: undefined });
    this.emit(true);
    this.pump();
    return true;
  }

  clearFinished() { this.jobs = this.jobs.filter((j) => j.state === "queued" || j.state === "running"); this.emit(true); }

  private pump() {
    while (this.running.size < this.concurrency) {
      const next = this.jobs.find((j) => j.state === "queued");
      if (!next) return;
      void this.start(next);
    }
  }

  private async start(j: Job) {
    const work = this.work.get(j.id);
    if (!work) { j.state = "failed"; j.error = "Nothing to run for this job."; this.emit(true); return; }
    const ac = new AbortController();
    this.running.set(j.id, ac);
    Object.assign(j, { state: "running", startedAt: new Date().toISOString(), attempts: j.attempts + 1, progress: 0 });
    this.emit(true);
    try {
      const out = await work(j, ac.signal, (f) => { j.progress = Math.max(0, Math.min(1, f)); this.emit(); });
      Object.assign(j, { state: "done", progress: 1, output: out || j.output });
    } catch (e) {
      j.state = ac.signal.aborted ? "cancelled" : "failed";
      j.error = ac.signal.aborted ? undefined : ((e as { stderrTail?: string }).stderrTail ? `${(e as Error).message}\n${(e as { stderrTail: string }).stderrTail}` : (e as Error).message);
    } finally {
      j.finishedAt = new Date().toISOString();
      this.running.delete(j.id);
      this.emit(true);
      this.pump();
    }
  }

  idle(): Promise<void> {
    return new Promise((res) => {
      const check = () => { if (!this.jobs.some((j) => j.state === "queued" || j.state === "running")) { off(); res(); } };
      const off = this.onChange(check);
      check();
    });
  }
}
