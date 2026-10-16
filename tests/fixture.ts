// Test media generated locally with FFmpeg (no copyrighted footage in the repo).
// 1280x720 test pattern, 40 s. Audio: "talk" (tones) with deliberate silences:
//   0-6 tone, 6-9 silence(3s), 9-15 tone, 15-15.5 pause(0.5s), 15.5-22 tone (louder),
//   22-26 silence(4s), 26-40 tone
import { existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { run } from "../src/core/ffmpeg";

export const OUT = join(__dirname, ".out");
export const FIXTURE = join(OUT, "fixture-landscape.mp4");

export async function ensureFixture(): Promise<string> {
  mkdirSync(OUT, { recursive: true });
  if (existsSync(FIXTURE)) return FIXTURE;
  const vol = "if(between(t,6,9)+between(t,15,15.5)+between(t,22,26),0,if(between(t,15.5,22),0.9,0.35))";
  await run("ffmpeg", ["-hide_banner", "-y",
    "-f", "lavfi", "-i", "testsrc2=size=1280x720:rate=30:duration=40",
    "-f", "lavfi", "-i", "sine=frequency=220:sample_rate=48000:duration=40",
    "-filter_complex", `[1:a]volume='${vol}':eval=frame[a]`,
    "-map", "0:v", "-map", "[a]", "-c:v", "libx264", "-preset", "ultrafast", "-pix_fmt", "yuv420p", "-c:a", "aac", "-shortest", FIXTURE]);
  return FIXTURE;
}
