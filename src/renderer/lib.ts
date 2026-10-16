import type { LocalCutApi } from "../shared/api";
declare global { interface Window { localcut: LocalCutApi; localcutFiles: { pathFor(f: File): string } } }
export const api = (): LocalCutApi => window.localcut;

export function clock(sec: number, withTenths = false): string {
  const s = Math.max(0, sec), h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), r = s % 60;
  const ss = withTenths ? r.toFixed(1).padStart(4, "0") : String(Math.floor(r)).padStart(2, "0");
  return h ? `${h}:${String(m).padStart(2, "0")}:${ss}` : `${m}:${ss}`;
}
export const bytes = (n: number) => n >= 1e9 ? `${(n / 1e9).toFixed(1)} GB` : n >= 1e6 ? `${(n / 1e6).toFixed(0)} MB` : `${Math.round(n / 1e3)} KB`;
export const baseName = (p: string) => p.split(/[\\/]/).pop() ?? p;
export const errText = (e: unknown) => String((e as Error)?.message ?? e).replace(/^Error invoking remote method '[^']+': (Error: )?/, "");
