// Renders composition.html frame by frame and encodes H.264 with ffmpeg-static.
//   node explainer/render.mjs                    vertical 1080×1920 → out/adhan-explainer.mp4
//   node explainer/render.mjs --fmt square       1080×1080 → out/adhan-explainer-square.mp4
//   node explainer/render.mjs --stills 2,8,26    PNGs only (out/still-<t>.png), no video
// Frames go to .frames/<fmt>/ and are deleted after encoding.
import { chromium } from "playwright";
import { spawnSync } from "node:child_process";
import { mkdirSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createRequire } from "node:module";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..");
const FFMPEG = createRequire(import.meta.url)("ffmpeg-static");

const arg = (name, def) => { const i = process.argv.indexOf(`--${name}`); return i > 0 ? process.argv[i + 1] : def; };
const FMT = arg("fmt", "vertical");
const FPS = +arg("fps", 30);
const WORKERS = +arg("workers", 6);
const STILLS = arg("stills", null);
const SIZE = FMT === "square" ? { width: 1080, height: 1080 } : { width: 1080, height: 1920 };
const OUT = join(ROOT, "..", "out");   // adhan-web/video/out
const FRAMES = join(ROOT, ".frames", FMT);
const NAME = FMT === "square" ? "adhan-explainer-square.mp4" : "adhan-explainer.mp4";
const URL = pathToFileURL(join(HERE, "composition.html")).href + `?fmt=${FMT}`;

async function openPage(browser) {
  const page = await browser.newPage({ viewport: SIZE, deviceScaleFactor: 1 });
  await page.goto(URL, { waitUntil: "networkidle" });
  const fontsOk = await page.evaluate(() => window.ready);
  if (!fontsOk) throw new Error("web fonts did not load (Amiri / IBM Plex Sans Arabic); check the network");
  return page;
}

async function shoot(page, t, path) {
  await page.evaluate(t => { window.seek(t); return new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))); }, t);
  await page.screenshot({ path, type: "png" });
}

mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch();
try {
  if (STILLS) {
    const page = await openPage(browser);
    for (const t of STILLS.split(",").map(Number)) {
      const p = join(OUT, `still-${FMT === "square" ? "sq-" : ""}${t}.png`);
      await shoot(page, t, p);
      console.log(p);
    }
  } else {
    rmSync(FRAMES, { recursive: true, force: true });
    mkdirSync(FRAMES, { recursive: true });
    const duration = await (await openPage(browser)).evaluate(() => window.DURATION);
    const total = Math.round(duration * FPS);
    let done = 0;
    const started = Date.now();
    // Frames are split into interleaved sets, one page each; every frame depends on t alone.
    await Promise.all(Array.from({ length: WORKERS }, async (_, w) => {
      const page = await openPage(browser);
      for (let f = w; f < total; f += WORKERS) {
        await shoot(page, f / FPS, join(FRAMES, `f${String(f).padStart(5, "0")}.png`));
        if (++done % 150 === 0) console.log(`${done}/${total} frames, ${((Date.now() - started) / done).toFixed(0)} ms/frame`);
      }
    }));
    console.log(`rendered ${total} frames in ${((Date.now() - started) / 1000).toFixed(0)} s`);
    const out = join(OUT, NAME);
    const r = spawnSync(FFMPEG, ["-y", "-loglevel", "error", "-framerate", String(FPS), "-i", join(FRAMES, "f%05d.png"),
      "-c:v", "libx264", "-pix_fmt", "yuv420p", "-profile:v", "high", "-level", "4.2", "-crf", "18", "-preset", "slow",
      "-movflags", "+faststart", out], { stdio: "inherit" });
    if (r.status !== 0) throw new Error("ffmpeg failed");
    rmSync(join(ROOT, ".frames"), { recursive: true, force: true });
    console.log(out);
  }
} finally {
  await browser.close();
}
