import "server-only";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

/**
 * The Tajawal Arabic font, base64-encoded, so both the PDF HTML and the print
 * footer embed the exact same glyphs (Arabic shaping + tabular numerals) with no
 * network fetch — the on-screen preview uses the same file via a URL @font-face,
 * so metrics (and therefore pagination) match.
 */
let cache: { regular: string; bold: string } | null = null;

export async function loadTajawalBase64(): Promise<{ regular: string; bold: string }> {
  if (cache) return cache;
  const [regular, bold] = await Promise.all([
    readFile(join(process.cwd(), "public/fonts/Tajawal-Regular.ttf")),
    readFile(join(process.cwd(), "public/fonts/Tajawal-Bold.ttf")),
  ]);
  cache = { regular: regular.toString("base64"), bold: bold.toString("base64") };
  return cache;
}

export function fontFaceCss(fonts: { regular: string; bold: string }): string {
  return `
@font-face{font-family:Tajawal;font-style:normal;font-weight:400;src:url(data:font/ttf;base64,${fonts.regular}) format('truetype');}
@font-face{font-family:Tajawal;font-style:normal;font-weight:700;src:url(data:font/ttf;base64,${fonts.bold}) format('truetype');}`;
}
