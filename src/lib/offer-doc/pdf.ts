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
 * Kept for call-site compatibility. The brand/serial/contact now live in the
 * DOCUMENT's own running footer (OfferDocument + styles.ts), which prints with
 * the real Tajawal font and the logo — things Chromium's native footer cannot do.
 */
export type FooterInfo = { brand: string; serial: string; contact: string };

/**
 * Chromium's footer — ONLY the page counter (Arabic label + "N / M"). It has no
 * access to our embedded font, so it uses a system sans; the string is digits +
 * one short word, which renders correctly everywhere.
 */
const PAGE_COUNTER_TEMPLATE = `
<div style="width:100%;box-sizing:border-box;padding:0 16px;font-family:'Segoe UI',Tahoma,sans-serif;font-size:8px;color:#8aa29b;text-align:center;">
  <span>صفحة </span><span class="pageNumber"></span><span> / </span><span class="totalPages"></span>
</div>`;

export async function offerDocumentToPdf(html: string, footer?: FooterInfo): Promise<Buffer> {
  void footer; // superseded by the document's own running footer
  let browser: Browser | null = null;
  try {
    browser = await launchBrowser();
    const page = await browser.newPage();
    await page.emulateMediaType("print");
    await page.setContent(html, { waitUntil: "load" });
    const pdf = await page.pdf({
      format: "A4",
      printBackground: true,
      // Split responsibility:
      //  • the DOCUMENT paints the running header band, footer bar, page
      //    background and watermark via position:fixed (styles.ts) — real font,
      //    real logo, full-bleed colour on EVERY page;
      //  • Chromium paints ONLY the page counter, because CSS counter(pages)
      //    does not resolve inside a fixed box (renders 0/0). It lives in the
      //    reserved 9mm bottom margin, just under our footer bar.
      preferCSSPageSize: true,
      displayHeaderFooter: true,
      headerTemplate: "<span></span>",
      footerTemplate: PAGE_COUNTER_TEMPLATE,
      margin: { top: "0", bottom: "9mm", left: "0", right: "0" },
    });
    return Buffer.from(pdf);
  } finally {
    if (browser) await browser.close();
  }
}
