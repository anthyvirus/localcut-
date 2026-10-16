// Drives the real Electron app (Playwright _electron) under a virtual display.
//   xvfb-run -a node tests/app.e2e.mjs
// Native file dialogs are answered from the main process; everything else is real clicks.
import { createRequire } from "node:module";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, rmSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
let pw;
for (const p of ["playwright", "/root/.npm/_npx/e41f203b7505f1fb/node_modules/playwright"]) { try { pw = require(p); break; } catch {} }
const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = join(root, "tests", ".out");
const data = join(OUT, "e2e-userdata"), exportsDir = join(OUT, "e2e-exports"), shots = join(OUT, "shots");
rmSync(data, { recursive: true, force: true }); rmSync(exportsDir, { recursive: true, force: true }); mkdirSync(shots, { recursive: true });
const fixture = join(OUT, "fixture-landscape.mp4");
if (!existsSync(fixture)) throw new Error("run the vitest suite first to generate tests/.out/fixture-landscape.mp4");

let fails = 0;
const ok = (c, m) => { console.log(`${c ? "ok  " : "FAIL"} ${m}`); if (!c) fails++; };
const launch = () => pw._electron.launch({ executablePath: join(root, "node_modules/electron/dist/electron"), args: [root, "--no-sandbox"], env: { ...process.env, LOCALCUT_USER_DATA: data } });

let app = await launch();
let win = await app.firstWindow();
const errors = [];
win.on("pageerror", (e) => errors.push(e.message));
win.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
await win.waitForSelector("text=Import Footage");
await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1440, 900));
await win.waitForTimeout(300);
await win.screenshot({ path: join(shots, "1-projects.png") });
ok(await win.isVisible("button:has-text('Import Footage')"), "home: Import Footage is the primary action");

// settings: export folder for the test, diagnostics
// low-memory test server: the fastest x264 preset keeps the encoder small next to Electron
await win.evaluate((d) => window.localcut.settings.set({ exportDir: d, quality: { crf: 23, preset: "ultrafast", audioKbps: 128, normalize: true, threads: 1 } }), exportsDir);
await win.click("button:has-text('Settings')");
await win.waitForSelector(".note.ok, .note.err");
ok(await win.isVisible(".note.ok"), "settings: FFmpeg diagnostics pass");
await win.screenshot({ path: join(shots, "5-settings.png") });

// import through the real button (dialog answered by the main process) -> the editor opens
await app.evaluate(({ dialog }, f) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [f] }); }, fixture);
await win.click("button:has-text('Projects')");
await win.click("button:has-text('Import Footage')");
await win.waitForSelector(".ed .media-grid .src");
const card = await win.textContent(".media-grid .src");
ok(card.includes("0:40") && card.includes("1280×720"), "import: media card shows real duration and resolution");
await win.waitForFunction(() => (document.querySelector(".canvas video")?.readyState ?? 0) >= 2, null, { timeout: 15000 }).catch(() => {});
ok(await win.evaluate(() => document.querySelector(".canvas video").videoWidth === 1280), "preview: the video loads in the stage");
await win.waitForFunction(() => document.querySelector(".poster img")?.naturalWidth > 0, null, { timeout: 15000 }).catch(() => {});
ok(await win.evaluate(() => document.querySelector(".poster img").naturalWidth > 0), "media: poster thumbnail loads");

// audio analysis from the Audio panel
await win.click(".rail-btn:has-text('Audio')");
await win.click("button:has-text('Analyse audio')");
await win.waitForSelector("text=/2 silences/", { timeout: 60000 });
await win.waitForSelector("text=/loudness measured/", { timeout: 60000 });
ok(true, "analysis: real silences found (2) and loudness measured");

// moments -> timeline
await win.click(".rail-btn:has-text('Moments')");
await win.click(".seg button:has-text('15–35s')");
await win.click("button:has-text('Find moments')");
await win.waitForSelector(".cand", { timeout: 30000 });
const nCands = await win.locator(".cand").count();
ok(nCands >= 1, `moments: ${nCands} scored suggestions`);
ok(await win.locator(".tl-track.moments .mk").count() === nCands, "timeline: moments track shows the suggestions");
await win.locator(".cand-check input").first().check();
await win.click("button:has-text('to timeline')");
await win.waitForSelector(".tl-track.clips .clip");
ok(await win.locator(".tl-track.clips .clip").count() === 1, "timeline: the moment becomes a clip on the clips track");
await win.waitForFunction(() => !document.body.textContent.includes("Making filmstrip"), null, { timeout: 60000 }).catch(() => {});
ok(!(await win.textContent(".tl")).includes("Making filmstrip"), "timeline: filmstrip thumbnails are drawn on the video track");

// select the clip -> tabbed properties
await win.click(".tl-track.clips .clip .clip-name");
await win.waitForSelector(".props select");
ok((await win.inputValue(".props select")) === "blurred-portrait", "properties: new clips default to Blurred Portrait");
ok(await win.locator(".clip.sel").count() === 1, "timeline: the selected clip is outlined with trim handles");
const clipBox = await win.locator(".clip.sel").boundingBox();

// split at the playhead (Ctrl+B), undo, redo
await win.mouse.click(clipBox.x + clipBox.width / 2, (await win.locator(".tl-ruler").boundingBox()).y + 10);
await win.waitForTimeout(200);
await win.click(".tl-track.clips .clip .clip-name", { timeout: 5000 });
await win.keyboard.press("Control+b");
await win.waitForFunction(() => document.querySelectorAll(".tl-track.clips .clip").length === 2, null, { timeout: 5000 }).catch(() => {});
ok(await win.locator(".tl-track.clips .clip").count() === 2, "edit: Ctrl+B splits the clip at the playhead");
await win.keyboard.press("Control+z");
await win.waitForFunction(() => document.querySelectorAll(".tl-track.clips .clip").length === 1, null, { timeout: 5000 }).catch(() => {});
ok(await win.locator(".tl-track.clips .clip").count() === 1, "edit: Ctrl+Z undoes the split");
await win.keyboard.press("Control+Shift+z");
await win.waitForFunction(() => document.querySelectorAll(".tl-track.clips .clip").length === 2, null, { timeout: 5000 }).catch(() => {});
ok(await win.locator(".tl-track.clips .clip").count() === 2, "edit: Ctrl+Shift+Z redoes it");
await win.keyboard.press("Control+z");
await win.waitForFunction(() => document.querySelectorAll(".tl-track.clips .clip").length === 1, null, { timeout: 5000 }).catch(() => {});

// trim with the right handle
await win.click(".tl-track.clips .clip .clip-name");
const before = await win.locator(".clip.sel .clip-len").textContent();
const h = await win.locator(".clip.sel .h.r").boundingBox();
await win.mouse.move(h.x + 3, h.y + h.height / 2); await win.mouse.down(); await win.mouse.move(h.x - 60, h.y + h.height / 2, { steps: 6 }); await win.mouse.up();
await win.waitForTimeout(600);
const after = await win.locator(".clip.sel .clip-len").textContent();
ok(parseFloat(after) < parseFloat(before), `edit: dragging the trim handle shortens the clip (${before} -> ${after})`);

// properties tabs: captions off by default, remove silences, headline
await win.click(".props-tabs [role=tab]:has-text('Captions')");
ok(await win.locator(".seg button:has-text('Captions off')").getAttribute("aria-pressed") === "true", "captions: off by default");
await win.click(".props-tabs [role=tab]:has-text('Audio')");
await win.check(".props label:has-text('Remove silences') input");
await win.click(".props-tabs [role=tab]:has-text('Text')");
await win.check(".props label:has-text('Headline') input");
await win.fill(".props textarea", "I STILL BOOKED THE MEETING.");
await win.waitForTimeout(900);
ok(await win.locator(".cv-head").count() === 1, "preview: the headline shows on the stage");
ok(await win.evaluate(() => { const el = document.querySelector(".props-body"); return el.scrollWidth <= el.clientWidth + 1; }), "layout: properties fit their column");
ok(await win.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), "layout: no sideways scrolling");
await win.screenshot({ path: join(shots, "3-editor.png") });

// export from the top bar
await win.click(".ed-export");
await win.waitForFunction(() => document.querySelector(".tray-bar")?.textContent?.includes("All jobs finished"), null, { timeout: 180000 });
const files = existsSync(exportsDir) ? readdirSync(exportsDir).filter((f) => f.endsWith(".mp4")) : [];
ok(files.length === 1, `export: ${files.length} MP4 file written`);
for (const f of files) {
  const dims = execFileSync("ffprobe", ["-v", "error", "-select_streams", "v:0", "-show_entries", "stream=width,height", "-of", "csv=p=0", join(exportsDir, f)]).toString().trim();
  ok(dims === "1080,1920", `export: ${f} is 1080x1920`);
}
await win.click(".ed-export");
await win.waitForSelector("text=/already exported/");
ok(true, "export: unchanged clips are not re-rendered");
const nClips = 1;
await win.click(".ed-top button:has-text('Projects')");

// OBS without OBS running: an honest failure, not a fake connection
await win.click("button:has-text('OBS')");
await win.click("button:has-text('Connect')");
await win.waitForSelector(".note.err", { timeout: 15000 });
ok((await win.textContent(".note.err")).includes("Couldn't reach OBS"), "obs: shows a clear error when OBS isn't running");
await win.screenshot({ path: join(shots, "6-obs.png") });
ok(errors.length === 0, `no console errors ${errors.slice(0, 2).join(" | ")}`);
await app.close();

// persistence: reopen the app, the project and its clips are still there
app = await launch();
win = await app.firstWindow();
await win.waitForSelector(".plist-item");
await win.locator(".plist-item").first().click();
await win.waitForSelector(".tl-track.clips");
await win.waitForTimeout(500);
ok((await win.locator(".tl-track.clips .clip").count()) === nClips, "persistence: clips survive closing and reopening the app");
await win.click(".rail-btn:has-text('Clips')");
ok(await win.locator(".cliplist .dot.ok").count() === nClips, "persistence: export status remembered");
await app.close();
console.log(fails ? `\n${fails} FAILED` : "\nALL APP CHECKS PASS");
process.exit(fails ? 1 : 0);
