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
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await page.goto("http://127.0.0.1:3000/packages", { waitUntil: "networkidle" });
  await page.screenshot({ path: path.join(refsDir, "local-packages-full.png"), fullPage: true });

  await page.goto("http://127.0.0.1:3000/customers", { waitUntil: "networkidle" });
  await page.getByLabel("Calculator").click();
  await page.screenshot({ path: path.join(refsDir, "local-calculator-open.png"), fullPage: true });
  await page.getByLabel("Settings").click();
  await page.screenshot({ path: path.join(refsDir, "local-settings-open.png"), fullPage: true });
} finally {
  await browser.close();
}

console.log(JSON.stringify({ captured: 3 }, null, 2));
