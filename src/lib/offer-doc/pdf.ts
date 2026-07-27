import "server-only";
import { existsSync } from "node:fs";
import puppeteer, { type Browser } from "puppeteer-core";

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

/**
 * Kept for call-site compatibility. The brand/serial/contact live in the
 * DOCUMENT itself (OfferDocument + styles.ts), which prints with the real
 * Tajawal font and the real logo — things Chromium's native footer cannot do.
 */
export type FooterInfo = { brand: string; serial: string; contact: string };

export async function offerDocumentToPdf(html: string, footer?: FooterInfo): Promise<Buffer> {
  void footer; // superseded by the document's own per-page footer
  let browser: Browser | null = null;
  try {
    browser = await launchBrowser();
    const page = await browser.newPage();
    await page.emulateMediaType("print");
    await page.setContent(html, { waitUntil: "load" });
    const pdf = await page.pdf({
      format: "A4",
      printBackground: true,
      // The document lays out its own full-bleed A4 sheets (.od-page: 210×297mm,
      // world-map background to the very edge, its own footer line), so every
      // margin here must be ZERO — any Chromium margin would shrink the page box
      // and leave a white gutter around the artwork. Nothing is drawn by
      // Chromium: displayHeaderFooter stays off.
      preferCSSPageSize: true,
      displayHeaderFooter: false,
      margin: { top: "0", bottom: "0", left: "0", right: "0" },
    });
    return Buffer.from(pdf);
  } finally {
    if (browser) await browser.close();
  }
}
