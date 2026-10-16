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
await win.evaluate((d) => window.localcut.settings.set({ exportDir: d }), exportsDir);
await win.click("button:has-text('Settings')");
await win.waitForSelector(".note.ok, .note.err");
ok(await win.isVisible(".note.ok"), "settings: FFmpeg diagnostics pass");
await win.screenshot({ path: join(shots, "5-settings.png") });

// import through the real button (dialog answered by the main process)
await app.evaluate(({ dialog }, f) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [f] }); }, fixture);
await win.click("button:has-text('Projects')");
await win.click("button:has-text('Import Footage')");
await win.waitForSelector(".src");
ok((await win.textContent(".src")).includes("0:40"), "import: the video shows with its real duration");
ok((await win.textContent(".src")).includes("1280×720"), "import: resolution read from the file");
await win.waitForFunction(() => (document.querySelector(".player video")?.readyState ?? 0) >= 2, null, { timeout: 15000 }).catch(() => {});
ok(await win.evaluate(() => document.querySelector(".player video").videoWidth === 1280), "player: the video loads and can play");

// analyse audio
await win.click("button:has-text('Analyse audio')");
await win.waitForSelector("text=/2 silences/", { timeout: 60000 });
ok(true, "analysis: real silences found (2) and loudness measured");
await win.waitForSelector("text=/loudness measured/", { timeout: 60000 });

// suggestions
await win.click(".seg button:has-text('15–35s')");
await win.click("button:has-text('Find moments')");
await win.waitForSelector(".cand", { timeout: 30000 });
const nCands = await win.locator(".cand").count();
ok(nCands >= 1, `suggestions: ${nCands} candidates with scores and signals`);
await win.screenshot({ path: join(shots, "2-suggestions.png") });
const boxes = win.locator(".cand-check input");
for (let i = 0; i < Math.min(2, nCands); i++) await boxes.nth(i).check();
await win.click("button:has-text('Make')");
await win.waitForSelector(".cliplist li");
const nClips = await win.locator(".cliplist li").count();
ok(nClips === Math.min(2, nCands), `clips: ${nClips} clips made from suggestions`);

// inspector: blurred portrait + remove silences + headline
await win.locator(".cl-main").first().click();
await win.waitForSelector(".insp");
ok((await win.inputValue(".insp select")) === "blurred-portrait", "inspector: new clips default to Blurred Portrait");
ok(await win.locator(".seg button:has-text('Captions off')").getAttribute("aria-pressed") === "true", "captions: off by default");
await win.check("label:has-text('Remove silences') input");
await win.check(".insp label:has-text('Headline') input");
await win.fill(".insp textarea", "I STILL BOOKED THE MEETING.");
await win.waitForTimeout(900);
ok(await win.evaluate(() => { const el = document.querySelector(".ws-inspector"); return el.scrollWidth <= el.clientWidth + 1; }), "layout: the inspector fits its column");
ok(await win.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), "layout: no sideways scrolling");
await win.screenshot({ path: join(shots, "3-inspector.png") });

// export the selected clips in a batch
await win.click("button:has-text('selected')");
await win.waitForFunction(() => document.querySelector(".tray-bar")?.textContent?.includes("All jobs finished"), null, { timeout: 180000 });
const files = existsSync(exportsDir) ? readdirSync(exportsDir).filter((f) => f.endsWith(".mp4")) : [];
ok(files.length === nClips, `export: ${files.length} MP4 files written`);
for (const f of files) {
  const dims = execFileSync("ffprobe", ["-v", "error", "-select_streams", "v:0", "-show_entries", "stream=width,height", "-of", "csv=p=0", join(exportsDir, f)]).toString().trim();
  ok(dims === "1080,1920", `export: ${f} is 1080x1920`);
}
await win.click(".tray-bar");
await win.screenshot({ path: join(shots, "4-jobs.png") });

// re-export without changes is skipped (no needless re-render)
await win.click(".tray-bar");
await win.click("button:has-text('selected')");
await win.waitForSelector("text=/already exported/");
ok(true, "export: unchanged clips are not re-rendered");

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
await win.waitForSelector(".cliplist li, .tabs");
await win.click("[role=tab]:has-text('Clips')");
ok((await win.locator(".cliplist li").count()) === nClips, "persistence: clips survive closing and reopening the app");
ok(await win.locator(".cliplist .dot.ok").count() === nClips, "persistence: export status remembered");
await app.close();
console.log(fails ? `\n${fails} FAILED` : "\nALL APP CHECKS PASS");
process.exit(fails ? 1 : 0);
