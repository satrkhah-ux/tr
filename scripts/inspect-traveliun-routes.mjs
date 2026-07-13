import { createRequire } from "node:module";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

const require = createRequire(import.meta.url);
const { chromium } = require("playwright-core");

const root = process.cwd();
const researchDir = path.join(root, "docs", "research", "traveliun");
const refsDir = path.join(root, "docs", "design-references", "traveliun", "routes");
const chromePath =
  process.env.CHROME_PATH || "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";

const sampleRoutes = [
  "/dashboard",
  "/kanban-board",
  "/customers",
  "/employees",
  "/packages",
  "/countries",
  "/hotels",
  "/flights",
  "/sea-travels",
  "/transportation",
  "/services",
  "/visas",
  "/settings",
  "/customers-care",
  "/web-guide",
];

async function login(page) {
  await page.goto("https://app.traveliun.com/sign-in", { waitUntil: "networkidle" });
  await page.fill("#signInEmail", process.env.TRAVELIUN_EMAIL || "");
  await page.fill("#signInPassword", process.env.TRAVELIUN_PASSWORD || "");
  await page.click('button:has-text("Login")');
  await page.waitForURL("**/dashboard", { timeout: 20000 }).catch(() => {});
  await page.waitForLoadState("networkidle", { timeout: 15000 }).catch(() => {});
}

async function extractRoute(page) {
  return page.evaluate(() => {
    const text = document.body.innerText.replace(/\s+/g, " ").trim();
    const links = [...document.querySelectorAll("a[href]")]
      .map((a) => ({
        text: (a.innerText || a.title || a.getAttribute("aria-label") || "").replace(/\s+/g, " ").trim(),
        href: a.href,
        classes: typeof a.className === "string" ? a.className.slice(0, 120) : "",
      }))
      .filter((link) => link.href.includes("app.traveliun.com"));
    const inputs = [...document.querySelectorAll("input, textarea, select")].map((input) => ({
      tag: input.tagName.toLowerCase(),
      type: input.getAttribute("type"),
      id: input.id,
      label: input.getAttribute("label"),
      placeholder: input.getAttribute("placeholder"),
      value: input.value,
      classes: typeof input.className === "string" ? input.className.slice(0, 120) : "",
    }));
    const headings = [...document.querySelectorAll("h1,h2,h3,h4,.card-title,.page-heading")]
      .map((el) => (el.innerText || "").replace(/\s+/g, " ").trim())
      .filter(Boolean);
    return {
      title: document.title,
      url: location.href,
      text: text.slice(0, 3000),
      headings,
      links,
      inputs,
    };
  });
}

await mkdir(researchDir, { recursive: true });
await mkdir(refsDir, { recursive: true });

const browser = await chromium.launch({
  headless: true,
  executablePath: chromePath,
});

try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await login(page);

  const results = [];
  for (const route of sampleRoutes) {
    await page.goto(`https://app.traveliun.com${route}`, {
      waitUntil: "domcontentloaded",
      timeout: 30000,
    });
    await page.waitForLoadState("networkidle", { timeout: 12000 }).catch(() => {});
    await page.waitForTimeout(700);
    const slug = route.replace(/^\//, "").replace(/\//g, "-") || "home";
    await page.screenshot({
      path: path.join(refsDir, `${slug}.png`),
      fullPage: true,
    });
    results.push({ route, ...(await extractRoute(page)) });
  }

  await writeFile(
    path.join(researchDir, "routes.json"),
    JSON.stringify(results, null, 2),
    "utf8",
  );

  console.log(JSON.stringify({ ok: true, routes: results.map((item) => item.url) }, null, 2));
} finally {
  await browser.close();
}
