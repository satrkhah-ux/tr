import { createRequire } from "node:module";
import { mkdir } from "node:fs/promises";
import path from "node:path";

const require = createRequire(import.meta.url);
const { chromium } = require("playwright-core");

const root = process.cwd();
const refsDir = path.join(root, "docs", "design-references", "traveliun");
const chromePath =
  process.env.CHROME_PATH || "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";

const shots = [
  ["local-dashboard-desktop", 1440, 900, "/dashboard"],
  ["local-dashboard-mobile", 390, 844, "/dashboard"],
  ["local-customers-desktop", 1440, 900, "/customers"],
  ["local-signin-desktop", 1440, 900, "/sign-in"],
];

await mkdir(refsDir, { recursive: true });

const browser = await chromium.launch({
  headless: true,
  executablePath: chromePath,
});

try {
  for (const [name, width, height, route] of shots) {
    const page = await browser.newPage({ viewport: { width, height } });
    await page.goto(`http://127.0.0.1:3000${route}`, { waitUntil: "networkidle" });
    await page.screenshot({
      path: path.join(refsDir, `${name}.png`),
      fullPage: true,
    });
    await page.close();
  }
  console.log(JSON.stringify({ captured: shots.length }, null, 2));
} finally {
  await browser.close();
}
