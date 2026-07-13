import { createRequire } from "node:module";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

const require = createRequire(import.meta.url);
const { chromium } = require("playwright-core");

const root = process.cwd();
const researchDir = path.join(root, "docs", "research", "traveliun");
const refsDir = path.join(root, "docs", "design-references", "traveliun", "full-system");
const chromePath =
  process.env.CHROME_PATH || "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";

async function login(page) {
  await page.goto("https://app.traveliun.com/sign-in", { waitUntil: "networkidle" });
  await page.fill("#signInEmail", process.env.TRAVELIUN_EMAIL || "");
  await page.fill("#signInPassword", process.env.TRAVELIUN_PASSWORD || "");
  await page.click('button:has-text("Login")');
  await page.waitForURL("**/dashboard", { timeout: 20000 }).catch(() => {});
  await page.waitForLoadState("networkidle", { timeout: 15000 }).catch(() => {});
}

function slugFromUrl(url) {
  const parsed = new URL(url);
  return parsed.pathname.replace(/^\/+/, "").replace(/\/+/g, "-") || "home";
}

async function extractPage(page) {
  return page.evaluate(() => {
    const text = document.body.innerText.replace(/\s+/g, " ").trim();
    const headings = [...document.querySelectorAll("h1,h2,h3,h4,.card-title,.page-heading")]
      .map((el) => (el.innerText || "").replace(/\s+/g, " ").trim())
      .filter(Boolean);
    const tables = [...document.querySelectorAll("table")].map((table) => ({
      headers: [...table.querySelectorAll("thead th")]
        .map((th) => (th.innerText || "").replace(/\s+/g, " ").trim())
        .filter(Boolean),
      rows: [...table.querySelectorAll("tbody tr")].slice(0, 12).map((tr) =>
        [...tr.querySelectorAll("td")]
          .map((td) => (td.innerText || "").replace(/\s+/g, " ").trim())
          .filter(Boolean),
      ),
    }));
    const cards = [...document.querySelectorAll(".card, [class*='card' i], .kanban-item")]
      .map((el) => (el.innerText || "").replace(/\s+/g, " ").trim())
      .filter((item) => item.length > 0)
      .slice(0, 30);
    const controls = [...document.querySelectorAll("button, input, textarea, select, a[href]")]
      .map((el) => ({
        tag: el.tagName.toLowerCase(),
        text: (el.innerText || el.getAttribute("aria-label") || el.getAttribute("title") || "").replace(/\s+/g, " ").trim(),
        href: el.href || null,
        id: el.id || null,
        type: el.getAttribute("type"),
        label: el.getAttribute("label"),
        placeholder: el.getAttribute("placeholder"),
        classes: typeof el.className === "string" ? el.className.slice(0, 150) : "",
      }))
      .filter((item) => item.text || item.href || item.id || item.label || item.placeholder)
      .slice(0, 220);
    return {
      title: document.title,
      url: location.href,
      text: text.slice(0, 7000),
      headings,
      tables,
      cards,
      controls,
    };
  });
}

async function collectLinks(page) {
  return page.evaluate(() => {
    const origin = location.origin;
    const ignored = [/\/offer\/[0-9a-f-]+/i, /\/storage\//i, /#$/];
    return [...document.querySelectorAll("a[href]")]
      .map((a) => ({
        text: (a.innerText || a.title || a.getAttribute("aria-label") || "").replace(/\s+/g, " ").trim(),
        href: a.href,
      }))
      .filter((link) => link.href.startsWith(origin))
      .filter((link) => !ignored.some((pattern) => pattern.test(link.href)))
      .filter((link, index, all) => all.findIndex((item) => item.href === link.href) === index)
      .sort((a, b) => a.href.localeCompare(b.href));
  });
}

async function inspectTopButtons(page) {
  const snapshots = [];
  const buttons = await page.locator("header a, header button, .app-navbar-item a, .app-navbar-item button").evaluateAll((els) =>
    els.map((el, index) => {
      const rect = el.getBoundingClientRect();
      return {
        index,
        text: (el.innerText || el.getAttribute("aria-label") || el.getAttribute("title") || "").replace(/\s+/g, " ").trim(),
        x: Math.round(rect.x),
        y: Math.round(rect.y),
        width: Math.round(rect.width),
        height: Math.round(rect.height),
        classes: typeof el.className === "string" ? el.className.slice(0, 160) : "",
      };
    }).filter((item) => item.width > 10 && item.height > 10 && item.y < 110),
  );

  for (const button of buttons.slice(-8)) {
    await page.mouse.click(button.x + button.width / 2, button.y + button.height / 2);
    await page.waitForTimeout(700);
    const overlay = await page.evaluate(() => {
      const candidates = [...document.querySelectorAll(".menu, .dropdown-menu, [data-popper-placement], .modal, .drawer, .offcanvas")]
        .map((el) => (el.innerText || "").replace(/\s+/g, " ").trim())
        .filter(Boolean);
      return candidates.slice(-6);
    });
    snapshots.push({ button, overlay });
    await page.keyboard.press("Escape").catch(() => {});
    await page.waitForTimeout(200);
  }
  return snapshots;
}

await mkdir(researchDir, { recursive: true });
await mkdir(refsDir, { recursive: true });

const browser = await chromium.launch({ headless: true, executablePath: chromePath });

try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await login(page);
  const links = await collectLinks(page);
  const topButtons = await inspectTopButtons(page);

  const targetLinks = links.filter((link) => {
    const pathname = new URL(link.href).pathname;
    return pathname !== "/" && pathname !== "/404" && !pathname.includes("/offer/");
  });

  const pages = [];
  for (const link of targetLinks) {
    await page.goto(link.href, { waitUntil: "domcontentloaded", timeout: 30000 });
    await page.waitForLoadState("networkidle", { timeout: 12000 }).catch(() => {});
    await page.waitForTimeout(600);
    const data = await extractPage(page);
    const slug = slugFromUrl(page.url());
    if (pages.find((item) => item.url === data.url)) continue;
    await page.screenshot({
      path: path.join(refsDir, `${slug}.png`),
      fullPage: true,
    });
    pages.push({ navText: link.text, requested: link.href, ...data });
  }

  await writeFile(path.join(researchDir, "full-system-links.json"), JSON.stringify(links, null, 2), "utf8");
  await writeFile(path.join(researchDir, "full-system-pages.json"), JSON.stringify(pages, null, 2), "utf8");
  await writeFile(path.join(researchDir, "top-buttons.json"), JSON.stringify(topButtons, null, 2), "utf8");

  console.log(JSON.stringify({ links: links.length, pages: pages.length, topButtons: topButtons.length }, null, 2));
} finally {
  await browser.close();
}
