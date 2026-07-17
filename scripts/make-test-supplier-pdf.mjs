// Generates TWO Arabic supplier-PDF fixtures for the repackage extraction engine:
//   supplier-test.pdf         — clean LOGICAL text layer (pdf-lib + Tajawal), like
//                               professional Word/InDesign supplier exports.
//   supplier-test-garbled.pdf — browser print-to-PDF (Chromium): shaped
//                               presentation-form glyphs in visual order; must be
//                               DETECTED as unreliable, never parsed silently.
// Usage: node scripts/make-test-supplier-pdf.mjs <outputDir>
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { PDFDocument } from "pdf-lib";
import fontkit from "@pdf-lib/fontkit";
import puppeteer from "puppeteer-core";

const outDir = process.argv[2] ?? ".";

const LINES = [
  "عرض سياحي — شركة النخبة للسياحة",
  "الوجهة: ماليزيا",
  "البلد: ماليزيا",
  "عدد الليالي: 7 ليالي",
  "الوصول: 10/03/2026",
  "المغادرة: 17/03/2026",
  "المسافرون: 2 بالغين و 1 طفل",
  "المدينة: كوالالمبور - 4 ليالي",
  "المدينة: لنكاوي - 3 ليالي",
  "الفندق: فندق جراند ميلينيوم | غرفة ديلوكس | BB | 4 ليالي",
  "الفندق: منتجع بيلانجي | شاليه | HB | 3 ليالي",
  "يشمل",
  "- الإقامة الفندقية",
  "- الإفطار اليومي",
  "- الاستقبال من المطار",
  "لا يشمل",
  "- تذاكر الطيران الدولية",
  "- التأشيرة",
  "الشروط والأحكام",
  "- الأسعار قابلة للتغيير حسب التوفر",
  "- يلزم عربون 30%",
  "الإجمالي: 7,500 ريال سعودي",
];

// ── clean fixture: logical codepoints via pdf-lib + Tajawal ──────────────────
{
  const doc = await PDFDocument.create();
  doc.registerFontkit(fontkit);
  const font = await doc.embedFont(readFileSync("public/fonts/Tajawal-Regular.ttf"), { subset: true });
  const page = doc.addPage([595, 842]); // A4
  let y = 800;
  for (const line of LINES) {
    page.drawText(line, { x: 40, y, size: 12, font });
    y -= 22;
  }
  writeFileSync(join(outDir, "supplier-test.pdf"), await doc.save());
  console.log("wrote", join(outDir, "supplier-test.pdf"));
}

// ── garbled fixture: Chromium print (visual-order presentation forms) ────────
{
  const CANDIDATES = [
    process.env.CHROME_PATH,
    "C:/Program Files/Google/Chrome/Application/chrome.exe",
    "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe",
    "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
    "C:/Program Files/Microsoft/Edge/Application/msedge.exe",
    "/usr/bin/google-chrome",
    "/usr/bin/chromium",
  ].filter(Boolean);
  const exe = CANDIDATES.find((p) => existsSync(p));
  if (!exe) {
    console.warn("no chromium found — skipped the garbled fixture");
  } else {
    const html = `<!doctype html><html dir="rtl" lang="ar"><head><meta charset="utf-8">
<style>body{font-family:'Segoe UI',Tahoma,sans-serif;font-size:14px;line-height:1.9;padding:24px}</style>
</head><body>${LINES.map((l) => `<div>${l}</div>`).join("")}</body></html>`;
    const browser = await puppeteer.launch({ executablePath: exe, headless: true, args: ["--no-sandbox"] });
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: "load" });
    await page.pdf({ path: join(outDir, "supplier-test-garbled.pdf"), format: "A4" });
    await browser.close();
    console.log("wrote", join(outDir, "supplier-test-garbled.pdf"));
  }
}
