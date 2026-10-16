// A small, consistent line-icon set (1.5px strokes on a 16px grid). No emoji anywhere.
import type { ReactElement } from "react";
const P: Record<string, ReactElement> = {
  logo: <><rect x="2" y="3" width="12" height="10" rx="1.5" /><path d="M6 3v10M2 8h4M10 6.5 12 8l-2 1.5" /></>,
  projects: <><rect x="2" y="3" width="12" height="10" rx="1.5" /><path d="M2 6h12" /></>,
  obs: <><circle cx="8" cy="8" r="5.5" /><circle cx="8" cy="8" r="2" /></>,
  settings: <><circle cx="8" cy="8" r="2" /><path d="M8 1.5v2M8 12.5v2M1.5 8h2M12.5 8h2M3.4 3.4l1.4 1.4M11.2 11.2l1.4 1.4M3.4 12.6l1.4-1.4M11.2 4.8l1.4-1.4" /></>,
  import: <><path d="M8 2v8M5 7l3 3 3-3" /><path d="M2.5 11v2.5h11V11" /></>,
  folder: <path d="M2 4.5c0-.6.4-1 1-1h3l1.5 1.5H13c.6 0 1 .4 1 1V12c0 .6-.4 1-1 1H3c-.6 0-1-.4-1-1z" />,
  play: <path d="M5 3.5v9l7-4.5z" />,
  pause: <path d="M5 3.5v9M11 3.5v9" />,
  scissors: <><circle cx="4.5" cy="4.5" r="2" /><circle cx="4.5" cy="11.5" r="2" /><path d="M6.2 5.6 13.5 12M6.2 10.4 13.5 4" /></>,
  wave: <path d="M1.5 8h1.5M4.5 5v6M7 3v10M9.5 6v4M12 4.5v7M14.5 8h0" />,
  text: <path d="M3 4V3h10v1M8 3v10M6 13h4" />,
  spark: <path d="M8 2v3M8 11v3M2 8h3M11 8h3M4 4l2 2M10 10l2 2M12 4l-2 2M6 10l-2 2" />,
  export: <><path d="M8 10V2M5 5l3-3 3 3" /><path d="M2.5 9v4.5h11V9" /></>,
  check: <path d="m3 8.5 3 3 7-7" />,
  x: <path d="m4 4 8 8M12 4l-8 8" />,
  retry: <><path d="M13 8a5 5 0 1 1-1.5-3.6" /><path d="M13 2.5V5h-2.5" /></>,
  reveal: <><path d="M9 3h4v4M13 3 8 8" /><path d="M11 9.5V13H3V5h3.5" /></>,
  trash: <path d="M3 4.5h10M6.5 4.5V3h3v1.5M4.5 4.5l.7 9h5.6l.7-9" />,
  plus: <path d="M8 3v10M3 8h10" />,
  inmark: <path d="M5 3v10M5 8h7" />,
  outmark: <path d="M11 3v10M11 8H4" />,
  link: <path d="M7 9.5 9.5 7M6 6.5 4.6 7.9a2.5 2.5 0 0 0 3.5 3.5L9.5 10M10 9.5l1.4-1.4a2.5 2.5 0 0 0-3.5-3.5L6.5 6" />,
  chevron: <path d="m6 4 4 4-4 4" />,
  film: <><rect x="2" y="3" width="12" height="10" rx="1" /><path d="M5 3v10M11 3v10M2 6h3M2 10h3M11 6h3M11 10h3" /></>,
  undo: <><path d="M5.5 4 3 6.5 5.5 9" /><path d="M3 6.5h6.5a3.5 3.5 0 0 1 0 7H7" /></>,
  redo: <><path d="M10.5 4 13 6.5 10.5 9" /><path d="M13 6.5H6.5a3.5 3.5 0 0 0 0 7H9" /></>,
  back: <><path d="M8 4.5 4.5 8 8 11.5M12 4.5 8.5 8l3.5 3.5" /></>,
  fwd: <><path d="M8 4.5 11.5 8 8 11.5M4 4.5 7.5 8 4 11.5" /></>,
  volume: <><path d="M2.5 6h2.5L8 3.5v9L5 10H2.5z" /><path d="M10.5 6a2.5 2.5 0 0 1 0 4M12 4.5a4.5 4.5 0 0 1 0 7" /></>,
  full: <path d="M2.5 6V2.5H6M10 2.5h3.5V6M13.5 10v3.5H10M6 13.5H2.5V10" />,
  magnet: <path d="M3.5 3v5a4.5 4.5 0 0 0 9 0V3h-3v5a1.5 1.5 0 0 1-3 0V3zM3.5 5.5h3M9.5 5.5h3" />,
  minus: <path d="M3 8h10" />,
};
export function Icon({ name, size = 16, className }: { name: keyof typeof P | string; size?: number; className?: string }) {
  return <svg className={`ico ${className ?? ""}`} width={size} height={size} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{P[name] ?? null}</svg>;
}
