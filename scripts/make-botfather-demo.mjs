// Records a REAL walkthrough of the deployed system (phone viewport) and
// assembles the BotFather demo GIF (640x360): sign-in → dashboard → generator
// (Teletel picker) → repackage → kanban. Output: Desktop/traveliun-botfather-demo.gif
// Usage: node scripts/make-botfather-demo.mjs
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import puppeteer from "puppeteer-core";
import sharp from "sharp";
import gifencPkg from "gifenc";
const { GIFEncoder, quantize, applyPalette } = gifencPkg;

const BASE = "https://traveliun.netlify.app";
const OUT = "C:/Users/al3r1/OneDrive/Desktop/traveliun-botfather-demo.gif";
const W = 640, H = 360, PHONE_H = 336;
const GREEN = "#185045";

// admin demo account (seeded)
function loadEnv() {
  const env = {};
  for (const line of readFileSync(".env.local", "utf8").split(/\r?\n/)) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m) env[m[1]] = m[2].trim();
  }
  return env;
}

const CANDIDATES = [
  process.env.CHROME_PATH,
  "C:/Program Files/Google/Chrome/Application/chrome.exe",
  "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe",
  "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
  "C:/Program Files/Microsoft/Edge/Application/msedge.exe",
].filter(Boolean);
const exe = CANDIDATES.find((p) => existsSync(p));
if (!exe) { console.error("no chromium"); process.exit(1); }

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function frame(page) {
  const shot = await page.screenshot({ type: "png" });
  const phone = await sharp(shot).resize({ height: PHONE_H }).png().toBuffer();
  const meta = await sharp(phone).metadata();
  const bg = Buffer.from(
    `<svg width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg">
      <rect width="${W}" height="${H}" fill="${GREEN}"/>
      <circle cx="590" cy="40" r="120" fill="#ffffff" opacity="0.05"/>
      <circle cx="50" cy="330" r="100" fill="#ffffff" opacity="0.05"/>
    </svg>`,
  );
  // phone screenshot centered with a rounded white border card feel
  const composed = await sharp(bg)
    .composite([{ input: phone, top: Math.round((H - PHONE_H) / 2), left: Math.round((W - (meta.width ?? 155)) / 2) }])
    .ensureAlpha()
    .raw()
    .toBuffer();
  return composed;
}

const frames = [];
const browser = await puppeteer.launch({ executablePath: exe, headless: true, args: ["--no-sandbox", "--lang=ar"] });
const page = await browser.newPage();
await page.setViewport({ width: 375, height: 812 });

// 1) sign-in
await page.goto(`${BASE}/sign-in`, { waitUntil: "networkidle2", timeout: 60000 });
await sleep(1200);
frames.push(await frame(page));

// 2) login → dashboard (executive)
await page.type('input[type="email"]', "admin@admin.com");
await page.type('input[type="password"]', "Traveliun#2026");
await Promise.all([
  page.click('button[type="submit"]'),
  page.waitForNavigation({ waitUntil: "networkidle2", timeout: 60000 }).catch(() => null),
]);
await sleep(4500); // exec data + charts animation
frames.push(await frame(page));

// 3) dashboard scrolled (charts)
await page.evaluate(() => window.scrollTo({ top: 700 }));
await sleep(1200);
frames.push(await frame(page));

// 4) package generator (drafts list)
await page.goto(`${BASE}/package-generator`, { waitUntil: "networkidle2", timeout: 60000 });
await sleep(1500);
frames.push(await frame(page));

// 5) repackage (supplier PDF redesign)
await page.goto(`${BASE}/repackage`, { waitUntil: "networkidle2", timeout: 60000 });
await sleep(1500);
frames.push(await frame(page));

// 6) kanban board
await page.goto(`${BASE}/kanban-board`, { waitUntil: "networkidle2", timeout: 60000 });
await sleep(2000);
frames.push(await frame(page));

await browser.close();

// assemble GIF (~1.2s per scene)
const gif = GIFEncoder();
for (const rgba of frames) {
  const palette = quantize(rgba, 256);
  const indexed = applyPalette(rgba, palette);
  gif.writeFrame(indexed, W, H, { palette, delay: 1200 });
}
gif.finish();
writeFileSync(OUT, Buffer.from(gif.bytes()));
console.log("wrote", OUT, `(${frames.length} frames, ${Math.round(Buffer.from(gif.bytes()).length / 1024)} KB)`);
