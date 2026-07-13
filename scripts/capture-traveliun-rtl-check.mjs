import { createRequire } from "node:module";
import { mkdir } from "node:fs/promises";
import path from "node:path";

const require = createRequire(import.meta.url);
const { chromium } = require("playwright-core");

const root = process.cwd();
const refsDir = path.join(root, "docs", "design-references", "traveliun");
const chromePath =
  process.env.CHROME_PATH || "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";

await mkdir(refsDir, { recursive: true });

const browser = await chromium.launch({ headless: true, executablePath: chromePath });
try {
  const page = await browser.newPage({ viewport: { width: 1903, height: 1031 } });
  await page.goto("http://127.0.0.1:3000/offers", { waitUntil: "networkidle" });
  await page.screenshot({ path: path.join(refsDir, "local-offers-rtl-fixed.png"), fullPage: true });

  await page.getByLabel("Open sidebar").click();
  await page.screenshot({ path: path.join(refsDir, "local-offers-menu-fixed.png"), fullPage: true });
} finally {
  await browser.close();
}

console.log(JSON.stringify({ captured: 2 }, null, 2));
