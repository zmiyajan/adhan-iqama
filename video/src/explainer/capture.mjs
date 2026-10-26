// Captures real app screens for the explainer video.
// Re-run after any app change:  node explainer/capture.mjs
// Serves ../public on :8794 (reuses a server already there), stages each moment with a fake clock,
// and writes 1170×2532 PNGs (390×844 @3) to explainer/shots/.
import { chromium } from "playwright";
import { spawn } from "node:child_process";
import { copyFileSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const PUBLIC = join(HERE, "..", "..", "..", "public");   // the site: adhan-web/public
const OUT = join(HERE, "shots");
let PORT = 8794;
let URL = `http://127.0.0.1:${PORT}/`;
const IPHONE_UA = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1";

// Settings open, scrolled so the «التنبيهات» group sits in the middle (falls back to the top of the sheet).
function openAlerts() {
  document.getElementById("openSettings")?.click();
  const g = document.getElementById("preSeg")?.closest(".group") || document.getElementById("warnSeg")?.closest(".group");
  g?.scrollIntoView({ block: "center" });
}

// Each shot: a moment in Makkah time (UTC given), a theme, and an optional action once loaded.
// 2026-10-25 is a Sunday: Asr adhan 15:22, iqama 15:42 (+03). 2026-10-30 is a Friday.
const SHOTS = [
  { name: "home-dark", time: "2026-10-25T11:58:12Z", theme: "dark" },
  { name: "home-light", time: "2026-10-25T11:58:12Z", theme: "light" },
  { name: "friday-dark", time: "2026-10-30T07:40:00Z", theme: "dark" },
  { name: "iqama-ring", time: "2026-10-25T12:41:30Z", theme: "dark" },
  { name: "iqama-now", time: "2026-10-25T12:41:56Z", theme: "dark", run: 6000 },
  { name: "radio-dark", time: "2026-10-25T11:58:12Z", theme: "dark",
    act: () => {
      // No audio in headless: show the playing look without the stream.
      try { radioOn = true; radioUI("playing"); } catch { document.getElementById("radio")?.classList.add("on"); }
    } },
  { name: "settings-dark", time: "2026-10-25T11:58:12Z", theme: "dark", act: openAlerts },
  { name: "settings-light", time: "2026-10-25T11:58:12Z", theme: "light", act: openAlerts },
  { name: "landscape-dark", time: "2026-10-25T11:58:12Z", theme: "dark", landscape: true },
  { name: "landscape-light", time: "2026-10-25T11:58:12Z", theme: "light", landscape: true },
  { name: "welcome-ios", time: "2026-10-25T11:58:12Z", theme: "dark", welcome: true, ua: IPHONE_UA, run: 800 },
];

// A server already on the port is reused only if it serves this very public/ (another one may hold the port).
const LOCAL_INDEX = readFileSync(join(PUBLIC, "index.html"), "utf8");
async function get(port) {
  try { const r = await fetch(`http://127.0.0.1:${port}/index.html`); return r.ok ? await r.text() : null; } catch { return null; }
}

async function serve() {
  for (; PORT < 8894; PORT++) {
    const body = await get(PORT);
    if (body === LOCAL_INDEX) break;      // ours: reuse it
    if (body !== null) continue;          // someone else's server
    const p = spawn("python3", ["-m", "http.server", String(PORT), "--bind", "127.0.0.1", "--directory", PUBLIC], { stdio: "ignore" });
    for (let i = 0; i < 50 && (await get(PORT)) === null; i++) await new Promise(r => setTimeout(r, 100));
    if ((await get(PORT)) === LOCAL_INDEX) { URL = `http://127.0.0.1:${PORT}/`; console.log(`serving public/ on :${PORT}`); return p; }
    p.kill();
  }
  if ((await get(PORT)) !== LOCAL_INDEX) throw new Error("could not serve public/ on any port 8794–8893");
  URL = `http://127.0.0.1:${PORT}/`;
  return null;
}

const server = await serve();
mkdirSync(OUT, { recursive: true });
// The app icon, so a new logo shows up in the video too.
copyFileSync(join(PUBLIC, "icon-512.png"), join(OUT, "icon.png"));
const browser = await chromium.launch();
try {
  for (const s of SHOTS) {
    const ctx = await browser.newContext({
      viewport: s.landscape ? { width: 844, height: 390 } : { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true,
      timezoneId: "Asia/Riyadh", locale: "ar-SA", serviceWorkers: "block", reducedMotion: "reduce",
      colorScheme: s.theme, userAgent: s.ua,
    });
    const page = await ctx.newPage();
    await page.clock.install({ time: new Date(s.time) });
    await page.addInitScript(([theme, welcome]) => {
      // City 0 is Makkah; keep the app defaults, only fix the theme.
      const prev = JSON.parse(localStorage.getItem("adhan-web") || "{}");
      localStorage.setItem("adhan-web", JSON.stringify({ ...prev, city: 0, theme }));
      if (welcome) localStorage.removeItem("adhan-web-welcome");
      else localStorage.setItem("adhan-web-welcome", "1");
    }, [s.theme, !!s.welcome]);
    await page.goto(URL, { waitUntil: "networkidle" });
    await page.evaluate(() => document.fonts.ready);
    await page.clock.runFor(s.run ?? 1200);
    if (s.act) await page.evaluate(s.act);
    await page.clock.runFor(300);
    await page.waitForTimeout(700);   // real time for any CSS transition left
    const fonts = await page.evaluate(() => [...document.fonts].filter(f => f.status === "loaded").length);
    await page.screenshot({ path: join(OUT, `${s.name}.png`) });
    console.log(`shot ${s.name}${fonts ? "" : "  (warning: web fonts did not load)"}`);
    await ctx.close();
  }
} finally {
  await browser.close();
  server?.kill();
}
