import "server-only";
import { existsSync } from "node:fs";
import puppeteer, { type Browser } from "puppeteer-core";
import { fontFaceCss, loadTajawalBase64 } from "./fonts";

/**
 * Headless-Chromium print-to-PDF.
 *
 * WHY Chromium (not @react-pdf/renderer or Satori): a real browser layout engine
 * is the only reliable way to get correct Arabic shaping + bidi AND full CSS
 * paged-media behaviour — break-inside/break-after, orphans/widows, repeated
 * table headers, and a running footer with "page X of Y". @react-pdf/renderer's
 * Arabic shaping is unreliable; Satori (next/og) produces a single flat image
 * with no pagination. Printing the SAME DOM/CSS as the on-screen preview is what
 * guarantees preview === PDF.
 *
 * Locally and on the Coolify/VPS target we use puppeteer-core against an
 * already-installed Chrome/Edge (both are Chromium) — no bundled-browser
 * download; override with CHROME_PATH. On serverless hosts (Netlify Functions /
 * AWS Lambda) no desktop browser exists, so we launch the bundled
 * @sparticuz/chromium binary instead.
 */
const CANDIDATES: (string | undefined)[] = [
  process.env.CHROME_PATH,
  "C:/Program Files/Google/Chrome/Application/chrome.exe",
  "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe",
  "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
  "C:/Program Files/Microsoft/Edge/Application/msedge.exe",
  "/usr/bin/google-chrome",
  "/usr/bin/google-chrome-stable",
  "/usr/bin/chromium",
  "/usr/bin/chromium-browser",
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
];

function findExecutable(): string | null {
  for (const path of CANDIDATES) {
    if (path && existsSync(path)) return path;
  }
  return null;
}

/** True on Netlify Functions / AWS Lambda — hosts with no installed desktop browser. */
function isServerless(): boolean {
  return Boolean(
    process.env.NETLIFY ||
      process.env.AWS_LAMBDA_FUNCTION_NAME ||
      process.env.AWS_EXECUTION_ENV ||
      process.env.VERCEL,
  );
}

/**
 * Launch headless Chromium. On serverless hosts there is no installed browser,
 * so use the bundled @sparticuz/chromium binary (loaded dynamically so it is
 * never touched on the local/VPS path); elsewhere use the machine's Chrome/Edge.
 */
async function launchBrowser(): Promise<Browser> {
  if (isServerless()) {
    const { default: chromium } = await import("@sparticuz/chromium");
    // No WebGL/graphics needed for print-to-PDF — disabling it speeds cold start.
    chromium.setGraphicsMode = false;
    return puppeteer.launch({
      executablePath: await chromium.executablePath(),
      args: chromium.args,
      headless: true,
    });
  }
  const executablePath = findExecutable();
  if (!executablePath) {
    throw new Error("No Chromium/Chrome/Edge executable found for PDF rendering. Set CHROME_PATH.");
  }
  return puppeteer.launch({
    executablePath,
    headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox", "--font-render-hinting=none"],
  });
}

export type FooterInfo = { brand: string; serial: string; contact: string };

function footerTemplate(info: FooterInfo, fontCss: string): string {
  // Chromium replaces .pageNumber / .totalPages; footer needs its own font + an
  // explicit size (its default is ~0). RTL, brand+serial · page X of Y · contact.
  return `<style>${fontCss}</style>
<div style="font-family:Tajawal,'Segoe UI',sans-serif;direction:rtl;width:100%;box-sizing:border-box;padding:0 10mm;font-size:8px;color:#557d78;display:flex;justify-content:space-between;align-items:center;">
  <span style="font-weight:700;color:#185045;">${info.brand} · <bdi dir="ltr">${info.serial}</bdi></span>
  <span>صفحة <span class="pageNumber"></span> من <span class="totalPages"></span></span>
  <span>${info.contact}</span>
</div>`;
}

export async function offerDocumentToPdf(html: string, footer: FooterInfo): Promise<Buffer> {
  const fonts = await loadTajawalBase64();

  let browser: Browser | null = null;
  try {
    browser = await launchBrowser();
    const page = await browser.newPage();
    await page.emulateMediaType("print");
    await page.setContent(html, { waitUntil: "load" });
    const pdf = await page.pdf({
      format: "A4",
      printBackground: true,
      preferCSSPageSize: false,
      displayHeaderFooter: true,
      headerTemplate: "<span></span>",
      footerTemplate: footerTemplate(footer, fontFaceCss(fonts)),
      margin: { top: "12mm", bottom: "18mm", left: "9mm", right: "9mm" },
    });
    return Buffer.from(pdf);
  } finally {
    if (browser) await browser.close();
  }
}
