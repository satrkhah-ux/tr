import { createRequire } from "node:module";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

const require = createRequire(import.meta.url);
const { chromium } = require("playwright-core");

const root = process.cwd();
const researchDir = path.join(root, "docs", "research", "traveliun");
const refsDir = path.join(root, "docs", "design-references", "traveliun");
const chromePath =
  process.env.CHROME_PATH || "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";

async function ensureDirs() {
  await mkdir(researchDir, { recursive: true });
  await mkdir(path.join(root, "docs", "research", "components"), { recursive: true });
  await mkdir(refsDir, { recursive: true });
}

async function tryLogin(page) {
  const email = process.env.TRAVELIUN_EMAIL;
  const password = process.env.TRAVELIUN_PASSWORD;
  if (!email || !password) return { attempted: false, reason: "missing env credentials" };

  const emailInput = page
    .locator(
      '#signInEmail, input[type="email"], input[label="email"], input[name*="email" i], input[placeholder*="email" i], input[placeholder*="بريد" i]',
    )
    .first();
  const passwordInput = page
    .locator('#signInPassword, input[type="password"], input[label="password"], input[name*="password" i], input[placeholder*="password" i]')
    .first();

  if ((await emailInput.count()) === 0 || (await passwordInput.count()) === 0) {
    return { attempted: false, reason: "login form not visible" };
  }

  await emailInput.fill(email);
  await passwordInput.fill(password);
  const submit = page
    .locator(
      'button[type="submit"], button:has-text("Login"), button:has-text("Sign in"), button:has-text("دخول"), button:has-text("تسجيل")',
    )
    .first();
  if ((await submit.count()) > 0) {
    await Promise.allSettled([
      page.waitForLoadState("networkidle", { timeout: 15000 }),
      submit.click(),
    ]);
  } else {
    await passwordInput.press("Enter");
    await page.waitForLoadState("networkidle", { timeout: 15000 }).catch(() => {});
  }

  return { attempted: true, url: page.url(), title: await page.title() };
}

async function extractPage(page) {
  return page.evaluate(() => {
    const styleProps = [
      "fontSize",
      "fontWeight",
      "fontFamily",
      "lineHeight",
      "letterSpacing",
      "color",
      "backgroundColor",
      "padding",
      "margin",
      "display",
      "gap",
      "borderRadius",
      "border",
      "boxShadow",
      "position",
      "zIndex",
      "transform",
      "transition",
    ];

    function briefStyles(el) {
      const cs = getComputedStyle(el);
      return Object.fromEntries(
        styleProps
          .map((prop) => [prop, cs[prop]])
          .filter(([, value]) => value && value !== "normal" && value !== "none" && value !== "0px"),
      );
    }

    const visible = [...document.querySelectorAll("body *")].filter((el) => {
      const rect = el.getBoundingClientRect();
      const cs = getComputedStyle(el);
      return rect.width > 0 && rect.height > 0 && cs.visibility !== "hidden" && cs.display !== "none";
    });

    const sections = [...document.querySelectorAll("main, section, aside, header, nav, footer, [class*='card' i]")]
      .filter((el) => {
        const rect = el.getBoundingClientRect();
        return rect.width > 120 && rect.height > 40;
      })
      .slice(0, 80)
      .map((el, index) => {
        const rect = el.getBoundingClientRect();
        return {
          index,
          tag: el.tagName.toLowerCase(),
          id: el.id || null,
          classes: typeof el.className === "string" ? el.className.slice(0, 180) : "",
          rect: {
            x: Math.round(rect.x),
            y: Math.round(rect.y + scrollY),
            width: Math.round(rect.width),
            height: Math.round(rect.height),
          },
          text: (el.innerText || "").replace(/\s+/g, " ").trim().slice(0, 800),
          styles: briefStyles(el),
        };
      });

    const textBlocks = visible
      .map((el) => (el.innerText || "").replace(/\s+/g, " ").trim())
      .filter((text) => text.length > 1 && text.length < 500)
      .filter((text, index, array) => array.indexOf(text) === index)
      .slice(0, 300);

    const buttons = [...document.querySelectorAll("button, a, [role='button']")].map((el) => ({
      tag: el.tagName.toLowerCase(),
      text: (el.innerText || el.getAttribute("aria-label") || "").replace(/\s+/g, " ").trim(),
      href: el.href || null,
      classes: typeof el.className === "string" ? el.className.slice(0, 160) : "",
      styles: briefStyles(el),
    }));

    const assets = {
      images: [...document.querySelectorAll("img")].map((img) => ({
        src: img.currentSrc || img.src,
        alt: img.alt,
        width: img.naturalWidth,
        height: img.naturalHeight,
      })),
      backgrounds: visible
        .map((el) => ({
          element: `${el.tagName.toLowerCase()} ${typeof el.className === "string" ? el.className.slice(0, 100) : ""}`,
          backgroundImage: getComputedStyle(el).backgroundImage,
        }))
        .filter((item) => item.backgroundImage && item.backgroundImage !== "none")
        .slice(0, 200),
      svgs: [...document.querySelectorAll("svg")].map((svg) => ({
        box: svg.getAttribute("viewBox"),
        text: svg.outerHTML.slice(0, 500),
      })),
      favicons: [...document.querySelectorAll('link[rel*="icon"]')].map((link) => ({
        href: link.href,
        rel: link.rel,
        sizes: link.sizes?.toString() || "",
      })),
    };

    const colors = [...new Set(visible.flatMap((el) => {
      const cs = getComputedStyle(el);
      return [cs.color, cs.backgroundColor, cs.borderColor].filter(Boolean);
    }))].slice(0, 120);

    const fonts = [...new Set(visible.map((el) => getComputedStyle(el).fontFamily))].slice(0, 40);

    return {
      title: document.title,
      url: location.href,
      viewport: { width: innerWidth, height: innerHeight },
      bodyText: document.body.innerText.replace(/\s+/g, " ").trim().slice(0, 8000),
      textBlocks,
      buttons,
      sections,
      colors,
      fonts,
      assets,
      htmlClass: document.documentElement.className,
      bodyClass: document.body.className,
    };
  });
}

async function captureViewport(page, name, width, height) {
  await page.setViewportSize({ width, height });
  await page.waitForTimeout(1000);
  await page.screenshot({
    path: path.join(refsDir, `${name}-${width}.png`),
    fullPage: true,
  });
  const data = await extractPage(page);
  await writeFile(
    path.join(researchDir, `${name}-${width}.json`),
    JSON.stringify(data, null, 2),
    "utf8",
  );
}

await ensureDirs();

const browser = await chromium.launch({
  headless: true,
  executablePath: chromePath,
});

try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await page.goto("https://app.traveliun.com/", {
    waitUntil: "domcontentloaded",
    timeout: 45000,
  });
  await page.waitForLoadState("networkidle", { timeout: 20000 }).catch(() => {});

  const loginResult = await tryLogin(page);
  await page.waitForTimeout(2000);

  await captureViewport(page, "desktop", 1440, 900);
  await captureViewport(page, "tablet", 768, 900);
  await captureViewport(page, "mobile", 390, 844);

  await writeFile(
    path.join(researchDir, "inspection-summary.json"),
    JSON.stringify(
      {
        loginResult,
        finalUrl: page.url(),
        title: await page.title(),
        capturedAt: new Date().toISOString(),
      },
      null,
      2,
    ),
    "utf8",
  );

  console.log(JSON.stringify({ ok: true, loginResult, finalUrl: page.url() }, null, 2));
} finally {
  await browser.close();
}
